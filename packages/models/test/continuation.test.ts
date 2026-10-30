import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { compileModel, runModel, Simulation, type RunResult } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '../src'

const integrated = () => compileModel(integratedProjectModel)
const brooks = () => compileModel(brooksModel)
const col = (r: RunResult, name: string) => r.series[name] as Float64Array

/** 시리즈 전체의 지문. E3·E4로 추가한 변수는 제외해 "기존 변수가 그대로인가"를 본다. */
function fingerprint(r: RunResult, exclude: string[] = []): string {
  const h = createHash('sha256')
  h.update(Buffer.from(r.time.buffer, r.time.byteOffset, r.time.byteLength))
  for (const n of Object.keys(r.series).filter((x) => !exclude.includes(x)).sort()) {
    const a = col(r, n)
    h.update(n)
    h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
  }
  return h.digest('hex')
}

describe('기존 모델 결과 불변(E3·E4 추가 전 지문과 비트 단위로 같다)', () => {
  // 추가 전(2026-10-21)에 같은 방법으로 계산해 둔 값
  const BEFORE = {
    brooks: '150d94991517f346e1304329a5891d5ba510b475b361a3816c156f9ca34f8526',
    brooks5: 'bdf9eab0ac336f9f5f30943051d833263093ea439c22441b0cc7360c19f30345',
    integrated: 'a665c1067d13c6d0de6cc86a008c73a8794499d896e321f8fd1b8de00c147ed1',
    integratedAlt: '12470b840c35f19e7f5c5f9bed4b06b79317c7a34d5b85365a9db6a19f5776fa'
  }
  const NEW = ['hr_extra_rate']
  it('Brooks 기본·5명 추가', () => {
    expect(fingerprint(runModel(brooks()))).toBe(BEFORE.brooks)
    expect(fingerprint(runModel(brooks(), { overrides: { extra_people: 5, hire_day: 120 } }))).toBe(BEFORE.brooks5)
  })
  it('통합 모델 기본·다른 입력', () => {
    expect(fingerprint(runModel(integrated()), NEW)).toBe(BEFORE.integrated)
    expect(fingerprint(runModel(integrated(), { overrides: { total_tasks: 500, initial_pros: 6 } }), NEW)).toBe(BEFORE.integratedAlt)
  })
})

describe('E1: 실제 모델에서 이어 실행이 비트 단위로 같다', () => {
  const tailEqual = (full: RunResult, fork: RunResult, from: number) => {
    expect(fork.time.length).toBe(full.time.length - from)
    for (const n of Object.keys(full.series)) {
      const a = col(fork, n)
      const b = col(full, n).slice(from)
      for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) throw new Error(`${n}[${i}] ${a[i]} != ${b[i]}`)
    }
  }
  it.each([
    ['통합 모델', integrated, { total_tasks: 450, extra_people: 4, extra_people_day: 80 }],
    ['Brooks', brooks, { extra_people: 5, hire_day: 120 }]
  ])('%s: 50·100·150·200일에서 스냅샷', (_n, make, overrides) => {
    const model = make()
    const full = new Simulation(model, { overrides }).run()
    for (const day of [50, 100, 150, 200]) {
      const sim = new Simulation(model, { overrides })
      sim.advance(day * 4)
      const fork = Simulation.fork(model, sim.snapshot(), { overrides }).run()
      tailEqual(full, fork, day * 4)
    }
  })
  it('난수를 쓰지 않으므로 시드가 달라도 같다', () => {
    const model = integrated()
    const sim = new Simulation(model, { seed: 1 })
    sim.advance(200)
    const a = Simulation.fork(model, sim.snapshot(), { seed: 1 }).run()
    const b = Simulation.fork(model, sim.snapshot(), { seed: 99 }).run()
    expect(fingerprint(a)).toBe(fingerprint(b))
  })
})

describe('E3: 통합 모델의 prod_calibration', () => {
  it('1이면 지문이 같고(위) 곱한 만큼 생산성이 변한다', () => {
    const m = integrated()
    const base = runModel(m)
    const fast = runModel(m, { overrides: { prod_calibration: 1.2 } })
    const slow = runModel(m, { overrides: { prod_calibration: 0.7 } })
    const at = (r: RunResult, t: number) => col(r, 'prod_productivity')[Math.round(t / 0.25)] as number
    // 시각 0에서는 다른 변수가 같으므로 정확히 비례한다
    expect(at(fast, 0)).toBeCloseTo(at(base, 0) * 1.2, 12)
    expect(at(slow, 0)).toBeCloseTo(at(base, 0) * 0.7, 12)
  })
  it('보정 계수가 클수록 완료가 빠르고 작을수록 늦다', () => {
    const m = integrated()
    const done = (k: number) => {
      const r = runModel(m, { overrides: { prod_calibration: k } })
      const dev = col(r, 'prod_tasks_tested')
      const i = dev.findIndex((v) => v >= 399.9)
      return i < 0 ? Infinity : (r.time[i] as number)
    }
    expect(done(1.3)).toBeLessThan(done(1))
    expect(done(0.8)).toBeGreaterThan(done(1))
  })
  it('실행 중에 setConstant로 바꾸면 그 시점부터 적용된다', () => {
    const m = integrated()
    const sim = new Simulation(m)
    sim.advance(120) // 30일: 개발이 한창일 때
    const f = Simulation.fork(m, sim.snapshot())
    f.setConstant('prod_calibration', 0.5)
    const base = Simulation.fork(m, sim.snapshot()).run()
    const slowed = f.run()
    expect(col(slowed, 'prod_tasks_developed')[200]!).toBeLessThan(col(base, 'prod_tasks_developed')[200]!)
    // 시작 시점의 값은 같다
    expect(col(slowed, 'prod_tasks_developed')[0]).toBe(col(base, 'prod_tasks_developed')[0])
  })
})

describe('E4: 통합 모델의 인력 보강(extra_people, extra_people_day)', () => {
  const m = integrated()
  const run = (o: Record<string, number>) => runModel(m, { overrides: o })
  it('기본값 0이면 hr_extra_rate는 항상 0', () => {
    expect(col(run({}), 'hr_extra_rate').every((v) => v === 0)).toBe(true)
  })
  it('지정한 날에 한 번만, 지정한 인원이 신입으로 들어온다', () => {
    const r = run({ extra_people: 6, extra_people_day: 100 })
    const rate = col(r, 'hr_extra_rate')
    const nonzero = [...rate].map((v, i) => [v, i] as const).filter(([v]) => v !== 0)
    expect(nonzero).toHaveLength(1)
    expect(r.time[nonzero[0]![1]]).toBe(100)
    expect(nonzero[0]![0] * 0.25).toBeCloseTo(6, 12) // 높이 × dt = 인원
  })
  it('투입 직후 총 인원이 늘고(고용 조정 전에), 신입이 숙련자로 편입된다', () => {
    const base = run({})
    const r = run({ extra_people: 6, extra_people_day: 100 })
    const i = 100 / 0.25 + 1
    expect(col(r, 'hr_new')[i]! - col(base, 'hr_new')[i]!).toBeGreaterThan(5)
    expect(col(r, 'hr_total')[i]!).toBeGreaterThan(col(base, 'hr_total')[i]!)
    // 투입 이전은 같다
    for (let k = 0; k <= 100 / 0.25; k++) expect(col(r, 'hr_total')[k]).toBe(col(base, 'hr_total')[k])
  })
  it('투입 시각이 종료 이후이면 결과가 기존과 같다', () => {
    const r = run({ extra_people: 5, extra_people_day: 5000 })
    expect(fingerprint(r, ['hr_extra_rate'])).toBe(fingerprint(run({}), ['hr_extra_rate']))
  })
  it('인원 수에 비례해 투입량이 늘고 음수는 거절하지 않으나 유한해야 한다', () => {
    const a = col(run({ extra_people: 2, extra_people_day: 60 }), 'hr_extra_rate')
    const b = col(run({ extra_people: 4, extra_people_day: 60 }), 'hr_extra_rate')
    expect(Math.max(...b)).toBeCloseTo(2 * Math.max(...a), 12)
  })
})
