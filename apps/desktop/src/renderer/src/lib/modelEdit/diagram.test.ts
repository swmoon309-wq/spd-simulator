import { describe, expect, it } from 'vitest'
import { compileModel, runModel, type ModelDef } from '@spd/sd-engine'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { deleteVariable, renameVariable, setField, variableNames, type EditResult } from './commands'
import { deriveConnectors, referencedVariables } from './connectors'
import { addSector, assignToSector, autoLayoutDoc, connect, deleteSector, disconnect, flipFlow, renameSector, setPositions, setSectorColor, toggleSectorCollapsed } from './diagramEdit'
import { autoPositions, buildDiagram, COL_W, NODE_SIZE, ROW_H, sectorSummary } from './layout'

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
const BUILTIN = catalog.filter((m) => m.category !== 'user').map((m) => [m.id] as const)

/** 작은 모델: 상수 k·tau, Level stock(유입 inflow, 유출 outflow), Rate inflow = k, outflow = stock / tau, Auxiliary smoothed = SMOOTH(stock, tau), gate = smoothed + stock */
const small = (): ModelDoc => {
  const def: ModelDef = {
    meta: { id: 'user-d-00000001', name: 'd', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 10, dt: 1 },
    constants: { k: { value: 2, unit: '명/일' }, tau: { value: 3, unit: '일' } },
    levels: { stock: { init: '0', inflows: ['inflow'], outflows: ['outflow'], unit: '명' } },
    rates: { inflow: { expr: 'k', unit: '명/일' }, outflow: { expr: 'stock / tau', unit: '명/일' }, lone: { expr: 'k', unit: '명/일' } },
    auxiliaries: { smoothed: { expr: 'SMOOTH(stock, tau)', unit: '명' }, gate: { expr: 'smoothed + stock', unit: '명' } },
    tables: {},
    outputs: ['gate']
  }
  const v = validateModelDoc({
    docVersion: 1,
    def: def as unknown as Record<string, unknown>,
    info: { description: '', createdAt: NOW.toISOString() },
    view: { positions: {}, sectors: [], notes: [] },
    spec: { params: [{ name: 'k', group: 'g', min: 0, max: 10, step: 1 }, { name: 'tau', group: 'g', min: 1, max: 10, step: 1 }], kpis: [], presets: [] }
  })
  if (!v.ok) throw new Error(v.message)
  return v.doc
}

describe('연결선 파생 (설계 08의 3.3)', () => {
  it('정보선·지연 정보선·흐름선을 수식과 Level의 흐름에서 만든다', () => {
    const c = deriveConnectors(small().def)
    const has = (from: string, to: string, kind: string, sense?: string) => c.some((x) => x.from === from && x.to === to && x.kind === kind && (sense === undefined || x.sense === sense))
    expect(has('k', 'inflow', 'info')).toBe(true)
    expect(has('stock', 'outflow', 'info')).toBe(true)
    expect(has('tau', 'outflow', 'info')).toBe(true)
    expect(has('stock', 'smoothed', 'delayed')).toBe(true) // SMOOTH의 입력
    expect(has('tau', 'smoothed', 'delayed')).toBe(true) // SMOOTH의 지연시간도
    expect(has('smoothed', 'gate', 'info')).toBe(true)
    expect(has('stock', 'gate', 'info')).toBe(true)
    expect(has('inflow', 'stock', 'flow', 'in')).toBe(true) // 유입: Rate → Level
    expect(has('stock', 'outflow', 'flow', 'out')).toBe(true) // 유출: Level → Rate
  })

  it('수식을 바꾸면 선도 바뀐다 — 저장된 선이 없어 어긋날 수 없다', () => {
    const d = must(setField(small(), 'gate', { field: 'expr', value: 'k * 2' }))
    const c = deriveConnectors(d.def)
    expect(c.some((x) => x.to === 'gate' && x.from === 'stock')).toBe(false)
    expect(c.some((x) => x.to === 'gate' && x.from === 'k')).toBe(true)
  })

  it('일반 참조와 지연 참조가 함께면 일반만 남기고, 자기 참조·정의되지 않은 변수·TIME·테이블 이름은 선이 아니다', () => {
    const base = small()
    const both = must(setField(base, 'gate', { field: 'expr', value: 'stock + SMOOTH(stock, tau)' }))
    const c = deriveConnectors(both.def).filter((x) => x.to === 'gate')
    expect(c.filter((x) => x.from === 'stock').map((x) => x.kind)).toEqual(['info'])
    expect(c.find((x) => x.from === 'tau')?.kind).toBe('delayed')
    const odd = must(setField(base, 'gate', { field: 'expr', value: 'gate + nothing + TIME + GRAPH(stock, curve)' }))
    const d = deriveConnectors({ ...odd.def, tables: { curve: { x: [0, 1], y: [0, 1] } } }).filter((x) => x.to === 'gate')
    expect(d.map((x) => x.from)).toEqual(['stock'])
  })

  it('수식이 미완성이어도 토큰으로 추정한다', () => {
    const r = referencedVariables('a + SMOOTH(b, ')
    expect([...r.direct].sort()).toEqual(['a', 'b'])
  })

  it('Level 초기값의 참조는 init 선이다', () => {
    const d = must(setField(small(), 'stock', { field: 'init', value: 'k * tau' }))
    expect(deriveConnectors(d.def).filter((x) => x.kind === 'init').map((x) => x.from).sort()).toEqual(['k', 'tau'])
  })

  it('결정적이다(같은 입력이면 같은 순서)', () => {
    expect(deriveConnectors(small().def)).toEqual(deriveConnectors(JSON.parse(JSON.stringify(small().def)) as ModelDef))
  })
})

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('자동 배치 (겹침 없음·결정적)', () => {
  it.each(BUILTIN)('내장 %s: 모든 변수가 그려지고 노드가 겹치지 않으며 선의 끝이 모두 있다', (id) => {
    const doc = docOf(id)
    const dia = buildDiagram(doc)
    const vars = new Set(variableNames(doc.def))
    for (const v of vars) expect(dia.nodes.some((n) => n.id === v), v).toBe(true)
    for (let i = 0; i < dia.nodes.length; i++) for (let j = i + 1; j < dia.nodes.length; j++) expect(overlaps(dia.nodes[i]!, dia.nodes[j]!), `${dia.nodes[i]!.id} / ${dia.nodes[j]!.id}`).toBe(false)
    const ids = new Set(dia.nodes.map((n) => n.id))
    for (const e of dia.edges) {
      expect(ids.has(e.from), `${e.id} from`).toBe(true)
      expect(ids.has(e.to), `${e.id} to`).toBe(true)
    }
    for (const n of dia.nodes) {
      expect(Number.isFinite(n.x) && Number.isFinite(n.y)).toBe(true)
      expect(n.w).toBe(NODE_SIZE[n.kind].w)
    }
  })

  it.each(BUILTIN)('내장 %s: 같은 입력은 같은 배치다(JSON 왕복 뒤에도)', (id) => {
    const doc = docOf(id)
    const a = JSON.stringify([...autoPositions(doc.def)])
    const b = JSON.stringify([...autoPositions(JSON.parse(JSON.stringify(doc.def)) as ModelDef)])
    expect(a).toBe(b)
    expect(JSON.stringify(buildDiagram(doc))).toBe(JSON.stringify(buildDiagram(JSON.parse(JSON.stringify(doc)) as ModelDoc)))
  })

  it('흐름은 왼쪽에서 오른쪽으로: 유입 Rate는 Level보다 왼쪽, 유출 Rate는 오른쪽에 둔다', () => {
    const p = autoPositions(small().def)
    expect((p.get('inflow') as { x: number }).x).toBeLessThan((p.get('stock') as { x: number }).x)
    expect((p.get('outflow') as { x: number }).x).toBeGreaterThan((p.get('stock') as { x: number }).x) // outflow는 stock을 읽으므로(정보) 오른쪽
    expect((p.get('k') as { x: number }).x).toBeLessThan((p.get('inflow') as { x: number }).x)
    // 칸은 열 폭·행 높이의 배수다
    for (const { x, y } of p.values()) {
      expect(x % COL_W).toBe(0)
      expect(y % ROW_H).toBe(0)
    }
  })

  it('원천·싱크 구름: 어느 Level에서 나오지 않는/어디로도 들어가지 않는 쪽의 Rate에 붙고, 흐름에 쓰이지 않는 Rate에는 없다', () => {
    const dia = buildDiagram(small())
    const labels = (kind: string) => dia.nodes.filter((n) => n.kind === kind).map((n) => n.id).sort()
    expect(labels('cloud-source')).toEqual(['cloud:src:inflow']) // inflow는 Level에서 나오지 않는다
    expect(labels('cloud-sink')).toEqual(['cloud:sink:outflow']) // outflow는 어디로도 들어가지 않는다
    expect(dia.nodes.some((n) => n.id.startsWith('cloud:') && n.id.includes('lone'))).toBe(false) // 흐름에 안 쓰이는 Rate에는 구름이 없다(변수 노드 자체는 있다)
    expect(dia.nodes.some((n) => n.id === 'lone')).toBe(true)
    expect(dia.edges.some((e) => e.kind === 'flow' && e.from === 'cloud:src:inflow' && e.to === 'inflow')).toBe(true)
    expect(dia.edges.some((e) => e.kind === 'flow' && e.from === 'outflow' && e.to === 'cloud:sink:outflow')).toBe(true)
  })

  it('저장된 위치가 있으면 그것을 쓰고 없는 노드만 자동 배치를 쓴다. 자동 배치는 위치를 지우고 다시 정한다', () => {
    const d = must(setPositions(small(), { stock: { x: 1000.4, y: -50.6 } }))
    const dia = buildDiagram(d)
    expect(dia.nodes.find((n) => n.id === 'stock')).toMatchObject({ x: 1000, y: -51 })
    const auto = autoPositions(d.def)
    expect(dia.nodes.find((n) => n.id === 'k')).toMatchObject(auto.get('k') as object)
    const re = autoLayoutDoc(d)
    expect(re.view.positions['stock']).toEqual(auto.get('stock'))
    expect(Object.keys(re.view.positions).sort()).toEqual(variableNames(d.def).sort())
  })

  it('큰 모델(통합 프로젝트, 변수 100여 개)도 한 칸에 하나씩 놓는다', () => {
    const doc = docOf('integrated-project')
    expect(variableNames(doc.def).length).toBeGreaterThan(80)
    const cells = new Set([...autoPositions(doc.def).values()].map((p) => `${p.x},${p.y}`))
    expect(cells.size).toBe(autoPositions(doc.def).size)
  })
})

describe('위치 편집', () => {
  it('변수의 위치만 저장하고 구름·섹터 노드·없는 변수는 무시한다(계산에 영향 없음)', () => {
    const d = must(setPositions(small(), { stock: { x: 10, y: 20 }, 'cloud:src:inflow': { x: 1, y: 2 }, nothing: { x: 3, y: 4 } }))
    expect(d.view.positions).toEqual({ stock: { x: 10, y: 20 } })
    expect(setPositions(small(), { stock: { x: NaN, y: 0 } }).ok).toBe(false)
  })

  it('위치와 섹터는 결과에 영향이 없다: 모든 변수의 시계열이 비트 단위로 같다', () => {
    const doc = docOf('brooks')
    const moved = must(assignToSector(must(addSector(autoLayoutDoc(doc), '인력')), 'total_personnel', 'sec1'))
    const run = (d: ModelDoc) => runModel(compileModel(d.def), { overrides: Object.fromEntries(Object.entries(d.def.constants).map(([n, c]) => [n, c.value])) })
    const a = run(doc)
    const b = run(moved)
    for (const [n, s] of Object.entries(a.series)) expect(Array.from(b.series[n] as Float64Array)).toEqual(Array.from(s))
  })

  it('이름을 바꾸거나 지우면 위치와 섹터도 따라간다', () => {
    let d = must(setPositions(small(), { stock: { x: 10, y: 20 } }))
    d = must(addSector(d, '재고', ['stock', 'inflow']))
    d = must(renameVariable(d, 'stock', 'inventory'))
    expect(d.view.positions['inventory']).toEqual({ x: 10, y: 20 })
    expect(d.view.sectors[0]?.members).toEqual(['inventory', 'inflow'])
    d = must(deleteVariable(d, 'inflow'))
    expect(d.view.sectors[0]?.members).toEqual(['inventory'])
  })
})

describe('섹터 (EDT-07)', () => {
  it('섹터를 만들고 이름·색·멤버를 바꾸고 지운다(변수는 지우지 않는다)', () => {
    let d = must(addSector(small(), '재고', ['stock', 'inflow']))
    expect(d.view.sectors).toEqual([{ id: 'sec1', name: '재고', members: ['stock', 'inflow'] }])
    d = must(renameSector(d, 'sec1', '창고'))
    d = must(setSectorColor(d, 'sec1', '#112233'))
    expect(d.view.sectors[0]).toMatchObject({ name: '창고', color: '#112233' })
    d = must(setSectorColor(d, 'sec1', null))
    expect(d.view.sectors[0]?.color).toBeUndefined()
    d = must(deleteSector(d, 'sec1'))
    expect(d.view.sectors).toEqual([])
    expect(Object.keys(d.def.levels)).toEqual(['stock'])
  })

  it('이름이 없으면 "섹터 N", 이름이 겹치거나 비면 거절한다. 최대 20개', () => {
    let d = must(addSector(small()))
    expect(d.view.sectors[0]?.name).toBe('섹터 1')
    d = must(addSector(d))
    expect(d.view.sectors[1]?.name).toBe('섹터 2')
    expect(addSector(d, '섹터 1').ok).toBe(false)
    expect(addSector(d, '   ').ok).toBe(true) // 빈 이름은 자동 이름
    expect(renameSector(d, 'sec1', '섹터 2').ok).toBe(false)
    expect(renameSector(d, 'sec1', '').ok).toBe(false)
    expect(renameSector(d, 'nope', 'x').ok).toBe(false)
    let many = small()
    for (let i = 0; i < 20; i++) many = must(addSector(many))
    expect(addSector(many).ok).toBe(false)
    expect(many.view.sectors.map((s) => s.id)).toHaveLength(new Set(many.view.sectors.map((s) => s.id)).size)
  })

  it('변수는 섹터 하나에만 속한다: 새 섹터·다른 섹터로 옮기면 이전 섹터에서 빠진다', () => {
    let d = must(addSector(small(), 'A', ['stock', 'inflow']))
    d = must(addSector(d, 'B', ['stock']))
    expect(d.view.sectors.map((s) => [s.name, s.members])).toEqual([['A', ['inflow']], ['B', ['stock']]])
    d = must(assignToSector(d, 'inflow', 'sec2'))
    expect(d.view.sectors.map((s) => s.members)).toEqual([[], ['stock', 'inflow']])
    d = must(assignToSector(d, 'stock', null))
    expect(d.view.sectors[1]?.members).toEqual(['inflow'])
    expect(assignToSector(d, 'nothing', 'sec1').ok).toBe(false)
    expect(assignToSector(d, 'stock', 'nope').ok).toBe(false)
  })

  it('섹터는 배경 상자로 멤버를 감싼다(펼쳤을 때)', () => {
    const d = must(addSector(small(), '재고', ['stock', 'inflow', 'outflow']))
    const dia = buildDiagram(d)
    expect(dia.sectors).toHaveLength(1)
    const box = dia.sectors[0]!
    for (const n of dia.nodes.filter((x) => x.sector === 'sec1')) {
      expect(n.x).toBeGreaterThanOrEqual(box.x)
      expect(n.y).toBeGreaterThanOrEqual(box.y)
      expect(n.x + n.w).toBeLessThanOrEqual(box.x + box.w)
      expect(n.y + n.h).toBeLessThanOrEqual(box.y + box.h)
    }
    expect(dia.nodes.find((n) => n.id === 'stock')?.sector).toBe('sec1')
    expect(dia.nodes.find((n) => n.id === 'k')?.sector).toBeUndefined()
  })

  it('접으면 요약 노드 하나가 되고 밖과의 연결만 남는다(합친 선 개수, 구름도 함께 숨는다)', () => {
    let d = must(addSector(small(), '재고', ['stock', 'inflow', 'outflow']))
    d = must(toggleSectorCollapsed(d, 'sec1'))
    const dia = buildDiagram(d)
    const summary = dia.nodes.find((n) => n.id === 'sector:sec1')!
    expect(summary).toMatchObject({ kind: 'sector', label: '재고', count: 3 })
    expect(dia.nodes.some((n) => ['stock', 'inflow', 'outflow'].includes(n.id))).toBe(false)
    expect(dia.nodes.some((n) => n.id.startsWith('cloud:'))).toBe(false)
    expect(dia.sectors).toEqual([]) // 접힌 섹터는 상자가 아니라 노드
    // 안쪽 선은 사라지고 바깥(k, tau, smoothed, gate)과의 선만 남는다
    for (const e of dia.edges) expect(e.from === e.to).toBe(false)
    const toSector = dia.edges.filter((e) => e.to === 'sector:sec1')
    expect(toSector.map((e) => e.from).sort()).toEqual(['k', 'tau']) // k → inflow, tau → outflow가 요약 노드로 들어간다
    expect(dia.edges.some((e) => e.from === 'sector:sec1' && e.to === 'smoothed' && e.kind === 'delayed')).toBe(true)
    expect(dia.edges.some((e) => e.from === 'sector:sec1' && e.to === 'gate' && e.kind === 'info')).toBe(true)
    const kToSector = dia.edges.find((e) => e.from === 'k' && e.to === 'sector:sec1')!
    expect(kToSector.count).toBeGreaterThanOrEqual(1)
    // 펼치면 원래대로
    const open = buildDiagram(must(toggleSectorCollapsed(d, 'sec1', false)))
    expect(open.nodes.some((n) => n.id === 'stock')).toBe(true)
    expect(open.sectors).toHaveLength(1)
  })

  it('접은 섹터의 합친 선: 같은 두 끝 사이의 여러 선은 개수로 센다', () => {
    let d = must(addSector(small(), '값', ['gate', 'smoothed']))
    d = must(toggleSectorCollapsed(must(addSector(d, '입력', ['k', 'tau'])), 'sec2', true))
    const dia = buildDiagram(d)
    const e = dia.edges.find((x) => x.from === 'sector:sec2' && x.to === 'smoothed')
    expect(e).toBeDefined() // tau → smoothed(지연)
  })

  it('섹터 사이 연결 요약: 어느 섹터가 어느 섹터에 주는지와 개수', () => {
    const d = must(addSector(must(addSector(small(), '입력', ['k', 'tau'])), '재고', ['stock', 'inflow', 'outflow']))
    const rows = sectorSummary(d)
    const row = (a: string, b: string) => rows.find((r) => r.fromName === a && r.toName === b)
    expect(row('입력', '재고')?.count).toBe(2) // k → inflow, tau → outflow
    expect(row('입력', '재고')?.examples[0]).toContain('→')
    expect(row('재고', '(섹터 없음)')?.count).toBeGreaterThan(0) // stock → smoothed·gate
    expect(row('재고', '재고')).toBeUndefined() // 같은 섹터 안은 요약하지 않는다
    expect(rows.every((r) => r.from !== r.to)).toBe(true)
  })

  it.each(BUILTIN)('내장 %s: 섹터를 하나 만들어 접어도 그림이 깨지지 않는다(끝점이 모두 있음)', (id) => {
    const doc = docOf(id)
    const names = variableNames(doc.def)
    let d = must(addSector(autoLayoutDoc(doc), '절반', names.slice(0, Math.ceil(names.length / 2))))
    d = must(toggleSectorCollapsed(d, 'sec1', true))
    const dia = buildDiagram(d)
    const ids = new Set(dia.nodes.map((n) => n.id))
    for (const e of dia.edges) {
      expect(ids.has(e.from)).toBe(true)
      expect(ids.has(e.to)).toBe(true)
    }
    expect(dia.nodes.filter((n) => n.kind === 'sector')).toHaveLength(1)
  })
})

describe('연결 편집 보조 (선을 그리면 수식을 고친다)', () => {
  it('Rate·Auxiliary로 선을 그리면 수식에 이름을 넣는다(0이면 이름으로, 아니면 곱을 붙이고 확인하라고 알린다)', () => {
    const zero = must(setField(small(), 'gate', { field: 'expr', value: '0' }))
    const r1 = connect(zero, 'k', 'gate')
    expect(r1.ok && r1.doc.def.auxiliaries['gate']?.expr).toBe('k')
    const r2 = connect(small(), 'k', 'gate')
    expect(r2.ok && r2.doc.def.auxiliaries['gate']?.expr).toBe('smoothed + stock * k')
    expect(r2.ok && r2.note).toContain('확인하세요')
    expect(deriveConnectors((r2 as { doc: ModelDoc }).doc.def).some((c) => c.from === 'k' && c.to === 'gate')).toBe(true)
  })

  it('Rate에서 Level로 선을 그리면 유입에 더한다', () => {
    const r = connect(small(), 'lone', 'stock')
    expect(r.ok && r.doc.def.levels['stock']?.inflows).toEqual(['inflow', 'lone'])
  })

  it('만들 수 없는 연결은 거절한다(이미 있음, 자기 자신, 상수로, Level로 Level·상수에서, 없는 변수)', () => {
    const d = small()
    expect(connect(d, 'stock', 'gate')).toMatchObject({ ok: false }) // 이미 쓴다
    expect(connect(d, 'inflow', 'stock')).toMatchObject({ ok: false }) // 이미 유입
    expect(connect(d, 'outflow', 'stock')).toMatchObject({ ok: false }) // 이미 유출
    expect(connect(d, 'gate', 'gate')).toMatchObject({ ok: false })
    expect(connect(d, 'gate', 'k')).toMatchObject({ ok: false })
    expect(connect(d, 'k', 'stock')).toMatchObject({ ok: false })
    expect(connect(d, 'nothing', 'gate')).toMatchObject({ ok: false })
  })

  it('선을 지우면 수식의 참조를 0으로(정보선) 또는 유입·유출에서 뺀다(흐름선)', () => {
    const a = disconnect(small(), 'stock', 'gate', 'info')
    expect(a.ok && a.doc.def.auxiliaries['gate']?.expr).toBe('smoothed + 0')
    const b = disconnect(small(), 'stock', 'smoothed', 'delayed')
    expect(b.ok && b.doc.def.auxiliaries['smoothed']?.expr).toBe('SMOOTH(0, tau)')
    const c = disconnect(small(), 'inflow', 'stock', 'flow')
    expect(c.ok && c.doc.def.levels['stock']?.inflows).toEqual([])
    const d = disconnect(small(), 'stock', 'outflow', 'flow')
    expect(d.ok && d.doc.def.levels['stock']?.outflows).toEqual([])
    const e = disconnect(must(setField(small(), 'stock', { field: 'init', value: 'k' })), 'k', 'stock', 'init')
    expect(e.ok && e.doc.def.levels['stock']?.init).toBe('0')
    expect(disconnect(small(), 'k', 'gate', 'info')).toMatchObject({ ok: false })
    expect(disconnect(small(), 'lone', 'stock', 'flow')).toMatchObject({ ok: false })
  })
})

describe('흐름 방향 바꾸기', () => {
  it('유입 ↔ 유출로 옮긴다(다른 흐름은 그대로)', () => {
    const a = flipFlow(small(), 'stock', 'inflow')
    expect(a.ok && a.doc.def.levels['stock']).toMatchObject({ inflows: [], outflows: ['outflow', 'inflow'] })
    expect(a.ok && a.note).toContain('유출')
    const b = flipFlow(small(), 'stock', 'outflow')
    expect(b.ok && b.doc.def.levels['stock']).toMatchObject({ inflows: ['inflow', 'outflow'], outflows: [] })
    expect(flipFlow(small(), 'stock', 'lone')).toMatchObject({ ok: false })
    expect(flipFlow(small(), 'nope', 'inflow')).toMatchObject({ ok: false })
  })
})
