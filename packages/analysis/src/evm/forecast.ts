import type { EvmPoint } from './actuals'
import type { Baseline } from './baseline'

/** EV가 BAC에 이 비율 이상 닿으면 완료로 본다(부동소수 오차 허용). */
export const COMPLETE_TOLERANCE = 1e-6

/**
 * 획득 일정 ES(Earned Schedule): 계획 공수 곡선(PV)이 `ev`에 처음 도달한 시각. PV는 단조 증가이므로 선형 보간으로
 * 역산하고, 평탄한 구간에서는 처음 도달한 시각을 쓴다. `ev`가 BAC 이상이면 계획 완료 시각, 0 이하이면 0.
 * 설계 05의 6장. 비용 정렬(2.2)에서는 계획이 실적의 진척에 도달한 시각과 같다.
 */
export function earnedSchedule(baseline: Pick<Baseline, 'bac' | 'plannedCompletion' | 'series'>, ev: number): number {
  if (!(ev > 0)) return 0
  if (ev >= baseline.bac) return baseline.plannedCompletion
  const { time, effort } = baseline.series
  const n = time.length
  if (n === 0) return 0
  // 개정 기준선처럼 시계열이 0이 아닌 값에서 시작하면, 그보다 작은 획득 가치는 시작 시각으로 본다.
  if (ev <= (effort[0] as number)) return time[0] as number
  let lo = 0
  let hi = n - 1
  if ((effort[hi] as number) < ev) return Math.min(time[hi] as number, baseline.plannedCompletion)
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((effort[mid] as number) < ev) lo = mid
    else hi = mid
  }
  const e0 = effort[lo] as number
  const e1 = effort[hi] as number
  const t0 = time[lo] as number
  const t1 = time[hi] as number
  const t = e1 === e0 ? t1 : t0 + ((t1 - t0) * (ev - e0)) / (e1 - e0)
  return Math.min(t, baseline.plannedCompletion)
}

/** 한 가정(누적 지수 또는 최근 구간 지수)으로 한 예측. 산출할 수 없으면 필드가 null이다. */
export interface Estimate {
  /** 완료 시점의 총 공수 예상 */
  eac: number | null
  /** 남은 공수 = EAC − AC */
  etc: number | null
  /** 예산 편차 = BAC − EAC (음수면 초과) */
  vac: number | null
  /** 예상 완료일 */
  completionDay: number | null
  /** 계획 완료일 대비 지연(일). 양수면 늦다 */
  delayDays: number | null
}

export type ForecastState = 'complete' | 'forecast' | 'unavailable'

export interface Forecast {
  state: ForecastState
  /** 산출할 수 없을 때(또는 일부만 산출할 수 있을 때)의 이유 */
  reasons: string[]
  /** 보고일 */
  day: number
  /** 획득 일정(일) */
  es: number
  /** 완료한 경우: 실제 완료일과 최종 공수 */
  complete: { day: number; cost: number } | null
  /** 누적 지수(CPI, ES/t)를 남은 작업에 이어 쓰는 가정 */
  cumulative: Estimate
  /** 최근 구간 지수(CPI_k, 구간 ES 속도)를 이어 쓰는 가정 */
  recent: Estimate
}

const NONE: Estimate = { eac: null, etc: null, vac: null, completionDay: null, delayDays: null }

function estimate(baseline: Baseline, ac: number, ev: number, day: number, es: number, cpi: number | null, rate: number | null): Estimate {
  let eac: number | null = null
  if (cpi !== null && cpi > 0) eac = ac + (baseline.bac - ev) / cpi
  let completionDay: number | null = null
  if (rate !== null && rate > 0) completionDay = day + (baseline.plannedCompletion - es) / rate
  return {
    eac,
    etc: eac === null ? null : eac - ac,
    vac: eac === null ? null : baseline.bac - eac,
    completionDay,
    delayDays: completionDay === null ? null : completionDay - baseline.plannedCompletion
  }
}

/**
 * `points[i]` 보고일의 지표 기반 예측(설계 05의 6장). 모든 수식은 표준 EVM이며 "현재의 효율이 남은 작업에도 이어진다"는
 * 가정이다. 누적 지수로 한 값과 최근 `k`개 구간 지수로 한 값을 함께 돌려줘 범위로 보인다.
 *
 *  - 비용: EAC = AC + (BAC − EV) / CPI, ETC = EAC − AC, VAC = BAC − EAC
 *  - 일정: 예상 완료일 = t + (계획 기간 − ES) / 속도. 속도는 누적에서 ES/t(= SPI_t, 이때 결과는 계획 기간 / SPI_t),
 *    최근 구간에서는 최근 k개 보고 구간의 ES 증가량 / 일수.
 *  - 완료(EV ≥ BAC): 예측 대신 실제 완료일(처음 EV ≥ BAC가 된 보고일)과 그날의 최종 공수.
 */
export function forecastAt(baseline: Baseline, points: EvmPoint[], i: number, k: number): Forecast {
  const p = points[i] as EvmPoint
  const es = earnedSchedule(baseline, p.ev)

  if (p.ev >= baseline.bac * (1 - COMPLETE_TOLERANCE)) {
    const first = points.findIndex((q) => q.ev >= baseline.bac * (1 - COMPLETE_TOLERANCE))
    const done = points[first] as EvmPoint
    return { state: 'complete', reasons: [], day: p.day, es, complete: { day: done.day, cost: done.ac }, cumulative: NONE, recent: NONE }
  }

  const reasons: string[] = []
  if (p.cpi === null) reasons.push('누적 공수(AC)가 0이라 CPI를 계산할 수 없어 비용을 예측할 수 없습니다')
  else if (p.cpi === 0) reasons.push('획득 가치(EV)가 0이라 비용을 예측할 수 없습니다')
  if (!(p.day > 0)) reasons.push('보고일이 0이라 일정을 예측할 수 없습니다')
  else if (!(es > 0)) reasons.push('획득 일정(ES)이 0이라 완료일을 예측할 수 없습니다(아직 진척이 없음)')

  const cumulative = estimate(baseline, p.ac, p.ev, p.day, es, p.cpi, p.day > 0 && es > 0 ? es / p.day : null)

  // 최근 구간: i - k번째 보고(없으면 출발점 0)에서 지금까지의 ES 증가 속도
  const prev = i - k >= 0 ? (points[i - k] as EvmPoint) : null
  const prevDay = prev ? prev.day : 0
  const prevEs = prev ? earnedSchedule(baseline, prev.ev) : 0
  const span = p.day - prevDay
  const rate = span > 0 ? (es - prevEs) / span : null
  const recent = estimate(baseline, p.ac, p.ev, p.day, es, p.cpiK, rate)
  if (recent.eac === null && cumulative.eac !== null) reasons.push('최근 구간의 CPI를 계산할 수 없어 비용의 최근 구간 값은 없습니다')
  if (recent.completionDay === null && cumulative.completionDay !== null) reasons.push('최근 구간에 진척이 없어 완료일의 최근 구간 값은 없습니다')

  const any = cumulative.eac !== null || cumulative.completionDay !== null || recent.eac !== null || recent.completionDay !== null
  return { state: any ? 'forecast' : 'unavailable', reasons, day: p.day, es, complete: null, cumulative, recent }
}

/** 두 가정의 값을 낙관·비관 범위로 합친다. 하나뿐이면 같은 값, 둘 다 없으면 null. */
export function rangeOf(a: number | null, b: number | null): { low: number; high: number } | null {
  const v = [a, b].filter((x): x is number => x !== null)
  if (v.length === 0) return null
  return { low: Math.min(...v), high: Math.max(...v) }
}
