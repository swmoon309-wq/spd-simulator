import { describe, expect, it } from 'vitest'
import { checkModelUnits, divDim, equalDim, formatDim, mulDim, parseModelDef, parseUnit, powDim, type Dim, type ModelDef, type UnitIssue } from '../src'

const dim = (s: string, aliases?: Record<string, string>): Dim => {
  const r = parseUnit(s, aliases ? { ...{ 맨데이: '명·일', 비율: '1', 배: '1', '0/1': '1', FTE: '명', 신입: '명' }, ...aliases } : undefined)
  if (!r.ok) throw new Error(`${s}: ${r.error.message}`)
  return r.dim
}

describe('단위 파서', () => {
  it('내장 모델이 쓰는 28개 단위 문자열이 모두 읽힌다(차원 확인)', () => {
    const expected: Record<string, Record<string, number>> = {
      명: { 명: 1 }, 일: { 일: 1 }, 태스크: { 태스크: 1 }, 비율: {}, 맨데이: { 명: 1, 일: 1 }, '태스크/일': { 태스크: 1, 일: -1 }, 배: {},
      '태스크/맨데이': { 태스크: 1, 명: -1, 일: -1 }, '명/일': { 명: 1, 일: -1 }, 오류: { 오류: 1 }, '맨데이/일': { 명: 1 }, '오류/일': { 오류: 1, 일: -1 },
      '일/일': {}, '오류/태스크': { 오류: 1, 태스크: -1 }, '맨데이/오류': { 명: 1, 일: 1, 오류: -1 }, '맨데이/태스크': { 명: 1, 일: 1, 태스크: -1 }, FP: { FP: 1 },
      '0/1': {}, '1/명²': { 명: -2 }, 'FTE/신입': {}, 'FP/일': { FP: 1, 일: -1 }, '명(생산성 환산)': { 명: 1 }, 소진일: { 소진일: 1 }, '소진일/일': { 소진일: 1, 일: -1 },
      '1/일': { 일: -1 }, 'FP/맨데이': { FP: 1, 명: -1, 일: -1 }, '명/명': {}, '1/일²': { 일: -2 }
    }
    expect(Object.keys(expected)).toHaveLength(28)
    for (const [text, want] of Object.entries(expected)) {
      const r = parseUnit(text)
      expect(r.ok, text).toBe(true)
      if (r.ok) expect(equalDim(r.dim, want), `${text} → ${formatDim(r.dim)}`).toBe(true)
    }
  })

  it('곱·나눗셈은 왼쪽부터, 지수는 ² ³ ^n(음수 포함)', () => {
    expect(equalDim(dim('a/b/c'), { a: 1, b: -1, c: -1 })).toBe(true)
    expect(equalDim(dim('a/b·c'), { a: 1, b: -1, c: 1 })).toBe(true)
    expect(equalDim(dim('a*b'), { a: 1, b: 1 })).toBe(true)
    expect(equalDim(dim('a^2'), { a: 2 })).toBe(true)
    expect(equalDim(dim('a^-1'), { a: -1 })).toBe(true)
    expect(equalDim(dim('a³'), { a: 3 })).toBe(true)
    expect(equalDim(dim('a⁻²'), { a: -2 })).toBe(true)
    expect(equalDim(dim('1/a^2·b'), { a: -2, b: 1 })).toBe(true)
  })

  it('괄호 주석은 버리고 별칭은 풀며 공백은 무시한다', () => {
    expect(equalDim(dim('명(생산성 환산)'), { 명: 1 })).toBe(true)
    expect(equalDim(dim('명 · 일'), dim('맨데이'))).toBe(true)
    // 옛 이름(`인일`)으로 저장된 사용자 모델과 프로젝트도 같은 단위로 읽는다
    expect(equalDim(dim('인일'), dim('맨데이'))).toBe(true)
    expect(equalDim(dim('태스크/인일'), dim('태스크/맨데이'))).toBe(true)
    expect(equalDim(dim(' 맨데이 / 일 '), { 명: 1 })).toBe(true)
    expect(equalDim(dim('FP（기능점수）'), { FP: 1 })).toBe(true)
  })

  it('사용자 별칭과 순환 별칭', () => {
    expect(equalDim(dim('인월', { 인월: '명·월' }), { 명: 1, 월: 1 })).toBe(true)
    expect(equalDim(dim('인월/월', { 인월: '명·월' }), { 명: 1 })).toBe(true)
    // 서로를 가리키는 별칭은 무한히 풀리지 않고, 자기 자신으로 돌아오는 이름을 기본 단위로 본다
    const loop = parseUnit('a', { a: 'b', b: 'a' })
    expect(loop.ok && equalDim(loop.dim, { a: 1 })).toBe(true)
    const self = parseUnit('x', { x: 'x·일' })
    expect(self.ok && equalDim(self.dim, { x: 1, 일: 1 })).toBe(true)
  })

  it('읽을 수 없는 문자열은 위치와 이유를 준다', () => {
    for (const bad of ['', '   ', '/일', '일/', '일//명', '일^', '일^x', '·일', '일 명']) {
      const r = parseUnit(bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.error.message.length).toBeGreaterThan(0)
    }
    const r = parseUnit('일/ ')
    expect(!r.ok && r.error.pos).toBeGreaterThan(0)
  })

  it('formatDim: 사람이 읽는 형식이고 다시 읽으면 같은 차원이다', () => {
    expect(formatDim({})).toBe('1')
    expect(formatDim({ 태스크: 1, 일: -1 })).toBe('태스크/일')
    expect(formatDim({ 일: -2 })).toBe('1/일²')
    expect(formatDim({ 명: 1, 일: 1, 오류: -1 })).toBe('명·일/오류')
    for (const d of [{ 태스크: 1, 일: -1 }, { 일: -2 }, { 명: 2 }, { a: 1, b: -3 }] as Record<string, number>[]) {
      const r = parseUnit(formatDim(d), {})
      expect(r.ok && equalDim(r.dim, d)).toBe(true)
    }
  })

  it('대수: 곱·나눗셈·거듭제곱, 0 지수 제거', () => {
    expect(equalDim(mulDim({ a: 1 }, { a: -1 }), {})).toBe(true)
    expect(Object.keys(mulDim({ a: 1 }, { a: -1 }))).toEqual([])
    expect(equalDim(divDim({ a: 2 }, { a: 1 }), { a: 1 })).toBe(true)
    expect(equalDim(powDim({ a: 1, b: -2 }, 2), { a: 2, b: -4 })).toBe(true)
    expect(equalDim(powDim({ a: 2 }, 0.5), { a: 1 })).toBe(true)
  })
})

const base = (over: Partial<ModelDef> = {}): ModelDef => ({
  meta: { id: 'm', name: 'm', version: 1, timeUnit: 'day' },
  time: { start: 0, end: 10, dt: 1 },
  constants: { staff: { value: 5, unit: '명' }, prod: { value: 2, unit: '태스크/맨데이' }, tau: { value: 3, unit: '일' }, ratio: { value: 0.5, unit: '비율' } },
  levels: { work: { init: '100', inflows: [], outflows: ['done'], unit: '태스크' } },
  rates: { done: { expr: 'staff * prod', unit: '태스크/일' } },
  auxiliaries: {},
  tables: {},
  outputs: [],
  ...over
})
const issues = (def: ModelDef): UnitIssue[] => checkModelUnits(def)
const errors = (def: ModelDef) => issues(def).filter((i) => i.severity === 'error')
const of = (def: ModelDef, code: string) => issues(def).filter((i) => i.code === code)
const aux = (expr: string, unit?: string, more: Partial<ModelDef> = {}): ModelDef => base({ auxiliaries: { a: { expr, ...(unit !== undefined ? { unit } : {}) } }, ...more })

describe('수식 단위 검사: 올바른 모델', () => {
  it('오류도 경고도 없다(정보만)', () => {
    expect(issues(base()).filter((i) => i.severity !== 'info')).toEqual([])
  })
})

describe('더하기·빼기·비교는 단위가 같아야 한다', () => {
  it('명 + 일은 오류이고 연산자 위치와 두 단위를 알린다', () => {
    const [i] = errors(aux('staff + tau', '명'))
    expect(i).toMatchObject({ code: 'unit-mismatch', variable: 'a', field: 'expr', range: [6, 7] })
    expect(i?.message).toContain('명 ≠ 일')
  })
  it('같은 단위(맨데이 = 명·일)는 통과한다', () => {
    expect(errors(aux('staff * tau + staff * tau', '맨데이'))).toEqual([])
    expect(errors(aux('staff * tau - 3 * staff * tau', '명·일'))).toEqual([])
  })
  it('비교도 같은 단위를 요구하고 결과는 무차원이다', () => {
    expect(of(aux('IF(staff > tau, 1, 0)', '비율'), 'unit-mismatch')).toHaveLength(1)
    expect(errors(aux('IF(staff > 3, 1, 0)', '비율'))).toEqual([])
    expect(errors(aux('staff > 3', '비율'))).toEqual([])
    expect(errors(aux('staff > 3 AND tau <= 2', '비율'))).toEqual([])
    expect(of(aux('staff = tau', '비율'), 'unit-mismatch')).toHaveLength(1)
  })
  it('0은 어디서나 허용하고 0이 아닌 숫자는 정보로 알린다', () => {
    expect(issues(aux('staff + 0', '명')).filter((i) => i.severity !== 'info')).toEqual([])
    expect(of(aux('staff + 0', '명'), 'unit-literal')).toEqual([])
    const lit = of(aux('staff + 5', '명'), 'unit-literal')
    expect(lit).toHaveLength(1)
    expect(lit[0]?.severity).toBe('info')
    expect(lit[0]?.message).toContain('5')
    expect(of(aux('ratio + 5', '비율'), 'unit-literal')).toEqual([]) // 무차원에 숫자는 자연스럽다
  })
})

describe('곱셈·나눗셈·거듭제곱', () => {
  it('단위를 곱하고 나눈다(선언한 단위와 맞으면 통과, 틀리면 선언 불일치)', () => {
    expect(errors(aux('staff * prod * tau', '태스크'))).toEqual([])
    const [i] = errors(aux('staff * prod', '태스크'))
    expect(i).toMatchObject({ code: 'unit-declared', variable: 'a', suggestion: '태스크/일' })
    expect(errors(aux('prod / prod', '비율'))).toEqual([])
    expect(errors(aux('1 / tau', '1/일'))).toEqual([])
    expect(errors(aux('2 * staff', '명'))).toEqual([])
  })
  it('지수가 정수 리터럴이면 지수, 식이면 밑·지수가 무차원이어야 한다', () => {
    expect(errors(aux('tau ^ 2', '일²'))).toEqual([])
    expect(errors(aux('tau ^ -1', '1/일'))).toEqual([])
    expect(errors(aux('ratio ^ ratio', '비율'))).toEqual([])
    expect(of(aux('tau ^ ratio', '일'), 'unit-argument')).toHaveLength(1)
    expect(of(aux('ratio ^ tau', '비율'), 'unit-argument')).toHaveLength(1)
    expect(errors(aux('SQRT(tau * tau)', '일'))).toEqual([])
  })
})

describe('함수', () => {
  it('MIN·MAX·IF의 분기·CLAMP·ABS·ROUND', () => {
    expect(of(aux('MAX(staff, tau)', '명'), 'unit-mismatch')).toHaveLength(1)
    expect(errors(aux('MIN(staff, 3, staff * 2)', '명'))).toEqual([])
    expect(of(aux('IF(1, staff, tau)', '명'), 'unit-mismatch')).toHaveLength(1)
    expect(of(aux('IF(staff, 1, 2)', '비율'), 'unit-argument')).toHaveLength(1) // 조건이 무차원이 아니다
    expect(of(aux('CLAMP(staff, 0, tau)', '명'), 'unit-mismatch')).toHaveLength(1)
    expect(errors(aux('ABS(staff) + ROUND(staff, 1)', '명'))).toEqual([])
    expect(of(aux('ROUND(staff, tau)', '명'), 'unit-argument')).toHaveLength(1)
  })
  it('EXP·LN은 무차원 입력, 결과도 무차원', () => {
    expect(errors(aux('EXP(ratio) + LN(ratio)', '비율'))).toEqual([])
    expect(of(aux('EXP(staff)', '비율'), 'unit-argument')).toHaveLength(1)
    expect(of(aux('LN(tau)', '비율'), 'unit-argument')).toHaveLength(1)
  })
  it('SMOOTH·DELAY의 지연시간은 일, 결과는 입력 단위', () => {
    expect(errors(aux('SMOOTH(staff, tau)', '명'))).toEqual([])
    expect(errors(aux('DELAY3(staff, 5)', '명'))).toEqual([])
    expect(of(aux('SMOOTH(staff, staff)', '명'), 'unit-argument')).toHaveLength(1)
    expect(of(aux('DELAY1(staff, ratio)', '명'), 'unit-argument')).toHaveLength(1)
  })
  it('STEP·PULSE·RAMP: 시각 인자는 일, RAMP의 결과는 기울기×일', () => {
    expect(errors(aux('STEP(staff, tau)', '명'))).toEqual([])
    expect(errors(aux('PULSE(staff, tau, 5)', '명'))).toEqual([])
    expect(errors(aux('RAMP(prod, 3)', '태스크/명'))).toEqual([])
    expect(of(aux('STEP(staff, staff)', '명'), 'unit-argument')).toHaveLength(1)
    expect(of(aux('PULSE(staff, 1, staff)', '명'), 'unit-argument')).toHaveLength(1)
    expect(of(aux('RAMP(prod, ratio)', '태스크/명'), 'unit-argument')).toHaveLength(1)
  })
  it('TIME·DT는 일, RANDOM은 인자가 같은 단위', () => {
    expect(errors(aux('TIME + DT', '일'))).toEqual([])
    expect(errors(aux('RANDOM_UNIFORM(staff, staff * 2)', '명'))).toEqual([])
    expect(of(aux('RANDOM_NORMAL(staff, tau)', '명'), 'unit-mismatch')).toHaveLength(1)
    expect(of(aux('RANDOM_TRIANGULAR(staff, 3, tau)', '명'), 'unit-mismatch')).toHaveLength(1)
  })
  it('GRAPH: 입력은 테이블의 x 단위, 결과는 y 단위(없으면 무차원)', () => {
    const t = { tables: { curve: { x: [0, 1], y: [1, 2], xUnit: '명', yUnit: '태스크/일' } } }
    expect(errors(aux('GRAPH(staff, curve)', '태스크/일', t))).toEqual([])
    expect(of(aux('GRAPH(tau, curve)', '태스크/일', t), 'unit-argument')).toHaveLength(1)
    expect(of(aux('GRAPH(staff, curve)', '명', t), 'unit-declared')).toHaveLength(1)
    const plain = { tables: { c2: { x: [0, 1], y: [1, 2] } } }
    expect(errors(aux('GRAPH(ratio, c2)', '비율', plain))).toEqual([])
    expect(of(aux('GRAPH(staff, c2)', '비율', plain), 'unit-argument')).toHaveLength(1)
    expect(errors(aux('GRAPH(ratio, [0, 1], [3, 4])', '비율'))).toEqual([]) // 인라인은 무차원
    expect(of(aux('GRAPH(ratio, [0, 1], [3, 4])', '명'), 'unit-declared')).toHaveLength(1)
  })
})

describe('Level의 유입·유출과 초기값', () => {
  it('유입·유출은 Level 단위/일이어야 한다(Level과 흐름 양쪽 위치를 알린다)', () => {
    const bad = base({ rates: { done: { expr: 'staff', unit: '명' } } })
    const [i] = of(bad, 'unit-flow')
    expect(i).toMatchObject({ severity: 'error', variable: 'work', field: 'outflows' })
    expect(i?.message).toContain('태스크/일')
    expect(errors(base({ levels: { work: { init: '100', inflows: ['done'], outflows: [], unit: '태스크' } } }))).toEqual([])
    expect(of(base({ levels: { work: { init: '100', inflows: ['done'], outflows: [], unit: '명' } } }), 'unit-flow')).toHaveLength(1)
  })
  it('인원(명)이 Level이고 흐름이 명/일이면 통과한다', () => {
    const def = base({ levels: { crew: { init: 'staff', inflows: ['hire'], outflows: [], unit: '명' } }, rates: { hire: { expr: 'staff / tau', unit: '명/일' } } })
    expect(errors(def)).toEqual([])
  })
  it('초기값 수식의 단위가 Level 단위와 다르면 오류다', () => {
    expect(of(base({ levels: { work: { init: 'staff', inflows: [], outflows: ['done'], unit: '태스크' } } }), 'unit-init')).toHaveLength(1)
    expect(errors(base({ levels: { work: { init: 'staff * prod * tau', inflows: [], outflows: ['done'], unit: '태스크' } } }))).toEqual([])
    expect(errors(base({ levels: { work: { init: '100', inflows: [], outflows: ['done'], unit: '태스크' } } }))).toEqual([]) // 숫자는 단위 미정
  })
})

describe('선언·추론·제안', () => {
  it('선언이 없으면 추론한 단위를 제안한다(정보)', () => {
    const [s] = of(aux('staff * prod'), 'unit-suggest')
    expect(s).toMatchObject({ severity: 'info', variable: 'a', suggestion: '태스크/일' })
    expect(of(aux('staff * prod'), 'unit-missing')).toHaveLength(1)
  })
  it('선언이 없는 변수를 다른 수식이 쓰면 그 변수의 수식에서 추론해 이어 간다', () => {
    const def = base({ auxiliaries: { a: { expr: 'staff * prod' }, b: { expr: 'a * tau', unit: '태스크' } } })
    expect(errors(def)).toEqual([])
    const wrong = base({ auxiliaries: { a: { expr: 'staff * prod' }, b: { expr: 'a * tau', unit: '명' } } })
    expect(of(wrong, 'unit-declared')).toHaveLength(1)
  })
  it('단위를 알 수 없는 변수를 쓰면 경고(추론 불가)이고 오류로 단정하지 않는다', () => {
    const def = base({ constants: { ...base().constants, mystery: { value: 1 } }, auxiliaries: { a: { expr: 'mystery * 2', unit: '명' } } })
    const w = of(def, 'unit-unresolved')
    expect(w).toHaveLength(1)
    expect(w[0]).toMatchObject({ severity: 'warning', variable: 'a' })
    expect(w[0]?.message).toContain('mystery')
    expect(errors(def)).toEqual([])
    // 알려진 쪽과 더하면 알려진 쪽 단위로 이어 간다
    expect(errors(base({ constants: { ...base().constants, mystery: { value: 1 } }, auxiliaries: { a: { expr: 'mystery + staff', unit: '명' } } }))).toEqual([])
  })
  it('읽을 수 없는 단위 문자열은 경고', () => {
    const [w] = of(base({ constants: { ...base().constants, bad: { value: 1, unit: '일//명' } } }), 'unit-parse')
    expect(w).toMatchObject({ severity: 'warning', variable: 'bad', field: 'unit' })
  })
  it('Level에 단위가 없으면 연결된 흐름에서 추론해 제안한다', () => {
    const [s] = of(base({ levels: { work: { init: '100', inflows: [], outflows: ['done'] } } }), 'unit-suggest')
    expect(s).toMatchObject({ variable: 'work', suggestion: '태스크' })
  })
  it('문법이 틀린 수식은 건너뛴다(lintModel이 알린다)', () => {
    expect(errors(aux('staff +', '명'))).toEqual([])
  })
  it('사용자 별칭(`units`)과 테이블 단위가 스키마를 통과하고 검사에 쓰인다', () => {
    const def = parseModelDef({
      ...base({ constants: { crew: { value: 2, unit: '인월' }, months: { value: 3, unit: '월' } } }),
      units: { aliases: { 인월: '명·월' } },
      tables: { t: { x: [0, 1], y: [0, 1], xUnit: '월', yUnit: '명' } },
      auxiliaries: { a: { expr: 'GRAPH(months, t)', unit: '명' }, b: { expr: 'crew / months', unit: '명' } },
      levels: {},
      rates: {}
    })
    expect(errors(def)).toEqual([])
    expect(of(parseModelDef({ ...def, auxiliaries: { b: { expr: 'crew / months', unit: '일' } } }), 'unit-declared')).toHaveLength(1)
  })
  it('결과 순서는 입력이 같으면 같다', () => {
    const def = aux('staff + tau', '명')
    expect(checkModelUnits(def)).toEqual(checkModelUnits(JSON.parse(JSON.stringify(def)) as ModelDef))
  })
})
