import { describe, expect, it } from 'vitest'
import { checkInvariants, compileModel, ModelError, parseModelDef, runModel } from '../src'
import { model } from './model-helpers'

/** 인구 이동: a가 줄어든 만큼 b가 늘어난다. a + b = 총량(상수)이 보존된다. */
const transfer = (extra: Partial<Parameters<typeof model>[0]> = {}) =>
  model({
    constants: { total: 100, k: 0.1 },
    levels: { a: { init: 'total', outflows: ['move'] }, b: { init: '0', inflows: ['move'] } },
    rates: { move: 'k * a' },
    time: { end: 20 },
    ...extra
  })

const inv = (patch: Record<string, unknown> = {}) => ({
  name: 'mass',
  label: 'a + b = total',
  lhs: [{ variable: 'a', coef: 1 }, { variable: 'b', coef: 1 }],
  rhs: [{ variable: 'total', coef: 1 }],
  tolerance: 1e-9,
  ...patch
})

describe('불변식 스키마', () => {
  it('선택 항목이다: 없어도 되고, 있으면 그대로 읽힌다', () => {
    const base = JSON.parse(JSON.stringify(transfer()))
    expect(parseModelDef(base).invariants).toBeUndefined()
    const withInv = parseModelDef({ ...base, invariants: [{ ...inv(), lhs: [{ variable: 'a' }, { variable: 'b' }] }] })
    expect(withInv.invariants?.[0]?.lhs).toEqual([{ variable: 'a', coef: 1 }, { variable: 'b', coef: 1 }]) // 계수 기본값 1
  })

  it('이름 형식, 빈 변, 0 이하의 허용 오차를 거부한다', () => {
    const base = JSON.parse(JSON.stringify(transfer()))
    expect(() => parseModelDef({ ...base, invariants: [inv({ name: '잘못된 이름' })] })).toThrow()
    expect(() => parseModelDef({ ...base, invariants: [inv({ lhs: [] })] })).toThrow()
    expect(() => parseModelDef({ ...base, invariants: [inv({ rhs: [] })] })).toThrow()
    expect(() => parseModelDef({ ...base, invariants: [inv({ tolerance: 0 })] })).toThrow()
  })
})

describe('컴파일 검사', () => {
  it('정의되지 않은 변수와 겹치는 이름은 ModelError', () => {
    const bad = () => compileModel(transfer({ invariants: [inv({ rhs: [{ variable: 'ghost', coef: 1 }] })] }))
    expect(bad).toThrow(ModelError)
    expect(bad).toThrow(/ghost/)
    expect(() => compileModel(transfer({ invariants: [inv(), inv()] }))).toThrow(/겹칩니다/)
    expect(() => compileModel(transfer({ invariants: [inv({ lhs: [{ variable: 'a', coef: Infinity }] })] }))).toThrow(/계수/)
  })

  it('올바른 선언은 컴파일되고 실행 결과를 바꾸지 않는다', () => {
    const plain = runModel(compileModel(transfer()))
    const declared = runModel(compileModel(transfer({ invariants: [inv()] })))
    for (const name of Object.keys(plain.series)) expect(Array.from(declared.series[name] as Float64Array)).toEqual(Array.from(plain.series[name] as Float64Array))
  })
})

describe('불변식 점검', () => {
  const run = (m = transfer({ invariants: [inv()] }), overrides: Record<string, number> = {}) => ({ def: m, result: runModel(compileModel(m), { overrides }) })

  it('성립하는 보존 법칙은 위반 0이다(상수 덮어쓰기에서도)', () => {
    for (const overrides of [{}, { total: 250 }, { k: 0.5 }] as Record<string, number>[]) {
      const { def, result } = run(undefined, overrides)
      const [c] = checkInvariants(def, result, overrides)
      expect(c).toMatchObject({ name: 'mass', violated: false, missing: [], firstViolationTime: null })
      expect(c!.maxViolation).toBeLessThan(1e-9)
    }
  })

  it('상수는 params로 덮어쓴 값을 쓴다(덮어쓴 값을 알려 주지 않으면 위반으로 나온다)', () => {
    const { def, result } = run(undefined, { total: 250 })
    expect(checkInvariants(def, result, { total: 250 })[0]!.violated).toBe(false)
    const wrong = checkInvariants(def, result)[0]!
    expect(wrong.violated).toBe(true)
    expect(wrong.maxViolation).toBeCloseTo(150, 9)
    expect(wrong.firstViolationTime).toBe(0)
  })

  it('깨진 모델(유출이 사라지지 않고 b도 늘어남)의 위반을 검출한다', () => {
    const broken = transfer({ levels: { a: { init: 'total', outflows: ['move'] }, b: { init: '0', inflows: ['move2'] } }, rates: { move: 'k * a', move2: '2 * k * a' }, invariants: [inv()] })
    const c = checkInvariants(broken, runModel(compileModel(broken)))[0]!
    expect(c.violated).toBe(true)
    expect(c.maxViolation).toBeGreaterThan(1)
    expect(c.firstViolationTime).toBeGreaterThan(0)
    expect(c.firstViolationTime).toBeLessThan(2)
  })

  it('계수를 쓴다(2a + b = 2·total은 이 모델에서 성립하지 않는다)', () => {
    const m = transfer({ invariants: [inv({ name: 'scaled', lhs: [{ variable: 'a', coef: 2 }, { variable: 'b', coef: 1 }], rhs: [{ variable: 'total', coef: 2 }] })] })
    expect(checkInvariants(m, runModel(compileModel(m)))[0]!.violated).toBe(true)
  })

  it('기록하지 않은 변수는 점검하지 못하고 알린다', () => {
    const m = transfer({ invariants: [inv()] })
    const result = runModel(compileModel(m), { record: ['a'] })
    const c = checkInvariants(m, result)[0]!
    expect(c.missing).toEqual(['b'])
    expect(Number.isNaN(c.maxViolation)).toBe(true)
    expect(c.violated).toBe(false) // 점검하지 못한 것을 위반으로 세지 않는다
  })

  it('선언이 없으면 빈 목록', () => {
    const m = transfer()
    expect(checkInvariants(m, runModel(compileModel(m)))).toEqual([])
  })

  it('허용 오차 경계: 오차가 허용 오차 이하면 위반이 아니다', () => {
    const m = transfer({ constants: { total: 100, k: 0.1, off: 1e-7 }, invariants: [inv({ rhs: [{ variable: 'total', coef: 1 }, { variable: 'off', coef: 1 }], tolerance: 1e-6 })] })
    const result = runModel(compileModel(m))
    expect(checkInvariants(m, result)[0]).toMatchObject({ violated: false })
    expect(checkInvariants(m, result)[0]!.maxViolation).toBeCloseTo(1e-7, 12)
    const tight = transfer({ constants: { total: 100, k: 0.1, off: 1e-7 }, invariants: [inv({ rhs: [{ variable: 'total', coef: 1 }, { variable: 'off', coef: 1 }], tolerance: 1e-8 })] })
    expect(checkInvariants(tight, runModel(compileModel(tight)))[0]!.violated).toBe(true)
  })
})
