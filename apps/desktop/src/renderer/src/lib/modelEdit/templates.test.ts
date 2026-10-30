import { describe, expect, it } from 'vitest'
import { checkInvariants, checkModelUnits, compileModel, lintErrors, lintModel, runModel, type ModelDef } from '@spd/sd-engine'
import { catalog } from '../../catalog'
import { MODEL_LIMITS } from '../../../../shared/modelDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { addVariable, setField, type EditResult } from './commands'
import { allTemplates, GENERIC_TEMPLATES, insertTemplate, libraryTemplates, type Template } from './templates'

/** 변수가 하나도 없는 모델(시간 설정만 있다). 삽입한 결과를 원본과 같은 조건으로 실행해 비교한다. */
function emptyDoc(time: ModelDef['time'] = { start: 0, end: 100, dt: 0.5 }): ModelDoc {
  const v = validateModelDoc({
    docVersion: 1,
    def: { meta: { id: 'user-empty-00000001', name: '빈 모델', version: 1, timeUnit: 'day' }, time, constants: {}, levels: {}, rates: {}, auxiliaries: {}, tables: {}, outputs: [] } as unknown as Record<string, unknown>,
    info: { description: '', createdAt: '2026-10-23T00:00:00.000Z' },
    view: { positions: {}, sectors: [], notes: [] },
    spec: { params: [], kpis: [], presets: [] }
  })
  if (!v.ok) throw new Error(v.message)
  return v.doc
}
const must = (r: EditResult | { ok: true; doc: ModelDoc } | { ok: false; message: string }): ModelDoc => {
  if (!r.ok) throw new Error(r.message)
  return r.doc
}
const insert = (doc: ModelDoc, t: Template, opts: Parameters<typeof insertTemplate>[2]) => {
  const r = insertTemplate(doc, t, opts)
  if (!r.ok) throw new Error(r.message)
  return r
}
const params = (d: ModelDoc) => Object.fromEntries(Object.entries(d.def.constants).map(([n, c]) => [n, c.value]))
const run = (d: ModelDoc, over: { end?: number } = {}) => runModel(compileModel(d.def), { overrides: params(d), ...over })
const last = (r: ReturnType<typeof run>, name: string) => (r.series[name] as Float64Array)[(r.series[name] as Float64Array).length - 1] as number
const template = (id: string) => allTemplates().find((t) => t.id === id)!
const GENERIC = GENERIC_TEMPLATES.map((t) => [t.id] as const)

describe('일반 흐름 과정·기반 구조 템플릿', () => {
  it('책 3.3의 9종과 3.4의 4종이 있다', () => {
    expect(GENERIC_TEMPLATES.filter((t) => t.group === 'generic').map((t) => t.id)).toEqual(['rate-level', 'flow-chain', 'compounding', 'draining', 'production', 'adjustment', 'coflow', 'split-flow', 'cyclic-loop'])
    expect(GENERIC_TEMPLATES.filter((t) => t.group === 'infra').map((t) => t.id)).toEqual(['s-growth', 'delay-1', 'delay-3', 'smooth'])
    for (const t of GENERIC_TEMPLATES) {
      expect(t.source, t.id).toMatch(/책 3\.\d/)
      expect(t.description.length, t.id).toBeGreaterThan(20)
      for (const p of t.ports) expect(p.name in t.elements.constants || p.name in t.elements.levels || p.name in t.elements.rates || p.name in t.elements.auxiliaries, `${t.id}:${p.name}`).toBe(true)
    }
  })

  it.each(GENERIC)('%s: 빈 모델에 삽입하면 구조 오류·단위 오류·경고가 없고 검증을 통과해 실행된다', (id) => {
    const t = template(id)
    const r = insert(emptyDoc(), t, { prefix: t.prefix })
    expect(r.inserted.length).toBeGreaterThan(0)
    expect(lintModel(r.doc.def)).toEqual([])
    expect(checkModelUnits(r.doc.def).filter((i) => i.severity !== 'info')).toEqual([])
    expect(validateModelDoc(r.doc).ok).toBe(true)
    const result = run(r.doc)
    for (const inv of checkInvariants(r.doc.def, result, params(r.doc))) expect(inv.violated, inv.label).toBe(false)
    expect(r.note).toContain('구조 오류 0건')
  })

  it('비율과 Level: Level은 흐름 × 시간만큼 쌓인다', () => {
    const d = insert(emptyDoc({ start: 0, end: 20, dt: 0.5 }), template('rate-level'), { prefix: 'a_' }).doc
    expect(last(run(d), 'a_stock')).toBeCloseTo(2 * 20, 9)
  })

  it('복리 과정: 지수 성장(오일러의 닫힌 형식과 같다)', () => {
    const d = insert(emptyDoc({ start: 0, end: 50, dt: 0.5 }), template('compounding'), { prefix: 'a_' }).doc
    expect(last(run(d), 'a_stock')).toBeCloseTo(10 * Math.pow(1 + 0.02 * 0.5, 100), 9)
  })

  it('배출 과정: 지수 감쇠', () => {
    const d = insert(emptyDoc({ start: 0, end: 40, dt: 0.5 }), template('draining'), { prefix: 'a_' }).doc
    expect(last(run(d), 'a_stock')).toBeCloseTo(100 * Math.pow(1 - 0.05 * 0.5, 80), 9)
  })

  it('조정 과정: 목표에 다가간다(처음엔 빠르고 점점 느려진다)', () => {
    const d = insert(emptyDoc({ start: 0, end: 200, dt: 0.5 }), template('adjustment'), { prefix: 'a_' }).doc
    const r = run(d)
    expect(last(r, 'a_stock')).toBeGreaterThan(99.99)
    const s = r.series['a_stock'] as Float64Array
    expect(s[2]! - s[0]!).toBeGreaterThan(s[202]! - s[200]!)
    expect(Math.max(...s)).toBeLessThanOrEqual(100)
  })

  it('생산 과정: 끝난 일 = 자원 × 생산성 × 시간', () => {
    const d = insert(emptyDoc({ start: 0, end: 20, dt: 0.5 }), template('production'), { prefix: 'a_' }).doc
    expect(last(run(d), 'a_tasks_completed')).toBeCloseTo(10 * 0.5 * 20, 9)
  })

  it('코플로: 종속 흐름 = 흐름 × 변환 계수', () => {
    const d = insert(emptyDoc({ start: 0, end: 30, dt: 0.5 }), template('coflow'), { prefix: 'a_' }).doc
    const r = run(d)
    expect(last(r, 'a_coflow_total')).toBeCloseTo(0.5 * last(r, 'a_host_total'), 9)
  })

  it('흐름 체인·분할 흐름·순환 고리는 보존적이다(선언한 불변식을 지킨다)', () => {
    for (const id of ['flow-chain', 'split-flow', 'cyclic-loop']) {
      const t = template(id)
      const d = insert(emptyDoc({ start: 0, end: 150, dt: 0.25 }), t, { prefix: t.prefix }).doc
      const checks = checkInvariants(d.def, run(d), params(d))
      expect(checks.length, id).toBe(1)
      expect(checks[0]!.violated, id).toBe(false)
    }
  })

  it('분할 흐름은 갈래의 비율대로 나뉘고, 순환 고리는 되돌아간 만큼 오래 걸린다', () => {
    const sf = insert(emptyDoc({ start: 0, end: 300, dt: 0.25 }), template('split-flow'), { prefix: 's_' }).doc
    const r = run(sf)
    expect(last(r, 's_output_1') / last(r, 's_output_2')).toBeCloseTo(0.7 / 0.3, 3)
    const cl = insert(emptyDoc({ start: 0, end: 400, dt: 0.25 }), template('cyclic-loop'), { prefix: 'c_' }).doc
    const slow = runModel(compileModel(cl.def), { overrides: { ...params(cl), c_rework_fraction: 0.5 } })
    const fast = runModel(compileModel(cl.def), { overrides: { ...params(cl), c_rework_fraction: 0 } })
    const reach = (res: typeof slow) => (res.series['c_accepted'] as Float64Array).findIndex((v) => v >= 99)
    expect(reach(slow)).toBeGreaterThan(reach(fast))
  })

  it('S자 성장은 용량을 넘지 않고 늘기만 하며, 지연·평활은 입력 신호를 늦게 따라간다', () => {
    const sg = insert(emptyDoc({ start: 0, end: 200, dt: 0.5 }), template('s-growth'), { prefix: 'a_' }).doc
    const s = run(sg).series['a_stock'] as Float64Array
    expect(Math.max(...s)).toBeLessThanOrEqual(1000)
    expect(last(run(sg), 'a_stock')).toBeGreaterThan(990)
    for (let i = 1; i < s.length; i++) expect(s[i]!).toBeGreaterThanOrEqual(s[i - 1]!)
    const at = (id: string) => {
      const d = insert(emptyDoc({ start: 0, end: 60, dt: 0.25 }), template(id), { prefix: 'a_' }).doc
      const r = run(d)
      const t = r.time
      const idx = (day: number) => Array.from(t).findIndex((x) => x >= day)
      const v = r.series['a_delayed'] as Float64Array
      return { early: v[idx(12)] as number, mid: v[idx(16)] as number, end: last(r, 'a_delayed') }
    }
    for (const id of ['delay-1', 'delay-3', 'smooth']) {
      const x = at(id)
      expect(x.early, id).toBeLessThan(10) // 신호(높이 10)보다 늦다
      expect(x.end, id).toBeGreaterThan(9.9)
      expect(x.mid, id).toBeGreaterThan(x.early)
    }
    expect(at('delay-3').early).toBeLessThan(at('delay-1').early) // 3차 지연이 시작이 더 늦다
  })
})

describe('라이브러리 모델 템플릿: 빈 모델에 삽입한 결과가 원본과 비트 단위로 같다 (M4 수용 기준)', () => {
  const lib = libraryTemplates().map((t) => [t.id] as const)
  it('내장 8개 모델 모두 템플릿이 있다(구조 5종 + 프로젝트 모델 3종)', () => {
    expect(libraryTemplates().filter((t) => t.group === 'structure')).toHaveLength(5)
    expect(libraryTemplates().filter((t) => t.group === 'project')).toHaveLength(3)
  })

  it.each(lib)('%s: 접두사 없이(같은 이름) 삽입하면 모든 변수의 시계열이 원본과 같다', (id) => {
    const entry = catalog.find((m) => `library:${m.id}` === id)!
    const doc = insert(emptyDoc(entry.def.time), template(id), { prefix: '', asSector: false }).doc
    expect(doc.def.time).toEqual(entry.def.time)
    const mine = runModel(compileModel(doc.def), { overrides: params(doc) })
    const original = runModel(compileModel(entry.def), { overrides: Object.fromEntries(Object.entries(entry.def.constants).map(([n, c]) => [n, c.value])) })
    expect(Object.keys(mine.series).sort()).toEqual(Object.keys(original.series).sort())
    for (const [n, s] of Object.entries(original.series)) expect(Array.from(mine.series[n] as Float64Array), n).toEqual(Array.from(s))
  })

  it.each(lib)('%s: 접두사를 붙여 삽입해도 이름만 달라질 뿐 값이 같고 불변식·테이블도 따라간다', (id) => {
    const entry = catalog.find((m) => `library:${m.id}` === id)!
    const doc = insert(emptyDoc(entry.def.time), template(id), { prefix: 'x_', asSector: false }).doc
    expect(lintErrors(lintModel(doc.def))).toEqual([])
    const mine = runModel(compileModel(doc.def), { overrides: params(doc) })
    const original = runModel(compileModel(entry.def), { overrides: Object.fromEntries(Object.entries(entry.def.constants).map(([n, c]) => [n, c.value])) })
    for (const [n, s] of Object.entries(original.series)) expect(Array.from(mine.series[`x_${n}`] as Float64Array), n).toEqual(Array.from(s))
    expect(Object.keys(doc.def.tables)).toEqual(Object.keys(entry.def.tables).map((n) => `x_${n}`))
    expect((doc.def.invariants ?? []).map((i) => i.name)).toEqual((entry.def.invariants ?? []).map((i) => `x_${i.name}`))
    for (const c of checkInvariants(doc.def, mine, params(doc))) expect(c.violated, c.label).toBe(false)
    expect(validateModelDoc(doc).ok).toBe(true)
  })

  it('상수의 범위는 라이브러리 모델의 입력 화면 범위를 따르고, 그룹 이름은 모델의 그룹을 쓴다', () => {
    const entry = catalog.find((m) => m.id === 'brooks')!
    const doc = insert(emptyDoc(entry.def.time), template('library:brooks'), { prefix: '', asSector: false }).doc
    for (const g of entry.groups) for (const p of g.params) expect(doc.spec.params.find((x) => x.name === p.name), p.name).toMatchObject({ min: p.min, max: p.max, step: p.step, group: g.title })
  })
})

describe('삽입 규칙', () => {
  const t = () => template('production')

  it('이름이 겹치면 거절하고 겹친 이름을 알린다(접두사로 피한다)', () => {
    const once = insert(emptyDoc(), t(), { prefix: 'a_' }).doc
    const r = insertTemplate(once, t(), { prefix: 'a_' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain('a_resources')
    expect(insertTemplate(once, t(), { prefix: 'b_' }).ok).toBe(true)
    const noPrefix = insertTemplate(must(addVariable(emptyDoc(), 'constant', 'resources')), t(), { prefix: '' })
    expect(noPrefix.ok).toBe(false)
  })

  it('테이블·불변식 이름도 겹침 검사에 들어간다', () => {
    const lib = template('library:learning-curve')
    const a = insert(emptyDoc(lib.elements.constants ? catalog.find((m) => m.id === 'learning-curve')!.def.time : undefined), lib, { prefix: 'p_' }).doc
    expect(insertTemplate(a, lib, { prefix: 'p_' }).ok).toBe(false)
    const withTable = { ...emptyDoc(), def: { ...emptyDoc().def, tables: { a_x: { x: [0, 1], y: [0, 1] } } } }
    const r = insertTemplate(withTable, { ...t(), elements: { ...t().elements, constants: { x: { value: 1 } } } }, { prefix: 'a_' })
    expect(r.ok).toBe(false)
  })

  it('접두사 규칙, 이름 길이 64자, 변수 한도', () => {
    expect(insertTemplate(emptyDoc(), t(), { prefix: '1a_' }).ok).toBe(false)
    expect(insertTemplate(emptyDoc(), t(), { prefix: 'a b' }).ok).toBe(false)
    expect(insertTemplate(emptyDoc(), t(), { prefix: 'p'.repeat(60) }).ok).toBe(false)
    let big = emptyDoc()
    for (let i = 0; i < MODEL_LIMITS.variables - 1; i++) big = must(addVariable(big, 'auxiliary', `v${i}`))
    const r = insertTemplate(big, t(), { prefix: 'a_' })
    expect(!r.ok && r.message).toMatch(new RegExp(`${MODEL_LIMITS.variables}개`))
  })

  it('시간 설정은 현재 모델의 것을 유지한다', () => {
    const base = emptyDoc({ start: 5, end: 33, dt: 0.125 })
    expect(insert(base, template('library:brooks'), { prefix: 'b_' }).doc.def.time).toEqual({ start: 5, end: 33, dt: 0.125 })
  })

  it('새 상수는 파라미터가 되고(범위 제안), 그룹은 템플릿 이름이다', () => {
    const d = insert(emptyDoc(), template('adjustment'), { prefix: 'a_' }).doc
    expect(d.spec.params.map((p) => p.name)).toEqual(['a_goal', 'a_adjustment_fraction', 'a_initial_amount'])
    expect(d.spec.params[0]).toMatchObject({ group: '조정 과정(Adjustment Process)', min: 10, max: 1000 })
    expect(d.spec.params[2]).toMatchObject({ min: 0, max: 1 }) // 값 0 → [0, 1]
  })

  it('그래프 변수 목록을 직접 고른 모델이면 새 변수도 그 목록에 더한다(없으면 그대로 모두)', () => {
    const base = emptyDoc()
    const picked = { ...base, spec: { ...base.spec, variables: [] } }
    const d = insert(picked, template('compounding'), { prefix: 'a_' }).doc
    expect(d.spec.variables?.map((v) => v.name)).toEqual(['a_stock', 'a_growth'])
    expect(d.spec.variables?.[0]?.unit).toBe('단위')
    expect(insert(base, template('compounding'), { prefix: 'a_' }).doc.spec.variables).toBeUndefined()
  })

  it('삽입한 변수를 템플릿 이름의 섹터로 묶는다(이름이 겹치면 번호, 끌 수 있다)', () => {
    let d = insert(emptyDoc(), template('compounding'), { prefix: 'a_' }).doc
    expect(d.view.sectors.map((s) => [s.name, s.members])).toEqual([['복리 과정(Compounding Process)', ['a_initial_amount', 'a_growth_fraction', 'a_stock', 'a_growth']]])
    d = insert(d, template('compounding'), { prefix: 'b_' }).doc
    expect(d.view.sectors.map((s) => s.name)).toEqual(['복리 과정(Compounding Process)', '복리 과정(Compounding Process) 2'])
    expect(insert(emptyDoc(), template('compounding'), { prefix: 'a_', asSector: false }).doc.view.sectors).toEqual([])
  })

  it('입력은 바뀌지 않는다(순수 함수)', () => {
    const base = emptyDoc()
    const before = JSON.stringify(base)
    insert(base, template('flow-chain'), { prefix: 'a_' })
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('포트 연결', () => {
  const base = (): ModelDoc => {
    let d = emptyDoc({ start: 0, end: 20, dt: 0.5 })
    d = must(addVariable(d, 'constant', 'team_size'))
    return must(setField(d, 'team_size', { field: 'value', value: 4 }))
  }

  it('입력 포트를 기존 변수에 연결하면 그 변수로 참조가 바뀌고 포트의 상수는 만들지 않는다', () => {
    const r = insert(base(), template('production'), { prefix: 'a_', connections: { resources: 'team_size' } })
    expect(r.doc.def.constants['a_resources']).toBeUndefined()
    expect(r.doc.spec.params.some((p) => p.name === 'a_resources')).toBe(false)
    expect(r.doc.def.rates['a_production_rate']?.expr).toBe('team_size * a_productivity')
    expect(r.inserted).not.toContain('a_resources')
    expect(r.note).toContain('포트 1개 연결')
    expect(lintErrors(lintModel(r.doc.def))).toEqual([])
    expect(last(run(r.doc), 'a_tasks_completed')).toBeCloseTo(4 * 0.5 * 20, 9) // team_size = 4
    expect(checkModelUnits(r.doc.def).filter((i) => i.severity === 'error' && i.variable === 'a_production_rate')).toEqual([]) // 명 × 태스크/맨데이
  })

  it('Auxiliary 포트(신호)를 기존 변수로 바꿔 지연·평활을 붙일 수 있다', () => {
    let d = base()
    d = must(addVariable(d, 'auxiliary', 'demand'))
    d = must(setField(d, 'demand', { field: 'expr', value: 'STEP(8, 5)' }))
    d = must(setField(d, 'demand', { field: 'unit', value: '단위' }))
    const r = insert(d, template('smooth'), { prefix: 's_', connections: { signal: 'demand' } })
    expect(r.doc.def.auxiliaries['s_signal']).toBeUndefined()
    expect(r.doc.def.auxiliaries['s_delayed']?.expr).toBe('SMOOTH(demand, s_delay_time)')
    expect(r.doc.def.outputs).toContain('s_delayed')
    expect(last(run(r.doc), 's_delayed')).toBeGreaterThan(7.5) // 8 × (1 − e^(−15/5)) ≈ 7.6
  })

  it('입력 포트가 아니거나, 상수·Auxiliary가 아니거나, 연결할 변수가 없으면 거절한다', () => {
    const t = template('production')
    expect(insertTemplate(base(), t, { prefix: 'a_', connections: { tasks_completed: 'team_size' } }).ok).toBe(false) // 출력 포트
    expect(insertTemplate(base(), t, { prefix: 'a_', connections: { nothing: 'team_size' } }).ok).toBe(false)
    expect(insertTemplate(base(), t, { prefix: 'a_', connections: { resources: 'ghost' } }).ok).toBe(false)
    const levelPort = { ...t, ports: [{ name: 'tasks_completed', role: 'input' as const, hint: '' }] }
    expect(insertTemplate(base(), levelPort, { prefix: 'a_', connections: { tasks_completed: 'team_size' } }).ok).toBe(false) // Level은 연결할 수 없다
  })

  it('단위 있는 변수(명)에 연결하면 템플릿의 일반 단위를 그 단위로 맞춰 단위 오류가 생기지 않는다', () => {
    let d = emptyDoc({ start: 0, end: 50, dt: 0.5 })
    d = must(addVariable(d, 'constant', 'target_staff'))
    d = must(setField(d, 'target_staff', { field: 'unit', value: '명' }))
    d = must(setField(d, 'target_staff', { field: 'value', value: 20 }))
    const r = insert(d, template('adjustment'), { prefix: 'a_', connections: { goal: 'target_staff' } })
    expect(r.note).toContain("단위 '단위'를 '명'(으)로 맞춤")
    expect(r.doc.def.levels['a_stock']?.unit).toBe('명')
    expect(r.doc.def.rates['a_adjustment']?.unit).toBe('명/일')
    expect(r.doc.def.constants['a_initial_amount']?.unit).toBe('명')
    expect(r.doc.def.constants['a_adjustment_fraction']?.unit).toBe('1/일') // 일반 단위가 없는 것은 그대로
    expect(r.doc.spec.variables).toBeUndefined()
    expect(checkModelUnits(r.doc.def).filter((i) => i.severity === 'error')).toEqual([])
    expect(r.note).toContain('단위 오류 0건')
    // 연결하지 않으면 일반 단위 그대로
    expect(insert(d, template('adjustment'), { prefix: 'b_' }).doc.def.levels['b_stock']?.unit).toBe('단위')
  })

  it('복합 단위나 단위가 없는 변수에 연결하면 일반 단위를 그대로 둔다', () => {
    let d = emptyDoc()
    d = must(addVariable(d, 'constant', 'fast'))
    d = must(setField(d, 'fast', { field: 'unit', value: '태스크/일' }))
    expect(insert(d, template('adjustment'), { prefix: 'a_', connections: { goal: 'fast' } }).doc.def.levels['a_stock']?.unit).toBe('단위')
    let e = emptyDoc()
    e = must(addVariable(e, 'constant', 'plain'))
    expect(insert(e, template('adjustment'), { prefix: 'a_', connections: { goal: 'plain' } }).doc.def.levels['a_stock']?.unit).toBe('단위')
  })

  it('연결한 포트가 불변식이나 출력에 있어도 깨지지 않는다', () => {
    const t = template('split-flow')
    const r = insert(base(), t, { prefix: 'a_', connections: { split_fraction: 'team_size' } })
    expect(r.doc.def.rates['a_out_1']?.expr).toContain('team_size')
    expect(lintErrors(lintModel(r.doc.def))).toEqual([])
  })
})
