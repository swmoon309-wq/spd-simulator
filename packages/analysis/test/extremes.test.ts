import { describe, expect, it } from 'vitest'
import { compileModel, type ModelDef } from '@spd/sd-engine'
import { EXTREME_LEVEL_LABEL, lastOf, planExtremes, runExtremeCase, simulateExtreme, summarizeExtremes, type ExtremeInput, type KpiSpec } from '../src'

/** 단순 모델: a가 k의 속도로 b로 옮겨 간다. a + b = total이 보존된다. 지표: b가 total의 99% 이상이면 끝난 날. */
const base = (p: { rate?: string; invariants?: ModelDef['invariants']; levels?: ModelDef['levels']; extraRates?: ModelDef['rates']; end?: number } = {}): ModelDef => ({
  meta: { id: 't', name: 't', version: 1, timeUnit: 'day' },
  time: { start: 0, end: p.end ?? 30, dt: 0.25 },
  constants: { total: { value: 100, unit: '개' }, k: { value: 0.5, unit: '1/일' }, div: { value: 1, unit: '개' } },
  levels: p.levels ?? { a: { init: 'total', inflows: [], outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move'], outflows: [], unit: '개' } },
  rates: { move: { expr: p.rate ?? 'k * a', unit: '개/일' }, ...(p.extraRates ?? {}) },
  auxiliaries: {},
  tables: {},
  outputs: ['a', 'b'],
  ...(p.invariants ? { invariants: p.invariants } : {})
})
const inv: ModelDef['invariants'] = [{ name: 'mass', label: 'a + b = total', lhs: [{ variable: 'a' }, { variable: 'b' }].map((t) => ({ ...t, coef: 1 })), rhs: [{ variable: 'total', coef: 1 }], tolerance: 1e-9 }]
const doneDay: KpiSpec = { id: 'completionDay', label: '끝난 날', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, 'b') >= 99 ? (r.time[r.series['b']!.findIndex((v) => v >= 99)] as number) : null) }
const input = (def: ModelDef, overrides: Partial<ExtremeInput> = {}): ExtremeInput => ({ model: compileModel(def), base: { total: 100, k: 0.5, div: 1 }, options: {}, kpis: [doneDay], ...overrides })
const param = (name: string, min: number, max: number, integer = false) => ({ name, min, max, ...(integer ? { integer } : {}) })

describe('시험할 값의 계획', () => {
  it('파라미터마다 최소·최대·0·×10·×0.1을 만든다', () => {
    const cases = planExtremes([param('k', 0.1, 2)], { k: 0.5 })
    expect(cases.map((c) => [c.value, c.levels.map((l) => EXTREME_LEVEL_LABEL[l])])).toEqual([
      [0.1, ['최소']], [2, ['최대']], [0, ['0']], [5, ['×10']], [0.05, ['×0.1']]
    ])
  })

  it('범위 안인지는 이름이 아니라 값으로 가른다(경계 포함)', () => {
    const cases = planExtremes([param('k', 0.1, 2)], { k: 0.5 })
    expect(cases.map((c) => c.inRange)).toEqual([true, true, false, false, false])
    const zeroOk = planExtremes([param('k', 0, 2)], { k: 0.5 })
    expect(zeroOk.find((c) => c.value === 0)).toMatchObject({ inRange: true, levels: ['min', 'zero'] }) // 최소 = 0 → 같은 값은 합친다
    expect(planExtremes([param('k', 0.1, 5)], { k: 0.5 }).find((c) => c.value === 5)).toMatchObject({ inRange: true, levels: ['max', 'x10'] })
  })

  it('값이 같으면 하나로 합치고 수준 이름을 모두 남긴다(현재 값이 0이면 ×10·×0.1·0이 한 값)', () => {
    const cases = planExtremes([param('x', 0, 10)], { x: 0 })
    expect(cases).toHaveLength(2)
    expect(cases.find((c) => c.value === 0)!.levels).toEqual(['min', 'zero', 'x10', 'x0.1'])
  })

  it('정수 파라미터는 ×10·×0.1을 반올림하고, 음수 0(-0)을 0으로 바로잡는다', () => {
    const cases = planExtremes([param('n', 1, 100, true)], { n: 7 })
    expect(cases.map((c) => c.value)).toEqual([1, 100, 0, 70]) // ×0.1 = 0.7 → 1 (최소와 같아 합쳐짐)
    expect(cases.find((c) => c.value === 1)!.levels).toEqual(['min', 'x0.1'])
    const neg = planExtremes([param('y', -5, 5)], { y: 0 })
    expect(neg.every((c) => !Object.is(c.value, -0))).toBe(true)
  })

  it('부동소수 잡음 없이 깔끔한 값을 만든다(0.1 × 0.1)', () => {
    const c = planExtremes([param('k', 0.001, 2)], { k: 0.1 })
    expect(c.find((x) => x.levels.includes('x0.1'))!.value).toBe(0.01)
    expect(planExtremes([param('k', 0, 2)], { k: 0.06 }).find((x) => x.levels.includes('x10'))!.value).toBe(0.6)
  })

  it('여러 파라미터는 순서대로 이어 붙인다', () => {
    const cases = planExtremes([param('k', 0.1, 2), param('total', 10, 1000)], { k: 0.5, total: 100 })
    // total은 ×10 = 1000이 최대와, ×0.1 = 10이 최소와 같아 값이 셋으로 합쳐진다
    expect(cases.map((c) => c.name)).toEqual(['k', 'k', 'k', 'k', 'k', 'total', 'total', 'total'])
    expect(cases.filter((c) => c.name === 'total').map((c) => c.levels)).toEqual([['min', 'x0.1'], ['max', 'x10'], ['zero']])
  })
})

describe('판정', () => {
  const caseOf = (name: string, value: number, inRange: boolean) => ({ name, value, levels: ['min' as const], inRange })

  it('결함이 없고 끝나면 통과한다', () => {
    const cell = runExtremeCase(input(base({ invariants: inv })), caseOf('k', 1, true))
    expect(cell).toMatchObject({ status: 'pass', reasons: [], error: null, finished: true })
    expect(cell.kpis!['completionDay']).toBeGreaterThan(0)
  })

  it('범위 안의 수치 오류(0으로 나누기)는 실패다', () => {
    const cell = runExtremeCase(input(base({ rate: 'k * a / (div - 1)' })), caseOf('k', 1, true))
    expect(cell.status).toBe('fail')
    expect(cell.error).toMatchObject({ variable: 'move' })
    expect(cell.reasons[0]).toContain('허용 범위 안의 값에서 오류')
    expect(cell.kpis).toBeNull()
  })

  it('같은 오류도 범위 밖에서는 정보다(예상된 거동일 수 있음)', () => {
    const cell = runExtremeCase(input(base({ rate: 'k * a / (div - 1)' })), caseOf('k', 1, false))
    expect(cell.status).toBe('info')
    expect(cell.reasons[0]).toContain('허용 범위 밖')
    expect(cell.error).not.toBeNull()
  })

  it('음수 Level은 주의다(범위 안·밖 모두), 처음 시각과 최솟값을 알린다', () => {
    // a가 일정한 속도로 줄어 음수가 된다
    const def = base({ rate: '30', levels: { a: { init: 'total', inflows: [], outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move'], outflows: [], unit: '개' } } })
    for (const inRange of [true, false]) {
      const cell = runExtremeCase(input(def), caseOf('k', 1, inRange))
      expect(cell.status).toBe('warn')
      expect(cell.negativeLevels[0]).toMatchObject({ name: 'a' })
      expect(cell.negativeLevels[0]!.min).toBeLessThan(0)
      expect(cell.reasons.join()).toContain('a이(가) 음수가 됨')
    }
  })

  it('불변식 위반은 주의다', () => {
    const def = base({ invariants: inv, levels: { a: { init: 'total', inflows: [], outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move2'], outflows: [], unit: '개' } }, extraRates: { move2: { expr: '2 * k * a', unit: '개/일' } } })
    const cell = runExtremeCase(input(def), caseOf('k', 1, true))
    expect(cell.status).toBe('warn')
    expect(cell.violatedInvariants).toEqual(['a + b = total'])
  })

  it('종료 시각 안에 끝나지 않으면 범위 안은 주의, 범위 밖은 정보다', () => {
    const slow = input(base({ end: 5 }))
    expect(runExtremeCase(slow, caseOf('k', 0.01, true))).toMatchObject({ status: 'warn', finished: false, reasons: ['종료 시각 안에 끝나지 않음'] })
    expect(runExtremeCase(slow, caseOf('k', 0.01, false))).toMatchObject({ status: 'info', finished: false })
  })

  it('가장 나쁜 판정을 상태로 하고 이유를 모두 남긴다(음수 Level + 끝나지 않음)', () => {
    const def = base({ end: 5, rate: '30', levels: { a: { init: 'total', inflows: [], outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move'], outflows: [], unit: '개' } } })
    const never: KpiSpec = { ...doneDay, compute: () => null }
    const cell = runExtremeCase(input(def, { kpis: [never] }), caseOf('k', 1, true))
    expect(cell.status).toBe('warn')
    expect(cell.reasons).toHaveLength(2)
    expect(cell.negativeLevels).toHaveLength(1)
    expect(cell.finished).toBe(false)
  })

  it('완료 지표가 없는 모델이면 끝났는지는 모른다(null)', () => {
    const cell = runExtremeCase(input(base(), { kpis: [] }), caseOf('k', 1, true))
    expect(cell.finished).toBeNull()
    expect(cell.status).toBe('pass')
  })

  it('대상 시나리오의 값에서 한 파라미터만 바꾼다', () => {
    const cell = runExtremeCase(input(base(), { base: { total: 200, k: 0.5, div: 1 } }), caseOf('k', 1, true))
    expect(cell.kpis!['completionDay']).toBeGreaterThan(0)
    const r = simulateExtreme(input(base(), { base: { total: 200, k: 0.5, div: 1 } }), caseOf('k', 1, true))
    expect(r.series['a']![0]).toBe(200) // total은 대상 시나리오의 값
  })

  it('요약: 상태별 개수와 실패 목록', () => {
    const cells = [
      runExtremeCase(input(base({ rate: 'k * a / (div - 1)' })), caseOf('k', 1, true)),
      runExtremeCase(input(base({ rate: 'k * a / (div - 1)' })), caseOf('k', 2, false)),
      runExtremeCase(input(base()), caseOf('k', 1, true))
    ]
    const s = summarizeExtremes(cells)
    expect(s.counts).toEqual({ pass: 1, warn: 0, fail: 1, info: 1 })
    expect(s.failures).toHaveLength(1)
  })
})
