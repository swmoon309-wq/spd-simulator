import { describe, expect, it } from 'vitest'
import { compileModel, parseModelDef, runModel } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '@spd/models'
import {
  bandSummary,
  compareResults,
  computeKpis,
  inputColumn,
  kpiDistribution,
  kpiHistogram,
  lastOf,
  MAX_ITERATIONS,
  McError,
  McRunner,
  ppf,
  runMonteCarlo,
  sampleInput,
  targetProbability,
  valueAt,
  type InputSpec,
  type KpiSpec,
  type McInput
} from '../src'

const brooks = compileModel(brooksModel)
const completion: KpiSpec = {
  id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1,
  compute: (r) => (lastOf(r, 'requirements') <= 1e-6 ? lastOf(r, 'completion_time') : null)
}
const effort: KpiSpec = {
  id: 'totalEffort', label: '총 공수', unit: '맨데이', better: 'lower', group: 'cost', decimals: 0,
  compute: (r) => (lastOf(r, 'requirements') <= 1e-6 ? valueAt(r, 'cum_effort', lastOf(r, 'completion_time')) : null)
}
const prod: InputSpec = { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 }, min: 0.001, max: 10 }
const staff: InputSpec = { name: 'initial_experienced', dist: { kind: 'uniform', min: 15, max: 25 }, min: 0, max: 200, integer: true }
const idle: InputSpec = { name: 'hire_day', dist: { kind: 'uniform', min: 50, max: 300 }, min: 0, max: 400 }
const input = (over: Partial<McInput> = {}): McInput => ({ model: brooks, baseParams: {}, options: {}, inputs: [prod], n: 60, seed: 1, kpis: [completion, effort], ...over })

describe('입력 검사', () => {
  it.each([
    ['반복 0', { n: 0 }, '반복 수'],
    ['반복 소수', { n: 10.5 }, '반복 수'],
    ['반복 상한 초과', { n: MAX_ITERATIONS + 1 }, '반복 수'],
    ['입력 없음', { inputs: [] }, '하나 이상'],
    ['지표 없음', { kpis: [] }, '지표'],
    ['상수가 아닌 입력', { inputs: [{ ...prod, name: 'requirements' }] }, '상수가 아닙니다'],
    ['분포 오류', { inputs: [{ ...prod, dist: { kind: 'triangular', min: 1, mode: 0.5, max: 2 } as const }] }, '최소 ≤ 최빈 ≤ 최대'],
    ['이름 중복', { inputs: [prod, prod] }, '겹칩니다']
  ])('거부: %s', (_n, over, msg) => {
    expect(() => new McRunner(input(over as Partial<McInput>))).toThrow(McError)
    try {
      new McRunner(input(over as Partial<McInput>))
    } catch (e) {
      expect((e as Error).message).toContain(msg)
    }
  })
  it('상한 5000회는 허용', () => {
    expect(() => new McRunner(input({ n: MAX_ITERATIONS }))).not.toThrow()
  })
  it('시계열 변수가 모델에 없으면 거부', () => {
    expect(() => new McRunner(input({ band: { variable: 'nope' } }))).toThrow(/모델에 없습니다/)
  })
})

describe('재현성과 결정성', () => {
  it('퇴화 분포만 있으면 모든 반복이 결정적 실행과 비트 동일하다', () => {
    const fixed: InputSpec = { ...prod, dist: { kind: 'uniform', min: 0.1, max: 0.1 } }
    const r = runMonteCarlo(input({ inputs: [fixed], n: 12 }))
    const det = computeKpis([completion, effort], runModel(brooks, { overrides: { nominal_productivity: 0.1 } }), { nominal_productivity: 0.1 })
    for (let i = 0; i < 12; i++) {
      expect(Object.is((r.kpis[0] as Float64Array)[i], det['completionDay'])).toBe(true)
      expect(Object.is((r.kpis[1] as Float64Array)[i], det['totalEffort'])).toBe(true)
    }
    expect(r.completed).toBe(12)
    expect(r.failures).toEqual([])
  })
  it('같은 입력·시드는 같은 결과, 다른 시드는 다른 결과', () => {
    const a = runMonteCarlo(input())
    const b = runMonteCarlo(input())
    const c = runMonteCarlo(input({ seed: 2 }))
    expect(Array.from(a.kpis[0] as Float64Array)).toEqual(Array.from(b.kpis[0] as Float64Array))
    expect(Array.from(a.kpis[0] as Float64Array)).not.toEqual(Array.from(c.kpis[0] as Float64Array))
  })
  it('반복 수를 늘려도 앞부분이 같다(접두 안정)', () => {
    const small = runMonteCarlo(input({ n: 30 }))
    const big = runMonteCarlo(input({ n: 90 }))
    expect(Array.from(big.kpis[0] as Float64Array).slice(0, 30)).toEqual(Array.from(small.kpis[0] as Float64Array))
    expect(Array.from(big.inputs[0] as Float64Array).slice(0, 30)).toEqual(Array.from(small.inputs[0] as Float64Array))
  })
  it('입력을 더해도 기존 입력의 표본은 그대로다', () => {
    const one = runMonteCarlo(input({ inputs: [prod], n: 20 }))
    const two = runMonteCarlo(input({ inputs: [idle, prod], n: 20 }))
    expect(Array.from(inputColumn(two, 'nominal_productivity'))).toEqual(Array.from(inputColumn(one, 'nominal_productivity')))
  })
  it('기록한 입력 표본은 표본 추출 함수와 같다', () => {
    const r = runMonteCarlo(input({ n: 10 }))
    for (let i = 0; i < 10; i++) expect(inputColumn(r, 'nominal_productivity')[i]).toBe(sampleInput(prod, 1, i))
  })
})

describe('진행과 취소', () => {
  it('step으로 나눠 실행해도 한 번에 실행한 것과 같다', () => {
    const whole = runMonteCarlo(input({ n: 40 }))
    const runner = new McRunner(input({ n: 40 }))
    while (!runner.step(7)) {
      /* 반복 */
    }
    expect(Array.from(runner.result().kpis[0] as Float64Array)).toEqual(Array.from(whole.kpis[0] as Float64Array))
  })
  it('취소하면 그때까지 끝난 반복이 완전한 결과로 남는다', () => {
    const full = runMonteCarlo(input({ n: 100 }))
    const runner = new McRunner(input({ n: 100 }))
    runner.step(23)
    const part = runner.result()
    expect(part.completed).toBe(23)
    expect(part.n).toBe(100)
    expect((part.kpis[0] as Float64Array).length).toBe(23)
    expect(Array.from(part.kpis[0] as Float64Array)).toEqual(Array.from(full.kpis[0] as Float64Array).slice(0, 23))
    expect(kpiDistribution(part, 'completionDay').nOk).toBe(23)
  })
  it('runMonteCarlo: 진행 콜백과 shouldStop', () => {
    const seen: number[] = []
    const r = runMonteCarlo(input({ n: 100 }), { onProgress: (d) => seen.push(d), shouldStop: () => seen.length >= 3 })
    expect(seen.length).toBe(3)
    expect(r.completed).toBe(seen[2])
    expect(r.completed).toBeLessThan(100)
    const all: number[] = []
    runMonteCarlo(input({ n: 100 }), { onProgress: (d, t) => all.push(d / t) })
    expect(all[all.length - 1]).toBe(1)
  })
  it('step은 모두 끝난 뒤에는 아무것도 하지 않는다', () => {
    const runner = new McRunner(input({ n: 5 }))
    expect(runner.step(100)).toBe(true)
    expect(runner.step(100)).toBe(true)
    expect(runner.completed).toBe(5)
  })
})

describe('단조 모델에서 분위수가 보존된다', () => {
  it('Brooks의 완료일은 공칭 생산성에 대해 감소 → 완료일의 P80 ≈ 생산성 P20에서의 완료일', () => {
    const r = runMonteCarlo(input({ n: 2000 }))
    const d = kpiDistribution(r, 'completionDay')
    const x20 = ppf(prod.dist, 0.2)
    const exact = lastOf(runModel(brooks, { overrides: { nominal_productivity: x20 } }), 'completion_time')
    expect(Math.abs(d.summary.percentiles['0.8']! - exact)).toBeLessThan(1.5)
    // 중앙값도 마찬가지
    const x50 = ppf(prod.dist, 0.5)
    const exact50 = lastOf(runModel(brooks, { overrides: { nominal_productivity: x50 } }), 'completion_time')
    expect(Math.abs(d.summary.percentiles['0.5']! - exact50)).toBeLessThan(1.5)
  })
  it('생산성이 높을수록 일찍 끝난다(표본 단위로 단조)', () => {
    const r = runMonteCarlo(input({ n: 200 }))
    const x = Array.from(inputColumn(r, 'nominal_productivity'))
    const y = Array.from(r.kpis[0] as Float64Array)
    const order = x.map((v, i) => i).sort((a, b) => (x[a] as number) - (x[b] as number))
    for (let k = 1; k < order.length; k++) expect(y[order[k] as number]).toBeLessThanOrEqual((y[order[k - 1] as number] as number) + 1e-9)
  })
})

describe('실패 격리', () => {
  const flaky = parseModelDef({
    meta: { id: 'flaky', name: 'flaky', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 5, dt: 0.5 },
    constants: { a: { value: 0.8 } },
    levels: { x: { init: '1', inflows: ['g'], outflows: [] } },
    rates: { g: { expr: 'SQRT(a - 0.5)' } },
    auxiliaries: {},
    tables: {},
    outputs: []
  })
  const final: KpiSpec = { id: 'x', label: 'x', unit: '', better: 'none', group: 'risk', decimals: 2, compute: (r) => lastOf(r, 'x') }
  const spec: InputSpec = { name: 'a', dist: { kind: 'uniform', min: 0, max: 1 }, min: 0, max: 1 }
  const r = runMonteCarlo({ model: compileModel(flaky), baseParams: {}, options: {}, inputs: [spec], n: 200, seed: 3, kpis: [final] })

  it('NaN이 나오는 반복(a < 0.5)만 실패로 기록하고 나머지는 계속한다', () => {
    expect(r.completed).toBe(200)
    expect(r.failures.length).toBeGreaterThan(70)
    expect(r.failures.length).toBeLessThan(130)
    for (const f of r.failures) {
      expect(f.values['a']).toBeLessThan(0.5)
      expect(f.message).toContain('NaN')
      expect(r.status[f.iteration]).toBe(1)
    }
    for (let i = 0; i < 200; i++) if (r.status[i] === 0) expect((r.inputs[0] as Float64Array)[i]).toBeGreaterThanOrEqual(0.5)
  })
  it('실패한 반복의 표본은 남고 분포에서는 빠진다', () => {
    const d = kpiDistribution(r, 'x')
    expect(d.nFailed).toBe(r.failures.length)
    expect(d.nOk + d.nFailed).toBe(200)
    expect(d.summary.n).toBe(d.nOk)
  })
  it('목표 확률의 분모는 성공한 반복 수', () => {
    const p = targetProbability(r, [{ kpi: 'x', op: '>=', value: 0 }])
    expect(p.n).toBe(200 - r.failures.length)
    expect(p.p).toBe(1)
  })
  it('모델 정의의 다른 오류(상수가 아닌 이름)는 실행 시작 전에 거부된다', () => {
    expect(() => runMonteCarlo({ model: compileModel(flaky), baseParams: {}, options: {}, inputs: [{ ...spec, name: 'x' }], n: 5, seed: 1, kpis: [final] })).toThrow(McError)
  })
})

describe('계산할 수 없는 지표(미완료)', () => {
  const short = input({ options: { end: 100 }, n: 40 })
  const r = runMonteCarlo(short)
  it('NaN으로 기록하고 분포에서 빼며 비율로 보인다', () => {
    const d = kpiDistribution(r, 'completionDay')
    expect(d.nUndefined).toBe(40)
    expect(d.nOk).toBe(40)
    expect(d.undefinedRate).toBe(1)
    expect(d.summary.n).toBe(0)
    expect(d.summary.mean).toBeNaN()
  })
  it('목표 확률에서는 만족하지 못한 것으로 센다', () => {
    expect(targetProbability(r, [{ kpi: 'completionDay', op: '<=', value: 1e9 }]).p).toBe(0)
  })
  it('일부만 미완료이면 비율이 중간', () => {
    const half = runMonteCarlo(input({ n: 200, inputs: [{ ...prod, dist: { kind: 'uniform', min: 0.04, max: 0.2 } }], options: { end: 330 } }))
    const d = kpiDistribution(half, 'completionDay')
    expect(d.undefinedRate).toBeGreaterThan(0)
    expect(d.undefinedRate).toBeLessThan(1)
    expect(d.summary.n + d.nUndefined).toBe(d.nOk)
  })
})

describe('목표 달성 확률', () => {
  const r = runMonteCarlo(input({ n: 400 }))
  const d = kpiDistribution(r, 'completionDay')
  it('경계: 목표 = 최소 미만 → 0, 최대 이상 → 1', () => {
    expect(targetProbability(r, [{ kpi: 'completionDay', op: '<=', value: d.summary.min - 1 }]).p).toBe(0)
    expect(targetProbability(r, [{ kpi: 'completionDay', op: '<=', value: d.summary.max }]).p).toBe(1)
    expect(targetProbability(r, [{ kpi: 'completionDay', op: '>=', value: d.summary.min }]).p).toBe(1)
    expect(targetProbability(r, [{ kpi: 'completionDay', op: '>=', value: d.summary.max + 1 }]).p).toBe(0)
  })
  it('P80을 목표로 하면 확률이 약 0.8이고 구간이 그것을 포함한다', () => {
    const p80 = d.summary.percentiles['0.8'] as number
    const t = targetProbability(r, [{ kpi: 'completionDay', op: '<=', value: p80 }])
    expect(t.p).toBeGreaterThanOrEqual(0.8)
    expect(t.p).toBeLessThan(0.82)
    expect(t.low).toBeLessThan(0.8)
    expect(t.high).toBeGreaterThan(0.8)
  })
  it('동시 달성 확률은 각 확률의 최소 이하', () => {
    const t1 = { kpi: 'completionDay', op: '<=' as const, value: d.summary.percentiles['0.5'] as number }
    const e = kpiDistribution(r, 'totalEffort')
    const t2 = { kpi: 'totalEffort', op: '<=' as const, value: e.summary.percentiles['0.5'] as number }
    const both = targetProbability(r, [t1, t2])
    expect(both.p).toBeLessThanOrEqual(Math.min(targetProbability(r, [t1]).p, targetProbability(r, [t2]).p))
    // 완료일과 공수는 같은 입력으로 움직여 양의 상관(생산성이 낮으면 둘 다 큼)이므로 동시 확률이 곱보다 크다
    expect(both.p).toBeGreaterThan(targetProbability(r, [t1]).p * targetProbability(r, [t2]).p)
  })
  it('목표가 없으면(빈 목록) 모든 성공 반복이 만족', () => {
    expect(targetProbability(r, []).p).toBe(1)
  })
  it('지표가 없으면 오류', () => {
    expect(() => targetProbability(r, [{ kpi: 'nope', op: '<=', value: 1 }])).toThrow(McError)
  })
})

describe('시나리오 간 비교 (공통난수)', () => {
  it('같은 시나리오 둘의 차이는 0이다', () => {
    const a = runMonteCarlo(input({ n: 50 }))
    const b = runMonteCarlo(input({ n: 50 }))
    const c = compareResults(a, b, 'completionDay')
    expect(c.pairs).toBe(50)
    expect(c.meanDiff).toBe(0)
    expect(c.probALess).toBe(0)
    expect(c.probTie).toBe(1)
    expect(c.flipRate).toBe(0)
  })
  it('인력 보강(110일 +5명)이 있는 시나리오 B는 대부분 A보다 빠르다', () => {
    const a = runMonteCarlo(input({ n: 100 }))
    const b = runMonteCarlo(input({ n: 100, baseParams: { extra_people: 5, hire_day: 110 } }))
    const c = compareResults(a, b, 'completionDay')
    expect(c.pairs).toBe(100)
    expect(c.meanDiff).toBeLessThan(0) // B − A < 0
    expect(c.probALess).toBeLessThan(0.1)
    expect(c.diffCI.high).toBeLessThan(0)
    // 공수는 인력을 보강하면 늘어난다(책 p.21)
    expect(compareResults(a, b, 'totalEffort').meanDiff).toBeGreaterThan(0)
  })
  it('쌍별 비교의 순위 뒤바뀜: +10명은 반복에 따라 우열이 갈릴 수 있다', () => {
    const wide: InputSpec = { ...prod, dist: { kind: 'uniform', min: 0.05, max: 0.2 } }
    const a = runMonteCarlo(input({ n: 100, inputs: [wide], options: { end: 600 } }))
    const b = runMonteCarlo(input({ n: 100, inputs: [wide], options: { end: 600 }, baseParams: { extra_people: 10, hire_day: 110 } }))
    const c = compareResults(a, b, 'completionDay')
    expect(c.flipRate).toBeGreaterThanOrEqual(0)
    expect(c.flipRate).toBeLessThanOrEqual(0.5)
  })
  it('시드·입력·반복 수가 다르면 비교하지 않는다', () => {
    const a = runMonteCarlo(input({ n: 20 }))
    expect(() => compareResults(a, runMonteCarlo(input({ n: 20, seed: 2 })), 'completionDay')).toThrow(/같아야/)
    expect(() => compareResults(a, runMonteCarlo(input({ n: 21 })), 'completionDay')).toThrow(/같아야/)
    expect(() => compareResults(a, runMonteCarlo(input({ n: 20, inputs: [idle] })), 'completionDay')).toThrow(McError)
  })
})

describe('분포 화면 자료', () => {
  it('히스토그램 도수의 합 = 지표가 있는 성공 반복 수', () => {
    const r = runMonteCarlo(input({ n: 150 }))
    const h = kpiHistogram(r, 'completionDay')
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(kpiDistribution(r, 'completionDay').summary.n)
    expect(kpiHistogram(r, 'completionDay', 5).counts.length).toBeLessThanOrEqual(8)
  })
  it('평균의 신뢰구간은 평균을 포함하고 표본이 많을수록 좁다', () => {
    const a = kpiDistribution(runMonteCarlo(input({ n: 50 })), 'completionDay')
    const b = kpiDistribution(runMonteCarlo(input({ n: 800 })), 'completionDay')
    expect(a.meanCI.low).toBeLessThan(a.summary.mean)
    expect(a.meanCI.high).toBeGreaterThan(a.summary.mean)
    expect(b.meanCI.high - b.meanCI.low).toBeLessThan(a.meanCI.high - a.meanCI.low)
  })
  it('시계열 띠: P10 ≤ P50 ≤ P90, 시작은 0이고 개발 완료 규모는 늘기만 한다', () => {
    const r = runMonteCarlo(input({ n: 60, band: { variable: 'developed_software' } }))
    const band = bandSummary(r)
    expect(band).toHaveLength(401)
    expect(band[0]).toMatchObject({ time: 0, p10: 0, p50: 0, p90: 0 })
    for (let k = 0; k < band.length; k++) {
      expect(band[k]!.p10).toBeLessThanOrEqual(band[k]!.p50 + 1e-9)
      expect(band[k]!.p50).toBeLessThanOrEqual(band[k]!.p90 + 1e-9)
      if (k > 0) expect(band[k]!.p50).toBeGreaterThanOrEqual(band[k - 1]!.p50 - 1e-9)
    }
    expect(band[400]!.p50).toBeCloseTo(500, 6)
  })
  it('띠를 요청하지 않으면 빈 목록', () => {
    expect(bandSummary(runMonteCarlo(input({ n: 5 })))).toEqual([])
  })
})

describe('통합 모델', () => {
  const integrated = compileModel(integratedProjectModel)
  const ic: KpiSpec = {
    id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1,
    compute: (r) => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null)
  }
  it('입력 둘로 100회 실행해 분포를 만들고 허용 시간 안에 끝난다', () => {
    const t0 = Date.now()
    const r = runMonteCarlo({
      model: integrated,
      baseParams: {},
      options: {},
      inputs: [
        { name: 'pro_prod', dist: { kind: 'triangular', min: 0.8, mode: 1, max: 1.2 }, min: 0.1, max: 3 },
        { name: 'plan_known_fraction', dist: { kind: 'pert', min: 0.5, mode: 0.7, max: 1 }, min: 0.3, max: 1 }
      ],
      n: 100,
      seed: 5,
      kpis: [ic]
    })
    expect(Date.now() - t0).toBeLessThan(5000)
    const d = kpiDistribution(r, 'completionDay')
    expect(d.nOk).toBe(100)
    expect(d.summary.sd).toBeGreaterThan(0)
    expect(d.summary.min).toBeLessThan(d.summary.max)
  })
})
