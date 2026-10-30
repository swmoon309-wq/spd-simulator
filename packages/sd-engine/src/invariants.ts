import type { ModelDef } from './model/schema'
import type { RunResult } from './result'

/** 불변식 하나를 실행 결과에서 점검한 결과. */
export interface InvariantCheck {
  name: string
  label: string
  tolerance: number
  /** 기록한 모든 시점에서 `|좌변 − 우변|`의 최댓값. 점검하지 못했으면 NaN */
  maxViolation: number
  /** 최대 위반이 처음 나온 시각. 위반이 없으면(최댓값이 허용 오차 이하) null */
  firstViolationTime: number | null
  /** 허용 오차를 넘은 적이 있는가 */
  violated: boolean
  /** 결과에 기록되지 않아 점검하지 못한 변수 */
  missing: string[]
}

/**
 * 모델이 선언한 불변식(`def.invariants`)을 매 기록 시점마다 평가해 최대 위반을 낸다. 상수는 `params`(없으면 모델 기본값)에서,
 * 나머지는 결과의 시계열에서 읽는다. 기록되지 않은 변수가 있으면 그 불변식은 점검하지 못하고 `missing`에 적는다.
 * 선언한 것만 확인하므로 "선언하지 않은 보존 법칙"은 알 수 없다.
 */
export function checkInvariants(def: ModelDef, result: RunResult, params: Record<string, number> = {}): InvariantCheck[] {
  const n = result.time.length
  return (def.invariants ?? []).map((inv) => {
    const terms = [...inv.lhs.map((t) => ({ ...t, sign: 1 })), ...inv.rhs.map((t) => ({ ...t, sign: -1 }))]
    const missing: string[] = []
    const readers = terms.map((t) => {
      const c = def.constants[t.variable]
      if (c) {
        const v = params[t.variable] ?? c.value
        return (_i: number) => v
      }
      const s = result.series[t.variable]
      if (!s) {
        missing.push(t.variable)
        return null
      }
      return (i: number) => s[i] as number
    })
    if (missing.length > 0) {
      return { name: inv.name, label: inv.label, tolerance: inv.tolerance, maxViolation: NaN, firstViolationTime: null, violated: false, missing: [...new Set(missing)] }
    }
    let max = 0
    let first: number | null = null
    for (let i = 0; i < n; i++) {
      let diff = 0
      terms.forEach((t, k) => {
        diff += t.sign * t.coef * (readers[k] as (i: number) => number)(i)
      })
      const v = Math.abs(diff)
      if (v > max) max = v
      if (first === null && v > inv.tolerance) first = result.time[i] as number
    }
    return { name: inv.name, label: inv.label, tolerance: inv.tolerance, maxViolation: max, firstViolationTime: first, violated: max > inv.tolerance, missing: [] }
  })
}
