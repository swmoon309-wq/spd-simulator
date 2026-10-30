import { describe, expect, it } from 'vitest'
import { compileModel, ModelError, runModel, SimulationError, Simulation, type Progress } from '../src'
import { model } from './model-helpers'

const growth = (extra: Parameters<typeof model>[0] = {}) =>
  model({
    constants: { r: 0.05 },
    levels: { x: { init: '100', inflows: ['g'] } },
    rates: { g: 'x * r' },
    ...extra
  })

describe('Level 적분 (Euler)', () => {
  it('지수 성장이 Euler 폐형식 x0(1+r·dt)^n 과 일치한다', () => {
    const r = runModel(growth({ time: { end: 40, dt: 0.25 } }))
    const x = r.series['x'] as Float64Array
    expect(x).toHaveLength(161)
    for (const n of [0, 1, 10, 80, 160]) {
      expect(x[n]).toBeCloseTo(100 * Math.pow(1 + 0.05 * 0.25, n), 9)
    }
    // 해석해와는 dt에 비례하는 오차
    expect(Math.abs((x[160] as number) - 100 * Math.exp(2)) / (100 * Math.exp(2))).toBeLessThan(0.02)
  })

  it('목표 추구: dx/dt = (goal − x)/τ', () => {
    const r = runModel(
      model({
        constants: { goal: 50, tau: 5 },
        levels: { x: { init: '0', inflows: ['adj'] } },
        rates: { adj: '(goal - x) / tau' },
        time: { end: 30, dt: 0.1 }
      })
    )
    const x = r.series['x'] as Float64Array
    const exact = 50 * (1 - Math.exp(-6))
    expect(Math.abs((x[x.length - 1] as number) - exact)).toBeLessThan(0.2)
    for (let i = 1; i < x.length; i++) expect(x[i]).toBeGreaterThanOrEqual(x[i - 1] as number)
  })

  it('유입·유출이 있는 체인은 총량을 보존한다', () => {
    const r = runModel(
      model({
        levels: { a: { init: '100', outflows: ['f'] }, b: { init: '0', inflows: ['f'] } },
        rates: { f: 'a / 10' },
        time: { end: 50, dt: 0.25 }
      })
    )
    const a = r.series['a'] as Float64Array
    const b = r.series['b'] as Float64Array
    for (let i = 0; i < a.length; i++) expect((a[i] as number) + (b[i] as number)).toBeCloseTo(100, 9)
  })

  it('Auxiliary도 유입으로 쓸 수 있다', () => {
    const r = runModel(model({ levels: { x: { init: '0', inflows: ['one'] } }, auxiliaries: { one: '1' }, time: { end: 4, dt: 1 } }))
    expect(Array.from(r.series['x'] as Float64Array)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('평가 순서', () => {
  it('뒤에 선언된 Auxiliary를 앞에서 참조해도 올바르다', () => {
    const r = runModel(
      model({
        constants: { k: 2 },
        auxiliaries: { c: 'b + 1', b: 'a * k', a: 'TIME' },
        time: { end: 3, dt: 1 }
      })
    )
    expect(Array.from(r.series['c'] as Float64Array)).toEqual([1, 3, 5, 7])
  })

  it('Rate가 Auxiliary에, Auxiliary가 Rate에 의존해도 된다', () => {
    const r = runModel(
      model({
        levels: { x: { init: '1', inflows: ['g'] } },
        rates: { g: 'rate_factor * x' },
        auxiliaries: { rate_factor: 'level_term / 10', level_term: 'x + 1' },
        time: { end: 2, dt: 1 }
      })
    )
    expect(r.series['g']?.[0]).toBeCloseTo(0.2, 12)
  })
})

describe('순환 참조', () => {
  it('대수 루프는 경로와 함께 거부한다', () => {
    try {
      compileModel(model({ auxiliaries: { a: 'b + 1', b: 'a * 2' } }))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ModelError)
      const me = e as ModelError
      expect(me.kind).toBe('cycle')
      expect(new Set(me.cycle)).toEqual(new Set(['a', 'b']))
      expect(me.message).toContain('→')
    }
  })

  it('자기 참조 Auxiliary도 거부한다', () => {
    expect(() => compileModel(model({ auxiliaries: { a: 'a + 1' } }))).toThrow(/순환/)
  })

  it('Level을 거치는 피드백은 순환이 아니다', () => {
    expect(() => compileModel(growth())).not.toThrow()
  })

  it('SMOOTH를 거치는 피드백은 순환이 아니고 수렴한다', () => {
    // s' = (y − s)/5, y = 10 − s  →  s = 5
    const r = runModel(model({ auxiliaries: { s: 'SMOOTH(y, 5)', y: '10 - s' }, time: { end: 80, dt: 0.1 } }))
    const s = r.series['s'] as Float64Array
    expect(s[s.length - 1]).toBeCloseTo(5, 3)
  })
})

describe('초기화', () => {
  it('Level 초기값은 상수·다른 Level·Auxiliary를 참조할 수 있다', () => {
    const sim = new Simulation(
      compileModel(
        model({
          constants: { k: 3 },
          levels: { a: { init: 'est * 2' }, b: { init: 'a + 1' } },
          auxiliaries: { est: 'k * 5' }
        })
      )
    )
    expect(sim.valueOf('a')).toBe(30)
    expect(sim.valueOf('b')).toBe(31)
  })

  it('선언 순서와 무관하게 초기값 의존을 푼다', () => {
    const sim = new Simulation(compileModel(model({ levels: { b: { init: 'a * 2' }, a: { init: '4' } } })))
    expect(sim.valueOf('b')).toBe(8)
  })

  it('초기값이 자기 자신의 값에 의존하면 거부한다', () => {
    try {
      compileModel(model({ levels: { x: { init: 'bad' } }, auxiliaries: { bad: 'x + 1' } }))
      expect.unreachable()
    } catch (e) {
      expect((e as ModelError).kind).toBe('init-cycle')
    }
  })

  it('초기값에는 SMOOTH·DELAY를 쓸 수 없다', () => {
    expect(() => compileModel(model({ levels: { x: { init: 'SMOOTH(1, 5)' } } }))).toThrow(ModelError)
  })

  it('SMOOTH는 상수 입력에서 처음부터 정상 상태다', () => {
    const r = runModel(model({ constants: { c: 5 }, auxiliaries: { s: 'SMOOTH(c, 10)', d: 'DELAY3(c, 20)' }, time: { end: 10, dt: 0.5 } }))
    expect((r.series['s'] as Float64Array).every((v) => v === 5)).toBe(true)
    expect((r.series['d'] as Float64Array).every((v) => v === 5)).toBe(true)
  })

  it('체인으로 연결된 SMOOTH도 초기 입력이 끝까지 전파된다', () => {
    const r = runModel(model({ constants: { c: 8 }, auxiliaries: { s2: 'SMOOTH(s1, 5)', s1: 'SMOOTH(c * 1, 5)' }, time: { end: 3, dt: 1 } }))
    expect((r.series['s2'] as Float64Array).every((v) => v === 8)).toBe(true)
  })

  it('모델 안의 SMOOTH 계단 응답이 해석해와 맞는다', () => {
    const r = runModel(model({ auxiliaries: { u: 'STEP(1, 5)', s: 'SMOOTH(u, 10)' }, time: { end: 60, dt: 0.01 } }))
    const s = r.series['s'] as Float64Array
    for (let i = 0; i < r.time.length; i += 50) {
      const t = r.time[i] as number
      const exact = t < 5 ? 0 : 1 - Math.exp(-(t - 5) / 10)
      expect(Math.abs((s[i] as number) - exact)).toBeLessThan(0.01)
    }
  })

  it('지연·평활 상태는 같은 스텝의 값으로 갱신된다(Level 변경 전)', () => {
    // x_n = n (dt=1). 올바른 갱신은 s_{n+1} = s_n + (x_n − s_n)·dt/τ 로, 같은 스텝의 x_n을 쓴다.
    // Level을 먼저 바꾸고 상태를 갱신하면 x_{n+1}을 읽어 이 점화식과 어긋난다.
    const tau = 4
    const r = runModel(model({ levels: { x: { init: '0', inflows: ['one'] } }, auxiliaries: { one: '1', s: `SMOOTH(x, ${tau})` }, time: { end: 12, dt: 1 } }))
    const s = r.series['s'] as Float64Array
    let expected = 0
    for (let n = 0; n <= 12; n++) {
      expect(s[n]).toBeCloseTo(expected, 12)
      expected += (n - expected) / tau
    }
  })
})

describe('덮어쓰기와 옵션', () => {
  it('상수를 덮어쓰고 컴파일된 모델은 재사용된다', () => {
    const compiled = compileModel(growth({ time: { end: 10, dt: 1 } }))
    const base = runModel(compiled)
    const fast = runModel(compiled, { overrides: { r: 0.1 } })
    const again = runModel(compiled)
    expect((fast.series['x'] as Float64Array)[10]).toBeCloseTo(100 * Math.pow(1.1, 10), 9)
    expect(Array.from(again.series['x'] as Float64Array)).toEqual(Array.from(base.series['x'] as Float64Array))
  })

  it('정의되지 않았거나 상수가 아닌 이름은 덮어쓸 수 없다', () => {
    expect(() => runModel(growth(), { overrides: { nope: 1 } })).toThrow(ModelError)
    expect(() => runModel(growth(), { overrides: { x: 1 } })).toThrow(/상수가 아닙니다/)
    expect(() => runModel(growth(), { overrides: { r: NaN } })).toThrow(ModelError)
  })

  it('dt와 end를 덮어쓴다', () => {
    const r = runModel(growth(), { dt: 0.5, end: 4 })
    expect(Array.from(r.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
    expect(r.meta.dt).toBe(0.5)
  })

  it('잘못된 dt·end는 거부한다', () => {
    expect(() => runModel(growth(), { dt: 0 })).toThrow(ModelError)
    expect(() => runModel(growth(), { dt: -1 })).toThrow(ModelError)
    expect(() => runModel(growth(), { end: 0 })).toThrow(ModelError)
  })

  it('recordEvery로 간격을 두되 마지막 스텝은 항상 기록한다', () => {
    const r = runModel(growth({ time: { end: 10, dt: 1 } }), { recordEvery: 4 })
    expect(Array.from(r.time)).toEqual([0, 4, 8, 10])
    expect(r.series['x']).toHaveLength(4)
  })

  it('record로 기록할 변수를 제한한다', () => {
    const r = runModel(growth(), { record: ['x'] })
    expect(Object.keys(r.series)).toEqual(['x'])
    expect(() => runModel(growth(), { record: ['nope'] })).toThrow(ModelError)
  })

  it('기본 기록은 상수를 제외한 모든 변수', () => {
    expect(Object.keys(runModel(growth()).series).sort()).toEqual(['g', 'x'])
  })

  it('결과 메타', () => {
    const r = runModel(growth(), { seed: 9 })
    expect(r.meta).toEqual({ model: 'test', version: 1, dt: 0.25, seed: 9, completed: true })
  })
})

describe('재현성', () => {
  const noisy = model({ levels: { x: { init: '0', inflows: ['n'] } }, rates: { n: 'RANDOM_NORMAL(1, 0.5)' }, time: { end: 50, dt: 1 } })

  it('같은 시드는 같은 결과, 다른 시드는 다른 결과', () => {
    const a = runModel(noisy, { seed: 5 }).series['x'] as Float64Array
    const b = runModel(noisy, { seed: 5 }).series['x'] as Float64Array
    const c = runModel(noisy, { seed: 6 }).series['x'] as Float64Array
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(Array.from(a)).not.toEqual(Array.from(c))
  })

  it('reset()은 난수열도 처음부터 다시 시작한다', () => {
    const sim = new Simulation(compileModel(noisy), { seed: 3 })
    sim.run()
    const first = Array.from(sim.result().series['x'] as Float64Array)
    sim.reset()
    sim.run()
    expect(Array.from(sim.result().series['x'] as Float64Array)).toEqual(first)
  })
})

describe('단계 실행', () => {
  it('advance를 나눠 호출해도 한 번에 실행한 것과 같다', () => {
    const whole = runModel(growth({ time: { end: 20, dt: 0.5 } }))
    const sim = new Simulation(compileModel(growth({ time: { end: 20, dt: 0.5 } })))
    expect(sim.advance(7)).toBe(false)
    expect(sim.currentStep).toBe(7)
    expect(sim.time).toBeCloseTo(3.5, 12)
    expect(sim.advance(1000)).toBe(true)
    expect(sim.done).toBe(true)
    expect(Array.from(sim.result().series['x'] as Float64Array)).toEqual(Array.from(whole.series['x'] as Float64Array))
  })

  it('끝에 도달한 뒤 advance는 아무것도 하지 않는다', () => {
    const sim = new Simulation(compileModel(growth({ time: { end: 2, dt: 1 } })))
    sim.advance()
    const n = sim.result().time.length
    sim.advance(5)
    expect(sim.result().time).toHaveLength(n)
  })

  it('중간 결과는 그때까지 기록한 만큼이고 completed=false', () => {
    const sim = new Simulation(compileModel(growth({ time: { end: 10, dt: 1 } })))
    sim.advance(3)
    const r = sim.result()
    expect(Array.from(r.time)).toEqual([0, 1, 2, 3])
    expect(r.meta.completed).toBe(false)
  })

  it('reset()은 처음 상태로 되돌린다', () => {
    const sim = new Simulation(compileModel(growth({ time: { end: 10, dt: 1 } })))
    sim.advance(5)
    sim.reset()
    expect(sim.currentStep).toBe(0)
    expect(sim.valueOf('x')).toBe(100)
    expect(sim.result().time).toHaveLength(1)
  })
})

describe('진행 알림 (reportProgress)', () => {
  it('진행 간격과 상관없이 지금 상태를 알린다', () => {
    const sim = new Simulation(compileModel(growth({ time: { end: 10, dt: 1 } })), { progressEvery: 100 })
    const seen: Progress[] = []
    sim.advance(3, { onProgress: (p) => seen.push(p) })
    seen.length = 0 // advance는 시작 상태(시각 0)만 알린다
    sim.reportProgress({ onProgress: (p) => seen.push(p) })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.step).toBe(3)
    expect(seen[0]?.time).toBeCloseTo(3, 12)
    expect(seen[0]?.fraction).toBeCloseTo(0.3, 12)
  })
})

describe('진행 콜백과 중단', () => {
  const m = model({ levels: { x: { init: '0', inflows: ['one'] } }, rates: { one: '1' }, time: { end: 100, dt: 1 }, outputs: ['x'] })

  it('progressEvery 간격과 마지막 스텝에서 호출한다', () => {
    const calls: Progress[] = []
    runModel(m, { progressEvery: 10 }, { onProgress: (p) => calls.push(p) })
    expect(calls.map((c) => c.step)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
    expect(calls[0]?.fraction).toBe(0)
    expect(calls[calls.length - 1]?.fraction).toBe(1)
    expect(calls[5]?.values).toEqual({ x: 50 })
    expect(calls[5]?.time).toBe(50)
  })

  it('나누어 떨어지지 않아도 마지막에 한 번 호출한다', () => {
    const calls: number[] = []
    runModel(m, { progressEvery: 30 }, { onProgress: (p) => calls.push(p.step) })
    expect(calls).toEqual([0, 30, 60, 90, 100])
  })

  it('shouldStop이 true면 그때까지의 결과로 멈춘다', () => {
    let checks = 0
    const r = runModel(m, { progressEvery: 10 }, { shouldStop: () => ++checks >= 3 })
    expect(r.meta.completed).toBe(false)
    expect(r.time[r.time.length - 1]).toBe(30)
  })

  it('끝까지 가면 shouldStop과 무관하게 completed', () => {
    const r = runModel(m, { progressEvery: 50 }, { shouldStop: () => false })
    expect(r.meta.completed).toBe(true)
  })
})

describe('수치 오류 감지', () => {
  it('0으로 나누면 변수 이름과 시각을 알려준다', () => {
    try {
      runModel(model({ levels: { x: { init: '2', outflows: ['d'] } }, rates: { d: '1 / (x - 1)' }, time: { end: 20, dt: 1 } }))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(SimulationError)
      expect((e as SimulationError).variable).toBe('d')
      expect(Number.isFinite((e as SimulationError).time)).toBe(true)
    }
  })

  it('초기 상태의 NaN도 감지한다', () => {
    expect(() => new Simulation(compileModel(model({ auxiliaries: { a: 'SQRT(-1)' } })))).toThrow(SimulationError)
  })
})

describe('모델 검증', () => {
  it('변수 이름이 여러 종류에 중복되면 거부한다', () => {
    expect(() => compileModel(model({ constants: { a: 1 }, auxiliaries: { a: '1' } }))).toThrow(/중복/)
  })

  it.each(['TIME', 'dt', 'and', '1abc', 'a-b', 'a b'])('이름 "%s"은 거부한다', (name) => {
    expect(() => compileModel(model({ constants: { [name]: 1 } }))).toThrow(ModelError)
  })

  it('정의되지 않은 유입은 거부한다', () => {
    expect(() => compileModel(model({ levels: { x: { init: '0', inflows: ['nope'] } } }))).toThrow(/정의되어 있지 않습니다/)
  })

  it('상수나 Level을 유입으로 쓸 수 없다', () => {
    expect(() => compileModel(model({ constants: { k: 1 }, levels: { x: { init: '0', inflows: ['k'] } } }))).toThrow(/constant/)
    expect(() => compileModel(model({ levels: { x: { init: '0', inflows: ['y'] }, y: { init: '0' } } }))).toThrow(/level/)
  })

  it('수식 오류는 변수 이름과 함께 알려준다', () => {
    try {
      compileModel(model({ auxiliaries: { a: '1 + * 2' } }))
      expect.unreachable()
    } catch (e) {
      expect((e as ModelError).kind).toBe('expression')
      expect((e as ModelError).variable).toBe('a')
    }
    expect(() => compileModel(model({ auxiliaries: { a: 'missing_var + 1' } }))).toThrow(/missing_var/)
  })

  it('outputs에 없는 변수는 거부한다', () => {
    expect(() => compileModel(model({ outputs: ['nope'] }))).toThrow(ModelError)
  })

  it('이름 있는 테이블을 GRAPH에서 쓴다', () => {
    const r = runModel(
      model({
        auxiliaries: { y: 'GRAPH(TIME, curve)' },
        tables: { curve: { x: [0, 10], y: [0, 100] } },
        time: { end: 10, dt: 5 }
      })
    )
    expect(Array.from(r.series['y'] as Float64Array)).toEqual([0, 50, 100])
  })
})
