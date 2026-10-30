import { beforeAll, describe, expect, it } from 'vitest'
import { compileModel, runModel, type CompiledModel, type RunResult } from '@spd/sd-engine'
import { brooksModel } from '../src'

/**
 * 책 1.4.1(p.19~21)의 수치로 엔진과 Brooks 모델을 검증한다.
 *  - 숙련 20명 고정: 500 FP를 274일에 완료
 *  - 약 110일에 5명 추가: 271일, 10명 추가: 296일
 *
 * 책은 인원 추가 시점을 "일정 편차 15% 시점(약 110일)"이라고만 적고 판단 정책의 수식은 싣지 않았다.
 * 그래서 시점을 파라미터(`hire_day`)로 두고, 책이 말한 110일과 책의 두 수치를 동시에 맞추는 시점을 따로 확인한다.
 */

let model: CompiledModel
beforeAll(() => {
  model = compileModel(brooksModel)
})

const run = (overrides: Record<string, number> = {}, dt?: number): RunResult =>
  runModel(model, { overrides, ...(dt ? { dt } : {}) })

const completion = (r: RunResult): number => {
  const c = r.series['completion_time'] as Float64Array
  return c[c.length - 1] as number
}

const at = (r: RunResult, name: string, day: number): number => {
  const i = r.time.findIndex((t) => Math.abs(t - day) < 1e-9)
  if (i < 0) throw new Error(`시각 ${day}가 기록에 없습니다`)
  return (r.series[name] as Float64Array)[i] as number
}

/** 숙련자 n명만 있을 때의 정상 개발률: n·(1.2·0.1)·(1 − 0.0006·n²) */
const steadyRate = (n: number) => n * 0.12 * (1 - 0.0006 * n * n)

describe('기준선: 숙련 20명 고정 (책: 274일)', () => {
  const base = () => run()

  it('완료 시점이 274일이다', () => {
    expect(completion(base())).toBeCloseTo(274, 0) // 274.12
    expect(Math.abs(completion(base()) - 274)).toBeLessThan(0.5)
  })

  it('개발률은 해석값 20·0.12·(1 − 0.24) = 1.824 FP/일로 일정하다', () => {
    const rate = base().series['software_development_rate'] as Float64Array
    expect(steadyRate(20)).toBeCloseTo(1.824, 12)
    // 마지막 스텝은 남은 양만 처리하므로 제외
    for (let i = 0; i < 1000; i++) expect(rate[i]).toBeCloseTo(1.824, 12)
  })

  it('요구사항과 개발 완료 규모의 합은 항상 500 FP로 보존된다', () => {
    const r = base()
    const req = r.series['requirements'] as Float64Array
    const dev = r.series['developed_software'] as Float64Array
    for (let i = 0; i < req.length; i++) expect((req[i] as number) + (dev[i] as number)).toBeCloseTo(500, 9)
  })

  it('완료 후 요구사항은 0, 개발 완료 규모는 500에서 멈춘다', () => {
    const r = base()
    expect(at(r, 'requirements', 400)).toBeCloseTo(0, 9)
    expect(at(r, 'developed_software', 400)).toBeCloseTo(500, 9)
  })

  it('인력이 변하지 않으므로 신입은 0, 총 인원은 20', () => {
    const r = base()
    expect(at(r, 'new_personnel', 200)).toBe(0)
    expect(at(r, 'total_personnel', 200)).toBe(20)
  })
})

describe('110일에 인원 추가 (책: +5명 271일, +10명 296일)', () => {
  const plus5 = () => run({ extra_people: 5 })
  const plus10 = () => run({ extra_people: 10 })

  it('+5명은 일정을 단축한다 (책 271일, 허용 ±2일)', () => {
    const c = completion(plus5())
    expect(c).toBeLessThan(completion(run()))
    expect(Math.abs(c - 271)).toBeLessThan(2)
  })

  it('+10명은 일정을 지연시킨다 (책 296일, 허용 ±2일)', () => {
    const c = completion(plus10())
    expect(c).toBeGreaterThan(completion(run()))
    expect(Math.abs(c - 296)).toBeLessThan(2)
  })

  it('"인원을 추가하면 늦어진다"는 조건부이다: 단축 < 기준 < 지연', () => {
    expect(completion(plus5())).toBeLessThan(completion(run()))
    expect(completion(run())).toBeLessThan(completion(plus10()))
  })

  it('책의 두 수치(271, 296)를 ±1일 안에서 동시에 맞추는 투입 시점이 80~110일 사이에 있다', () => {
    const days = Array.from({ length: 31 }, (_, i) => 80 + i)
    const fit = days.filter((d) => {
      const a = completion(run({ extra_people: 5, hire_day: d }))
      const b = completion(run({ extra_people: 10, hire_day: d }))
      return Math.abs(a - 271) <= 1 && Math.abs(b - 296) <= 1
    })
    expect(fit.length).toBeGreaterThan(0)
  })

  it('일찍 추가할수록 +10명의 지연이 커진다 (단조)', () => {
    const c = [90, 100, 110, 120].map((d) => completion(run({ extra_people: 10, hire_day: d })))
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThan(c[i - 1] as number)
  })

  it('투입 직후 개발률이 급락한 뒤 회복한다 (책 그림 1.10)', () => {
    const r = plus5()
    const before = at(r, 'software_development_rate', 109)
    const justAfter = at(r, 'software_development_rate', 111)
    const later = at(r, 'software_development_rate', 200)
    expect(before).toBeCloseTo(1.824, 9)
    // 신입 5명 + 훈련 1.25명 + 25명 규모의 의사소통 오버헤드로 하락
    expect(justAfter).toBeLessThan(before * 0.95)
    expect(later).toBeGreaterThan(justAfter)
  })

  it('+5명은 기준선을 약간 넘어서고 +10명은 기준선보다 낮게 정착한다', () => {
    const base = steadyRate(20)
    // 정착 후 총 인원 25명, 30명
    expect(at(plus5(), 'software_development_rate', 250)).toBeCloseTo(steadyRate(25), 2)
    expect(at(plus10(), 'software_development_rate', 250)).toBeCloseTo(steadyRate(30), 2)
    expect(steadyRate(25)).toBeGreaterThan(base)
    expect(steadyRate(30)).toBeLessThan(base)
  })

  it('신입은 평균 20일의 지수 감쇠로 숙련자가 되고 총 인원은 보존된다', () => {
    const r = plus10()
    const n0 = at(r, 'new_personnel', 110.25)
    expect(n0).toBeCloseTo(10, 9) // 투입한 스텝의 직후 값
    const expected = 10 * Math.exp(-(130 - 110.25) / 20)
    expect(at(r, 'new_personnel', 130)).toBeCloseTo(expected, 1)
    for (const day of [111, 120, 150, 300]) expect(at(r, 'total_personnel', day)).toBeCloseTo(30, 9)
  })

  it('완료 후에 투입하면 결과가 기준선과 같다', () => {
    expect(completion(run({ extra_people: 10, hire_day: 350 }))).toBeCloseTo(completion(run()), 9)
  })
})

describe('엔진 정합성', () => {
  it('적분 간격을 줄여도 완료 시점이 거의 같다 (dt 0.25 vs 0.0625)', () => {
    for (const extra of [0, 5, 10]) {
      const coarse = completion(run({ extra_people: extra }, 0.25))
      const fine = completion(run({ extra_people: extra }, 0.0625))
      expect(Math.abs(coarse - fine)).toBeLessThan(0.1)
    }
  })

  it('같은 입력은 같은 결과다 (컴파일된 모델 재사용)', () => {
    const a = run({ extra_people: 5 })
    run({ extra_people: 10 })
    const b = run({ extra_people: 5 })
    expect(Array.from(a.series['developed_software'] as Float64Array)).toEqual(
      Array.from(b.series['developed_software'] as Float64Array)
    )
  })
})

describe('누적 투입 공수 (cum_effort)', () => {
  it('총 인원의 시간적분(Euler 합)과 같다', () => {
    const r = run({ extra_people: 5 })
    const staff = r.series['total_personnel'] as Float64Array
    const cum = r.series['cum_effort'] as Float64Array
    let sum = 0
    for (let i = 0; i < r.time.length; i++) {
      expect(cum[i] as number).toBeCloseTo(sum, 6)
      sum += (staff[i] as number) * r.meta.dt
    }
  })

  it('기준선: 20명 × 274.1일 ≈ 5,482 맨데이(완료 시점)', () => {
    const r = run()
    const at = r.time.findIndex((t) => t >= completion(r))
    const interpolated =
      (r.series['cum_effort'] as Float64Array)[at - 1]! +
      (((r.series['cum_effort'] as Float64Array)[at]! - (r.series['cum_effort'] as Float64Array)[at - 1]!) * (completion(r) - r.time[at - 1]!)) /
        (r.time[at]! - r.time[at - 1]!)
    expect(interpolated).toBeCloseTo(20 * completion(r), 0)
    expect(Math.abs(interpolated - 5482.5)).toBeLessThan(1)
  })

  it('인원을 추가하면 일정이 줄어도 투입 공수는 늘어난다(책 p.21)', () => {
    const effortAtCompletion = (r: RunResult) => {
      const cum = r.series['cum_effort'] as Float64Array
      return cum[Math.min(cum.length - 1, Math.round(completion(r) / r.meta.dt))] as number
    }
    expect(completion(run({ extra_people: 5 }))).toBeLessThan(completion(run()))
    expect(effortAtCompletion(run({ extra_people: 5 }))).toBeGreaterThan(effortAtCompletion(run()))
  })

  it('기존 정량 결과는 그대로다(274.1일, 5명 272.0일, 10명 294.6일)', () => {
    expect(completion(run())).toBeCloseTo(274.12, 1)
    expect(completion(run({ extra_people: 5 }))).toBeCloseTo(272.0, 1)
    expect(completion(run({ extra_people: 10 }))).toBeCloseTo(294.64, 1)
  })
})
