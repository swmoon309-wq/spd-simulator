/** 비율. 분모가 0이면 "계산 불가"(null)이다. 0이나 무한대로 보이게 하지 않는다. 설계 05의 2.4. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : null
}

export interface Indicators {
  /** 비용 편차 EV − AC */
  cv: number
  /** 일정 편차 EV − PV */
  sv: number
  /** 비용 지수 EV / AC. AC = 0이면 null */
  cpi: number | null
  /** 일정 지수 EV / PV. PV = 0이면 null */
  spi: number | null
}

/** 책 6.7(p.449)의 지표. */
export function indicators(pv: number, ev: number, ac: number): Indicators {
  return { cv: ev - ac, sv: ev - pv, cpi: ratio(ev, ac), spi: ratio(ev, pv) }
}

/** 구간 지수의 기본 보고 구간 수 */
export const DEFAULT_WINDOW = 3
/** 추세 판정에 필요한 연속 하락 횟수 */
export const DEFAULT_TREND = 3

export interface Cumulative {
  pv: number
  ev: number
  ac: number
}

/**
 * 최근 `k`개 보고 구간의 지수. `points[i]`와 `points[i-k]`의 증분으로 계산한다. i < k이면 출발점(`origin`,
 * 보통 모두 0)에서 센다. 설계 05의 2.5.
 */
export function windowIndices(points: Cumulative[], i: number, k: number, origin: Cumulative = { pv: 0, ev: 0, ac: 0 }): { cpi: number | null; spi: number | null } {
  const cur = points[i] as Cumulative
  const prev = i - k >= 0 ? (points[i - k] as Cumulative) : origin
  return { cpi: ratio(cur.ev - prev.ev, cur.ac - prev.ac), spi: ratio(cur.ev - prev.ev, cur.pv - prev.pv) }
}

/** 마지막 값들이 `n`번 연속 줄었는가(값이 `n + 1`개 필요하고 null이 섞이면 아님). */
export function isWorsening(values: (number | null)[], n: number = DEFAULT_TREND): boolean {
  if (values.length < n + 1) return false
  const tail = values.slice(-(n + 1))
  for (let i = 1; i < tail.length; i++) {
    const a = tail[i - 1]
    const b = tail[i]
    if (a === null || a === undefined || b === null || b === undefined || !(b < a)) return false
  }
  return true
}
