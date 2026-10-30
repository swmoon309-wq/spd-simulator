import { describe, expect, it } from 'vitest'
import { brooksModel } from '@spd/models'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { calibrationSteps, CalibrationError, runCalibration, startPoints, valueAt, type CalibInput, type CalibParam } from '../src'

const model = compileModel(brooksModel)
const defaults = Object.fromEntries(Object.entries(brooksModel.constants).map(([k, c]) => [k, (c as { value: number }).value]))
const run = (overrides: Record<string, number> = {}): RunResult => runModel(model, { overrides })

/** 결과에서 주 단위(1~28주)로 뽑은 관측 [주, 값]. */
const weekly = (r: RunResult, variable: string, weeks = 28, noise = 0, seed = 7): [number, number][] => {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2 // −1 ~ 1
  return Array.from({ length: weeks }, (_, i) => [i + 1, valueAt(r, variable, (i + 1) * 7) * (1 + noise * rnd())] as [number, number])
}
const param = (name: string, min: number, max: number, integer = false): CalibParam => ({ name, min, max, ...(integer ? { integer: true } : {}) })
const input = (over: Partial<CalibInput> = {}): CalibInput => ({
  model,
  base: defaults,
  options: {},
  params: [param('nominal_productivity', 0.01, 1)],
  columns: [{ variable: 'developed_software', points: weekly(run({ nominal_productivity: 0.13 }), 'developed_software') }],
  align: { timeUnit: 'week' },
  ...over
})

describe('시작점', () => {
  it('첫 점은 현재 값이고, 나머지는 라틴 하이퍼큐브(파라미터마다 구간을 한 번씩) 표본이다', () => {
    const pts = startPoints([0.3, 0.7], 5, 1)
    expect(pts).toHaveLength(5)
    expect(pts[0]).toEqual([0.3, 0.7])
    for (let d = 0; d < 2; d++) {
      const strata = pts.slice(1).map((p) => Math.floor((p[d] as number) * 4))
      expect(strata.sort()).toEqual([0, 1, 2, 3]) // 4개 구간을 모두 한 번씩
    }
    for (const p of pts) for (const v of p) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1)
  })
  it('같은 시드는 같은 점, 다른 시드는 다른 점이다', () => {
    expect(startPoints([0.5], 5, 3)).toEqual(startPoints([0.5], 5, 3))
    expect(startPoints([0.5], 5, 3)).not.toEqual(startPoints([0.5], 5, 4))
  })
  it('시작이 하나뿐이면 현재 값만', () => {
    expect(startPoints([0.2], 1, 1)).toEqual([[0.2]])
  })
})

describe('쌍둥이 회수: 알려진 파라미터로 만든 합성 데이터', () => {
  it('잡음 없는 데이터에서 공칭 생산성 0.13을 회수한다(현재 값 0.1에서 출발)', () => {
    const r = runCalibration(input())
    expect(r.names).toEqual(['nominal_productivity'])
    expect(r.initial).toEqual([0.1])
    expect(Math.abs((r.best[0] as number) - 0.13) / 0.13).toBeLessThan(0.005)
    expect(r.jAfter).toBeLessThan(r.jBefore / 100)
    expect(r.jAfter).toBeLessThan(1e-4)
    expect(r.diagnostics.filter((d) => d.severity === 'warn')).toEqual([]) // 잘 정해진 문제이므로 경고가 없다
    expect(r.starts).toHaveLength(5)
    expect(r.canceled).toBe(false)
  })

  it('3% 잡음에서도 5% 안으로 회수하고 목적함수는 잡음 수준이다', () => {
    const noisy = weekly(run({ nominal_productivity: 0.13 }), 'developed_software', 28, 0.03)
    const r = runCalibration(input({ columns: [{ variable: 'developed_software', points: noisy }] }))
    expect(Math.abs((r.best[0] as number) - 0.13) / 0.13).toBeLessThan(0.05)
    expect(r.jAfter).toBeGreaterThan(0)
    expect(r.jAfter).toBeLessThan(0.01)
  })

  it('여러 열(개발 완료 규모 + 누적 공수)을 가중해 함께 맞춘다', () => {
    const actual = run({ nominal_productivity: 0.13 })
    const r = runCalibration(
      input({
        columns: [
          { variable: 'developed_software', points: weekly(actual, 'developed_software'), weight: 3 },
          { variable: 'cum_effort', points: weekly(actual, 'cum_effort'), weight: 1 }
        ]
      })
    )
    expect(Math.abs((r.best[0] as number) - 0.13) / 0.13).toBeLessThan(0.01)
    expect(r.columns.map((c) => c.weight)).toEqual([0.75, 0.25]) // 합이 1이 되게 다시 맞춘다
    expect(r.columns.every((c) => (c.nrmseAfter ?? 1) <= (c.nrmseBefore ?? 0) + 1e-12)).toBe(true)
  })

  it('정수 파라미터는 정수 값으로 회수한다(초기 숙련 인원 28)', () => {
    const actual = run({ initial_experienced: 28 })
    const r = runCalibration(input({ params: [param('initial_experienced', 1, 60, true)], columns: [{ variable: 'developed_software', points: weekly(actual, 'developed_software') }] }))
    expect(r.best[0]).toBe(28)
    expect(Number.isInteger(r.best[0])).toBe(true)
    expect(r.jAfter).toBeLessThan(1e-6)
  })
})

describe('식별 가능성 진단', () => {
  it('공칭 생산성과 숙련자 계수는 곱으로만 영향을 주므로 비유일성을 경고한다(곱 0.156은 회수)', () => {
    const r = runCalibration(input({ params: [param('nominal_productivity', 0.01, 1), param('experienced_productivity_factor', 0.1, 5)] }))
    const product = (r.best[0] as number) * (r.best[1] as number)
    expect(Math.abs(product - 0.13 * 1.2) / (0.13 * 1.2)).toBeLessThan(0.02) // 곱은 정해진다
    const d = r.diagnostics.find((x) => x.kind === 'nonunique')
    expect(d, '비유일성 경고').toBeDefined()
    expect(d!.params.sort()).toEqual(['experienced_productivity_factor', 'nominal_productivity'])
    expect(d!.message).toContain('해가 유일하지 않습니다')
  })

  it('신입 생산성 계수는 신입이 없으면 영향이 없어 평탄을 경고한다(시작 값에서 이미 완벽해도)', () => {
    const data = weekly(run({}), 'developed_software') // 실제 = 기준. 신입이 없다
    const r = runCalibration(input({ params: [param('new_productivity_factor', 0.1, 3)], columns: [{ variable: 'developed_software', points: data }] }))
    expect(r.jBefore).toBeLessThan(1e-12)
    const flat = r.diagnostics.find((d) => d.kind === 'flat')
    expect(flat?.params).toEqual(['new_productivity_factor'])
    expect(flat!.message).toContain('정해지지 않는 파라미터')
    expect(r.diagnostics.find((d) => d.kind === 'noimprove')).toBeDefined() // 더 줄일 수 없어 시작 값 유지
    expect(r.best[0]).toBe(0.8)
  })

  it('범위가 좁아 참값(0.13)이 밖에 있으면 경계에 붙었다고 경고한다', () => {
    const r = runCalibration(input({ params: [param('nominal_productivity', 0.01, 0.12)] }))
    expect(r.best[0]).toBeGreaterThan(0.1199)
    const b = r.diagnostics.find((d) => d.kind === 'boundary')
    expect(b?.params).toEqual(['nominal_productivity'])
    expect(b!.message).toContain('위 끝')
    expect(r.jAfter).toBeGreaterThan(1e-5) // 못 맞춘다
  })

  it('경계 도달은 값이 움직였을 때만 알린다(시작 값이 경계인 것은 사용자가 정한 것)', () => {
    const r = runCalibration(input({ base: { ...defaults, nominal_productivity: 0.13 } , params: [param('nominal_productivity', 0.13, 1)] }))
    expect(r.diagnostics.find((d) => d.kind === 'boundary')).toBeUndefined()
  })

  it('관측 점이 파라미터 수 × 3보다 적으면 자료 부족을 경고한다', () => {
    const few = weekly(run({ nominal_productivity: 0.13 }), 'developed_software', 5)
    const r = runCalibration(input({ columns: [{ variable: 'developed_software', points: few }], params: [param('nominal_productivity', 0.01, 1), param('experienced_productivity_factor', 0.1, 5), param('new_productivity_factor', 0.1, 3), param('comm_overhead_coeff', 0.001, 0.2)] }))
    const d = r.diagnostics.find((x) => x.kind === 'scarce')
    expect(d?.severity).toBe('warn')
    expect(d!.message).toContain('5개')
    expect(d!.params).toHaveLength(4)
  })
})

describe('시간 분할 검증', () => {
  it('관측이 15점 이상이면 기본으로 앞 70%로 보정하고 뒤 30%를 검증에 쓴다', () => {
    const r = runCalibration(input())
    expect(r.split).not.toBeNull()
    expect(r.split!.fraction).toBe(0.7)
    expect(r.split!.nCal + r.split!.nVal).toBe(28)
    expect(r.split!.nCal).toBe(Math.ceil(0.7 * 28)) // 20
    expect(r.split!.cutoffTime).toBe(20 * 7)
    expect(r.columns[0]).toMatchObject({ n: 20, nVal: 8 })
    // 잘 맞는 모델이므로 검증 구간 오차도 작고 과적합 경고가 없다
    expect(r.jValAfter!).toBeLessThan(1e-3)
    expect(r.jValAfter!).toBeLessThan(r.jValBefore!)
    expect(r.diagnostics.find((d) => d.kind === 'overfit')).toBeUndefined()
  })

  it('보정 구간에서만 맞고 검증 구간에서 어긋나면 과적합을 경고한다', () => {
    // 실제는 150일에 인력 10명을 더 투입했지만(보정 구간은 137일까지라 그것을 보지 못함) 모델은 그것을 모른다
    const actual = run({ nominal_productivity: 0.13, extra_people: 10, hire_day: 150 })
    const r = runCalibration(input({ columns: [{ variable: 'cum_effort', points: weekly(actual, 'cum_effort') }] }))
    expect(r.jAfter).toBeLessThan(1e-3) // 보정 구간은 잘 맞는다
    expect(r.jValAfter!).toBeGreaterThan(2 * r.jAfter)
    const o = r.diagnostics.find((d) => d.kind === 'overfit')
    expect(o).toBeDefined()
    expect(o!.message).toContain('과적합')
  })

  it('끄거나 점이 적으면 분할하지 않는다', () => {
    expect(runCalibration(input({ split: false })).split).toBeNull()
    expect(runCalibration(input({ split: false })).jValAfter).toBeNull()
    const few = weekly(run({ nominal_productivity: 0.13 }), 'developed_software', 12)
    expect(runCalibration(input({ columns: [{ variable: 'developed_software', points: few }] })).split).toBeNull()
  })

  it('비율을 정할 수 있다', () => {
    const r = runCalibration(input({ split: 0.5 }))
    expect(r.split).toMatchObject({ fraction: 0.5, nCal: 14, nVal: 14 })
  })
})

describe('재현성과 취소', () => {
  it('같은 입력(시드 포함)은 결과가 정확히 같다', () => {
    const a = runCalibration(input({ seed: 11 }))
    const b = runCalibration(input({ seed: 11 }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('시드가 다르면 시작점이 다르지만 잘 정해진 문제의 최선은 같다', () => {
    const a = runCalibration(input({ seed: 1 }))
    const b = runCalibration(input({ seed: 2 }))
    expect(a.starts.map((s) => s.theta0)).not.toEqual(b.starts.map((s) => s.theta0))
    expect(Math.abs((a.best[0] as number) - (b.best[0] as number))).toBeLessThan(0.001)
  })
  it('시작 값(첫 시작점)은 항상 현재 값이다', () => {
    const r = runCalibration(input())
    expect(r.starts[0]!.theta0).toEqual([0.1])
  })
  it('진행을 알리고 취소하면 그때까지 끝난 시작점 중 최선으로 끝난다', () => {
    const seen: number[] = []
    let evals = 0
    const r = runCalibration(input(), { onProgress: (p) => { evals = p.evaluations; seen.push(p.start) }, shouldStop: () => evals >= 60 })
    expect(r.canceled).toBe(true)
    expect(r.starts.length).toBeGreaterThanOrEqual(1)
    expect(r.starts.length).toBeLessThan(5)
    expect(Math.max(...seen)).toBeLessThan(5)
    expect(r.jAfter).toBeLessThanOrEqual(r.jBefore)
    expect(r.diagnostics.some((d) => d.message.includes('취소'))).toBe(true)
  })
  it('시작하기 전에 취소하면 시작 값을 그대로 돌려준다', () => {
    const r = runCalibration(input(), { shouldStop: () => true })
    expect(r.canceled).toBe(true)
    expect(r.best).toEqual(r.initial)
    expect(r.starts).toEqual([])
  })
  it('생성기로 한 평가씩 진행하고 평가 횟수가 늘어난다', () => {
    const gen = calibrationSteps(input({ starts: 1 }))
    const first = gen.next()
    expect(first.done).toBe(false)
    const evals: number[] = []
    for (let s = gen.next(); !s.done; s = gen.next()) evals.push(s.value.evaluations)
    expect(evals[evals.length - 1]).toBeGreaterThan(evals[0]!)
    expect(evals).toEqual([...evals].sort((a, b) => a - b))
  })
  it('평가 횟수는 시작점마다 파라미터 수 × 200을 넘지 않는다', () => {
    const r = runCalibration(input({ evalsPerParam: 20 }))
    for (const s of r.starts) expect(s.evaluations).toBeLessThanOrEqual(20 + 3) // 한 반복이 끝나기 전의 여유
  })
})

describe('가중치와 제외', () => {
  it('관측 평균이 0인 열과 범위 밖의 열은 쓰지 않고 이유를 알린다', () => {
    const actual = run({ nominal_productivity: 0.13 })
    const r = runCalibration(
      input({
        columns: [
          { variable: 'developed_software', points: weekly(actual, 'developed_software') },
          { variable: 'new_personnel', points: weekly(actual, 'new_personnel'), label: '신입 인원' }, // 모두 0
          { variable: 'cum_effort', points: [[999, 1]], label: '범위 밖' }
        ]
      })
    )
    expect(r.columns.map((c) => c.variable)).toEqual(['developed_software'])
    const ex = r.diagnostics.filter((d) => d.kind === 'excluded').map((d) => d.message)
    expect(ex).toHaveLength(2)
    expect(ex.join()).toContain('신입 인원: 관측의 평균 크기가 0')
    expect(ex.join()).toContain('범위 밖: 보정에 쓸 관측 점이 없습니다')
  })
})

describe('입력 검사', () => {
  const bad = (over: Partial<CalibInput>, message: RegExp) => expect(() => runCalibration(input(over))).toThrow(message)
  it('올바르지 않은 입력은 CalibrationError', () => {
    expect(() => runCalibration(input({ params: [] }))).toThrow(CalibrationError)
    bad({ params: [] }, /하나 이상/)
    bad({ params: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => param(n, 0, 1)) }, /최대 5개/)
    bad({ params: [param('nominal_productivity', 1, 1)] }, /최솟값 < 최댓값/)
    bad({ params: [param('nominal_productivity', 0, Infinity)] }, /유한한 수/)
    bad({ params: [param('nope', 0, 1)] }, /상수가 아닙니다/)
    bad({ params: [param('nominal_productivity', 0, 1), param('nominal_productivity', 0, 2)] }, /두 번/)
    bad({ columns: [] }, /열을 하나 이상/)
    bad({ columns: [{ variable: 'developed_software', points: [[999, 1]] }] }, /보정에 쓸 관측이 없습니다/)
    bad({ columns: [{ variable: 'developed_software', points: weekly(run(), 'developed_software'), weight: 0 }] }, /가중치의 합/)
  })
  it('모델에 없는 변수는 정렬 오류로 알린다', () => {
    expect(() => runCalibration(input({ columns: [{ variable: 'nope', points: [[1, 1]] }] }))).toThrow(/없습니다/)
  })
})

describe('결과의 일관성', () => {
  it('보정한 값으로 실행하면 보고한 NRMSE가 다시 계산한 값과 같다', () => {
    const r = runCalibration(input({ split: false }))
    const sim = run({ nominal_productivity: r.best[0] as number })
    const obs = weekly(run({ nominal_productivity: 0.13 }), 'developed_software')
    const mse = obs.reduce((s, [w, o]) => s + (valueAt(sim, 'developed_software', w * 7) - o) ** 2, 0) / obs.length
    const nrmse = Math.sqrt(mse) / (obs.reduce((s, [, o]) => s + Math.abs(o), 0) / obs.length)
    expect(r.columns[0]!.nrmseAfter).toBeCloseTo(nrmse, 10)
    expect(r.jAfter).toBeCloseTo(nrmse * nrmse, 10) // 열이 하나면 J = NRMSE²
  })
  it('목적함수는 절대 늘지 않는다(보정 전 ≥ 보정 후)', () => {
    for (const p of [param('nominal_productivity', 0.01, 1), param('comm_overhead_coeff', 0.001, 0.2)]) {
      const r = runCalibration(input({ params: [p] }))
      expect(r.jAfter).toBeLessThanOrEqual(r.jBefore + 1e-15)
    }
  })
})
