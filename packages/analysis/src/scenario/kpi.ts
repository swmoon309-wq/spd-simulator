import type { RunResult } from '@spd/sd-engine'
import type { Params } from './effective'

export type KpiGroup = 'schedule' | 'cost' | 'quality' | 'risk'

export interface KpiSpec {
  id: string
  label: string
  unit: string
  /** 낮을수록/높을수록 좋은지. 'none'이면 좋음·나쁨을 판정하지 않는다. */
  better: 'lower' | 'higher' | 'none'
  group: KpiGroup
  /** 표시할 소수 자릿수 */
  decimals: number
  /** 값이 null일 때 표에 보일 글자. 없으면 "미완료". 완료일 말고도 null이 되는 이유가 있는 지표(예: 단가를 정하지 않은 비용)가 쓴다. */
  emptyLabel?: string
  /** 결과와 유효 파라미터에서 값을 계산한다. 정의할 수 없으면 null(예: 미완료 프로젝트의 완료일). */
  compute(result: RunResult, params: Params): number | null
}

export type KpiValues = Record<string, number | null>

export function computeKpis(specs: KpiSpec[], result: RunResult, params: Params): KpiValues {
  const out: KpiValues = {}
  for (const spec of specs) {
    const v = spec.compute(result, params)
    out[spec.id] = v !== null && Number.isFinite(v) ? v : null
  }
  return out
}

function series(result: RunResult, name: string): Float64Array {
  const s = result.series[name]
  if (!s) throw new Error(`결과에 변수 '${name}'이(가) 없습니다`)
  return s
}

export function lastOf(result: RunResult, name: string): number {
  const s = series(result, name)
  return s[s.length - 1] as number
}

export function maxOf(result: RunResult, name: string): number {
  const s = series(result, name)
  let m = -Infinity
  for (const v of s) if (v > m) m = v
  return m
}

/** 시각 `t`의 값. 기록 눈금 사이는 선형 보간하고 범위 밖은 양 끝값. */
export function valueAt(result: RunResult, name: string, t: number): number {
  const s = series(result, name)
  const time = result.time
  const n = time.length
  if (t <= (time[0] as number)) return s[0] as number
  if (t >= (time[n - 1] as number)) return s[n - 1] as number
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if ((time[mid] as number) <= t) lo = mid
    else hi = mid
  }
  const t0 = time[lo] as number
  const t1 = time[hi] as number
  const y0 = s[lo] as number
  const y1 = s[hi] as number
  return y0 + ((y1 - y0) * (t - t0)) / (t1 - t0)
}
