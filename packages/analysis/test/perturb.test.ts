import { describe, expect, it } from 'vitest'
import { brooksModel } from '@spd/models'
import { compileModel, runModel, type ModelDef } from '@spd/sd-engine'
import { DEFAULT_LEVEL_CHECK_DAYS, levelChanges, perturbChanges, perturbProblem, RAMP_STEPS, runWithChanges, summarizeResponse, targetValue, type PerturbSpec } from '../src'

/** 일정한 입력 u가 stock s에 쌓이고, s에 비례해 빠져나가는 1차 시스템: ds/dt = u − s/τ. */
const system = (): ModelDef => ({
  meta: { id: 't', name: 't', version: 1, timeUnit: 'day' },
  time: { start: 0, end: 100, dt: 0.5 },
  constants: { u: { value: 10, unit: '개/일' }, tau: { value: 5, unit: '일' } },
  levels: { s: { init: 'u * tau', inflows: ['inflow'], outflows: ['outflow'], unit: '개' }, total: { init: '0', inflows: ['inflow'], outflows: [], unit: '개' } },
  rates: { inflow: { expr: 'u', unit: '개/일' }, outflow: { expr: 's / tau', unit: '개/일' } },
  auxiliaries: {},
  tables: {},
  outputs: ['s']
})
const model = compileModel(system())
const run = (changes: Parameters<typeof runWithChanges>[3] = []) => runWithChanges(model, {}, {}, changes)
const spec = (p: Partial<PerturbSpec> = {}): PerturbSpec => ({ kind: 'step', name: 'u', mode: 'absolute', amount: 20, day: 20, width: 10, ...p })
const at = (r: ReturnType<typeof run>, name: string, day: number) => (r.series[name] as Float64Array)[Math.round(day / 0.5)] as number

describe('시험 입력 → 상수 변경 목록', () => {
  it('스텝은 시각부터 새 값(1개)', () => {
    expect(perturbChanges(spec(), 10)).toEqual([{ day: 20, name: 'u', value: 20 }])
  })
  it('펄스는 폭이 끝나면 원래 값으로(2개)', () => {
    expect(perturbChanges(spec({ kind: 'pulse' }), 10)).toEqual([{ day: 20, name: 'u', value: 20 }, { day: 30, name: 'u', value: 10 }])
  })
  it('램프는 K + 1개 계단으로 원래 값에서 새 값까지 오르고 끝에서 새 값이다', () => {
    const c = perturbChanges(spec({ kind: 'ramp', width: 20 }), 10)
    expect(c).toHaveLength(RAMP_STEPS + 1)
    expect(c[0]).toEqual({ day: 20, name: 'u', value: 10 })
    expect(c[RAMP_STEPS]).toEqual({ day: 40, name: 'u', value: 20 })
    for (let i = 1; i < c.length; i++) {
      expect(c[i]!.value).toBeGreaterThan(c[i - 1]!.value) // 단조
      expect(c[i]!.day).toBeGreaterThan(c[i - 1]!.day)
    }
    expect(c[5]!.value).toBeCloseTo(15, 12)
  })
  it('내려가는 램프도 단조 감소', () => {
    const c = perturbChanges(spec({ kind: 'ramp', amount: 2, width: 10 }), 10)
    for (let i = 1; i < c.length; i++) expect(c[i]!.value).toBeLessThan(c[i - 1]!.value)
  })
  it('크기는 절대값이거나 현재 값 대비 증감(%)이다', () => {
    expect(targetValue(spec({ mode: 'percent', amount: 50 }), 10)).toBe(15)
    expect(targetValue(spec({ mode: 'percent', amount: -100 }), 10)).toBe(0)
    expect(targetValue(spec({ mode: 'absolute', amount: 3 }), 10)).toBe(3)
    expect(perturbChanges(spec({ mode: 'percent', amount: 50 }), 10)[0]!.value).toBe(15)
  })
  it('입력 검사', () => {
    const range = { start: 0, end: 100 }
    expect(perturbProblem(spec(), 10, range)).toBeNull()
    expect(perturbProblem(spec({ name: 'x' }), undefined, range)).toContain('상수가 아닙니다')
    expect(perturbProblem(spec({ amount: NaN }), 10, range)).toContain('크기')
    expect(perturbProblem(spec({ day: 100 }), 10, range)).toContain('시작 시각')
    expect(perturbProblem(spec({ day: -1 }), 10, range)).toContain('시작 시각')
    expect(perturbProblem(spec({ kind: 'pulse', width: 0 }), 10, range)).toContain('폭')
    expect(perturbProblem(spec({ kind: 'step', width: 0 }), 10, range)).toBeNull() // 스텝은 폭을 쓰지 않는다
  })
})

describe('변경을 적용한 실행', () => {
  it('변경이 없으면 보통의 실행과 비트 단위로 같다', () => {
    const plain = runModel(model, {})
    const r = run()
    for (const name of Object.keys(plain.series)) expect(Array.from(r.series[name] as Float64Array)).toEqual(Array.from(plain.series[name] as Float64Array))
  })

  it('스텝: 변경 시각 이전은 기준과 비트 단위로 같고 이후는 달라진다', () => {
    const base = run()
    const r = run(perturbChanges(spec(), 10))
    const i20 = 20 / 0.5
    for (let i = 0; i < i20; i++) expect(Object.is((r.series['s'] as Float64Array)[i], (base.series['s'] as Float64Array)[i])).toBe(true)
    expect(at(r, 's', 21)).toBeGreaterThan(at(base, 's', 21))
    // 정상 상태: s = u·τ → 100에서 200으로
    expect(at(base, 's', 99)).toBeCloseTo(50, 0)
    expect(at(r, 's', 99)).toBeCloseTo(100, 0)
  })

  it('펄스: 폭이 끝나면 상수가 원래 값이고 반응이 1차 지연으로 사라진다', () => {
    const r = run(perturbChanges(spec({ kind: 'pulse', amount: 30, width: 10 }), 10))
    const u = r.series['inflow'] as Float64Array
    expect(u[Math.round(19.5 / 0.5)]).toBe(10)
    expect(u[Math.round(20 / 0.5)]).toBe(30)
    expect(u[Math.round(29.5 / 0.5)]).toBe(30)
    expect(u[Math.round(30 / 0.5)]).toBe(10) // 폭이 끝난 스텝부터 원래 값
    expect(at(r, 's', 99)).toBeCloseTo(at(run(), 's', 99), 3)
  })

  it('램프: 상수가 단조롭게 오르고 끝 이후 새 값을 유지한다', () => {
    const r = run(perturbChanges(spec({ kind: 'ramp', amount: 30, day: 20, width: 20 }), 10))
    const u = r.series['inflow'] as Float64Array
    for (let i = 1; i < u.length; i++) expect(u[i] as number).toBeGreaterThanOrEqual(u[i - 1] as number)
    expect(u[Math.round(19.5 / 0.5)]).toBe(10)
    expect(u[Math.round(60 / 0.5)]).toBeCloseTo(30, 12)
    expect(u[u.length - 1]).toBeCloseTo(30, 12)
  })

  it('시작 시각 이하의 변경은 시작할 때 적용하고, 종료 이후의 변경은 무시한다', () => {
    const r = run([{ day: 0, name: 'u', value: 20 }, { day: 500, name: 'u', value: 99 }])
    expect((r.series['inflow'] as Float64Array)[0]).toBe(20)
    expect((r.series['inflow'] as Float64Array)[r.time.length - 1]).toBe(20)
  })

  it('입력 순서와 무관하게 시각순으로 적용한다', () => {
    const a = run([{ day: 50, name: 'u', value: 5 }, { day: 20, name: 'u', value: 20 }])
    const b = run([{ day: 20, name: 'u', value: 20 }, { day: 50, name: 'u', value: 5 }])
    expect(Array.from(a.series['s'] as Float64Array)).toEqual(Array.from(b.series['s'] as Float64Array))
  })

  it('상수가 아닌 이름은 오류', () => {
    expect(() => run([{ day: 5, name: 's', value: 1 }])).toThrow(/상수가 아닙니다/)
  })
})

describe('반응 요약', () => {
  const base = run()

  it('스텝 반응: 최대 편차는 마지막 쪽이고 복귀하지 않는다', () => {
    const r = run(perturbChanges(spec(), 10))
    const sum = summarizeResponse(base, r, 's')
    expect(sum.noEffect).toBe(false)
    expect(sum.maxDeviation).toBeCloseTo(50, 0) // 50 → 100
    expect(sum.signedAtMax).toBeGreaterThan(0)
    expect(sum.timeOfMax).toBeGreaterThan(60)
    expect(sum.returnTime).toBeNull() // 복귀 안 함
    expect(sum.finalDeviation).toBeCloseTo(50, 0)
    expect(sum.relativeAtMax).toBeCloseTo(1, 1) // 기준 50 대비 +100%
  })

  it('펄스 반응: 최대 편차 후 1차 지연으로 줄어 5% 이하가 되는 시각을 알린다', () => {
    const r = run(perturbChanges(spec({ kind: 'pulse', amount: 30, width: 10 }), 10))
    const sum = summarizeResponse(base, r, 's')
    expect(sum.timeOfMax).toBeGreaterThanOrEqual(29)
    expect(sum.timeOfMax).toBeLessThanOrEqual(31)
    expect(sum.returnTime).not.toBeNull()
    // 최대 이후 τ = 5일의 지수 감쇠: 5%에 이르려면 약 ln(20)·5 ≈ 15일
    expect(sum.returnTime! - sum.timeOfMax).toBeGreaterThan(12)
    expect(sum.returnTime! - sum.timeOfMax).toBeLessThan(18)
    expect(Math.abs(sum.finalDeviation)).toBeLessThan(0.01 * sum.maxDeviation)
  })

  it('영향이 없는 변수는 반응 없음', () => {
    const r = run(perturbChanges(spec({ day: 50, mode: 'absolute', amount: 10 }), 10)) // 같은 값으로 바꿈
    const sum = summarizeResponse(base, r, 's')
    expect(sum).toMatchObject({ noEffect: true, maxDeviation: 0, returnTime: null })
  })

  it('음수가 되는지 알린다', () => {
    const r = run([{ day: 20, name: 'u', value: -50 }])
    expect(summarizeResponse(base, r, 's').goesNegative).toBe(true)
    expect(summarizeResponse(base, base, 's').goesNegative).toBe(false)
  })

  it('없는 변수와 눈금이 다른 실행은 오류', () => {
    expect(() => summarizeResponse(base, base, 'nope')).toThrow(/없습니다/)
    const other = runWithChanges(model, {}, { dt: 0.25 }, [])
    expect(() => summarizeResponse(base, other, 's')).toThrow(/눈금/)
  })
})

describe('실제 모델: Brooks 법칙 인력 투입', () => {
  const brooks = compileModel(brooksModel)
  const brooksRun = (changes: Parameters<typeof runWithChanges>[3] = []) => runWithChanges(brooks, {}, {}, changes)

  it('스텝으로 90일째에 인원 10명을 더하면 총 인원이 30으로 오른다(기준은 20)', () => {
    const base = brooksRun()
    const r = brooksRun([{ day: 90, name: 'extra_people', value: 10 }, { day: 90, name: 'hire_day', value: 90 }])
    const sum = summarizeResponse(base, r, 'total_personnel')
    expect(sum.maxDeviation).toBeCloseTo(10, 6)
    expect(sum.timeOfMax).toBeGreaterThanOrEqual(90)
    expect(sum.returnTime).toBeNull()
    // 책 1.4: 신규 인력이 오히려 일정을 늦춘다
    const done = (x: typeof r) => x.series['completion_time']![x.time.length - 1] as number
    expect(done(r)).toBeGreaterThan(done(base))
  })
})

describe('Level 변화 점검', () => {
  it('짧은 구간에서 Level의 시작·끝·변화를 변화량 순으로 낸다', () => {
    const rows = levelChanges(model, {}, {})
    expect(rows.map((r) => r.name)).toEqual(['total', 's']) // total은 매일 10씩 쌓여 변화가 크다
    expect(rows[0]).toMatchObject({ name: 'total', start: 0, moves: true })
    expect(rows[0]!.end).toBeCloseTo(10 * DEFAULT_LEVEL_CHECK_DAYS, 6)
    expect(rows[0]!.relative).toBeNull() // 시작이 0이면 비율을 정하지 않는다
    // s는 정상 상태(u·τ = 50)에서 시작해 변하지 않는다
    expect(rows[1]).toMatchObject({ name: 's', moves: false })
    expect(rows[1]!.change).toBeCloseTo(0, 9)
  })

  it('정상 상태가 아니면 움직이는 Level이 비율과 함께 나온다', () => {
    const rows = levelChanges(model, { u: 20 }, {}, 20) // 입력이 두 배인데 s의 초기값은 u·τ로 따라가므로 여전히 정상 → total만 움직임
    expect(rows.filter((r) => r.moves).map((r) => r.name)).toEqual(['total'])
    const unsteady = compileModel({ ...system(), levels: { ...system().levels, s: { init: '10', inflows: ['inflow'], outflows: ['outflow'], unit: '개' } } })
    const r2 = levelChanges(unsteady, {}, {}, 20)
    const s = r2.find((x) => x.name === 's')!
    expect(s.moves).toBe(true)
    expect(s.relative!).toBeGreaterThan(1) // 10에서 크게 올라간다
  })

  it('일수 인자를 따르고 시뮬레이션 시작 시각을 기준으로 한다', () => {
    const r = levelChanges(model, {}, {}, 10)
    expect(r.find((x) => x.name === 'total')!.end).toBeCloseTo(100, 6)
  })
})
