import { normalPpf, tPpf } from './distributions'

/** 정렬된 표본의 `p` 백분위수(선형 보간, 순위 `(n − 1)p + 1`). R·numpy의 기본(type 7)과 같다. */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  if (n === 1) return sorted[0] as number
  const pos = (n - 1) * Math.min(1, Math.max(0, p))
  const lo = Math.floor(pos)
  const hi = Math.min(n - 1, lo + 1)
  return (sorted[lo] as number) + (pos - lo) * ((sorted[hi] as number) - (sorted[lo] as number))
}

/** 유한한 값만 모아 오름차순으로 정렬한 복사본. */
export function finiteSorted(values: ArrayLike<number>): Float64Array {
  const out: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) out.push(values[i] as number)
  return Float64Array.from(out).sort()
}

export const SUMMARY_PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.8, 0.9, 0.95] as const

export interface Summary {
  n: number
  mean: number
  /** 표본 표준편차(n − 1). n < 2이면 0 */
  sd: number
  min: number
  max: number
  /** `SUMMARY_PERCENTILES` 순서 */
  percentiles: Record<string, number>
}

/** 요약 통계(유한한 값만). 개수가 0이면 값은 NaN. */
export function summarize(values: ArrayLike<number>): Summary {
  const s = finiteSorted(values)
  const n = s.length
  if (n === 0) return { n: 0, mean: NaN, sd: 0, min: NaN, max: NaN, percentiles: Object.fromEntries(SUMMARY_PERCENTILES.map((p) => [String(p), NaN])) }
  let sum = 0
  for (const v of s) sum += v
  const mean = sum / n
  let ss = 0
  for (const v of s) ss += (v - mean) ** 2
  return {
    n,
    mean,
    sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0,
    min: s[0] as number,
    max: s[n - 1] as number,
    percentiles: Object.fromEntries(SUMMARY_PERCENTILES.map((p) => [String(p), percentileSorted(s, p)]))
  }
}

export interface Interval {
  low: number
  high: number
}

/**
 * 평균의 신뢰구간(책 A.6.1): `평균 ± t(α/2, n − 1)·s/√n`. 책은 n ≥ 30이면 정규, 미만이면 t를 쓰라고 한다. t 분위수는 n이 크면
 * 정규에 수렴하므로 하나의 식으로 둘을 처리한다.
 */
export function meanCI(mean: number, sd: number, n: number, level = 0.95): Interval & { half: number } {
  if (n < 2) return { low: mean, high: mean, half: 0 }
  const half = (tPpf(1 - (1 - level) / 2, n - 1) * sd) / Math.sqrt(n)
  return { low: mean - half, high: mean + half, half }
}

/** 분위수의 신뢰구간: 정렬한 표본의 순위로 구한다(정규 근사). `p`는 0~1. */
export function quantileCI(sorted: ArrayLike<number>, p: number, level = 0.95): Interval {
  const n = sorted.length
  if (n === 0) return { low: NaN, high: NaN }
  const z = normalPpf(1 - (1 - level) / 2)
  const spread = z * Math.sqrt(n * p * (1 - p))
  const l = Math.max(1, Math.floor(n * p - spread))
  const u = Math.min(n, Math.ceil(n * p + spread) + 1)
  return { low: sorted[l - 1] as number, high: sorted[u - 1] as number }
}

/** 이항 비율의 Wilson 구간. */
export function wilson(k: number, n: number, level = 0.95): Interval & { p: number } {
  if (n <= 0) return { p: NaN, low: NaN, high: NaN }
  const z = normalPpf(1 - (1 - level) / 2)
  const p = k / n
  const denom = 1 + (z * z) / n
  const center = (p + (z * z) / (2 * n)) / denom
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom
  // 경계(0/n, n/n)에서는 구간의 한쪽 끝이 수학적으로 정확히 0 또는 1이다.
  return { p, low: k <= 0 ? 0 : Math.max(0, center - margin), high: k >= n ? 1 : Math.min(1, center + margin) }
}

/** 이 반폭 `half`를 얻는 데 필요한 표본 수(책 A.6.1의 표본 크기 관계 `n ≥ (z·s/h)²`). */
export function requiredSamples(sd: number, half: number, level = 0.95): number {
  if (!(half > 0)) return Infinity
  const z = normalPpf(1 - (1 - level) / 2)
  return Math.ceil(((z * sd) / half) ** 2)
}

export interface Histogram {
  /** 구간 경계(개수 = 구간 수 + 1) */
  edges: number[]
  counts: number[]
  binWidth: number
}

/** Sturges 규칙의 구간 수 `⌈log₂ n⌉ + 1`. */
export const sturges = (n: number): number => Math.max(1, Math.ceil(Math.log2(Math.max(1, n))) + 1)

/** 보기 좋은 구간 폭(1, 2, 2.5, 5 × 10^k 중 `raw` 이상인 가장 작은 것). */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const exp = Math.floor(Math.log10(raw))
  const base = 10 ** exp
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= raw - 1e-12 * base) return m * base
  return 10 * base
}

/**
 * 히스토그램. 구간 수 기본은 Sturges이고, 경계는 보기 좋은 수로 맞춘다. 모든 값이 같으면 구간 하나. 마지막 구간은 오른쪽 끝을
 * 포함한다(도수의 합 = 값의 개수).
 */
export function histogram(values: ArrayLike<number>, bins?: number): Histogram {
  const s = finiteSorted(values)
  const n = s.length
  if (n === 0) return { edges: [], counts: [], binWidth: 0 }
  const min = s[0] as number
  const max = s[n - 1] as number
  if (min === max) {
    const w = niceStep(Math.abs(min) * 0.1 || 1)
    return { edges: [min - w / 2, min + w / 2], counts: [n], binWidth: w }
  }
  const k = Math.max(1, Math.round(bins ?? sturges(n)))
  const step = niceStep((max - min) / k)
  const start = Math.floor(min / step) * step
  const count = Math.max(1, Math.ceil((max - start) / step - 1e-9))
  const edges = Array.from({ length: count + 1 }, (_, i) => Number((start + i * step).toPrecision(12)))
  const counts = new Array<number>(count).fill(0)
  for (const v of s) {
    let i = Math.floor((v - start) / step + 1e-12)
    if (i >= count) i = count - 1
    if (i < 0) i = 0
    counts[i] = (counts[i] as number) + 1
  }
  return { edges, counts, binWidth: step }
}

/** 경험적 누적분포: 정렬한 값과 `i/n`. */
export function ecdf(values: ArrayLike<number>): { x: number[]; p: number[] } {
  const s = finiteSorted(values)
  const n = s.length
  return { x: Array.from(s), p: Array.from(s, (_, i) => (i + 1) / n) }
}

/** `x` 이하인 값의 비율(정렬된 표본). */
export function cdfAtSorted(sorted: ArrayLike<number>, x: number): number {
  const n = sorted.length
  if (n === 0) return NaN
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((sorted[mid] as number) <= x) lo = mid + 1
    else hi = mid
  }
  return lo / n
}

/** 피어슨 상관(쌍 중 하나라도 유한하지 않으면 제외). 분산이 0이면 NaN. */
export function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      xs.push(x[i] as number)
      ys.push(y[i] as number)
    }
  }
  const n = xs.length
  if (n < 2) return NaN
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] as number) - mx
    const dy = (ys[i] as number) - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy)
}

/** 평균 순위(동순위는 평균). 1부터. */
export function ranks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(values.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && (idx[j + 1] as readonly [number, number])[0] === (idx[i] as readonly [number, number])[0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) out[(idx[k] as readonly [number, number])[1]] = avg
    i = j + 1
  }
  return out
}

/** 스피어만 순위상관(유한한 쌍만). */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (Number.isFinite(x[i]) && Number.isFinite(y[i])) {
      xs.push(x[i] as number)
      ys.push(y[i] as number)
    }
  }
  return pearson(ranks(xs), ranks(ys))
}

export interface ConvergencePoint {
  /** 이 시점까지 쓴 표본 수(앞에서부터) */
  n: number
  mean: number
  quantile: number
  /** 평균의 신뢰구간 반폭 */
  half: number
}

/**
 * 수렴 곡선(설계 06의 5.5): 표본을 앞에서부터 `steps`등분해 누적 평균·`p` 분위수·평균 신뢰구간 반폭을 낸다. 마지막 점이
 * 전체 표본의 값이다. 입력 순서는 반복 순서여야 한다(정렬하지 않는다).
 */
export function convergence(values: ArrayLike<number>, p = 0.8, steps = 10, level = 0.95): ConvergencePoint[] {
  const v: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) v.push(values[i] as number)
  const out: ConvergencePoint[] = []
  if (v.length === 0) return out
  const seen = new Set<number>()
  for (let k = 1; k <= steps; k++) {
    const n = Math.max(1, Math.round((v.length * k) / steps))
    if (seen.has(n)) continue
    seen.add(n)
    const sub = v.slice(0, n)
    const s = summarize(sub)
    out.push({ n, mean: s.mean, quantile: percentileSorted(finiteSorted(sub), p), half: meanCI(s.mean, s.sd, n, level).half })
  }
  return out
}
