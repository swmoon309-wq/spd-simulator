import {
  compareValue,
  computeKpis,
  normalizeForRadar,
  type KpiDelta,
  type KpiGroup,
  type KpiSpec,
  type KpiValues,
  type RadarAxis
} from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import type { ModelEntry } from '../catalog'
import type { RunRecord } from '../stores/appStore'
import { scenarioColor } from './palette'
import { BASE_ID, rowStatus, taskFor, type RowStatus, type ScenarioInputs, type ScenarioRun } from './scenarioRunner'

export const GROUP_LABEL: Record<KpiGroup, string> = { schedule: '일정', cost: '비용', quality: '품질', risk: '위험' }
export const GROUP_ORDER: KpiGroup[] = ['schedule', 'cost', 'quality', 'risk']

/** 기준 시나리오의 색(시나리오 색과 겹치지 않는 무채색). */
export const BASE_COLOR = '#7A7A7A'

export interface CompareColumn {
  id: string
  name: string
  /** 기준은 null */
  color: string | null
  status: RowStatus['kind']
  hasResult: boolean
  /** 결과는 있지만 현재 입력과 다르다 */
  stale: boolean
  kpis: KpiValues | null
}

export interface CompareCell {
  value: number | null
  /** 기준 열은 null */
  delta: KpiDelta | null
}

export interface CompareRow {
  spec: KpiSpec
  cells: Record<string, CompareCell>
}

export interface Comparison {
  columns: CompareColumn[]
  groups: { group: KpiGroup; label: string; rows: CompareRow[] }[]
  /** 기준의 결과가 있어 차이를 계산할 수 있다 */
  baseReady: boolean
  anyStale: boolean
}

/** 결과 하나의 지표. 같은 결과 객체는 같은 파라미터로 만들어졌으므로 결과 객체로 캐시한다. */
const kpiCache = new WeakMap<RunResult, KpiValues>()

function kpisOf(entry: ModelEntry, run: ScenarioRun | undefined, fallback: Record<string, number>): KpiValues | null {
  const result = run?.result
  if (!result) return null
  let k = kpiCache.get(result)
  if (!k) {
    k = computeKpis(entry.kpiSpecs, result, run.resultParams ?? fallback)
    kpiCache.set(result, k)
  }
  return k
}

/** 기준과 시나리오의 지표를 표 구조로 만든다. 지표는 각 결과를 만든 입력으로 계산한다(오래된 결과도 자기 입력으로). */
export function buildComparison(entry: ModelEntry, inputs: ScenarioInputs, runs: Record<string, ScenarioRun | undefined>): Comparison {
  const ids = [BASE_ID, ...inputs.scenarios.map((s) => s.id)]
  const columns: CompareColumn[] = ids.map((id) => {
    const task = taskFor(inputs, id)
    const run = runs[id]
    const status = rowStatus(run, task?.key ?? '')
    const hasResult = run?.result !== undefined
    return {
      id,
      name: id === BASE_ID ? '기준' : (inputs.scenarios.find((s) => s.id === id)?.name ?? id),
      color: id === BASE_ID ? null : scenarioColor(id),
      status: status.kind,
      hasResult,
      stale: hasResult && run?.resultKey !== task?.key,
      kpis: kpisOf(entry, run, task?.params ?? {})
    }
  })
  const base = columns[0] as CompareColumn

  const groups = GROUP_ORDER.flatMap((group) => {
    const specs = entry.kpiSpecs.filter((k) => k.group === group)
    if (specs.length === 0) return []
    const rows: CompareRow[] = specs.map((spec) => {
      const cells: Record<string, CompareCell> = {}
      for (const col of columns) {
        const value = col.kpis ? (col.kpis[spec.id] ?? null) : null
        const isBase = col.id === BASE_ID
        cells[col.id] = {
          value,
          delta: isBase || !col.kpis ? null : compareValue(spec.better, base.kpis ? (base.kpis[spec.id] ?? null) : null, value)
        }
      }
      return { spec, cells }
    })
    // 값이 없는 이유가 하나뿐이 아닌 지표(`emptyLabel`, 예: 단가를 정하지 않은 비용)는 모든 열이 비었으면 줄을 감춘다.
    const shown = rows.filter((r) => !(r.spec.emptyLabel !== undefined && Object.values(r.cells).every((c) => c.value === null)))
    if (shown.length === 0) return []
    return [{ group, label: GROUP_LABEL[group], rows: shown }]
  })

  return { columns, groups, baseReady: base.hasResult, anyStale: columns.some((c) => c.stale) }
}

const nf = (v: number, decimals: number) => v.toLocaleString('ko-KR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** 한 글자 단위(일, 명)와 %는 붙여 쓰고 나머지는 띄어 쓴다. */
export function withUnit(text: string, unit: string): string {
  if (!unit) return text
  return unit.length === 1 || unit === '%' ? `${text}${unit}` : `${text} ${unit}`
}

/** 지표 값 표시. 계산할 수 없는 값(완료하지 못함 등)은 "미완료"(지표가 `emptyLabel`을 정했으면 그 글자). */
export function formatValue(spec: Pick<KpiSpec, 'decimals' | 'unit'> & { emptyLabel?: string }, value: number | null): string {
  return value === null ? (spec.emptyLabel ?? '미완료') : withUnit(nf(value, spec.decimals), spec.unit)
}

export interface DeltaText {
  /** 부호와 값, 단위. 같으면 "변화 없음" */
  text: string
  /** 값이 기준보다 크면 ▲, 작으면 ▼, 같으면 ＝ */
  arrow: '▲' | '▼' | '＝'
  /** 판정 글자. 방향이 없는 지표는 빈 문자열 */
  verdict: '좋음' | '나쁨' | '같음' | ''
  /** 기준 대비 변화율("+12.3%"). 기준이 0이면 null */
  percent: string | null
}

/** 차이 표시. 색에 의존하지 않도록 화살표와 판정 글자를 함께 만든다. */
export function formatDelta(spec: Pick<KpiSpec, 'decimals' | 'unit'>, delta: KpiDelta): DeltaText | null {
  if (delta.diff === null) return null
  // 표시 자릿수에서 0으로 보이는 차이는 "같음"으로 취급한다(좋음/나쁨을 주장하지 않는다).
  const shown = Number(Math.abs(delta.diff).toFixed(spec.decimals))
  const same = delta.verdict === 'same' || shown === 0
  const directional = delta.verdict !== 'n/a'
  const sign = delta.diff > 0 ? '+' : '−'
  const percent = delta.ratio === null ? null : `${delta.ratio > 0 ? '+' : delta.ratio < 0 ? '−' : ''}${(Math.abs(delta.ratio) * 100).toFixed(1)}%`
  return {
    text: same ? '변화 없음' : `${sign}${withUnit(nf(shown, spec.decimals), spec.unit)}`,
    arrow: same ? '＝' : delta.diff > 0 ? '▲' : '▼',
    verdict: !directional ? '' : same ? '같음' : delta.verdict === 'better' ? '좋음' : '나쁨',
    percent
  }
}

export function isHidden(hidden: Record<string, true | undefined>, id: string): boolean {
  return hidden[id] === true
}

export interface BarData {
  spec: KpiSpec
  categories: string[]
  /** 완료하지 못한 항목은 null */
  values: (number | null)[]
  colors: string[]
  baseValue: number | null
}

/** 막대 차트 데이터. 결과가 있고 보이기로 한 열만 담는다(기준 포함). */
export function barData(comparison: Comparison, specId: string, hidden: Record<string, true | undefined> = {}): BarData | null {
  const row = comparison.groups.flatMap((g) => g.rows).find((r) => r.spec.id === specId)
  if (!row) return null
  const cols = comparison.columns.filter((c) => c.kpis && !isHidden(hidden, c.id))
  return {
    spec: row.spec,
    categories: cols.map((c) => c.name),
    values: cols.map((c) => row.cells[c.id]?.value ?? null),
    colors: cols.map((c) => c.color ?? BASE_COLOR),
    baseValue: comparison.columns[0]?.kpis ? (row.cells[BASE_ID]?.value ?? null) : null
  }
}

export interface RadarData {
  /** 3개 이상이어야 그린다 */
  ready: boolean
  reason: string | null
  axes: RadarAxis[]
  skipped: { axis: RadarAxis; reason: string }[]
  series: { id: string; name: string; color: string; values: number[] }[]
  excluded: { name: string; reason: string }[]
}

/**
 * 레이더 차트 데이터. 기준 = 1로 정규화한다. 그릴 수 없는 축은 이유와 함께 빼고, 일부 축의 값이 없는
 * 시나리오(완료하지 못함)는 0으로 그려 오해를 주지 않도록 통째로 제외하고 이유를 알린다.
 */
export function radarData(entry: ModelEntry, comparison: Comparison, hidden: Record<string, true | undefined> = {}): RadarData {
  const empty = (reason: string): RadarData => ({ ready: false, reason, axes: [], skipped: [], series: [], excluded: [] })
  const base = comparison.columns[0] as CompareColumn
  if (!base.kpis) return empty('기준을 먼저 실행하세요.')

  const others = comparison.columns.slice(1).filter((c) => c.kpis && !isHidden(hidden, c.id))
  const norm = normalizeForRadar(entry.radarAxes, entry.kpiSpecs, base.kpis, others.map((c) => ({ id: c.id, kpis: c.kpis as KpiValues })))
  if (norm.axes.length < 3) {
    return {
      ...empty(
        entry.radarAxes.length < 3
          ? `이 모델은 비교 축이 ${entry.radarAxes.length}개뿐이라 레이더를 그리지 않습니다. 비교 표와 막대 차트를 쓰세요.`
          : `그릴 수 있는 축이 ${norm.axes.length}개뿐이라 레이더를 그리지 않습니다(3개 이상 필요).`
      ),
      axes: norm.axes,
      skipped: norm.skipped
    }
  }

  const series: RadarData['series'] = []
  const excluded: RadarData['excluded'] = []
  others.forEach((col, i) => {
    const values = norm.series[i]?.values ?? []
    if (values.some((v) => v === null)) excluded.push({ name: col.name, reason: '완료하지 못해 일부 축의 값이 없습니다' })
    else series.push({ id: col.id, name: col.name, color: col.color ?? BASE_COLOR, values: values as number[] })
  })
  return { ready: true, reason: null, axes: norm.axes, skipped: norm.skipped, series, excluded }
}

/** 시계열 겹치기에 넘길 실행 기록 모양으로 바꾼다. 결과가 있고 보이기로 한 열만(오래된 결과는 이름에 표시). */
export function overlayRuns(
  entry: ModelEntry,
  comparison: Comparison,
  runs: Record<string, ScenarioRun | undefined>,
  hidden: Record<string, true | undefined> = {}
): RunRecord[] {
  return comparison.columns.flatMap((col, i) => {
    const run = runs[col.id]
    if (!run?.result || isHidden(hidden, col.id)) return []
    return [
      {
        id: i + 1,
        name: col.stale ? `${col.name} (오래됨)` : col.name,
        color: col.color ?? BASE_COLOR,
        visible: true,
        params: run.resultParams ?? {},
        result: run.result,
        kpis: entry.kpis(run.result)
      }
    ]
  })
}
