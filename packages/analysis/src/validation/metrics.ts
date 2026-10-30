import { pearson } from '../risk/stats'

/**
 * 오차 지표(설계 07의 3.2). 관측 `O`와 시뮬레이션 `S`의 짝에서 구한다. 이 도구는 합격·불합격을 선언하지 않는다 —
 * 지표와, 사용자가 정한 허용 기준의 안/밖만 낸다(설계 0장). 입력은 시간 순서로 정렬되어 있어야 한다(`alignColumn`).
 */

export interface Metrics {
  /** 짝의 수(유한한 짝만) */
  n: number
  /** 평균 오차 mean(S − O). 부호 있음(편향) */
  me: number
  mae: number
  rmse: number
  /** RMSE / mean(|O|). 단위가 다른 열을 비교하기 위해. mean(|O|) = 0이면 NaN */
  nrmse: number
  /** 상대 예측 오차 mean((S − O)/O). O = 0인 점은 뺀다. 부호 있음 */
  mre: number
  /** mean(|S − O|/|O|). O = 0인 점은 뺀다 */
  mape: number
  /** O = 0이라 MRE·MAPE에서 뺀 점 수 */
  zeroObserved: number
  /** Nash–Sutcliffe 효율. 1이면 일치, 0이면 평균만큼, 음수면 평균보다 나쁨. 관측이 상수면 NaN(오차 0이면 1) */
  nse: number
  /** 피어슨 상관과 결정계수. 상관은 편향을 놓치므로 보조로만 쓴다(책 1장의 경고) */
  r: number
  r2: number
  /** Theil 부등계수 RMSE / (√mean(S²) + √mean(O²)). 0이면 일치 */
  theilU: number
  /** Theil 분해: 편향·변동 크기·비체계 오차의 몫. 오차가 0이 아니면 합이 1. 오차가 0이면 NaN */
  theilM: number
  theilS: number
  theilC: number
  /** 인접한 관측 구간에서 변화 방향(증가·감소·같음)이 같은 비율. 짝이 2개 미만이면 NaN */
  trend: number
}

const NaNs = (): Omit<Metrics, 'n' | 'zeroObserved'> => ({
  me: NaN, mae: NaN, rmse: NaN, nrmse: NaN, mre: NaN, mape: NaN, nse: NaN, r: NaN, r2: NaN, theilU: NaN, theilM: NaN, theilS: NaN, theilC: NaN, trend: NaN
})

export class MetricsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetricsError'
  }
}

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0)

/** 관측과 시뮬레이션의 길이가 같아야 한다. 어느 한쪽이 유한하지 않은 짝은 뺀다. */
export function computeMetrics(observed: ArrayLike<number>, simulated: ArrayLike<number>): Metrics {
  if (observed.length !== simulated.length) throw new MetricsError(`관측(${observed.length})과 시뮬레이션(${simulated.length})의 개수가 다릅니다`)
  const O: number[] = []
  const S: number[] = []
  for (let i = 0; i < observed.length; i++) {
    const o = observed[i] as number
    const s = simulated[i] as number
    if (Number.isFinite(o) && Number.isFinite(s)) {
      O.push(o)
      S.push(s)
    }
  }
  const n = O.length
  if (n === 0) return { n: 0, zeroObserved: 0, ...NaNs() }

  const err = S.map((s, i) => s - (O[i] as number))
  const me = mean(err)
  const mae = mean(err.map(Math.abs))
  const mse = mean(err.map((e) => e * e))
  const rmse = Math.sqrt(mse)
  const meanAbsO = mean(O.map(Math.abs))
  const nrmse = meanAbsO === 0 ? NaN : rmse / meanAbsO

  const rel: number[] = []
  let zeroObserved = 0
  err.forEach((e, i) => {
    const o = O[i] as number
    if (o === 0) zeroObserved++
    else rel.push(e / o)
  })
  const mre = rel.length === 0 ? NaN : mean(rel)
  const mape = rel.length === 0 ? NaN : mean(rel.map(Math.abs))

  const meanO = mean(O)
  const meanS = mean(S)
  const ssTot = O.reduce((s, o) => s + (o - meanO) ** 2, 0)
  const ssRes = err.reduce((s, e) => s + e * e, 0)
  const nse = ssTot === 0 ? (ssRes === 0 ? 1 : NaN) : 1 - ssRes / ssTot

  const r = n < 2 ? NaN : pearson(S, O)

  const rmsS = Math.sqrt(mean(S.map((s) => s * s)))
  const rmsO = Math.sqrt(mean(O.map((o) => o * o)))
  const uDen = rmsS + rmsO
  const theilU = uDen === 0 ? (rmse === 0 ? 0 : NaN) : rmse / uDen

  // Theil 분해는 모집단 표준편차(n으로 나눔)를 써야 MSE = 편향² + (sS − sO)² + 2(1 − r)·sS·sO가 정확히 성립해 세 몫의 합이 1이다.
  let theilM = NaN
  let theilS = NaN
  let theilC = NaN
  if (mse > 0) {
    const sS = Math.sqrt(mean(S.map((s) => (s - meanS) ** 2)))
    const sO = Math.sqrt(ssTot / n)
    // 한쪽이 상수면 상관이 정의되지 않고 교차항도 0이다.
    const cross = sS === 0 || sO === 0 || !Number.isFinite(r) ? 0 : 2 * (1 - r) * sS * sO
    theilM = (meanS - meanO) ** 2 / mse
    theilS = (sS - sO) ** 2 / mse
    theilC = cross / mse
  }

  let trend = NaN
  if (n >= 2) {
    let agree = 0
    for (let i = 1; i < n; i++) if (sign((S[i] as number) - (S[i - 1] as number)) === sign((O[i] as number) - (O[i - 1] as number))) agree++
    trend = agree / (n - 1)
  }

  return { n, me, mae, rmse, nrmse, mre, mape, zeroObserved, nse, r, r2: r * r, theilU, theilM, theilS, theilC, trend }
}

// ---------- 허용 기준 (설계 07의 3.3) ----------

/** 허용 기준을 둘 수 있는 지표. 기본값은 없다(0장: 기준은 사용자가 정한다). */
export type ToleranceKey = 'nrmse' | 'mre' | 'mape' | 'nse' | 'trend'

export type Tolerances = Partial<Record<ToleranceKey, number>>

/** 기준 안(`in`), 밖(`out`), 기준이 없거나 값을 알 수 없음(`na`). */
export type ToleranceStatus = 'in' | 'out' | 'na'

/** 지표별 기준 충족 여부. `nrmse`·`mape`는 이하, `mre`는 |MRE| 이하, `nse`·`trend`는 이상이어야 안이다. */
export function checkTolerances(m: Metrics, tol: Tolerances): Partial<Record<ToleranceKey, ToleranceStatus>> {
  const out: Partial<Record<ToleranceKey, ToleranceStatus>> = {}
  const judge = (key: ToleranceKey, value: number, ok: (v: number, limit: number) => boolean) => {
    const limit = tol[key]
    if (limit === undefined) return
    out[key] = !Number.isFinite(value) || !Number.isFinite(limit) ? 'na' : ok(value, limit) ? 'in' : 'out'
  }
  judge('nrmse', m.nrmse, (v, l) => v <= l)
  judge('mre', m.mre, (v, l) => Math.abs(v) <= l)
  judge('mape', m.mape, (v, l) => v <= l)
  judge('nse', m.nse, (v, l) => v >= l)
  judge('trend', m.trend, (v, l) => v >= l)
  return out
}

// ---------- 완료 시점 오차 ----------

export interface CompletionError {
  /** 시뮬레이션 완료일 − 실제 완료일(일). 양수면 시뮬레이션이 늦다. 시뮬레이션이 끝나지 않았으면 null */
  days: number | null
  /** 실제 완료일 대비 비율(%). 실제 완료일이 0 이하이거나 days가 null이면 null */
  percent: number | null
}

/** 시뮬레이션 완료일(끝나지 않았으면 null)과 실제 완료일의 차이(설계 07의 3.2). */
export function completionError(simulatedDay: number | null, actualDay: number): CompletionError {
  if (simulatedDay === null || !Number.isFinite(simulatedDay) || !Number.isFinite(actualDay)) return { days: null, percent: null }
  const days = simulatedDay - actualDay
  return { days, percent: actualDay > 0 ? (days / actualDay) * 100 : null }
}

// ---------- 종합(보정의 목적함수와 같은 정의, 설계 07의 5.1) ----------

export interface WeightedNrmse {
  /** J = Σ w · NRMSE². 쓸 수 있는 열이 없으면 NaN */
  j: number
  /** 계산에 쓴 열 수와 NRMSE를 알 수 없어 뺀 열 수 */
  used: number
  skipped: number
}

/**
 * 열별 NRMSE의 가중 제곱합 `J(θ) = Σ_열 w_c · NRMSE_c²`. 가중치를 주지 않으면 쓴 열 수의 역수(1/열 수)이다.
 * NRMSE를 알 수 없는 열(관측 평균 0, 짝 없음)은 빼고 개수를 알린다.
 */
export function weightedNrmse(columns: { nrmse: number; weight?: number }[]): WeightedNrmse {
  const usable = columns.filter((c) => Number.isFinite(c.nrmse))
  if (usable.length === 0) return { j: NaN, used: 0, skipped: columns.length }
  const j = usable.reduce((s, c) => s + (c.weight ?? 1 / usable.length) * c.nrmse ** 2, 0)
  return { j, used: usable.length, skipped: columns.length - usable.length }
}
