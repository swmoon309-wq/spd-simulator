import type { RunResult } from '@spd/sd-engine'
import { valueAt } from '../scenario/kpi'

/** 진척 인정(earned) 규칙의 한 단계: 이 변수(누적 완료 태스크)에 `weight`만큼 인정한다. 가중치의 합은 1이다. */
export interface EvmCredit {
  variable: string
  weight: number
}

export interface BaselineSeries {
  /** 시각(일) */
  time: number[]
  /** 진척률 P(t) = Σ(w × 누적 태스크) / 총 태스크 */
  progress: number[]
  /** 누적 투입 공수(맨데이) */
  effort: number[]
}

/** 채택한 시나리오의 시뮬레이션에서 만든 계획 기준선. PV(t) = bac × progress(t). */
export interface Baseline {
  credits: EvmCredit[]
  totalTasks: number
  /** 총 예산: 완료 시점의 누적 투입 공수(맨데이) */
  bac: number
  /** 계획 완료 시각(일) */
  plannedCompletion: number
  series: BaselineSeries
}

export const CREDIT_TOLERANCE = 1e-6

/** 인정 비율 검사. 문제가 없으면 null. */
export function validateCredits(credits: EvmCredit[]): string | null {
  if (credits.length === 0) return '인정할 단계가 하나 이상 필요합니다'
  const seen = new Set<string>()
  for (const c of credits) {
    if (!Number.isFinite(c.weight) || c.weight < 0 || c.weight > 1) return `'${c.variable}'의 비율은 0 이상 1 이하여야 합니다`
    if (seen.has(c.variable)) return `'${c.variable}'이(가) 겹칩니다`
    seen.add(c.variable)
  }
  const sum = credits.reduce((s, c) => s + c.weight, 0)
  if (Math.abs(sum - 1) > CREDIT_TOLERANCE) return `비율의 합이 1이어야 합니다(현재 ${sum})`
  return null
}

/** 시각 `t`의 진척률. */
export function progressAt(result: RunResult, credits: EvmCredit[], totalTasks: number, t: number): number {
  let sum = 0
  for (const c of credits) sum += c.weight * valueAt(result, c.variable, t)
  return sum / totalTasks
}

export interface BaselineOptions {
  credits: EvmCredit[]
  totalTasks: number
  effortVariable: string
  /** 완료 시각. 완료하지 못한 실행으로는 기준선을 만들 수 없다. */
  completion: number
  /** 표본 간격(일). 기본 1 */
  step?: number
}

const round6 = (x: number) => Number(x.toFixed(6))

/**
 * 시뮬레이션 결과에서 기준선을 만든다. 진척률과 누적 공수를 `step`일 간격으로 다시 표본화해 저장 크기를
 * 줄인다(400일이면 401개 점). BAC는 완료 시점의 누적 공수이다.
 */
export function buildBaseline(result: RunResult, opts: BaselineOptions): Baseline {
  const { credits, totalTasks, effortVariable, completion } = opts
  const step = opts.step ?? 1
  const bad = validateCredits(credits)
  if (bad) throw new Error(`인정 비율이 올바르지 않습니다: ${bad}`)
  if (!(totalTasks > 0) || !Number.isFinite(totalTasks)) throw new Error(`총 태스크가 올바르지 않습니다: ${totalTasks}`)
  if (!(step > 0)) throw new Error(`표본 간격이 올바르지 않습니다: ${step}`)
  if (!Number.isFinite(completion) || completion <= 0) throw new Error('완료하지 못한 실행으로는 기준선을 만들 수 없습니다')

  const bac = valueAt(result, effortVariable, completion)
  if (!(bac > 0)) throw new Error(`총 예산(BAC)이 0 이하입니다: ${bac}`)

  const start = result.time[0] as number
  const end = result.time[result.time.length - 1] as number
  const series: BaselineSeries = { time: [], progress: [], effort: [] }
  for (let k = 0; ; k++) {
    const t = start + k * step
    if (t > end + 1e-9) break
    const tt = Math.min(t, end)
    series.time.push(round6(tt))
    series.progress.push(round6(progressAt(result, credits, totalTasks, tt)))
    series.effort.push(round6(valueAt(result, effortVariable, tt)))
  }
  return { credits: credits.map((c) => ({ ...c })), totalTasks, bac: round6(bac), plannedCompletion: round6(completion), series }
}

/** 계획 완료 시각까지의 표본에서 `time` 위치를 찾는다(마지막 표본은 계획 완료 이전 또는 같은 시각). */
function lastIndexAtOrBefore(time: number[], t: number): number {
  let lo = 0
  let hi = time.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((time[mid] as number) <= t) lo = mid
    else hi = mid
  }
  return lo
}

/** 선형 보간. 표본 `t0 → t1`에서 `x`가 차지하는 비율로 `y0 → y1`을 잇는다. */
const lerp = (x: number, x0: number, x1: number, y0: number, y1: number): number => (x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0))

/**
 * 계획 가치 PV(t) = 계획 공수 곡선(비용 정렬). 계획 완료 시각 이후에는 BAC로 평평하다. 표본 사이는 선형 보간하고
 * 범위 밖은 끝값. 설계 05의 2.2.
 */
export function pvAt(baseline: Pick<Baseline, 'bac' | 'plannedCompletion' | 'series'>, t: number): number {
  const { time, effort } = baseline.series
  const n = time.length
  if (n === 0) return 0
  const tt = Math.min(t, baseline.plannedCompletion)
  if (tt <= (time[0] as number)) return effort[0] as number
  if (tt >= (time[n - 1] as number)) return Math.min(effort[n - 1] as number, baseline.bac)
  const lo = lastIndexAtOrBefore(time, tt)
  return Math.min(lerp(tt, time[lo] as number, time[lo + 1] as number, effort[lo] as number, effort[lo + 1] as number), baseline.bac)
}

/** 계획이 완료 시점에 도달한 진척률. 거의 1이다(표본화·인정 비율의 부동소수 차이). */
export function plannedFinalProgress(baseline: Pick<Baseline, 'plannedCompletion' | 'series'>): number {
  const { time, progress } = baseline.series
  const n = time.length
  if (n === 0) return 0
  const tt = Math.min(baseline.plannedCompletion, time[n - 1] as number)
  if (tt <= (time[0] as number)) return progress[0] as number
  const lo = lastIndexAtOrBefore(time, tt)
  if (lo >= n - 1) return progress[n - 1] as number
  return lerp(tt, time[lo] as number, time[lo + 1] as number, progress[lo] as number, progress[lo + 1] as number)
}

/**
 * 획득 가치 EV(P) = 계획이 진척률 `P`에 **처음 도달할 때까지 쓴 공수**(비용 정렬, 설계 05의 2.2). 실적이 계획과 같으면
 * 모든 시각에서 EV = PV = 계획 공수가 되어 CPI = SPI = 1이다. 계획 완료 진척률을 넘는 값(범위 증가)은 BAC에
 * 비례해 늘린다. 진척이 0 이하면 0.
 */
export function evAt(baseline: Pick<Baseline, 'bac' | 'plannedCompletion' | 'series'>, progress: number): number {
  if (!(progress > 0)) return 0
  const pEnd = plannedFinalProgress(baseline)
  if (!(pEnd > 0)) return 0
  if (progress >= pEnd) return (baseline.bac * progress) / pEnd
  const { time, progress: prog, effort } = baseline.series
  // 진척 곡선은 단조 비감소이므로 P에 처음 도달하는 표본을 이분 탐색한다.
  let lo = 0
  let hi = time.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((prog[mid] as number) < progress) lo = mid
    else hi = mid
  }
  const p0 = prog[lo] as number
  const p1 = prog[hi] as number
  return Math.max(0, Math.min(lerp(progress, p0, p1, effort[lo] as number, effort[hi] as number), baseline.bac))
}
