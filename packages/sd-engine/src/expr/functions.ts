import type { Runtime } from './runtime'

export interface FnSpec {
  min: number
  max: number
  impl: (rt: Runtime, ...a: number[]) => number
}

const EPS = 1e-9

/** 상태나 테이블이 필요해 컴파일러가 직접 처리하는 함수. */
export const SPECIAL_FUNCTIONS = new Set(['SMOOTH', 'DELAY1', 'DELAY3', 'GRAPH'])

/** 순수 함수 레지스트리. 이름은 대소문자를 구분하지 않는다(대문자로 등록). */
export const FUNCTIONS: Record<string, FnSpec> = {
  IF: { min: 3, max: 3, impl: (_rt, c, a, b) => (c !== 0 ? (a as number) : (b as number)) },
  MIN: { min: 1, max: Infinity, impl: (_rt, ...a) => Math.min(...a) },
  MAX: { min: 1, max: Infinity, impl: (_rt, ...a) => Math.max(...a) },
  ABS: { min: 1, max: 1, impl: (_rt, x) => Math.abs(x as number) },
  SQRT: { min: 1, max: 1, impl: (_rt, x) => Math.sqrt(x as number) },
  EXP: { min: 1, max: 1, impl: (_rt, x) => Math.exp(x as number) },
  LN: { min: 1, max: 1, impl: (_rt, x) => Math.log(x as number) },
  ROUND: {
    min: 1,
    max: 2,
    impl: (_rt, x, digits) => {
      const f = 10 ** (digits ?? 0)
      return Math.round((x as number) * f) / f
    }
  },
  CLAMP: {
    min: 3,
    max: 3,
    impl: (_rt, x, lo, hi) => Math.min(Math.max(x as number, lo as number), hi as number)
  },
  /** STEP(높이, 시작시각): 시작시각 이후 높이, 이전 0 */
  STEP: { min: 2, max: 2, impl: (rt, h, t) => (rt.time >= (t as number) - EPS ? (h as number) : 0) },
  /** PULSE(높이, 시작시각, 폭): [시작, 시작+폭) 구간에서만 높이 */
  PULSE: {
    min: 3,
    max: 3,
    impl: (rt, h, t, w) =>
      rt.time >= (t as number) - EPS && rt.time < (t as number) + (w as number) - EPS
        ? (h as number)
        : 0
  },
  /** RAMP(기울기, 시작시각): 시작시각 이후 기울기 × 경과시간 */
  RAMP: {
    min: 2,
    max: 2,
    impl: (rt, s, t) => (s as number) * Math.max(0, rt.time - (t as number))
  },
  RANDOM_UNIFORM: { min: 2, max: 2, impl: (rt, a, b) => rt.rng.uniform(a as number, b as number) },
  RANDOM_NORMAL: { min: 2, max: 2, impl: (rt, m, sd) => rt.rng.normal(m as number, sd as number) },
  RANDOM_TRIANGULAR: {
    min: 3,
    max: 3,
    impl: (rt, a, m, b) => rt.rng.triangular(a as number, m as number, b as number)
  }
}

export function isKnownFunction(name: string): boolean {
  const upper = name.toUpperCase()
  return upper in FUNCTIONS || SPECIAL_FUNCTIONS.has(upper)
}

export interface Table {
  x: number[]
  y: number[]
}

/** 선형 보간. 범위 밖은 끝값으로 고정한다. 입력이 NaN이면 NaN. */
export function interpolate(table: Table): (x: number) => number {
  const { x: xs, y: ys } = table
  const n = xs.length
  const first = xs[0] as number
  const last = xs[n - 1] as number
  return (x) => {
    if (Number.isNaN(x)) return NaN
    if (x <= first) return ys[0] as number
    if (x >= last) return ys[n - 1] as number
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if ((xs[mid] as number) <= x) lo = mid
      else hi = mid
    }
    const x0 = xs[lo] as number
    const x1 = xs[hi] as number
    const y0 = ys[lo] as number
    const y1 = ys[hi] as number
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
}
