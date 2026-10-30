import { describe, expect, it } from 'vitest'
import { compileModel, lintErrors, lintModel, runModel, type ModelDef } from '@spd/sd-engine'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { addVariable, changeFlowKind, deleteVariable, setUnitAliases, unitAliasesToText, kindOf, nameProblem, referencesTo, renameVariable, setField, setInfo, setMeta, suggestRange, syncSpec, uniqueName, variableNames, type EditResult } from './commands'

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
const params = (doc: ModelDoc) => Object.fromEntries(Object.entries(doc.def.constants).map(([n, c]) => [n, c.value]))
const run = (doc: ModelDoc) => runModel(compileModel(doc.def), { overrides: params(doc) })

/** 작은 모델: 상수 k, Level x(유입 r), Rate r = k * rate2_gain, Auxiliary rate2 */
const small = (): ModelDoc => {
  const def: ModelDef = {
    meta: { id: 'user-small-00000001', name: '작은', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 10, dt: 1 },
    constants: { k: { value: 2, unit: 'FP/일' }, rate_gain: { value: 3 } },
    levels: { x: { init: 'k', inflows: ['r'], outflows: ['rate2'], unit: 'FP' } },
    rates: { r: { expr: 'k * rate_gain + MAX(k, 1)' } },
    auxiliaries: { rate2: { expr: 'x / 10 + rate_gain * 0' }, shadow: { expr: 'GRAPH(x, rate)' } },
    tables: { rate: { x: [0, 100], y: [0, 1] } },
    outputs: ['x', 'rate2'],
    invariants: [{ name: 'inv', label: '보존', lhs: [{ variable: 'x', coef: 1 }], rhs: [{ variable: 'x', coef: 1 }], tolerance: 1e-6 }]
  }
  const v = validateModelDoc({
    docVersion: 1,
    def: def as unknown as Record<string, unknown>,
    info: { description: '', createdAt: NOW.toISOString() },
    view: { positions: { k: { x: 1, y: 2 } }, sectors: [{ id: 's', name: 'S', members: ['k', 'x'] }], notes: [] },
    spec: {
      params: [{ name: 'k', group: '입력', min: 0, max: 10, step: 1 }, { name: 'rate_gain', group: '입력', min: 0, max: 10, step: 1 }],
      variables: [{ name: 'x', label: 'x', unit: 'FP' }, { name: 'rate2', label: 'r2', unit: '' }],
      defaultVariable: 'x',
      completion: { variable: 'x', op: '>=', value: 50 },
      kpis: [{ id: 'fin', label: '끝', unit: '', kind: 'final', variable: 'x', better: 'none', group: 'cost', decimals: 0 }],
      staffVariable: 'rate2',
      evm: { totalTasks: { param: 'rate_gain' }, credits: [{ variable: 'x', label: '쌓인', weight: 1 }], effortVariable: 'rate2' },
      size: { param: 'k', unit: 'FP', slocPerUnit: null },
      presets: [{ label: '빠르게', overrides: { k: 4, rate_gain: 1 } }]
    }
  })
  if (!v.ok) throw new Error(v.message)
  return v.doc
}

describe('변수 추가', () => {
  it('종류마다 새 이름과 기본 내용으로 만든다(상수는 파라미터 정의도)', () => {
    let d = small()
    d = must(addVariable(d, 'constant'))
    expect(d.def.constants['new_constant']).toEqual({ value: 0 })
    expect(d.spec.params.find((p) => p.name === 'new_constant')).toMatchObject({ min: 0, max: 1 })
    d = must(addVariable(d, 'constant'))
    expect(Object.keys(d.def.constants)).toContain('new_constant_2')
    d = must(addVariable(d, 'level'))
    expect(d.def.levels['new_level']).toEqual({ init: '0', inflows: [], outflows: [] })
    d = must(addVariable(d, 'rate', 'speed'))
    expect(d.def.rates['speed']).toEqual({ expr: '0' })
    d = must(addVariable(d, 'auxiliary'))
    expect(d.def.auxiliaries['new_aux']).toEqual({ expr: '0' })
  })

  it('이름이 올바르지 않거나 겹치면 거절한다', () => {
    const d = small()
    for (const bad of ['1x', 'a b', '한글', 'TIME', 'and', 'k', 'rate']) {
      const r = addVariable(d, 'auxiliary', bad)
      expect(r.ok, bad).toBe(false)
    }
    expect(nameProblem(d.def, 'a'.repeat(65))).toMatch(/64자/)
  })

  it('입력 문서는 바뀌지 않는다', () => {
    const d = small()
    const before = JSON.stringify(d)
    addVariable(d, 'rate')
    renameVariable(d, 'k', 'kk')
    deleteVariable(d, 'shadow')
    expect(JSON.stringify(d)).toBe(before)
  })

  it('안 쓰는 이름 만들기', () => {
    const d = small()
    expect(uniqueName(d.def, 'k')).toBe('k_2')
    expect(uniqueName(d.def, 'rate')).toBe('rate_2') // 테이블 이름과도 겹치지 않는다
    expect(uniqueName(d.def, 'fresh')).toBe('fresh')
  })

  it('상수의 제안 범위', () => {
    expect(suggestRange(0)).toMatchObject({ min: 0, max: 1 })
    expect(suggestRange(5)).toMatchObject({ min: 0.5, max: 50 })
    expect(suggestRange(-5)).toMatchObject({ min: -50, max: -0.5 })
    expect(suggestRange(5).step).toBeGreaterThan(0)
  })
})

describe('이름 바꾸기: 모든 참조를 토큰 단위로 갱신', () => {
  it('수식·흐름·출력·불변식·spec·섹터·위치가 함께 바뀐다', () => {
    const d = must(renameVariable(small(), 'k', 'speed'))
    expect(d.def.constants['speed']).toBeDefined()
    expect(d.def.constants['k']).toBeUndefined()
    expect(Object.keys(d.def.constants)).toEqual(['speed', 'rate_gain']) // 순서 유지
    expect(d.def.levels['x']?.init).toBe('speed')
    expect(d.def.rates['r']?.expr).toBe('speed * rate_gain + MAX(speed, 1)')
    expect(d.spec.params.map((p) => p.name)).toEqual(['speed', 'rate_gain'])
    expect(d.spec.presets[0]?.overrides).toEqual({ speed: 4, rate_gain: 1 })
    expect(d.spec.size?.param).toBe('speed')
    expect(d.view.positions['speed']).toEqual({ x: 1, y: 2 })
    expect(d.view.sectors[0]?.members).toEqual(['speed', 'x'])
    expect(referencesTo(d, 'k')).toEqual([])
  })

  it('다른 종류도 바뀐다: Level(흐름·출력·불변식·spec)과 Auxiliary(유출·출력·spec)', () => {
    let d = must(renameVariable(small(), 'x', 'stock'))
    expect(Object.keys(d.def.levels)).toEqual(['stock'])
    expect(d.def.rates['r']?.expr).toBe('k * rate_gain + MAX(k, 1)')
    expect(d.def.auxiliaries['rate2']?.expr).toBe('stock / 10 + rate_gain * 0')
    expect(d.def.auxiliaries['shadow']?.expr).toBe('GRAPH(stock, rate)')
    expect(d.def.outputs).toEqual(['stock', 'rate2'])
    expect(d.def.invariants?.[0]?.lhs[0]?.variable).toBe('stock')
    expect(d.spec.completion?.variable).toBe('stock')
    expect(d.spec.kpis[0]?.variable).toBe('stock')
    expect(d.spec.evm?.credits[0]?.variable).toBe('stock')
    expect(d.spec.variables?.[0]?.name).toBe('stock')
    expect(d.spec.defaultVariable).toBe('stock')
    d = must(renameVariable(d, 'rate2', 'outflow'))
    expect(d.def.levels['stock']?.outflows).toEqual(['outflow'])
    expect(d.spec.staffVariable).toBe('outflow')
    expect(d.spec.evm?.effortVariable).toBe('outflow')
    expect(lintErrors(lintModel(d.def))).toEqual([])
  })

  it('rate와 rate2·rate_gain, 테이블 이름 rate는 건드리지 않는다(부분 문자열 충돌)', () => {
    const d = must(renameVariable(small(), 'r', 'inflow'))
    expect(d.def.rates['inflow']?.expr).toBe('k * rate_gain + MAX(k, 1)')
    expect(d.def.levels['x']?.inflows).toEqual(['inflow'])
    expect(d.def.auxiliaries['rate2']).toBeDefined()
    expect(d.def.auxiliaries['shadow']?.expr).toBe('GRAPH(x, rate)')
    expect(Object.keys(d.def.tables)).toEqual(['rate'])
  })

  it('거절: 같은 이름 중복, 잘못된 이름, 예약어, 테이블과 겹침, 없는 변수', () => {
    const d = small()
    expect(renameVariable(d, 'k', 'x').ok).toBe(false)
    expect(renameVariable(d, 'k', '9k').ok).toBe(false)
    expect(renameVariable(d, 'k', 'TIME').ok).toBe(false)
    expect(renameVariable(d, 'k', 'rate').ok).toBe(false)
    expect(renameVariable(d, 'nope', 'z').ok).toBe(false)
    expect(renameVariable(d, 'k', 'k')).toEqual({ ok: true, doc: d }) // 같은 이름은 아무 일도 없다
  })

  it('알려 주는 말에 바꾼 수식 수가 있다', () => {
    const r = renameVariable(small(), 'k', 'speed')
    expect(r.ok && r.note).toContain('수식 3곳')
  })
})

describe('내장 7개 모델: 아무 변수의 이름을 바꿔도 결과가 비트 단위로 같다', () => {
  it.each(catalog.filter((m) => m.category !== 'user').map((m) => [m.id] as const))('%s', (id) => {
    const original = docOf(id)
    const baseline = run(original)
    const names = variableNames(original.def)
    // 큰 모델은 일부만(상수·Level·Rate·Auxiliary가 고르게 들어가도록 간격 선택)
    const step = Math.max(1, Math.floor(names.length / 30))
    for (let i = 0; i < names.length; i += step) {
      const from = names[i] as string
      const to = `${from}_renamed`
      const r = renameVariable(original, from, to)
      expect(r.ok, from).toBe(true)
      const d = must(r)
      expect(lintErrors(lintModel(d.def)), from).toEqual([])
      expect(validateModelDoc(d).ok, from).toBe(true)
      const result = run(d)
      for (const [name, series] of Object.entries(baseline.series)) {
        const got = result.series[name === from ? to : name] as Float64Array
        expect(got, `${from}: ${name}`).toBeDefined()
        expect(Array.from(got)).toEqual(Array.from(series))
      }
    }
  })
})

describe('변수 삭제', () => {
  it('아무도 쓰지 않으면 지운다(spec·출력·섹터·위치도 정리)', () => {
    const d = must(deleteVariable(small(), 'shadow'))
    expect(d.def.auxiliaries['shadow']).toBeUndefined()
    expect(lintErrors(lintModel(d.def))).toEqual([])
  })

  it('다른 수식이 쓰면 거절하고 목록을 알린다', () => {
    const r = deleteVariable(small(), 'k')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/'x'의 초기값 수식|'r'의 수식/)
    expect(!r.ok && r.message).toMatch(/상수 0/)
  })

  it('참조를 상수 0으로 바꿔 지울 수 있다(수식이 계속 컴파일된다)', () => {
    const d = must(deleteVariable(small(), 'k', { replaceWithZero: true }))
    expect(d.def.constants['k']).toBeUndefined()
    expect(d.def.levels['x']?.init).toBe('0')
    expect(d.def.rates['r']?.expr).toBe('0 * rate_gain + MAX(0, 1)')
    expect(d.spec.params.map((p) => p.name)).toEqual(['rate_gain'])
    expect(d.spec.size).toBeUndefined()
    expect(d.spec.presets[0]?.overrides).toEqual({ rate_gain: 1 })
    expect(d.view.positions['k']).toBeUndefined()
    expect(d.view.sectors[0]?.members).toEqual(['x'])
    expect(lintErrors(lintModel(d.def))).toEqual([])
  })

  it('Level을 지우면 흐름·출력·불변식(한쪽이 비면 통째로)·완료 조건·진척이 정리된다', () => {
    const d0 = must(deleteVariable(must(deleteVariable(small(), 'shadow')), 'rate2', { replaceWithZero: true }))
    const d = must(deleteVariable(d0, 'x', { replaceWithZero: true }))
    expect(d.def.levels['x']).toBeUndefined()
    expect(d.def.outputs).toEqual([])
    expect(d.def.invariants).toEqual([])
    expect(d.spec.completion).toBeUndefined()
    expect(d.spec.evm).toBeUndefined() // 완료 조건이 없으면 진척도 없다
    expect(d.spec.kpis).toEqual([])
    expect(d.spec.defaultVariable).toBeUndefined()
    expect(d.spec.variables).toEqual([])
  })

  it('없는 변수는 거절한다', () => {
    expect(deleteVariable(small(), 'nope').ok).toBe(false)
  })

  it('참조 목록이 모든 곳을 가리킨다', () => {
    const where = referencesTo(small(), 'x').map((r) => r.where).join('|')
    for (const w of ['rate2', 'shadow', '출력', '불변식', '그래프 변수', '완료 조건', '지표', '진척']) expect(where, w).toContain(w === 'rate2' ? "'rate2'" : w === 'shadow' ? "'shadow'" : w)
  })
})

describe('필드 수정·종류 변경·모델 정보', () => {
  it('단위·값·수식·초기값·유입·유출', () => {
    let d = small()
    d = must(setField(d, 'k', { field: 'unit', value: 'FP/주' }))
    expect(d.def.constants['k']?.unit).toBe('FP/주')
    d = must(setField(d, 'k', { field: 'unit', value: ' ' }))
    expect(d.def.constants['k']).toEqual({ value: 2 }) // 비우면 단위를 없앤다
    d = must(setField(d, 'k', { field: 'value', value: 7 }))
    expect(d.def.constants['k']?.value).toBe(7)
    d = must(setField(d, 'k', { field: 'label', value: '속도' }))
    expect(d.def.constants['k']?.label).toBe('속도')
    d = must(setField(d, 'r', { field: 'expr', value: 'k' }))
    expect(d.def.rates['r']?.expr).toBe('k')
    d = must(setField(d, 'rate2', { field: 'expr', value: 'x' }))
    d = must(setField(d, 'x', { field: 'init', value: '5' }))
    expect(d.def.levels['x']?.init).toBe('5')
    d = must(setField(d, 'x', { field: 'inflows', value: ['r', 'rate2'] }))
    d = must(setField(d, 'x', { field: 'outflows', value: [] }))
    expect(d.def.levels['x']).toMatchObject({ inflows: ['r', 'rate2'], outflows: [] })
    d = must(setField(d, 'x', { field: 'unit', value: '건' }))
    expect(d.def.levels['x']?.unit).toBe('건')
  })

  it('종류에 없는 필드와 유한하지 않은 값은 거절한다', () => {
    const d = small()
    expect(setField(d, 'r', { field: 'value', value: 1 }).ok).toBe(false)
    expect(setField(d, 'k', { field: 'expr', value: '1' }).ok).toBe(false)
    expect(setField(d, 'k', { field: 'init', value: '1' }).ok).toBe(false)
    expect(setField(d, 'k', { field: 'inflows', value: [] }).ok).toBe(false)
    expect(setField(d, 'r', { field: 'label', value: 'x' }).ok).toBe(false)
    expect(setField(d, 'k', { field: 'value', value: Infinity }).ok).toBe(false)
    expect(setField(d, 'nope', { field: 'unit', value: 'x' }).ok).toBe(false)
  })

  it('Rate ↔ Auxiliary 변환(유입·유출 참조는 그대로)', () => {
    const d = must(changeFlowKind(small(), 'r', 'auxiliary'))
    expect(kindOf(d.def, 'r')).toBe('auxiliary')
    expect(d.def.levels['x']?.inflows).toEqual(['r'])
    expect(lintErrors(lintModel(d.def))).toEqual([])
    expect(changeFlowKind(small(), 'k', 'rate').ok).toBe(false)
    expect(changeFlowKind(small(), 'r', 'rate')).toMatchObject({ ok: true })
  })

  it('모델 이름·시간 설정', () => {
    const d = must(setMeta(small(), { name: '새 이름', end: 50, dt: 0.5 }))
    expect(d.def.meta.name).toBe('새 이름')
    expect(d.def.time).toEqual({ start: 0, end: 50, dt: 0.5 })
    expect(setMeta(small(), { name: ' ' }).ok).toBe(false)
    expect(setMeta(small(), { dt: 0 }).ok).toBe(false)
    expect(setMeta(small(), { end: 0 }).ok).toBe(false)
    expect(setMeta(small(), { end: NaN }).ok).toBe(false)
  })

  it('설명·작성자', () => {
    let d = setInfo(small(), { description: '설명', author: '나' })
    expect(d.info).toMatchObject({ description: '설명', author: '나' })
    d = setInfo(d, { author: '' })
    expect(d.info.author).toBeUndefined()
  })

  it('spec 동기화: 없는 파라미터는 만들고 상수가 아닌 것은 뺀다', () => {
    const d = small()
    const broken: ModelDoc = { ...d, spec: { ...d.spec, params: [d.spec.params[0]!, { name: 'ghost', group: 'g', min: 0, max: 1, step: 1 }] } }
    const synced = syncSpec(broken)
    expect(synced.spec.params.map((p) => p.name)).toEqual(['k', 'rate_gain'])
  })
})

describe('사용자 정의 단위(별칭)', () => {
  it('줄마다 이름 = 단위로 정의하고 다시 글로 읽으면 같다', () => {
    const d = must(setUnitAliases(small(), '인월 = 명·월\n주 = 일^1'))
    expect(d.def.units).toEqual({ aliases: { 인월: '명·월', 주: '일^1' } })
    expect(unitAliasesToText(d.def)).toBe('인월 = 명·월\n주 = 일^1')
  })
  it('비우면 없앤다', () => {
    const d = must(setUnitAliases(must(setUnitAliases(small(), '인월 = 명·월')), '  \n'))
    expect(d.def.units).toBeUndefined()
    expect('units' in d.def).toBe(false)
  })
  it('형식·이름·단위가 올바르지 않으면 줄 번호와 함께 거절한다', () => {
    const d = small()
    expect(setUnitAliases(d, '인월 명·월')).toMatchObject({ ok: false })
    expect(setUnitAliases(d, '= 명')).toMatchObject({ ok: false })
    expect(setUnitAliases(d, '인월 = 명·월\n인월 = 일')).toMatchObject({ ok: false })
    expect(setUnitAliases(d, '맨데이 = 명')).toMatchObject({ ok: false }) // 기본 별칭
    expect(setUnitAliases(d, 'a b = 명')).toMatchObject({ ok: false })
    const bad = setUnitAliases(d, '\nx = 일//명')
    expect(!bad.ok && bad.message).toMatch(/x = 일\/\/명/)
    const line = setUnitAliases(d, '\n\n잘못')
    expect(!line.ok && line.message).toContain('3번째 줄')
  })
  it('별칭이 단위 검사에 쓰인다', async () => {
    const { checkModelUnits } = await import('@spd/sd-engine')
    const base = small()
    const def = { ...base.def, constants: { ...base.def.constants, crew: { value: 2, unit: '인월' }, months: { value: 3, unit: '월' } }, auxiliaries: { ...base.def.auxiliaries, avg: { expr: 'crew / months', unit: '명' } } }
    const withoutAlias = checkModelUnits(def).filter((i) => i.code === 'unit-declared' && i.variable === 'avg')
    expect(withoutAlias).toHaveLength(1)
    const d = must(setUnitAliases({ ...base, def }, '인월 = 명·월'))
    expect(checkModelUnits(d.def).filter((i) => i.severity === 'error' && i.variable === 'avg')).toEqual([])
  })
})
