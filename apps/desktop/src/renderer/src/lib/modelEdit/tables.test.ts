import { describe, expect, it } from 'vitest'
import { compileModel, interpolate, lintErrors, lintModel, runModel, type ModelDef } from '@spd/sd-engine'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { setField, type EditResult } from './commands'
import { addTable, analyzeCurve, applyCurveShape, CURVE_SHAPES, deleteTable, findInlineGraphs, inlineToTables, insertTablePoint, removeTablePoint, renameTable, resampleTable, setTable, setTablePoint, setTableUnits, sortTable, tableNameProblem, tableUsage } from './tables'

const NOW = new Date('2026-10-23T00:00:00.000Z')
const docOf = (id: string): ModelDoc => {
  const v = validateModelDoc(docFromBuiltin(catalog.find((m) => m.id === id)!, { now: NOW, random: () => 0.3 }))
  if (!v.ok) throw new Error(v.message)
  return v.doc
}
const must = (r: EditResult): ModelDoc => {
  if (!r.ok) throw new Error(r.message)
  return r.doc
}
const run = (d: ModelDoc) => runModel(compileModel(d.def), { overrides: Object.fromEntries(Object.entries(d.def.constants).map(([n, c]) => [n, c.value])) })

/** 작은 모델: 입력 x(Level)에 따라 GRAPH 두 개(이름 있는 테이블 t, 인라인)가 영향을 준다 */
const small = (): ModelDoc => {
  const def: ModelDef = {
    meta: { id: 'user-t-00000001', name: 't', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 20, dt: 0.5 },
    constants: { k: { value: 1, unit: '비율' } },
    levels: { x: { init: '0', inflows: ['grow'], outflows: [], unit: '비율' } },
    rates: { grow: { expr: 'GRAPH(x, t) * 0.1 + GRAPH(k, [0, 1, 2], [0, 5, 6]) * 0', unit: '비율/일' } },
    auxiliaries: { shape: { expr: 'GRAPH(x, [-1, 0, 1], [3, 2, 1])', unit: '비율' }, other: { expr: 'GRAPH(x, t)', unit: '비율' } },
    tables: { t: { x: [0, 1, 2], y: [1, 1, 0.5] } },
    outputs: ['shape', 'other']
  }
  const v = validateModelDoc({
    docVersion: 1,
    def: def as unknown as Record<string, unknown>,
    info: { description: '', createdAt: NOW.toISOString() },
    view: { positions: {}, sectors: [], notes: [] },
    spec: { params: [{ name: 'k', group: 'g', min: 0, max: 5, step: 1 }], kpis: [], presets: [] }
  })
  if (!v.ok) throw new Error(v.message)
  return v.doc
}

describe('테이블 편집', () => {
  it('테이블을 더한다(곡선 모양, 이름 자동·직접, 규칙·최대 개수)', () => {
    let d = must(addTable(small()))
    expect(d.def.tables['curve']).toEqual({ x: [0, 1, 2], y: [0, 1, 2] })
    d = must(addTable(d, undefined, 's-down'))
    expect(Object.keys(d.def.tables)).toEqual(['t', 'curve', 'curve_2'])
    expect(d.def.tables['curve_2']?.y[0]).toBe(2)
    expect(addTable(d, 'k').ok).toBe(false) // 변수 이름과 겹침
    expect(addTable(d, 't').ok).toBe(false) // 테이블 이름과 겹침
    expect(addTable(d, '1x').ok).toBe(false)
    expect(addTable(d, 'z', 'nope').ok).toBe(false)
    let many = small()
    for (let i = 0; i < 49; i++) many = must(addTable(many))
    expect(Object.keys(many.def.tables)).toHaveLength(50)
    expect(addTable(many).ok).toBe(false)
  })

  it('이름 바꾸기: GRAPH(x, 이름)을 모두 고치고 같은 이름의 변수는 건드리지 않는다', () => {
    const d = must(renameTable(small(), 't', 'shape_curve'))
    expect(Object.keys(d.def.tables)).toEqual(['shape_curve'])
    expect(d.def.rates['grow']?.expr).toContain('GRAPH(x, shape_curve)')
    expect(d.def.auxiliaries['other']?.expr).toBe('GRAPH(x, shape_curve)')
    expect(lintErrors(lintModel(d.def))).toEqual([])
    expect(renameTable(small(), 't', 'k').ok).toBe(false)
    expect(renameTable(small(), 'nope', 'z').ok).toBe(false)
    expect(renameTable(small(), 't', 'x').ok).toBe(false) // 변수 이름
    // 결과는 그대로
    const a = run(small())
    const b = run(d)
    for (const [n, s] of Object.entries(a.series)) expect(Array.from(b.series[n] as Float64Array)).toEqual(Array.from(s))
  })

  it('지우기: 쓰는 수식이 있으면 거절하고 목록을 알린다', () => {
    const r = deleteTable(small(), 't')
    expect(!r.ok && r.message).toMatch(/'grow', 'other'/)
    expect(tableUsage(small().def, 't')).toEqual(['grow', 'other'])
    const d = must(addTable(small(), 'spare'))
    expect(Object.keys(must(deleteTable(d, 'spare')).def.tables)).toEqual(['t'])
    expect(deleteTable(small(), 'nope').ok).toBe(false)
  })

  it('점 하나 수정: 순서가 어긋나면 거절하고(정렬 안내), sort이면 자동으로 정렬한다', () => {
    const d = must(setTablePoint(small(), 't', 1, { y: 0.9 }))
    expect(d.def.tables['t']).toEqual({ x: [0, 1, 2], y: [1, 0.9, 0.5] })
    const bad = setTablePoint(small(), 't', 0, { x: 5 })
    expect(!bad.ok && bad.message).toMatch(/오름차순/)
    expect(!bad.ok && bad.message).toMatch(/정렬/)
    const sorted = must(setTablePoint(small(), 't', 0, { x: 5 }, true))
    expect(sorted.def.tables['t']).toEqual({ x: [1, 2, 5], y: [1, 0.5, 1] })
    expect(setTablePoint(small(), 't', 1, { x: 0 }).ok).toBe(false) // 겹침
    expect(setTablePoint(small(), 't', 9, { x: 0 }).ok).toBe(false)
    expect(setTablePoint(small(), 't', 0, { y: NaN }).ok).toBe(false)
    expect(setTablePoint(small(), 'nope', 0, { y: 1 }).ok).toBe(false)
  })

  it('점 더하기·지우기·균등 분할·정렬', () => {
    let d = must(insertTablePoint(small(), 't', 0))
    expect(d.def.tables['t']).toEqual({ x: [0, 0.5, 1, 2], y: [1, 1, 1, 0.5] }) // 가운데 x, 보간한 y
    d = must(insertTablePoint(d, 't', 3)) // 마지막 점 뒤
    expect((d.def.tables['t']?.x ?? []).length).toBe(5)
    expect(d.def.tables['t']?.x[4]).toBeGreaterThan(2)
    d = must(removeTablePoint(d, 't', 1))
    expect(d.def.tables['t']?.x).toEqual([0, 1, 2, 3])
    let two = must(setTable(small(), 't', [0, 1], [0, 1]))
    expect(removeTablePoint(two, 't', 0).ok).toBe(false) // 2개 밑으로는 못 줄인다
    two = must(resampleTable(small(), 't', 5))
    expect(two.def.tables['t']?.x).toEqual([0, 0.5, 1, 1.5, 2])
    expect(two.def.tables['t']?.y).toEqual([1, 1, 1, 0.75, 0.5]) // 선형 보간
    expect(resampleTable(small(), 't', 1).ok).toBe(false)
    expect(resampleTable(small(), 't', 101).ok).toBe(false)
    const bad = { ...small(), def: { ...small().def, tables: { t: { x: [2, 0, 1], y: [5, 6, 7] } } } }
    expect(must(sortTable(bad, 't')).def.tables['t']).toEqual({ x: [0, 1, 2], y: [6, 7, 5] })
  })

  it('점은 최대 100개, 모든 값은 유한한 수', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i)
    const d = must(setTable(small(), 't', xs, xs))
    expect(insertTablePoint(d, 't', 3).ok).toBe(false)
    expect(setTable(small(), 't', [...xs, 100], [...xs, 100]).ok).toBe(false)
    expect(setTable(small(), 't', [0, Infinity], [0, 1]).ok).toBe(false)
    expect(setTable(small(), 't', [0, 1], [0]).ok).toBe(false)
    expect(setTable(small(), 't', [0], [0]).ok).toBe(false)
  })

  it('단위: 입력·출력 단위를 정하고 비우면 없앤다. 단위 검사가 이를 쓴다', () => {
    let d = must(setTableUnits(small(), 't', { xUnit: ' 명 ', yUnit: '태스크' }))
    expect(d.def.tables['t']).toMatchObject({ xUnit: '명', yUnit: '태스크' })
    d = must(setTableUnits(d, 't', { xUnit: '' }))
    expect(d.def.tables['t']?.xUnit).toBeUndefined()
    expect(d.def.tables['t']?.yUnit).toBe('태스크')
    expect(setTableUnits(small(), 'nope', {}).ok).toBe(false)
  })

  it('곡선 모양은 모두 단조이고 기준점 x=1에서 y=1이다. 모양을 적용하면 점이 바뀐다', () => {
    for (const s of CURVE_SHAPES) {
      const a = analyzeCurve({ x: s.x, y: s.y })
      expect(['increasing', 'decreasing'], s.id).toContain(a.direction)
      expect(a.atOne, s.id).toBe(1)
      expect(a.advice, s.id).toEqual([])
    }
    const d = must(applyCurveShape(small(), 't', 's-up'))
    expect(d.def.tables['t']?.x).toEqual(CURVE_SHAPES.find((c) => c.id === 's-up')!.x)
    expect(applyCurveShape(small(), 't', 'nope').ok).toBe(false)
  })
})

describe('곡선 권고 (책 2.6.3)', () => {
  it('단조가 아니면 경고하고 방향이 바뀌는 점을 알린다', () => {
    const a = analyzeCurve({ x: [0, 1, 2, 3], y: [0, 2, 1, 3] })
    expect(a.direction).toBe('non-monotone')
    expect(a.turns).toEqual([1, 2])
    expect(a.advice[0]).toMatchObject({ severity: 'warning' })
    expect(a.advice[0]?.message).toContain('단조가 아닙니다')
  })
  it('기준점 x=1에서 y가 1이 아니면 정보, x 범위가 1을 지나지 않으면 말하지 않는다', () => {
    const a = analyzeCurve({ x: [0, 2], y: [0, 4] })
    expect(a.atOne).toBe(2)
    expect(a.advice.map((x) => x.severity)).toEqual(['info'])
    expect(a.advice[0]?.message).toContain('기준점(x = 1)')
    expect(analyzeCurve({ x: [2, 3], y: [1, 2] }).atOne).toBeNull()
    expect(analyzeCurve({ x: [2, 3], y: [1, 2] }).advice).toEqual([])
  })
  it('상수 함수와 입력에 단위가 있을 때(정규화 권고)', () => {
    expect(analyzeCurve({ x: [0, 1], y: [1, 1] }).direction).toBe('flat')
    expect(analyzeCurve({ x: [0, 1], y: [1, 1] }).advice.some((x) => x.message.includes('상수 함수'))).toBe(true)
    const withUnit = analyzeCurve({ x: [0, 1], y: [0, 1], xUnit: '명' })
    expect(withUnit.advice.some((x) => x.message.includes('정규화'))).toBe(true)
    expect(analyzeCurve({ x: [0, 1], y: [0, 1], xUnit: '비율' }).advice).toEqual([])
  })
  it('엔진의 보간 규칙과 같은 값을 쓴다(범위 밖은 양 끝값)', () => {
    const f = interpolate({ x: [0, 1, 2], y: [1, 1, 0.5] })
    expect(f(-5)).toBe(1)
    expect(f(1.5)).toBe(0.75)
    expect(f(9)).toBe(0.5)
  })
})

describe('인라인 GRAPH → 테이블', () => {
  it('인라인 호출을 찾는다(위치, 좌표, 수식 전체인지)', () => {
    const g = findInlineGraphs(small().def)
    expect(g.map((x) => [x.variable, x.x, x.y, x.whole])).toEqual([
      ['grow', [0, 1, 2], [0, 5, 6], false],
      ['shape', [-1, 0, 1], [3, 2, 1], true]
    ])
    const src = small().def.auxiliaries['shape']!.expr
    expect(src.slice(g[1]!.start, g[1]!.end)).toBe('[-1, 0, 1], [3, 2, 1]')
  })

  it('음수·식으로 쓴 좌표도 읽고, 상수가 아닌 좌표는 건너뛴다', () => {
    const d = must(setField(small(), 'shape', { field: 'expr', value: 'GRAPH(x, [-0.5, 0, 0.5 * 2], [1 - 2, 2, 3 / 1]) + GRAPH(x, [0, k], [1, 2])' }))
    const g = findInlineGraphs(d.def).filter((x) => x.variable === 'shape')
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ x: [-0.5, 0, 1], y: [-1, 2, 3], whole: false })
  })

  it('한 변수만 / 전부 바꾸고, 수식이 GRAPH 하나뿐이고 단위가 있으면 yUnit을 적는다. 결과는 비트 단위로 같다', () => {
    const before = run(small())
    const one = must(inlineToTables(small(), 'shape'))
    expect(one.def.auxiliaries['shape']?.expr).toBe('GRAPH(x, shape_curve)')
    expect(one.def.tables['shape_curve']).toEqual({ x: [-1, 0, 1], y: [3, 2, 1], yUnit: '비율' })
    expect(findInlineGraphs(one.def).map((g) => g.variable)).toEqual(['grow'])
    const all = must(inlineToTables(small()))
    expect(findInlineGraphs(all.def)).toEqual([])
    expect(all.def.rates['grow']?.expr).toBe('GRAPH(x, t) * 0.1 + GRAPH(k, grow_curve) * 0')
    expect(all.def.tables['grow_curve']).toEqual({ x: [0, 1, 2], y: [0, 5, 6] }) // 수식이 GRAPH 하나가 아니라 단위를 적지 않는다
    expect(lintErrors(lintModel(all.def))).toEqual([])
    const after = run(all)
    for (const [n, s] of Object.entries(before.series)) expect(Array.from(after.series[n] as Float64Array), n).toEqual(Array.from(s))
  })

  it('테이블 이름이 겹치면 _2를 붙인다. 바꿀 것이 없으면 거절한다', () => {
    const d = must(addTable(small(), 'shape_curve'))
    expect(Object.keys(must(inlineToTables(d, 'shape')).def.tables)).toContain('shape_curve_2')
    expect(inlineToTables(must(inlineToTables(small()))).ok).toBe(false)
    expect(inlineToTables(small(), 'k').ok).toBe(false)
  })

  it('한 수식 안의 여러 인라인 GRAPH도 뒤에서부터 바꿔 모두 맞게 바꾼다', () => {
    const d = must(setField(small(), 'shape', { field: 'expr', value: 'GRAPH(x, [0, 1], [5, 6]) + GRAPH(x, [0, 2], [7, 8])' }))
    const r = must(inlineToTables(d, 'shape'))
    expect(r.def.auxiliaries['shape']?.expr).toBe('GRAPH(x, shape_curve) + GRAPH(x, shape_curve_2)')
    expect(r.def.tables['shape_curve']).toEqual({ x: [0, 1], y: [5, 6] })
    expect(r.def.tables['shape_curve_2']).toEqual({ x: [0, 2], y: [7, 8] })
  })

  it('통합 프로젝트 모델: 남은 인라인 GRAPH를 모두 표로 바꿔도 모든 변수의 시계열이 비트 단위로 같다 (M4 수용 기준)', () => {
    const doc = docOf('integrated-project')
    const inline = findInlineGraphs(doc.def)
    expect(inline.length).toBeGreaterThanOrEqual(5)
    const r = must(inlineToTables(doc))
    expect(findInlineGraphs(r.def)).toEqual([])
    expect(Object.keys(r.def.tables).length).toBe(Object.keys(doc.def.tables).length + inline.length)
    expect(lintErrors(lintModel(r.def))).toEqual([])
    const a = run(doc)
    const b = run(r)
    for (const [n, s] of Object.entries(a.series)) expect(Array.from(b.series[n] as Float64Array), n).toEqual(Array.from(s))
  })

  it('테이블 이름 규칙', () => {
    expect(tableNameProblem(small().def, 'ok_1')).toBeNull()
    expect(tableNameProblem(small().def, '1a')).not.toBeNull()
    expect(tableNameProblem(small().def, 't')).toMatch(/이미/)
    expect(tableNameProblem(small().def, 't', 't')).toBeNull() // 자기 이름은 허용
    expect(tableNameProblem(small().def, 'k')).toMatch(/변수/)
  })
})
