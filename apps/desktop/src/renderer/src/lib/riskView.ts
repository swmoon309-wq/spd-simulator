import {
  bandSummary,
  compareResults,
  convergence,
  distMean,
  histogram,
  kpiDistribution,
  quantileCI,
  requiredSamples,
  sturges,
  summarize,
  targetProbability,
  type BandPoint,
  type Comparison,
  type ConvergencePoint,
  type DistSpec,
  type Interval,
  type KpiDistribution,
  type KpiSpec,
  type McResult,
  type McTarget,
  type RankEntry,
  type TargetProbability,
  type TornadoEntry
} from '@spd/analysis'
import type { ModelEntry } from '../catalog'

/** 분포 종류를 바꿀 때 허용 범위 안으로 맞춘다. */
interface Bounds {
  min: number
  max: number
}

export type DistKind = DistSpec['kind']

/** 분포 입력칸: 키와 화면 이름. 절단 정규의 절단 범위는 파라미터의 허용 범위로 채우므로 입력받지 않는다. */
export function distFields(kind: DistKind): { key: string; label: string }[] {
  switch (kind) {
    case 'uniform':
      return [
        { key: 'min', label: '최소' },
        { key: 'max', label: '최대' }
      ]
    case 'triangular':
    case 'pert':
      return [
        { key: 'min', label: '최소' },
        { key: 'mode', label: '최빈' },
        { key: 'max', label: '최대' }
      ]
    case 'normal':
      return [
        { key: 'mean', label: '평균' },
        { key: 'sd', label: '표준편차' }
      ]
  }
}

export function distValue(dist: DistSpec, key: string): number {
  return (dist as unknown as Record<string, number>)[key] as number
}

export function withDistValue(dist: DistSpec, key: string, value: number): DistSpec {
  return { ...dist, [key]: value } as DistSpec
}

const clean = (x: number): number => Number(x.toPrecision(12))

/**
 * 분포 종류를 바꾼다. 값은 이전 분포의 범위와 평균에서 이어받아, 종류만 바꿔도 비슷한 모양이 남는다.
 * 같은 종류면 그대로 돌려준다.
 */
export function changeDistKind(dist: DistSpec, kind: DistKind, bounds: Bounds, integer = false): DistSpec {
  if (dist.kind === kind) return dist
  const mean = distMean(dist)
  let lo: number
  let hi: number
  if (dist.kind === 'normal') {
    lo = dist.mean - 2 * dist.sd
    hi = dist.mean + 2 * dist.sd
  } else {
    lo = dist.min
    hi = dist.max
  }
  const fit = (x: number) => {
    const c = Math.min(bounds.max, Math.max(bounds.min, x))
    return integer ? Math.round(c) : clean(c)
  }
  lo = fit(lo)
  hi = fit(hi)
  // 최빈값이 있는 분포에서 오면 그 값을 이어받고, 없으면(균등·정규) 평균을 쓴다.
  const mid = Math.min(hi, Math.max(lo, fit('mode' in dist ? dist.mode : mean)))
  switch (kind) {
    case 'uniform':
      return { kind, min: lo, max: hi }
    case 'triangular':
    case 'pert':
      return { kind, min: lo, mode: mid, max: hi }
    case 'normal':
      return { kind, mean: clean(mean), sd: clean(Math.max((hi - lo) / 4, Number.EPSILON)) }
  }
}

/** 분포를 한 줄로 요약한다(목록 접힌 모습·접근성 이름용). */
export function distText(dist: DistSpec): string {
  const f = (x: number) => String(clean(x))
  switch (dist.kind) {
    case 'uniform':
      return `균등 ${f(dist.min)} ~ ${f(dist.max)}`
    case 'triangular':
      return `삼각 ${f(dist.min)} / ${f(dist.mode)} / ${f(dist.max)}`
    case 'pert':
      return `PERT ${f(dist.min)} / ${f(dist.mode)} / ${f(dist.max)}`
    case 'normal':
      return `정규 평균 ${f(dist.mean)}, 표준편차 ${f(dist.sd)}`
  }
}

export interface HistogramBar {
  from: number
  to: number
  count: number
  /** 지표가 있는 반복 중 이 구간의 비율(0~1) */
  share: number
}

export interface DistributionView {
  kpiId: string
  dist: KpiDistribution
  bars: HistogramBar[]
  /** 신뢰 수준 차트(누적분포) 점: `[값, 그 값 이하일 확률(0~1)]`. 점이 많으면 줄인다. */
  cdf: [number, number][]
  /** P50·P80·P90의 값과 95% 구간 */
  quantiles: { p: number; label: string; value: number; ci: Interval }[]
}

const CDF_POINTS = 200
export const MIN_BINS = 2
export const MAX_BINS = 50

/** 결과 → 한 지표의 분포 화면 자료. 지표 값이 하나도 없으면 막대와 곡선이 비어 있다. */
export function distributionView(result: McResult, kpiId: string, bins?: number): DistributionView {
  const dist = kpiDistribution(result, kpiId)
  const n = dist.sorted.length
  const h = histogram(dist.sorted, bins === undefined ? undefined : Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(bins))))
  const bars = h.counts.map((count, i) => ({ from: h.edges[i] as number, to: h.edges[i + 1] as number, count, share: n === 0 ? 0 : count / n }))
  const step = Math.max(1, Math.ceil(n / CDF_POINTS))
  const cdf: [number, number][] = []
  for (let i = 0; i < n; i += step) cdf.push([dist.sorted[i] as number, (i + 1) / n])
  if (n > 0 && cdf[cdf.length - 1]?.[1] !== 1) cdf.push([dist.sorted[n - 1] as number, 1])
  const quantiles =
    n === 0
      ? []
      : [0.5, 0.8, 0.9].map((p) => ({ p, label: `P${Math.round(p * 100)}`, value: dist.summary.percentiles[String(p)] as number, ci: quantileCI(dist.sorted, p) }))
  return { kpiId, dist, bars, cdf, quantiles }
}

/** 구간 수를 정하지 않았을 때 쓰는 값(Sturges). 입력칸의 초기값. */
export const autoBins = (n: number): number => Math.min(MAX_BINS, Math.max(MIN_BINS, sturges(n)))

/** 시계열 띠: 선택한 변수가 있고 결과에 띠가 있을 때만. */
export function bandView(result: McResult): { variable: string; points: BandPoint[] } | null {
  if (!result.band) return null
  const points = bandSummary(result)
  return points.length === 0 ? null : { variable: result.band.variable, points }
}

export type RiskStatusKind = 'idle' | 'running' | 'done' | 'canceled' | 'error'

/** 상태 줄의 글. `stale`이면 입력이 바뀌어 결과가 오래되었다는 안내를 덧붙인다. */
export function riskStatusText(status: RiskStatusKind, completed: number, total: number, stale: boolean): string {
  const base =
    status === 'idle'
      ? '아직 실행하지 않았습니다.'
      : status === 'running'
        ? `실행 중 ${completed}/${total}회`
        : status === 'canceled'
          ? `취소됨 — ${completed}/${total}회까지의 결과입니다.`
          : status === 'error'
            ? '실행하지 못했습니다.'
            : `${completed}회 완료`
  return stale && (status === 'done' || status === 'canceled') ? `${base} 입력이 바뀌어 결과가 오래되었습니다. 다시 실행하세요.` : base
}

// ---------- 목표 확률 (RSK-04) ----------

/** 지표의 방향에 맞는 기본 부등호: 낮을수록 좋으면 `≤`, 아니면 `≥`. */
export const defaultOp = (spec: Pick<KpiSpec, 'better'>): McTarget['op'] => (spec.better === 'higher' ? '>=' : '<=')

/** 채택 계획이 있으면 그 완료일·예산(BAC)을 목표로 채운다. 이 모델에 없는 지표는 건너뛴다. */
export function adoptedTargets(entry: ModelEntry, adopted: { plannedCompletion: number; bac: number } | null): McTarget[] {
  if (!adopted) return []
  const out: McTarget[] = []
  if (entry.kpiSpecs.some((k) => k.id === 'completionDay')) out.push({ kpi: 'completionDay', op: '<=', value: adopted.plannedCompletion })
  if (entry.kpiSpecs.some((k) => k.id === 'totalEffort')) out.push({ kpi: 'totalEffort', op: '<=', value: adopted.bac })
  return out
}

export interface TargetRow {
  target: McTarget
  /** 이 목표 하나만의 확률 */
  prob: TargetProbability
}

export interface TargetView {
  rows: TargetRow[]
  /** 모든 목표를 함께 만족할 확률. 목표가 둘 이상일 때만 */
  joint: TargetProbability | null
}

/** 목표별 확률과 동시 달성 확률(같은 반복의 쌍으로 센다). */
export function targetView(result: McResult, targets: McTarget[]): TargetView {
  const rows = targets.map((t) => ({ target: t, prob: targetProbability(result, [t]) }))
  return { rows, joint: targets.length >= 2 ? targetProbability(result, targets) : null }
}

/** 확률을 "63.2%"로. */
export const pct = (p: number): string => (Number.isFinite(p) ? `${(p * 100).toFixed(1)}%` : '–')

// ---------- 민감도 토네이도 (RSK-05) ----------

export interface TornadoBar {
  name: string
  label: string
  /** 낮은/높은 값에서의 지표(모르면 null) */
  kpiLow: number | null
  kpiHigh: number | null
  /** 바의 왼쪽 끝과 폭. 폭을 모르면 null */
  from: number | null
  swing: number | null
  low: number
  high: number
}

/** OAT 토네이도 막대: 지표가 낮은 쪽부터 높은 쪽까지의 구간. 폭이 큰 순서는 이미 정렬되어 있다. */
export function oatBars(entries: TornadoEntry[], labelOf: (name: string) => string): TornadoBar[] {
  return entries.map((e) => ({
    name: e.name,
    label: labelOf(e.name),
    kpiLow: e.kpiLow,
    kpiHigh: e.kpiHigh,
    from: e.kpiLow !== null && e.kpiHigh !== null ? Math.min(e.kpiLow, e.kpiHigh) : null,
    swing: e.swing,
    low: e.low,
    high: e.high
  }))
}

/**
 * 두 토네이도(OAT, 순위상관)에서 가장 영향이 큰 입력이 다르면 안내 문구를, 같으면 null.
 * 상호작용이나 비단조 효과의 신호일 수 있다(설계 06의 6.2).
 */
export function tornadoDisagreement(oat: TornadoEntry[], rank: RankEntry[], labelOf: (name: string) => string): string | null {
  const a = oat.find((e) => e.swing !== null && e.swing > 0)
  const b = rank.find((r) => Number.isFinite(r.rho))
  if (!a || !b || a.name === b.name) return null
  return `한 번에 하나씩 바꾸면 '${labelOf(a.name)}'이(가), 함께 흔들면 '${labelOf(b.name)}'이(가) 가장 큽니다. 입력끼리의 상호작용이나 비단조 효과일 수 있습니다.`
}

// ---------- 수렴 (RSK-08) ----------

export interface ConvergenceView {
  points: ConvergencePoint[]
  /** 전체 표본의 평균 신뢰구간 반폭과 표준편차 */
  half: number
  sd: number
  n: number
}

/** 반복 순서대로 쌓은 누적 평균·P80과 평균의 신뢰구간 반폭. 지표가 없는 반복은 건너뛴다. */
export function convergenceView(result: McResult, kpiId: string, steps = 10): ConvergenceView | null {
  const j = result.kpiIds.indexOf(kpiId)
  if (j < 0) return null
  const col = result.kpis[j] as Float64Array
  const values: number[] = []
  for (let i = 0; i < result.completed; i++) if (result.status[i] !== 1 && Number.isFinite(col[i] as number)) values.push(col[i] as number)
  if (values.length < 2) return null
  const points = convergence(values, 0.8, steps)
  const s = summarize(values)
  const last = points[points.length - 1]
  return { points, half: last ? last.half : NaN, sd: s.sd, n: values.length }
}

/** 목표 반폭 `h*`를 얻으려면 필요한 반복 수와 지금 충분한지. 반폭이 올바르지 않으면 null. */
export function requiredIterations(view: ConvergenceView, targetHalf: number): { needed: number; enough: boolean } | null {
  if (!(targetHalf > 0) || !Number.isFinite(targetHalf)) return null
  const needed = requiredSamples(view.sd, targetHalf)
  return { needed, enough: view.n >= needed }
}

// ---------- 시나리오 간 비교 (RSK-07) ----------

export interface ComparePair {
  /** 앞(A)과 뒤(B) 시나리오 id */
  a: string
  b: string
  cmp: Comparison
}

export interface CompareView {
  /** 시나리오별 지표 분포 */
  items: { id: string; dist: KpiDistribution; cdf: [number, number][] }[]
  /** 첫 번째(기준으로 삼는) 시나리오와 나머지의 쌍별 비교 */
  pairs: ComparePair[]
}

/** 비교 결과 → 화면 자료. 첫 시나리오를 A로 두고 나머지를 B로 쌍별 비교한다. */
export function compareView(results: { id: string; result: McResult }[], kpiId: string): CompareView {
  const items = results.map(({ id, result }) => {
    const dist = kpiDistribution(result, kpiId)
    const n = dist.sorted.length
    const step = Math.max(1, Math.ceil(n / CDF_POINTS))
    const cdf: [number, number][] = []
    for (let i = 0; i < n; i += step) cdf.push([dist.sorted[i] as number, (i + 1) / n])
    if (n > 0 && cdf[cdf.length - 1]?.[1] !== 1) cdf.push([dist.sorted[n - 1] as number, 1])
    return { id, dist, cdf }
  })
  const first = results[0]
  const pairs = first ? results.slice(1).map((r) => ({ a: first.id, b: r.id, cmp: compareResults(first.result, r.result, kpiId) })) : []
  return { items, pairs }
}

/** 쌍별 비교를 한 문장으로: 낮을수록 좋은 지표는 "A가 더 낮을 확률", 높을수록 좋으면 "A가 더 높을 확률", 방향이 없으면 "A가 더 작을 확률". */
export function compareSentence(spec: Pick<KpiSpec, 'label' | 'better'>, aName: string, bName: string, cmp: Comparison): string {
  if (cmp.pairs === 0) return '비교할 수 있는 반복이 없습니다.'
  if (spec.better === 'higher') return `${aName}의 ${spec.label}이(가) ${bName}보다 높을 확률 ${pct(1 - cmp.probALess - cmp.probTie)}`
  return `${aName}의 ${spec.label}이(가) ${bName}보다 ${spec.better === 'lower' ? '낮을(더 좋을)' : '작을'} 확률 ${pct(cmp.probALess)}`
}
