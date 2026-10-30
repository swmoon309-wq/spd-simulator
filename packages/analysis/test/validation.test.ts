import { describe, expect, it } from 'vitest'
import { brooksModel } from '@spd/models'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { AlignError, alignColumn, checkTolerances, completionError, computeMetrics, lastOf, MetricsError, toSimTime, valueAt, weightedNrmse } from '../src'

/** 손으로 계산한 표본: O = [1, 2, 3, 4], S = [1.5, 2, 2.5, 5] */
const O = [1, 2, 3, 4]
const S = [1.5, 2, 2.5, 5]

describe('오차 지표: 손으로 계산한 값', () => {
  const m = computeMetrics(O, S)
  it('ME·MAE·RMSE·정규화 RMSE', () => {
    expect(m.n).toBe(4)
    expect(m.me).toBeCloseTo(0.25, 12) // (0.5 + 0 − 0.5 + 1)/4
    expect(m.mae).toBeCloseTo(0.5, 12) // (0.5 + 0 + 0.5 + 1)/4
    expect(m.rmse).toBeCloseTo(Math.sqrt(0.375), 12) // MSE = (0.25 + 0 + 0.25 + 1)/4
    expect(m.nrmse).toBeCloseTo(Math.sqrt(0.375) / 2.5, 12) // mean|O| = 2.5
  })
  it('MRE·MAPE', () => {
    expect(m.mre).toBeCloseTo((0.5 / 1 + 0 + -0.5 / 3 + 1 / 4) / 4, 12)
    expect(m.mape).toBeCloseTo((0.5 + 0 + 0.5 / 3 + 0.25) / 4, 12)
    expect(m.zeroObserved).toBe(0)
  })
  it('NSE = 1 − Σ(O−S)²/Σ(O−Ō)² = 1 − 1.5/5', () => {
    expect(m.nse).toBeCloseTo(0.7, 12)
  })
  it('상관·결정계수', () => {
    expect(m.r).toBeCloseTo(5.5 / Math.sqrt(7.25 * 5), 12)
    expect(m.r2).toBeCloseTo(m.r ** 2, 12)
  })
  it('Theil 부등계수 U', () => {
    expect(m.theilU).toBeCloseTo(Math.sqrt(0.375) / (Math.sqrt(9.375) + Math.sqrt(7.5)), 12)
  })
  it('Theil 분해: 편향 몫이 손계산과 같고 세 몫의 합은 1', () => {
    expect(m.theilM).toBeCloseTo(0.0625 / 0.375, 12) // (S̄ − Ō)²/MSE = 0.25²/0.375
    expect(m.theilS).toBeCloseTo((Math.sqrt(7.25 / 4) - Math.sqrt(5 / 4)) ** 2 / 0.375, 12)
    expect(m.theilM + m.theilS + m.theilC).toBeCloseTo(1, 12)
  })
  it('추세 일치율: 인접 구간의 방향', () => {
    expect(m.trend).toBe(1) // 관측과 시뮬레이션 모두 계속 증가
    expect(computeMetrics([1, 2, 3, 2], [1, 2, 3, 4]).trend).toBeCloseTo(2 / 3, 12) // 마지막 구간만 반대
    expect(computeMetrics([1, 2, 3], [3, 2, 1]).trend).toBe(0)
  })
})

describe('오차 지표: 성질', () => {
  it('완전 일치: 오차 0, NSE 1, U 0, 상관 1, 추세 1', () => {
    const m = computeMetrics(O, O)
    expect([m.me, m.mae, m.rmse, m.nrmse, m.mre, m.mape, m.theilU]).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(m.nse).toBe(1)
    expect(m.r).toBeCloseTo(1, 12)
    expect(m.trend).toBe(1)
    // 오차가 0이면 Theil 분해는 정의되지 않는다
    expect(Number.isNaN(m.theilM) && Number.isNaN(m.theilS) && Number.isNaN(m.theilC)).toBe(true)
  })

  it('Theil 분해의 합은 임의의 표본에서도 1이다(편향·분산 차이·상관 부족을 모두 가진 경우)', () => {
    let seed = 12345
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
    for (let trial = 0; trial < 50; trial++) {
      const o = Array.from({ length: 5 + (trial % 20) }, () => rnd() * 100)
      const s = o.map((x) => x * (0.5 + rnd()) + (rnd() - 0.3) * 20)
      const m = computeMetrics(o, s)
      expect(m.theilM + m.theilS + m.theilC).toBeCloseTo(1, 10)
      expect(m.theilM).toBeGreaterThanOrEqual(0)
      expect(m.theilS).toBeGreaterThanOrEqual(0)
      expect(m.theilC).toBeGreaterThanOrEqual(-1e-12)
    }
  })

  it('상수 시뮬레이션이어도 분해의 합이 1이다(교차항 0)', () => {
    const m = computeMetrics([1, 2, 3, 4], [2, 2, 2, 2])
    expect(m.theilM + m.theilS + m.theilC).toBeCloseTo(1, 12)
    expect(m.theilC).toBe(0)
    expect(Number.isNaN(m.r)).toBe(true)
  })

  it('편향만 있으면 편향 몫이 1, 크기만 다르면 변동 몫이 크다', () => {
    const shifted = computeMetrics(O, O.map((x) => x + 3))
    expect(shifted.theilM).toBeCloseTo(1, 12)
    expect(shifted.theilS).toBeCloseTo(0, 12)
    expect(shifted.nse).toBeLessThan(0) // 평균만 쓰는 것보다 나쁘다
    expect(shifted.r).toBeCloseTo(1, 12) // 상관은 편향을 놓친다
    const scaled = computeMetrics(O, O.map((x) => x * 2))
    expect(scaled.theilS).toBeGreaterThan(scaled.theilC)
  })

  it('관측과 시뮬레이션에 같은 배율을 곱해도 정규화 지표·NSE·상관·U·몫·추세는 그대로다', () => {
    const a = computeMetrics(O, S)
    const b = computeMetrics(O.map((x) => x * 37), S.map((x) => x * 37))
    for (const key of ['nrmse', 'mre', 'mape', 'nse', 'r', 'theilU', 'theilM', 'theilS', 'theilC', 'trend'] as const) expect(b[key]).toBeCloseTo(a[key], 10)
    expect(b.rmse).toBeCloseTo(a.rmse * 37, 9) // 단위가 있는 지표는 배율을 따른다
  })

  it('관측이 0인 점은 MRE·MAPE에서만 빼고 개수를 알린다', () => {
    const m = computeMetrics([0, 2, 4], [1, 3, 4])
    expect(m.zeroObserved).toBe(1)
    expect(m.mre).toBeCloseTo((1 / 2 + 0) / 2, 12)
    expect(m.mape).toBeCloseTo((1 / 2 + 0) / 2, 12)
    expect(m.n).toBe(3) // 다른 지표에는 모든 점을 쓴다
    expect(m.mae).toBeCloseTo((1 + 1 + 0) / 3, 12)
    const allZero = computeMetrics([0, 0], [1, 1])
    expect(Number.isNaN(allZero.mre) && Number.isNaN(allZero.mape) && Number.isNaN(allZero.nrmse)).toBe(true)
  })

  it('관측이 상수면 NSE는 정의되지 않는다(완전 일치면 1)', () => {
    expect(Number.isNaN(computeMetrics([5, 5, 5], [4, 5, 6]).nse)).toBe(true)
    expect(computeMetrics([5, 5, 5], [5, 5, 5]).nse).toBe(1)
  })

  it('유한하지 않은 짝은 뺀다', () => {
    const m = computeMetrics([1, NaN, 3, 4], [1, 2, Infinity, 4])
    expect(m.n).toBe(2)
    expect(m.rmse).toBe(0)
  })

  it('비어 있거나 짝이 하나뿐일 때', () => {
    const e = computeMetrics([], [])
    expect(e.n).toBe(0)
    expect(Number.isNaN(e.rmse) && Number.isNaN(e.trend)).toBe(true)
    const one = computeMetrics([2], [3])
    expect(one.n).toBe(1)
    expect(one.me).toBe(1)
    expect(Number.isNaN(one.trend) && Number.isNaN(one.r)).toBe(true)
  })

  it('길이가 다르면 오류', () => {
    expect(() => computeMetrics([1, 2], [1])).toThrow(MetricsError)
  })

  it('추세는 같음(0)끼리도 일치로 센다', () => {
    expect(computeMetrics([1, 1, 2], [3, 3, 9]).trend).toBe(1)
    expect(computeMetrics([1, 1, 2], [3, 4, 9]).trend).toBeCloseTo(0.5, 12)
  })
})

describe('허용 기준', () => {
  const m = computeMetrics(O, S) // nrmse ≈ 0.245, mre ≈ 0.146, nse 0.7, trend 1
  it('기준을 정한 지표만 안/밖을 낸다(기준이 없으면 아무것도 내지 않는다)', () => {
    expect(checkTolerances(m, {})).toEqual({})
    expect(checkTolerances(m, { nrmse: 0.3, mre: 0.1 })).toEqual({ nrmse: 'in', mre: 'out' })
  })
  it('방향: NSE·추세는 이상, 나머지는 이하(MRE는 절댓값)', () => {
    expect(checkTolerances(m, { nse: 0.7, trend: 1 })).toEqual({ nse: 'in', trend: 'in' })
    expect(checkTolerances(m, { nse: 0.71 })).toEqual({ nse: 'out' })
    const under = computeMetrics([10, 10], [9, 9]) // MRE = −0.1
    expect(checkTolerances(under, { mre: 0.1 }).mre).toBe('in')
    expect(checkTolerances(under, { mre: 0.05 }).mre).toBe('out')
    expect(checkTolerances(m, { mape: 0.3 }).mape).toBe('in')
  })
  it('값을 알 수 없으면 판정하지 않는다', () => {
    expect(checkTolerances(computeMetrics([], []), { nrmse: 0.1 })).toEqual({ nrmse: 'na' })
    expect(checkTolerances(m, { nrmse: NaN })).toEqual({ nrmse: 'na' })
  })
})

describe('완료 시점 오차', () => {
  it('시뮬레이션 − 실제(일)와 실제 대비 비율', () => {
    expect(completionError(330, 300)).toEqual({ days: 30, percent: 10 })
    expect(completionError(270, 300)).toEqual({ days: -30, percent: -10 })
  })
  it('시뮬레이션이 끝나지 않았거나 실제 완료일이 올바르지 않으면 null', () => {
    expect(completionError(null, 300)).toEqual({ days: null, percent: null })
    expect(completionError(300, NaN)).toEqual({ days: null, percent: null })
    expect(completionError(10, 0)).toEqual({ days: 10, percent: null })
  })
})

describe('종합 J = Σ w·NRMSE²', () => {
  it('가중치를 주지 않으면 열 수의 역수', () => {
    const r = weightedNrmse([{ nrmse: 0.2 }, { nrmse: 0.4 }])
    expect(r.j).toBeCloseTo((0.04 + 0.16) / 2, 12)
    expect(r).toMatchObject({ used: 2, skipped: 0 })
  })
  it('가중치를 주면 그대로 곱한다', () => {
    expect(weightedNrmse([{ nrmse: 0.2, weight: 0.75 }, { nrmse: 0.4, weight: 0.25 }]).j).toBeCloseTo(0.75 * 0.04 + 0.25 * 0.16, 12)
  })
  it('NRMSE를 모르는 열은 빼고 개수를 알린다(남은 열로 1/열 수를 다시 정한다)', () => {
    const r = weightedNrmse([{ nrmse: 0.2 }, { nrmse: NaN }, { nrmse: 0.4 }])
    expect(r.j).toBeCloseTo((0.04 + 0.16) / 2, 12)
    expect(r).toMatchObject({ used: 2, skipped: 1 })
    const none = weightedNrmse([{ nrmse: NaN }])
    expect(Number.isNaN(none.j)).toBe(true)
    expect(none).toMatchObject({ used: 0, skipped: 1 })
  })
})

// ---------- 정렬 ----------

/** 시각 0~10, 변수 x = 2t(선형), y = 100 − t. 기록 간격 2. */
const result = (): RunResult => ({
  time: Float64Array.from([0, 2, 4, 6, 8, 10]),
  series: { x: Float64Array.from([0, 4, 8, 12, 16, 20]), y: Float64Array.from([100, 98, 96, 94, 92, 90]) },
  meta: { model: 't', version: 1, dt: 1, seed: 1, completed: true }
})

describe('시간 변환', () => {
  it('t_sim = t_data × 단위 + 이동', () => {
    expect(toSimTime(3)).toBe(3)
    expect(toSimTime(3, 'week')).toBe(21)
    expect(toSimTime(2, 'month')).toBeCloseTo(60.875, 12)
    expect(toSimTime(3, 'day', 5)).toBe(8)
    expect(toSimTime(2, 'week', -4)).toBe(10)
  })
})

describe('열 정렬', () => {
  it('일 단위: 기록 눈금 위의 점은 그 값, 사이는 선형 보간', () => {
    const a = alignColumn(result(), { variable: 'x', points: [[2, 5], [5, 11], [8, 15]] })
    expect(a.time).toEqual([2, 5, 8])
    expect(a.observed).toEqual([5, 11, 15])
    expect(a.simulated).toEqual([4, 10, 16]) // x(5) = 10
    expect(a.outOfRange + a.invalid).toBe(0)
  })

  it('주 단위와 시간 이동을 적용한다', () => {
    // 데이터 시각 1, 2 (주) → 7, 14일 → 이동 −6 → 1, 8일
    const a = alignColumn(result(), { variable: 'y', points: [[1, 1], [2, 2]] }, { timeUnit: 'week', offsetDay: -6 })
    expect(a.time).toEqual([1, 8])
    expect(a.simulated).toEqual([99, 92])
  })

  it('값 배율은 관측에만 곱한다', () => {
    const a = alignColumn(result(), { variable: 'x', scale: 10, points: [[4, 0.8]] })
    expect(a.observed).toEqual([8])
    expect(a.simulated).toEqual([8])
    expect(computeMetrics(a.observed, a.simulated).rmse).toBe(0)
  })

  it('시뮬레이션 범위 밖의 점은 빼고 개수를 알린다(양 끝은 포함)', () => {
    const a = alignColumn(result(), { variable: 'x', points: [[-1, 0], [0, 0], [10, 20], [10.5, 21], [30, 60]] })
    expect(a.time).toEqual([0, 10])
    expect(a.outOfRange).toBe(3)
  })

  it('유한하지 않은 점은 빼고 따로 센다', () => {
    const a = alignColumn(result(), { variable: 'x', points: [[1, NaN], [Infinity, 1], [2, 4]] })
    expect(a.time).toEqual([2])
    expect(a.invalid).toBe(2)
  })

  it('입력이 시간 순서가 아니어도 시간 순서로 돌려준다(같은 시각은 입력 순서)', () => {
    const a = alignColumn(result(), { variable: 'x', points: [[6, 1], [2, 2], [6, 3], [4, 4]] })
    expect(a.time).toEqual([2, 4, 6, 6])
    expect(a.observed).toEqual([2, 4, 1, 3])
  })

  it('점이 없거나 모두 범위 밖이면 빈 짝', () => {
    expect(alignColumn(result(), { variable: 'x', points: [] }).time).toEqual([])
    expect(alignColumn(result(), { variable: 'x', points: [[99, 1]] })).toMatchObject({ time: [], outOfRange: 1 })
  })

  it('모델에 없는 변수·올바르지 않은 배율·이동은 오류', () => {
    expect(() => alignColumn(result(), { variable: 'nope', points: [[1, 1]] })).toThrow(AlignError)
    expect(() => alignColumn(result(), { variable: 'x', scale: Infinity, points: [[1, 1]] })).toThrow(/배율/)
    expect(() => alignColumn(result(), { variable: 'x', points: [[1, 1]] }, { offsetDay: NaN })).toThrow(/이동/)
  })

  it('정렬 결과를 지표로 바로 넘길 수 있다(관측이 선형이면 오차 0)', () => {
    const a = alignColumn(result(), { variable: 'x', points: [[1, 2], [3, 6], [7, 14]] })
    const m = computeMetrics(a.observed, a.simulated)
    expect(m.n).toBe(3)
    expect(m.rmse).toBeCloseTo(0, 12)
    expect(m.nse).toBe(1)
  })
})

describe('실제 모델 결과와의 정렬', () => {
  const run = (overrides: Record<string, number>) => runModel(compileModel(brooksModel), { overrides })
  /** 결과에서 주 단위(7일)로 뽑은 "관측" 점. 데이터 시각은 주 */
  const weekly = (r: RunResult, variable: string): [number, number][] => {
    const out: [number, number][] = []
    for (let w = 1; w * 7 <= 200; w++) out.push([w, valueAt(r, variable, w * 7)])
    return out
  }

  it('같은 실행에서 뽑은 관측은 오차가 0이고 모든 열이 완전 일치한다', () => {
    const base = run({})
    const col = { variable: 'total_personnel', points: weekly(base, 'total_personnel') }
    const a = alignColumn(base, col, { timeUnit: 'week' })
    expect(a.time.length).toBe(28)
    const m = computeMetrics(a.observed, a.simulated)
    expect(m.rmse).toBeCloseTo(0, 9)
    expect(m.nse).toBeCloseTo(1, 9)
  })

  it('인력을 더 투입한 실행을 "실제"로 보면 편향이 있고 NSE가 1보다 작다', () => {
    const actual = run({ extra_people: 10 })
    const sim = run({})
    const a = alignColumn(sim, { variable: 'total_personnel', points: weekly(actual, 'total_personnel') }, { timeUnit: 'week' })
    const m = computeMetrics(a.observed, a.simulated)
    expect(m.me).toBeLessThan(0) // 시뮬레이션이 인원을 적게 본다
    expect(m.nse).toBeLessThan(1)
    expect(m.theilM + m.theilS + m.theilC).toBeCloseTo(1, 10)
  })

  it('완료 시점 오차: 시뮬레이션 완료일 − 실제 완료일', () => {
    const done = (r: RunResult) => lastOf(r, 'completion_time')
    const e = completionError(done(run({})), done(run({ extra_people: 10 })))
    expect(e.days).toBeLessThan(0) // 인력을 더 넣으면(Brooks 법칙) 실제가 더 늦다
    expect(e.percent).toBeLessThan(0)
  })
})
