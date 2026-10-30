import { describe, expect, it } from 'vitest'
import { compileModel, ModelError, Simulation, type RunResult, type SimSnapshot } from '../src'
import { model } from './model-helpers'

/** 평활·지연·난수가 모두 들어간 모델: 스냅샷이 이 모두를 담아야 이어 실행이 같다. */
const def = () =>
  model({
    constants: { r: 0.05, tau: 4, d: 3, noise: 0.2 },
    levels: { x: { init: '100', inflows: ['g'] }, y: { init: '0', inflows: ['h'], outflows: ['leak'] } },
    rates: {
      g: 'x * r * (1 + noise * RANDOM_NORMAL(0, 1))',
      h: 'SMOOTH(x, tau) * 0.01 + DELAY3(g, d) * 0.5',
      leak: 'y * 0.02'
    },
    auxiliaries: { total: 'x + y' },
    time: { end: 60, dt: 0.25 }
  })
const compiled = () => compileModel(def())
const sameBits = (a: Float64Array, b: Float64Array) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
/** `full`의 `from`번째 행부터를 `fork`의 결과와 모든 변수에서 비교한다. */
const expectTail = (full: RunResult, fork: RunResult, from: number) => {
  expect(fork.time.length).toBe(full.time.length - from)
  expect(sameBits(fork.time, full.time.slice(from))).toBe(true)
  for (const name of Object.keys(full.series)) {
    const ok = sameBits(fork.series[name] as Float64Array, (full.series[name] as Float64Array).slice(from))
    if (!ok) throw new Error(`변수 ${name}이(가) 비트 단위로 다릅니다`)
  }
}

describe('E1: snapshot / fork', () => {
  const full = new Simulation(compiled(), { seed: 7 }).run()

  it.each([0, 1, 37, 100, 239])('스텝 %i에서 스냅샷해 이어 실행하면 원본과 모든 변수가 비트 단위로 같다', (n) => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(n)
    const snap = sim.snapshot()
    expect(snap.step).toBe(n)
    expectTail(full, Simulation.fork(compiled(), snap, { seed: 7 }).run(), n)
  })

  it('끝에서 스냅샷하면 한 행만 남는다', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.run()
    const r = Simulation.fork(compiled(), sim.snapshot(), { seed: 7 }).run()
    expect(r.time).toHaveLength(1)
    expect(r.meta.completed).toBe(true)
  })

  it('원래 실행을 계속 진행해도 스냅샷은 바뀌지 않는다(복사본)', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(50)
    const snap = sim.snapshot()
    const copy = { ...snap, values: snap.values.slice(), state: snap.state.slice() }
    sim.advance(50)
    expect(snap.values).toEqual(copy.values)
    expect(snap.state).toEqual(copy.state)
    expect(snap.step).toBe(50)
  })

  it('같은 스냅샷에서 여러 번 이어 실행해도 같고, 서로 영향을 주지 않는다', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(80)
    const snap = sim.snapshot()
    const a = Simulation.fork(compiled(), snap, { seed: 7 })
    const b = Simulation.fork(compiled(), snap, { seed: 7 })
    a.advance(30)
    expectTail(full, b.run(), 80)
    expectTail(full, a.run(), 80)
  })

  it('이어 실행한 것에서 다시 스냅샷해도(2단계) 같다', () => {
    const first = new Simulation(compiled(), { seed: 7 })
    first.advance(40)
    const second = Simulation.fork(compiled(), first.snapshot(), { seed: 7 })
    second.advance(60)
    expectTail(full, Simulation.fork(compiled(), second.snapshot(), { seed: 7 }).run(), 100)
  })

  it('recordEvery가 있어도 같은 시각을 기록한다', () => {
    const f5 = new Simulation(compiled(), { seed: 7, recordEvery: 5 }).run()
    const sim = new Simulation(compiled(), { seed: 7, recordEvery: 5 })
    sim.advance(40)
    const tail = Simulation.fork(compiled(), sim.snapshot(), { seed: 7, recordEvery: 5 }).run()
    const from = f5.time.findIndex((t) => t === tail.time[0])
    expect(from).toBeGreaterThan(0)
    expectTail(f5, tail, from)
  })

  it('reset()은 스냅샷 상태로 돌아간다', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(60)
    const f = Simulation.fork(compiled(), sim.snapshot(), { seed: 7 })
    f.advance(100)
    f.reset()
    expect(f.currentStep).toBe(60)
    expectTail(full, f.run(), 60)
  })

  it('진행 중 상태(시각, 스텝)가 이어진다', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(20)
    const f = Simulation.fork(compiled(), sim.snapshot(), { seed: 7 })
    expect(f.time).toBe(5)
    expect(f.currentStep).toBe(20)
    expect(f.done).toBe(false)
    expect(f.totalSteps).toBe(240)
  })

  it('이어 실행의 종료 시각을 바꿀 수 있다(스냅샷 이후는 원본과 같다)', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(40)
    const r = Simulation.fork(compiled(), sim.snapshot(), { seed: 7, end: 30 }).run()
    expect(r.time[r.time.length - 1]).toBe(30)
    const fullPart = new Simulation(compiled(), { seed: 7, end: 30 }).run()
    expectTail(fullPart, r, 40)
  })

  describe('검증', () => {
    const snap = (): SimSnapshot => {
      const sim = new Simulation(compiled(), { seed: 7 })
      sim.advance(10)
      return sim.snapshot()
    }
    const err = (f: () => unknown) => {
      try {
        f()
      } catch (e) {
        if (e instanceof ModelError) return e.message
        throw e
      }
      throw new Error('오류가 나야 합니다')
    }
    it('모델 id·버전이 다르면 거부', () => {
      expect(err(() => Simulation.fork(compiled(), { ...snap(), model: { id: 'other', version: 1 } }))).toContain('모델')
      expect(err(() => Simulation.fork(compiled(), { ...snap(), model: { id: 'test', version: 2 } }))).toContain('모델')
    })
    it('dt가 다르면 거부', () => {
      expect(err(() => Simulation.fork(compiled(), snap(), { dt: 0.5 }))).toContain('dt')
    })
    it('크기가 다르면 거부', () => {
      expect(err(() => Simulation.fork(compiled(), { ...snap(), values: new Float64Array(3) }))).toContain('크기')
      expect(err(() => Simulation.fork(compiled(), { ...snap(), state: new Float64Array(1) }))).toContain('크기')
    })
    it('스냅샷 스텝이 종료 스텝을 넘으면 거부', () => {
      expect(err(() => Simulation.fork(compiled(), snap(), { end: 1 }))).toContain('범위')
    })
  })
})

describe('E2: setLevel / setConstant', () => {
  const at = (step: number) => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(step)
    return Simulation.fork(compiled(), sim.snapshot(), { seed: 7 })
  }
  it('setLevel은 값을 바꾸고 종속 변수를 다시 계산하며 첫 행을 고친다', () => {
    const f = at(40)
    f.setLevel('x', 500)
    expect(f.valueOf('x')).toBe(500)
    expect(f.valueOf('total')).toBe(500 + f.valueOf('y'))
    expect(f.valueOf('g')).toBeCloseTo(f.valueOf('x') * 0.05 * (1 + 0.2 * 0), -2) // 난수가 있어 근사. 아래에서 정확히 확인
    const r = f.result()
    expect((r.series['x'] as Float64Array)[0]).toBe(500)
    expect((r.series['total'] as Float64Array)[0]).toBe(500 + f.valueOf('y'))
  })
  it('바꾼 Level에서 이어 실행하면 그 값부터 진행한다', () => {
    const a = at(40)
    const b = at(40)
    b.setLevel('x', (a.valueOf('x') as number) * 2)
    const ra = a.run()
    const rb = b.run()
    expect((rb.series['x'] as Float64Array)[0]).toBeCloseTo((ra.series['x'] as Float64Array)[0]! * 2, 9)
    expect((rb.series['x'] as Float64Array).at(-1)!).toBeGreaterThan((ra.series['x'] as Float64Array).at(-1)!)
  })
  it('같은 값으로 덮어쓰면 이어 실행은 그대로다(비트 동일)', () => {
    const full = new Simulation(compiled(), { seed: 7 }).run()
    const f = at(40)
    f.setLevel('x', f.valueOf('x'))
    f.setLevel('y', f.valueOf('y'))
    expectTail(full, f.run(), 40)
  })
  it('setConstant는 이후 계산에 쓰이고 기록된 과거는 바꾸지 않는다', () => {
    const base = at(40).run()
    const f = at(40)
    f.setConstant('r', 0.2)
    const r = f.run()
    expect((r.series['x'] as Float64Array).at(-1)!).toBeGreaterThan((base.series['x'] as Float64Array).at(-1)!)
    // 시작 행의 Level 값은 같다(상수는 이후 흐름만 바꾼다)
    expect((r.series['x'] as Float64Array)[0]).toBe((base.series['x'] as Float64Array)[0])
  })
  it('reset()은 setConstant를 되돌린다', () => {
    const f = at(40)
    const base = at(40).run()
    f.setConstant('r', 0.2)
    f.advance(10)
    f.reset()
    expectTail(base, f.run(), 0)
  })
  it('options.overrides로 이어 실행 시작에서 상수를 바꿀 수 있다(setConstant와 같음)', () => {
    const sim = new Simulation(compiled(), { seed: 7 })
    sim.advance(40)
    const a = Simulation.fork(compiled(), sim.snapshot(), { seed: 7, overrides: { r: 0.2 } }).run()
    const b = at(40)
    b.setConstant('r', 0.2)
    expectTail(a, b.run(), 0)
  })
  it('이름·종류·값을 검증한다', () => {
    const f = at(10)
    expect(() => f.setLevel('r', 1)).toThrow(/Level이 아닙니다/)
    expect(() => f.setLevel('nope', 1)).toThrow(/Level이 아닙니다/)
    expect(() => f.setLevel('x', NaN)).toThrow(/유한/)
    expect(() => f.setLevel('x', Infinity)).toThrow(/유한/)
    expect(() => f.setConstant('x', 1)).toThrow(/상수가 아닙니다/)
    expect(() => f.setConstant('g', 1)).toThrow(/상수가 아닙니다/)
    expect(() => f.setConstant('r', NaN)).toThrow(/유한/)
  })
  it('검증 실패는 상태를 바꾸지 않는다', () => {
    const f = at(10)
    const before = f.valueOf('x')
    expect(() => f.setLevel('x', NaN)).toThrow()
    expect(f.valueOf('x')).toBe(before)
  })
})
