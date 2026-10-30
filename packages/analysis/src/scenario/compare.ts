import type { KpiSpec, KpiValues } from './kpi'

export type Verdict = 'better' | 'worse' | 'same' | 'n/a'

export interface KpiDelta {
  value: number | null
  base: number | null
  /** value − base. 어느 쪽이든 null이면 null */
  diff: number | null
  /** value / base − 1. base가 0이거나 null이면 null */
  ratio: number | null
  verdict: Verdict
}

/** 값이 같다고 볼 상대 오차. 부동소수 잡음을 "좋아짐/나빠짐"으로 오판하지 않기 위한 값이다. */
const SAME_TOLERANCE = 1e-9

export function compareValue(better: KpiSpec['better'], base: number | null, value: number | null): KpiDelta {
  if (base === null || value === null) return { value, base, diff: null, ratio: null, verdict: 'n/a' }
  const diff = value - base
  const ratio = base !== 0 ? value / base - 1 : null
  const same = Math.abs(diff) <= SAME_TOLERANCE * Math.max(1, Math.abs(base))
  let verdict: Verdict
  if (better === 'none') verdict = 'n/a'
  else if (same) verdict = 'same'
  else if ((better === 'lower') === diff < 0) verdict = 'better'
  else verdict = 'worse'
  return { value, base, diff, ratio, verdict }
}

/** 지표마다 기준 대비 차이와 판정을 계산한다. */
export function compareToBase(specs: KpiSpec[], base: KpiValues, scenario: KpiValues): Record<string, KpiDelta> {
  const out: Record<string, KpiDelta> = {}
  for (const spec of specs) out[spec.id] = compareValue(spec.better, base[spec.id] ?? null, scenario[spec.id] ?? null)
  return out
}
