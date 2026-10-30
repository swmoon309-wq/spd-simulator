import { computeKpis, type KpiSpec } from '@spd/analysis'
import { runModel, type RunResult } from '@spd/sd-engine'
import type { Block, Cell, SectionStatus, TableBlock } from '../../../../shared/reportDoc'
import type { ModelEntry } from '../../catalog'
import { getCompiledModel } from '../../engine/models'
import type { RunRecord } from '../../stores/appStore'
import { adoptionStatus, adoptionSummary } from '../adoption'
import { kpiBarHeight, kpiBarOption, kpiBarSummary } from '../charts/kpiBarOption'
import { kpiRadarOption, kpiRadarSummary } from '../charts/kpiRadarOption'
import { timeSeriesOption } from '../charts/timeSeriesOption'
import { colorFor } from '../palette'
import { defaultParams, formatNumber } from '../params'
import { RUN_SETTING_FIELDS } from '../runSettings'
import { barData, buildComparison, formatDelta, formatValue, GROUP_ORDER, overlayRuns, radarData, type Comparison } from '../scenarioCompare'
import { diffRows } from '../scenarioView'
import { renderChartSvg } from './chartSvg'
import { FIXED_CAVEATS, modelCaveat } from './caveats'
import type { ReportOptions, ReportState } from './model'

/** 한 절을 만든 결과. `reason`은 최신이 아닐 때의 이유. */
export interface Built {
  status: SectionStatus
  reason: string | null
  blocks: Block[]
}

const fresh = (blocks: Block[]): Built => ({ status: 'fresh', reason: null, blocks })
export const unavailable = (status: Exclude<SectionStatus, 'fresh'>, reason: string): Built => ({ status, reason, blocks: [{ kind: 'paragraph', text: reason, tone: 'warning' }] })

const withUnitText = (value: number, unit: string) => `${formatNumber(value)}${unit ? ` ${unit}` : ''}`

// ---------- 기준 실행(현재 입력으로 그 자리에서 계산한다. 4.1: 파일에 저장하지 않고 재현한다) ----------

export interface BaselineRun {
  result: RunResult
  record: RunRecord
  kpis: ReturnType<typeof computeKpis>
}

export function runBaseline(state: ReportState): BaselineRun | { error: string } {
  try {
    const result = runModel(getCompiledModel(state.entry.id), { overrides: state.params, end: state.runSettings.end, dt: state.runSettings.dt, seed: state.runSettings.seed })
    const record: RunRecord = { id: 1, name: '기준', color: colorFor(0), visible: true, params: { ...state.params }, result, kpis: state.entry.kpis(result) }
    return { result, record, kpis: computeKpis(state.entry.kpiSpecs, result, state.params) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------- 개요 ----------

/** 개요의 한 문단: 핵심 지표(일정·공수·결함 그룹의 첫 지표)를 나열한다. 값이 없으면 "미완료". */
export function headline(entry: ModelEntry, kpis: Record<string, number | null>): string {
  const parts: string[] = []
  for (const group of ['schedule', 'cost', 'quality'] as const) {
    const spec = entry.kpiSpecs.find((k) => k.group === group)
    if (spec) parts.push(`${spec.label} ${formatValue(spec, kpis[spec.id] ?? null)}`)
  }
  return parts.join(' · ')
}

export function overviewSection(state: ReportState, options: ReportOptions, baseline: BaselineRun | { error: string }): Built {
  const rows: [string, string][] = [
    ['프로젝트', state.projectName],
    ['모델', `${state.entry.title} (v${state.entry.def.meta.version})`],
    ...(options.author ? ([['작성자', options.author]] as [string, string][]) : []),
    ['작성일', options.date.toISOString().slice(0, 10)]
  ]
  const blocks: Block[] = [{ kind: 'keyValues', rows }]
  if (state.description.trim() !== '') blocks.push({ kind: 'paragraph', text: state.description.trim() })
  if ('error' in baseline) blocks.push({ kind: 'paragraph', tone: 'warning', text: `기준 실행을 할 수 없어 요약 지표를 싣지 못했습니다: ${baseline.error}` })
  else blocks.push({ kind: 'paragraph', text: `현재 입력의 기준 실행: ${headline(state.entry, baseline.kpis)}.` })
  return fresh(blocks)
}

// ---------- 입력 ----------

export function inputsSection(state: ReportState): Built {
  const defaults = defaultParams(state.entry)
  const blocks: Block[] = []
  const changed: string[] = []
  for (const group of state.entry.groups) {
    const rows: Cell[][] = group.params.map((spec) => {
      const c = state.entry.def.constants[spec.name]
      const value = state.params[spec.name] as number
      const diff = value !== defaults[spec.name]
      if (diff) changed.push(c?.label ?? spec.name)
      return [c?.label ?? spec.name, { text: withUnitText(value, c?.unit ?? ''), ...(diff ? { tone: 'strong' as const } : {}) }, withUnitText(defaults[spec.name] as number, c?.unit ?? '')]
    })
    blocks.push({ kind: 'table', caption: group.title, columns: [{ label: '항목' }, { label: '값', align: 'right' }, { label: '기본값', align: 'right' }], rows })
  }
  blocks.push({
    kind: 'keyValues',
    rows: RUN_SETTING_FIELDS.map((f): [string, string] => [f.label, `${formatNumber(state.runSettings[f.key])}${f.unit ? ` ${f.unit}` : ''}`])
  })
  blocks.push({ kind: 'paragraph', tone: 'note', text: changed.length > 0 ? `굵게 표시한 값은 기본값과 다릅니다(${changed.length}개: ${changed.join(', ')}).` : '모든 입력이 기본값입니다.' })
  return fresh(blocks)
}

// ---------- 기준 실행 결과 ----------

export function baselineSection(state: ReportState, options: ReportOptions, baseline: BaselineRun | { error: string }): Built {
  if ('error' in baseline) return unavailable('na', `기준 실행을 할 수 없습니다: ${baseline.error}`)
  const { entry } = state
  const rows: Cell[][] = entry.kpiSpecs.map((spec) => [spec.label, { text: formatValue(spec, baseline.kpis[spec.id] ?? null), tone: 'strong' as const }])
  const blocks: Block[] = [{ kind: 'table', caption: '지표', columns: [{ label: '지표' }, { label: '값', align: 'right' }], rows }]
  const variable = entry.variables.find((v) => v.name === entry.defaultVariable)
  if (variable) {
    const w = options.chartSize === 'large' ? 860 : 720
    const svg = renderChartSvg(timeSeriesOption({ runs: [baseline.record], references: [], live: null, variable }, false, false), w, 360)
    const t = baseline.result.time
    const y = baseline.result.series[variable.name]
    const last = y ? (y[y.length - 1] as number) : null
    blocks.push({ kind: 'chart', title: `${variable.label} (${variable.unit})`, alt: `기준 실행의 ${variable.label}: 시각 ${formatNumber(t[0] as number)}일부터 ${formatNumber(t[t.length - 1] as number)}일까지${last === null ? '' : `, 마지막 값 ${formatNumber(Number(last.toPrecision(5)))}`}.`, svg })
  }
  return fresh(blocks)
}

// ---------- 채택 계획 ----------

export function adoptedSection(state: ReportState): Built {
  const { adopted, entry } = state
  if (!adopted) return unavailable('na', '채택한 계획이 없습니다. 시나리오 탭에서 시나리오를 채택하면 계획 기준선이 만들어집니다.')
  const rows: [string, string][] = [
    ['채택한 시나리오', adopted.scenarioName],
    ['채택 시각', adopted.adoptedAt.slice(0, 10)],
    ['계획', adoptionSummary(adopted)],
    ['기준선 개정', `${adopted.revision}회`],
    ['채택 당시 모델', `v${adopted.model.version}`]
  ]
  const blocks: Block[] = [{ kind: 'keyValues', rows }]
  const status = adoptionStatus(adopted, { modelId: entry.id, params: state.params, settings: state.runSettings, scenarios: state.scenarios }, entry)
  if (!status.linked) blocks.push({ kind: 'paragraph', tone: 'warning', text: '채택한 시나리오가 지금 프로젝트에 없습니다(삭제됨).' })
  else if (status.changes.length > 0) {
    blocks.push({ kind: 'paragraph', tone: 'warning', text: `채택한 뒤 바뀐 입력이 ${status.changes.length}개 있습니다. 채택 계획은 채택 시점의 값으로 고정되어 있습니다.` })
    blocks.push({ kind: 'table', columns: [{ label: '항목' }, { label: '채택 시', align: 'right' }, { label: '지금', align: 'right' }], rows: status.changes.map((c) => [c.label, c.adopted, c.current]) })
  }
  return fresh(blocks)
}

// ---------- 시나리오 목록과 기준과 다른 값 ----------

export function scenariosSection(state: ReportState): Built {
  const { scenarios, entry, params } = state
  if (scenarios.length === 0) return unavailable('na', '시나리오가 없습니다. 기준(기본 설정)만 있습니다.')
  const rows: Cell[][] = []
  for (const sc of scenarios) {
    const diffs = diffRows(entry, params, sc)
    if (diffs.length === 0) rows.push([sc.name, '기준과 같음', '', '', sc.note ?? ''])
    else diffs.forEach((d, i) => rows.push([i === 0 ? sc.name : '', d.label, withUnit(d.base, d.unit), withUnit(d.value, d.unit), i === 0 ? (sc.note ?? '') : '']))
  }
  return fresh([
    { kind: 'paragraph', text: `시나리오 ${scenarios.length}개. 시나리오는 기준(기본 설정)과 달라지는 값만 가집니다.` },
    { kind: 'table', caption: '기준과 다른 값', columns: [{ label: '시나리오' }, { label: '항목' }, { label: '기준', align: 'right' }, { label: '시나리오', align: 'right' }, { label: '메모' }], rows }
  ])
}

const withUnit = (text: string, unit: string) => (unit ? `${text} ${unit}` : text)

// ---------- 지표 비교표 ----------

/** 비교 결과의 신선도: 모든 열이 최신이면 fresh, 하나도 없으면 missing, 그 밖에는 stale(일부 없음·오래됨). */
export function comparisonStatus(c: Comparison): { status: SectionStatus; reason: string | null } {
  const withResult = c.columns.filter((col) => col.hasResult)
  if (withResult.length === 0) return { status: 'missing', reason: '시나리오를 실행하지 않았습니다. 시나리오 탭에서 "전체 실행"을 하거나 "필요한 결과 만들기"를 누르세요.' }
  const missing = c.columns.filter((col) => !col.hasResult).map((col) => col.name)
  const stale = c.columns.filter((col) => col.stale).map((col) => col.name)
  if (missing.length === 0 && stale.length === 0) return { status: 'fresh', reason: null }
  const parts = [...(stale.length > 0 ? [`입력이 바뀌어 오래된 결과: ${stale.join(', ')}`] : []), ...(missing.length > 0 ? [`아직 실행하지 않음: ${missing.join(', ')}`] : [])]
  return { status: 'stale', reason: parts.join(' · ') }
}

function cellFor(spec: KpiSpec, cell: { value: number | null; delta: Parameters<typeof formatDelta>[1] | null }, hasResult: boolean): Cell {
  if (!hasResult) return { text: '미실행', tone: 'dim' }
  // 값과 단위 사이는 줄바꿈하지 않는다(좁은 칸에서 "1,224 / 맨데이"로 갈라지지 않게).
  const text = formatValue(spec, cell.value).replace(/ /g, '\u00a0')
  if (!cell.delta) return text
  const d = formatDelta(spec, cell.delta)
  if (!d) return text
  const tone = d.verdict === '좋음' ? ('better' as const) : d.verdict === '나쁨' ? ('worse' as const) : undefined
  // 색에만 의존하지 않도록 화살표와 판정 글자를 함께 싣는다.
  // 값과 차이를 두 줄로 나눠 좁은 칸에서도 읽히게 한다(칸의 줄바꿈은 그대로 보인다).
  return { text: `${text}\n(${d.arrow} ${d.text}${d.verdict ? ` ${d.verdict}` : ''}${d.percent ? ` ${d.percent}` : ''})`, ...(tone ? { tone } : {}) }
}

export function comparisonSection(state: ReportState, options: ReportOptions, comparison: Comparison): Built {
  const { status, reason } = comparisonStatus(comparison)
  if (status === 'missing') return unavailable('missing', reason as string)
  if (status === 'stale' && !options.includeStale) return unavailable('stale', `${reason}. 숫자를 싣지 않았습니다(오래된 결과를 새것처럼 싣지 않습니다). "필요한 결과 만들기"로 다시 만들거나 "오래된 결과 포함"을 켜세요.`)
  const header = comparison.columns.map((c) => ({ label: c.stale ? `${c.name} (오래됨)` : c.name, align: 'right' as const }))
  const blocks: Block[] = []
  if (status === 'stale') blocks.push({ kind: 'callout', tone: 'warning', title: '오래된 결과 포함', text: reason as string })
  for (const g of comparison.groups) {
    const rows: Cell[][] = g.rows.map((row) => [`${row.spec.label}${row.spec.better === 'lower' ? ' (낮을수록 좋음)' : row.spec.better === 'higher' ? ' (높을수록 좋음)' : ''}`, ...comparison.columns.map((c) => cellFor(row.spec, row.cells[c.id] ?? { value: null, delta: null }, c.hasResult))])
    blocks.push({ kind: 'table', caption: g.label, columns: [{ label: '지표' }, ...header], rows })
  }
  blocks.push({ kind: 'paragraph', tone: 'note', text: '괄호 안은 기준과의 차이입니다. ▲는 기준보다 큰 값, ▼는 작은 값이고, 좋음·나쁨은 지표마다 정한 방향에 따릅니다.' })
  return { status, reason, blocks }
}

// ---------- 차트 ----------

export function chartsSection(state: ReportState, options: ReportOptions, comparison: Comparison): Built {
  const { status, reason } = comparisonStatus(comparison)
  if (status === 'missing') return unavailable('missing', reason as string)
  if (status === 'stale' && !options.includeStale) return unavailable('stale', `${reason}. 차트를 싣지 않았습니다.`)
  const { entry } = state
  const w = options.chartSize === 'large' ? 860 : 720
  const blocks: Block[] = []
  if (status === 'stale') blocks.push({ kind: 'callout', tone: 'warning', title: '오래된 결과 포함', text: reason as string })

  // 막대: 일정·비용·품질 그룹의 첫 지표
  for (const group of GROUP_ORDER) {
    const spec = entry.kpiSpecs.find((k) => k.group === group && k.better !== 'none')
    if (!spec) continue
    const bar = barData(comparison, spec.id)
    if (!bar || bar.categories.length === 0) continue
    const rows: Cell[][] = bar.categories.map((name, i) => [name, formatValue(bar.spec, bar.values[i] ?? null)])
    blocks.push({
      kind: 'chart',
      title: `${spec.label} 비교`,
      alt: `${spec.label}: ${kpiBarSummary(bar)}`,
      svg: renderChartSvg(kpiBarOption(bar, false), w, kpiBarHeight(bar)),
      table: { kind: 'table', caption: `${spec.label}의 값`, columns: [{ label: '시나리오' }, { label: spec.label, align: 'right' }], rows }
    })
  }

  // 레이더: 축이 3개 이상이고 그릴 수 있을 때만
  const radar = radarData(entry, comparison)
  if (radar.ready && radar.axes.length >= 3) {
    const rows: Cell[][] = radar.series.map((s) => [s.name, ...radar.axes.map((_, i) => (s.values[i] ?? 0).toFixed(2))])
    blocks.push({
      kind: 'chart',
      title: '레이더 (기준 = 1, 바깥일수록 기준보다 좋음)',
      alt: kpiRadarSummary(radar),
      svg: renderChartSvg(kpiRadarOption(radar, false), 560, 380),
      table: { kind: 'table', caption: '정규화한 값(1.00 = 기준)', columns: [{ label: '시나리오' }, ...radar.axes.map((a) => ({ label: a.label, align: 'right' as const }))], rows }
    })
  }

  // 시계열: 기본 변수의 실행 겹쳐 보기
  const variable = entry.variables.find((v) => v.name === entry.defaultVariable)
  const overlay = overlayRuns(entry, comparison, state.scenarioRuns)
  if (variable && overlay.length > 0) {
    blocks.push({
      kind: 'chart',
      title: `${variable.label} (${variable.unit}) — 실행 겹쳐 보기`,
      alt: overlay.map((r) => `${r.name}: 완료일 ${r.kpis.completionDay === null ? '미완료' : `${formatNumber(Number(r.kpis.completionDay.toFixed(1)))}일`}`).join(', '),
      svg: renderChartSvg(timeSeriesOption({ runs: overlay, references: [], live: null, variable }, false, false), w, 380),
      table: {
        kind: 'table',
        caption: '실행별 완료일',
        columns: [{ label: '실행' }, { label: '완료일', align: 'right' }],
        rows: overlay.map((r): Cell[] => [r.name, r.kpis.completionDay === null ? '미완료' : `${formatNumber(Number(r.kpis.completionDay.toFixed(1)))}일`])
      }
    })
  }
  if (blocks.length === 0 || blocks.every((b) => b.kind === 'callout')) return unavailable('na', '그릴 수 있는 차트가 없습니다.')
  return { status, reason, blocks }
}

// ---------- 읽을 때 / 만든 조건 ----------

export function readingSection(state: ReportState, notFresh: { title: string; status: SectionStatus; included: boolean; reason: string | null }[]): Built {
  const blocks: Block[] = [{ kind: 'list', items: [...FIXED_CAVEATS, modelCaveat(state.entry)] }]
  if (notFresh.length > 0) {
    blocks.push({
      kind: 'callout',
      tone: 'warning',
      title: '이 보고서에서 최신이 아니거나 빠진 자료',
      text: notFresh.map((n) => `${n.title}: ${n.status === 'stale' ? '오래됨' : n.status === 'missing' ? '없음' : '해당 없음'}${n.reason ? `(${n.reason})` : ''}${n.included ? '' : ' — 싣지 않음'}`).join('\n')
    })
  }
  return fresh(blocks)
}

function riskConditions(state: ReportState): [string, string][] {
  const { settings, run } = state.risk
  return [['위험 분석', `반복 ${settings.n}회, 시드 ${settings.seed}, 불확실한 입력 ${settings.inputs.length}개${run?.result ? `, 실제 완료 ${run.result.completed}회` : ''}`]]
}

function statusConditions(state: ReportState, options: ReportOptions): [string, string][] {
  const days = state.control.actuals.length
  return [['통제', `실적 ${days}건, 보고 기준일 ${options.reportDay != null ? `${options.reportDay}일` : '최근 보고일'}, 최근 구간 ${state.control.evm.k}개, 기준선 개정 ${state.control.revisions.length}회`]]
}

export function conditionsSection(state: ReportState, options: ReportOptions): Built {
  const rows: [string, string][] = [
    ['앱', state.appName],
    ['모델', `${state.entry.id} v${state.entry.def.meta.version}`],
    ['실행 설정', RUN_SETTING_FIELDS.map((f) => `${f.label} ${formatNumber(state.runSettings[f.key])}${f.unit}`).join(', ')],
    ['시나리오', `${state.scenarios.length}개`],
    ['채택 계획', state.adopted ? state.adopted.scenarioName : '없음'],
    ...(options.kind === 'risk' ? riskConditions(state) : []),
    ...(options.kind === 'status' ? statusConditions(state, options) : []),
    ['만든 시각', options.date.toISOString()]
  ]
  return fresh([{ kind: 'keyValues', rows }, { kind: 'paragraph', tone: 'note', text: '같은 프로젝트 파일과 같은 조건이면 같은 숫자가 나옵니다.' }])
}

