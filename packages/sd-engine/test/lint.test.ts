import { describe, expect, it } from 'vitest'
import { compileModel, findReferences, lintErrors, lintModel, renameTableInExpr, renameVariableInExpr, type LintIssue, type ModelDef } from '../src'

const base = (over: Partial<ModelDef> = {}): ModelDef => ({
  meta: { id: 'm', name: 'm', version: 1, timeUnit: 'day' },
  time: { start: 0, end: 10, dt: 1 },
  constants: { k: { value: 2 } },
  levels: { x: { init: '0', inflows: ['r'], outflows: [] } },
  rates: { r: { expr: 'k' } },
  auxiliaries: {},
  tables: {},
  outputs: [],
  ...over
})

const compiles = (def: ModelDef): boolean => {
  try {
    compileModel(def)
    return true
  } catch {
    return false
  }
}
const codes = (issues: LintIssue[]) => issues.map((i) => i.code)
const errs = (def: ModelDef) => lintErrors(lintModel(def))
const only = (def: ModelDef, code: string) => lintModel(def).filter((i) => i.code === code)

describe('lintModel: 오류', () => {
  it('올바른 모델은 오류가 없다', () => {
    expect(errs(base())).toEqual([])
  })

  it('이름: 규칙 위반·예약어·중복', () => {
    expect(codes(errs(base({ constants: { '1a': { value: 1 }, k: { value: 1 } } })))).toContain('name-invalid')
    expect(codes(errs(base({ constants: { 한글: { value: 1 }, k: { value: 1 } } })))).toContain('name-invalid')
    expect(only(base({ constants: { TIME: { value: 1 }, k: { value: 1 } } }), 'name-reserved')[0]).toMatchObject({ severity: 'error', variable: 'TIME', field: 'name' })
    expect(codes(errs(base({ auxiliaries: { DT: { expr: '1' } } })))).toContain('name-reserved')
    const dup = errs(base({ auxiliaries: { k: { expr: '1' } } }))
    expect(dup.find((i) => i.code === 'name-duplicate')).toMatchObject({ variable: 'k' })
    expect(codes(errs(base({ rates: { r: { expr: '1' }, x: { expr: '2' } } })))).toContain('name-duplicate')
  })

  it('문법: 위치(글자 범위)가 정확하다', () => {
    const [i] = only(base({ rates: { r: { expr: '1 + * 2' } } }), 'syntax')
    expect(i).toMatchObject({ severity: 'error', variable: 'r', field: 'expr', range: [4, 5] })
    const [j] = only(base({ rates: { r: { expr: '(1 + 2' } } }), 'syntax')
    expect(j?.range?.[0]).toBe(6)
    expect(only(base({ rates: { r: { expr: '1 $ 2' } } }), 'syntax')[0]?.range?.[0]).toBe(2)
    expect(only(base({ levels: { x: { init: '1 +', inflows: ['r'], outflows: [] } } }), 'syntax')[0]).toMatchObject({ variable: 'x', field: 'init' })
  })

  it('정의되지 않은 변수: 이름 전체가 범위다', () => {
    const [i] = only(base({ rates: { r: { expr: 'k * potentail' } } }), 'undefined-variable')
    expect(i).toMatchObject({ variable: 'r', range: [4, 13] })
    expect(i?.message).toContain("'potentail'")
    expect(only(base({ levels: { x: { init: 'nope', inflows: ['r'], outflows: [] } } }), 'undefined-variable')[0]).toMatchObject({ variable: 'x', field: 'init', range: [0, 4] })
  })

  it('함수: 알 수 없음·인자 개수(IF·MAX·ROUND·SMOOTH·GRAPH)', () => {
    expect(only(base({ rates: { r: { expr: 'FOO(1) + k' } } }), 'unknown-function')[0]).toMatchObject({ range: [0, 3] })
    expect(only(base({ rates: { r: { expr: 'IF(1, 2)' } } }), 'arity')[0]?.message).toContain('3개')
    expect(only(base({ rates: { r: { expr: 'MAX()' } } }), 'arity')[0]?.message).toContain('1개 이상')
    expect(only(base({ rates: { r: { expr: 'ROUND(1, 2, 3)' } } }), 'arity')[0]?.message).toContain('1~2개')
    expect(only(base({ rates: { r: { expr: 'SMOOTH(k)' } } }), 'arity')).toHaveLength(1)
    expect(only(base({ rates: { r: { expr: 'DELAY3(k, 1, 2)' } } }), 'arity')).toHaveLength(1)
    expect(only(base({ rates: { r: { expr: 'GRAPH(k)' } } }), 'graph-form')).toHaveLength(1)
  })

  it('GRAPH: 정의되지 않은 테이블·테이블 이름 자리에 식·잘못된 인라인 배열', () => {
    expect(only(base({ rates: { r: { expr: 'GRAPH(k, nothing)' } } }), 'undefined-table')[0]).toMatchObject({ range: [9, 16] })
    expect(only(base({ rates: { r: { expr: 'GRAPH(k, 1 + 2)' } } }), 'graph-form')).toHaveLength(1)
    expect(only(base({ rates: { r: { expr: 'GRAPH(k, [0, 1], [1])' } } }), 'table-invalid')[0]?.message).toContain('개수')
    expect(only(base({ rates: { r: { expr: 'GRAPH(k, [1, 0], [1, 2])' } } }), 'table-invalid')[0]?.message).toContain('오름차순')
    expect(only(base({ rates: { r: { expr: 'GRAPH(k, [0, k], [1, 2])' } } }), 'array-value')).toHaveLength(1)
    expect(only(base({ rates: { r: { expr: 'GRAPH(k, 5, [1, 2])' } } }), 'array-value')).toHaveLength(1)
  })

  it('배열은 GRAPH 밖에서 쓸 수 없다', () => {
    expect(only(base({ rates: { r: { expr: '[1, 2] + k' } } }), 'array-misplaced')[0]).toMatchObject({ range: [0, 1] })
    expect(only(base({ rates: { r: { expr: 'MAX([1], k)' } } }), 'array-misplaced')).toHaveLength(1)
  })

  it('테이블 참조는 참조될 때 검사한다(잘못된 테이블 + 사용)', () => {
    const def = base({ tables: { t: { x: [0, 0], y: [1, 2] } }, rates: { r: { expr: 'GRAPH(k, t)' } } })
    expect(only(def, 'table-invalid')[0]?.message).toContain('오름차순')
  })

  it('초기값에 SMOOTH·DELAY를 쓸 수 없다', () => {
    expect(only(base({ levels: { x: { init: 'SMOOTH(k, 2)', inflows: ['r'], outflows: [] } } }), 'init-delay')[0]).toMatchObject({ variable: 'x', field: 'init' })
    expect(only(base({ levels: { x: { init: '1 + DELAY3(k, 2)', inflows: ['r'], outflows: [] } } }), 'init-delay')).toHaveLength(1)
  })

  it('Level의 유입·유출: 정의되지 않음·종류가 틀림', () => {
    expect(only(base({ levels: { x: { init: '0', inflows: ['nope'], outflows: [] } } }), 'flow-undefined')[0]).toMatchObject({ variable: 'x', field: 'inflows' })
    expect(only(base({ levels: { x: { init: '0', inflows: ['r'], outflows: ['k'] } } }), 'flow-kind')[0]).toMatchObject({ variable: 'x', field: 'outflows' })
    expect(only(base({ levels: { x: { init: '0', inflows: ['x'], outflows: [] } } }), 'flow-kind')).toHaveLength(1)
  })

  it('outputs·불변식의 이름', () => {
    expect(only(base({ outputs: ['x', 'ghost'] }), 'output-undefined')[0]).toMatchObject({ variable: 'ghost', field: 'outputs' })
    const inv = { name: 'a', label: 'a', lhs: [{ variable: 'x', coef: 1 }], rhs: [{ variable: 'ghost', coef: 1 }], tolerance: 1e-9 }
    expect(only(base({ invariants: [inv] }), 'invariant-undefined')[0]).toMatchObject({ variable: 'ghost' })
    expect(only(base({ invariants: [inv, inv] }), 'invariant-duplicate')).toHaveLength(1)
  })

  it('순환: 경로를 a → b → a로 알린다. Level이나 SMOOTH가 끊으면 오류가 아니다', () => {
    const cyc = base({ auxiliaries: { a: { expr: 'b + 1' }, b: { expr: 'a * 2' } } })
    const [c] = only(cyc, 'cycle')
    expect(c?.cycle).toEqual(['a', 'b', 'a'])
    expect(c?.message).toContain('a → b → a')
    expect(only(base({ auxiliaries: { a: { expr: 'a + 1' } } }), 'cycle')[0]?.cycle).toEqual(['a', 'a'])
    expect(errs(base({ auxiliaries: { a: { expr: 'SMOOTH(b, 2)' }, b: { expr: 'a * 2' } } }))).toEqual([])
    expect(errs(base({ auxiliaries: { a: { expr: 'x * 2' } }, rates: { r: { expr: 'a' } } }))).toEqual([])
  })

  it('초기값 계산의 순환', () => {
    const def = base({ levels: { x: { init: 'a', inflows: ['r'], outflows: [] } }, auxiliaries: { a: { expr: 'x + 1' } }, rates: { r: { expr: 'k' } } })
    expect(codes(errs(def))).toContain('init-cycle')
  })

  it('여러 문제를 한 번에 보고한다(첫 오류에서 멈추지 않는다)', () => {
    const def = base({
      constants: { k: { value: 1 }, '9z': { value: 1 } },
      rates: { r: { expr: 'k * nothing' }, q: { expr: '1 +' } },
      auxiliaries: { a: { expr: 'FOO(1)' } },
      levels: { x: { init: '0', inflows: ['r', 'ghost'], outflows: [] } },
      outputs: ['nope']
    })
    const found = new Set(codes(errs(def)))
    for (const c of ['name-invalid', 'undefined-variable', 'syntax', 'unknown-function', 'flow-undefined', 'output-undefined']) expect(found.has(c as never), c).toBe(true)
  })

  it('결과 순서는 입력이 같으면 같다', () => {
    const def = base({ rates: { r: { expr: 'nothing' } }, auxiliaries: { a: { expr: 'FOO(1)' } } })
    expect(lintModel(def)).toEqual(lintModel(JSON.parse(JSON.stringify(def)) as ModelDef))
  })
})

describe('lintModel: 경고', () => {
  it('쓰이지 않는 상수·Auxiliary·Rate, 그러나 Level은 아니다', () => {
    const def = base({ constants: { k: { value: 2 }, unused: { value: 1 } }, auxiliaries: { lonely: { expr: 'x' } } })
    const orphans = only(def, 'orphan').map((i) => i.variable)
    expect(orphans.sort()).toEqual(['lonely', 'unused'])
    expect(lintErrors(lintModel(def))).toEqual([])
    expect(orphans).not.toContain('x')
  })

  it('outputs·불변식·유입·다른 수식이 쓰면 쓰인 것이다', () => {
    const inv = { name: 'a', label: 'a', lhs: [{ variable: 'c2', coef: 1 }], rhs: [{ variable: 'c2', coef: 1 }], tolerance: 1 }
    const def = base({ constants: { k: { value: 2 }, c2: { value: 1 }, c3: { value: 1 } }, auxiliaries: { aux: { expr: 'k' } }, outputs: ['aux'], invariants: [inv] })
    expect(only(def, 'orphan').map((i) => i.variable)).toEqual(['c3'])
  })

  it('상수 Rate: 변수·시간·난수·GRAPH가 없을 때만', () => {
    expect(only(base({ rates: { r: { expr: '5' } } }), 'constant-rate')).toHaveLength(1)
    expect(only(base({ rates: { r: { expr: 'k' } } }), 'constant-rate')).toHaveLength(0)
    expect(only(base({ rates: { r: { expr: 'STEP(1, 5)' } } }), 'constant-rate')).toHaveLength(0)
    expect(only(base({ rates: { r: { expr: 'TIME * 2' } } }), 'constant-rate')).toHaveLength(0)
    expect(only(base({ rates: { r: { expr: 'RANDOM_UNIFORM(0, 1)' } } }), 'constant-rate')).toHaveLength(0)
  })

  it('유입·유출이 없는 Level, 상쇄되는 흐름, 쓰이지 않는 테이블, 연산자와 같은 이름', () => {
    expect(only(base({ levels: { x: { init: '0', inflows: [], outflows: [] } } }), 'level-no-flow')).toHaveLength(1)
    expect(only(base({ levels: { x: { init: '0', inflows: ['r'], outflows: ['r'] } } }), 'flow-duplicate')).toHaveLength(1)
    expect(only(base({ tables: { t: { x: [0, 1], y: [0, 1] } } }), 'table-unused')).toHaveLength(1)
    expect(only(base({ constants: { k: { value: 2 }, and: { value: 1 } } }), 'name-keyword-case')[0]?.severity).toBe('warning')
  })
})

describe('lintModel ⇔ compileModel (같은 규칙)', () => {
  const good = base({
    tables: { t: { x: [0, 1], y: [0, 1] } },
    constants: { k: { value: 2 }, tau: { value: 3 } },
    auxiliaries: { a: { expr: 'GRAPH(x / 10, t) + SMOOTH(k, tau)' }, b: { expr: 'IF(a > 1, MAX(a, 2), MIN(a, ROUND(k, 1)))' } },
    rates: { r: { expr: 'a * b' } },
    outputs: ['a']
  })
  const mutations: [string, (d: ModelDef) => ModelDef][] = [
    ['정상', (d) => d],
    ['수식 문법', (d) => ({ ...d, rates: { r: { expr: 'a *' } } })],
    ['없는 변수', (d) => ({ ...d, rates: { r: { expr: 'a * zz' } } })],
    ['없는 함수', (d) => ({ ...d, rates: { r: { expr: 'FOO(a)' } } })],
    ['인자 수', (d) => ({ ...d, auxiliaries: { ...d.auxiliaries, b: { expr: 'IF(1)' } } })],
    ['순환', (d) => ({ ...d, auxiliaries: { ...d.auxiliaries, a: { expr: 'b' }, b: { expr: 'a' } } })],
    ['지연으로 끊은 순환', (d) => ({ ...d, auxiliaries: { ...d.auxiliaries, a: { expr: 'SMOOTH(b, 2)' }, b: { expr: 'a' } } })],
    ['없는 테이블', (d) => ({ ...d, auxiliaries: { ...d.auxiliaries, a: { expr: 'GRAPH(k, zz)' } } })],
    ['유입 없음', (d) => ({ ...d, levels: { x: { init: '0', inflows: ['zz'], outflows: [] } } })],
    ['유입이 상수', (d) => ({ ...d, levels: { x: { init: '0', inflows: ['k'], outflows: [] } } })],
    ['출력 없음', (d) => ({ ...d, outputs: ['zz'] })],
    ['초기값 지연', (d) => ({ ...d, levels: { x: { init: 'SMOOTH(k, 2)', inflows: ['r'], outflows: [] } } })],
    ['초기값 순환', (d) => ({ ...d, levels: { x: { init: 'a', inflows: ['r'], outflows: [] } } })],
    ['이름 중복', (d) => ({ ...d, auxiliaries: { ...d.auxiliaries, k: { expr: '1' } } })],
    ['예약어', (d) => ({ ...d, auxiliaries: { ...d.auxiliaries, TIME: { expr: '1' } } })]
  ]
  it.each(mutations)('%s: lint 오류가 있을 때만 컴파일이 실패한다', (_n, mutate) => {
    const def = mutate(good)
    expect(errs(def).length > 0, JSON.stringify(errs(def))).toBe(!compiles(def))
  })
})

describe('findReferences·renameVariableInExpr (이름 바꾸기)', () => {
  it('변수·함수·테이블을 구분하고 위치를 준다', () => {
    const r = findReferences('GRAPH(rate1 * 2, curve) + MAX(rate1, rate2)')
    expect(r.error).toBeNull()
    expect(r.refs.map((x) => [x.kind, x.name, x.start])).toEqual([
      ['function', 'GRAPH', 0],
      ['variable', 'rate1', 6],
      ['table', 'curve', 17],
      ['function', 'MAX', 26],
      ['variable', 'rate1', 30],
      ['variable', 'rate2', 37]
    ])
  })

  it('수식이 완성되지 않아도 토큰으로 추정한다', () => {
    const r = findReferences('MAX(a, b +')
    expect(r.error).not.toBeNull()
    expect(r.refs.map((x) => [x.kind, x.name])).toEqual([['function', 'MAX'], ['variable', 'a'], ['variable', 'b']])
    expect(findReferences('a $ b').refs).toEqual([])
  })

  it('이름 바꾸기는 토큰 단위다: rate와 rate2·함수 이름·테이블 이름은 건드리지 않는다', () => {
    expect(renameVariableInExpr('rate + rate2 + MAX(rate, 1)', 'rate', 'speed')).toEqual({ source: 'speed + rate2 + MAX(speed, 1)', count: 2 })
    expect(renameVariableInExpr('GRAPH(rate, rate)', 'rate', 'speed')).toEqual({ source: 'GRAPH(speed, rate)', count: 1 }) // 두 번째는 테이블 이름
    expect(renameVariableInExpr('MAX(a, 1)', 'MAX', 'zz').count).toBe(0)
    expect(renameVariableInExpr('1 + 2', 'a', 'b').count).toBe(0)
    expect(renameVariableInExpr('a +', 'a', 'bb')).toEqual({ source: 'bb +', count: 1 }) // 미완성 수식도 바꾼다
  })
})

describe('renameTableInExpr', () => {
  it('테이블 이름만 바꾸고 같은 이름의 변수는 건드리지 않는다', () => {
    expect(renameTableInExpr('GRAPH(curve, curve) + curve', 'curve', 'shape')).toEqual({ source: 'GRAPH(curve, shape) + curve', count: 1 })
    expect(renameTableInExpr('GRAPH(a, t1) + GRAPH(b, t1) + GRAPH(c, t2)', 't1', 'zz')).toEqual({ source: 'GRAPH(a, zz) + GRAPH(b, zz) + GRAPH(c, t2)', count: 2 })
    expect(renameTableInExpr('a + b', 't', 'u').count).toBe(0)
    expect(renameTableInExpr('GRAPH(a, [0, 1], [1, 2])', 't', 'u').count).toBe(0)
  })
})
