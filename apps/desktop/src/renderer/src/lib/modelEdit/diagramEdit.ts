import { findReferences, type ModelDef } from '@spd/sd-engine'
import { MODEL_LIMITS } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../modelDoc'
import { kindOf, type EditResult } from './commands'
import { autoPositions } from './layout'

/**
 * 다이어그램·섹터 편집 명령(EDT-01·EDT-07, 설계 08의 9·10.3장). 모두 순수 함수이며 **캔버스에서만 할 수 있는 편집은 없다**: 섹터는 목록·속성에서,
 * 연결은 수식과 Level의 유입·유출에서 같은 일을 할 수 있다(연결선은 수식에서 파생하므로 선을 그리는 것은 수식을 고치는 편집 보조다). 위치·섹터는
 * 계산에 영향이 없다.
 */

const fail = (message: string): EditResult => ({ ok: false, message })
const ok = (doc: ModelDoc, note?: string): EditResult => ({ ok: true, doc, ...(note ? { note } : {}) })
const withView = (doc: ModelDoc, view: Partial<ModelDoc['view']>): ModelDoc => ({ ...doc, view: { ...doc.view, ...view } })

// ---------- 위치 ----------

/** 변수 노드의 위치를 바꾼다(캔버스에서 끌어 옮길 때). 구름·섹터 요약 노드는 저장하지 않는다. */
export function setPositions(doc: ModelDoc, moved: Record<string, { x: number; y: number }>): EditResult {
  const positions = { ...doc.view.positions }
  for (const [name, p] of Object.entries(moved)) {
    if (!kindOf(doc.def, name)) continue // 변수가 아닌 것(구름·섹터)은 무시한다
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return fail('위치가 유한한 수가 아닙니다.')
    positions[name] = { x: Math.round(p.x), y: Math.round(p.y) }
  }
  return ok(withView(doc, { positions }))
}

/** 모든 변수의 위치를 자동 배치로 다시 정한다(저장된 위치를 지운다). */
export function autoLayoutDoc(doc: ModelDoc): ModelDoc {
  const auto = autoPositions(doc.def, doc.view.sectors)
  const positions: Record<string, { x: number; y: number }> = {}
  for (const [n, p] of auto) if (kindOf(doc.def, n)) positions[n] = { x: p.x, y: p.y }
  return withView(doc, { positions })
}

// ---------- 섹터 ----------

/** 안 쓰는 섹터 id(`sec1`, `sec2`, …). */
export function newSectorId(doc: ModelDoc): string {
  const used = new Set(doc.view.sectors.map((s) => s.id))
  let n = doc.view.sectors.length + 1
  while (used.has(`sec${n}`)) n++
  return `sec${n}`
}

const nameProblem = (doc: ModelDoc, name: string, ignore?: string): string | null => {
  if (name.trim() === '') return '섹터 이름이 비어 있습니다.'
  if (name.length > MODEL_LIMITS.name) return `섹터 이름은 ${MODEL_LIMITS.name}자 이하여야 합니다.`
  if (doc.view.sectors.some((s) => s.name === name.trim() && s.id !== ignore)) return `'${name.trim()}' 섹터가 이미 있습니다.`
  return null
}

/** 섹터를 더한다. 이름이 없으면 "섹터 N". 최대 20개. */
export function addSector(doc: ModelDoc, wanted?: string, members: string[] = []): EditResult {
  if (doc.view.sectors.length >= MODEL_LIMITS.sectors) return fail(`섹터는 최대 ${MODEL_LIMITS.sectors}개입니다.`)
  let name = wanted?.trim() ?? ''
  if (name === '') {
    let n = doc.view.sectors.length + 1
    while (doc.view.sectors.some((s) => s.name === `섹터 ${n}`)) n++
    name = `섹터 ${n}`
  }
  const problem = nameProblem(doc, name)
  if (problem) return fail(problem)
  const id = newSectorId(doc)
  const valid = members.filter((m) => kindOf(doc.def, m))
  // 변수는 섹터 하나에만 속한다: 다른 섹터에서 뺀다
  const sectors = doc.view.sectors.map((s) => ({ ...s, members: s.members.filter((m) => !valid.includes(m)) }))
  return ok(withView(doc, { sectors: [...sectors, { id, name, members: valid }] }), `'${name}' 섹터를 만들었습니다.`)
}

export function renameSector(doc: ModelDoc, id: string, name: string): EditResult {
  if (!doc.view.sectors.some((s) => s.id === id)) return fail('섹터를 찾을 수 없습니다.')
  const problem = nameProblem(doc, name, id)
  if (problem) return fail(problem)
  return ok(withView(doc, { sectors: doc.view.sectors.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)) }))
}

export function setSectorColor(doc: ModelDoc, id: string, color: string | null): EditResult {
  if (!doc.view.sectors.some((s) => s.id === id)) return fail('섹터를 찾을 수 없습니다.')
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) return fail('색은 #rrggbb 형식이어야 합니다.')
  return ok(withView(doc, { sectors: doc.view.sectors.map((s) => (s.id === id ? withColor(s, color) : s)) }))
}

function withColor<T extends { color?: string | undefined }>(s: T, color: string | null): T {
  const { color: _drop, ...rest } = s
  return (color === null ? rest : { ...rest, color }) as T
}

/** 섹터를 지운다. 변수는 지우지 않고 섹터 없음으로 돌아간다. */
export function deleteSector(doc: ModelDoc, id: string): EditResult {
  if (!doc.view.sectors.some((s) => s.id === id)) return fail('섹터를 찾을 수 없습니다.')
  return ok(withView(doc, { sectors: doc.view.sectors.filter((s) => s.id !== id) }))
}

/** 변수를 섹터에 넣거나(`sectorId`) 섹터에서 뺀다(`null`). 변수는 섹터 하나에만 속하므로 다른 섹터에서는 빠진다. */
export function assignToSector(doc: ModelDoc, variable: string, sectorId: string | null): EditResult {
  if (!kindOf(doc.def, variable)) return fail(`변수 '${variable}'을(를) 찾을 수 없습니다.`)
  if (sectorId !== null && !doc.view.sectors.some((s) => s.id === sectorId)) return fail('섹터를 찾을 수 없습니다.')
  const sectors = doc.view.sectors.map((s) => ({ ...s, members: s.members.filter((m) => m !== variable).concat(s.id === sectorId ? [variable] : []) }))
  return ok(withView(doc, { sectors }))
}

export function toggleSectorCollapsed(doc: ModelDoc, id: string, collapsed?: boolean): EditResult {
  const s = doc.view.sectors.find((x) => x.id === id)
  if (!s) return fail('섹터를 찾을 수 없습니다.')
  const next = collapsed ?? s.collapsed !== true
  return ok(withView(doc, { sectors: doc.view.sectors.map((x) => (x.id === id ? { ...x, collapsed: next } : x)) }))
}

/** 변수가 속한 섹터 id(없으면 null). */
export function sectorOfVariable(doc: ModelDoc, variable: string): string | null {
  return doc.view.sectors.find((s) => s.members.includes(variable))?.id ?? null
}

// ---------- 연결 ----------

const zeroRefs = (source: string, name: string): { source: string; count: number } => {
  const targets = findReferences(source).refs.filter((r) => r.kind === 'variable' && r.name === name)
  let out = source
  for (const r of [...targets].reverse()) out = out.slice(0, r.start) + '0' + out.slice(r.end)
  return { source: out, count: targets.length }
}

const replaceExpr = (def: ModelDef, name: string, expr: string): ModelDef => {
  const k = kindOf(def, name)
  if (k === 'rate') return { ...def, rates: { ...def.rates, [name]: { ...(def.rates[name] as { expr: string }), expr } } }
  if (k === 'auxiliary') return { ...def, auxiliaries: { ...def.auxiliaries, [name]: { ...(def.auxiliaries[name] as { expr: string }), expr } } }
  return def
}

/**
 * 캔버스에서 `from`에서 `to`로 선을 그렸을 때의 편집 보조. 연결선은 수식에서 파생하므로 **수식을 고쳐서** 선을 만든다.
 * - `to`가 Rate·Auxiliary: 수식에 `from`의 이름을 넣는다(수식이 `0`이거나 비었으면 이름으로 바꾸고, 아니면 ` * from`을 끝에 붙인다 — 연산을 확인하라고 알린다).
 * - `to`가 Level이고 `from`이 Rate·Auxiliary: 그 Level의 **유입**에 더한다(유출은 속성에서 고른다).
 * 이미 연결되어 있거나 만들 수 없는 연결은 거절한다.
 */
export function connect(doc: ModelDoc, from: string, to: string): EditResult {
  const kf = kindOf(doc.def, from)
  const kt = kindOf(doc.def, to)
  if (!kf || !kt) return fail('연결할 변수를 찾을 수 없습니다.')
  if (from === to) return fail('변수를 자기 자신에 연결할 수 없습니다.')
  if (kt === 'constant') return fail('상수는 값이므로 다른 변수에서 오는 선을 받을 수 없습니다.')
  if (kt === 'level') {
    if (kf !== 'rate' && kf !== 'auxiliary') return fail('Level에는 Rate나 Auxiliary(흐름)만 연결할 수 있습니다. Level의 초기값은 속성에서 고칩니다.')
    const l = doc.def.levels[to] as { init: string; inflows: string[]; outflows: string[]; unit?: string }
    if (l.inflows.includes(from) || l.outflows.includes(from)) return fail(`'${from}'은(는) 이미 '${to}'의 흐름입니다.`)
    const def: ModelDef = { ...doc.def, levels: { ...doc.def.levels, [to]: { ...l, inflows: [...l.inflows, from] } } }
    return ok({ ...doc, def }, `'${from}'을(를) '${to}'의 유입으로 연결했습니다.`)
  }
  const expr = (kt === 'rate' ? doc.def.rates[to]?.expr : doc.def.auxiliaries[to]?.expr) ?? ''
  if (findReferences(expr).refs.some((r) => r.kind === 'variable' && r.name === from)) return fail(`'${to}'의 수식이 이미 '${from}'을(를) 씁니다.`)
  const trivial = expr.trim() === '' || expr.trim() === '0'
  const next = trivial ? from : `${expr} * ${from}`
  return ok({ ...doc, def: replaceExpr(doc.def, to, next) }, trivial ? `'${to}'의 수식을 '${from}'으로 정했습니다.` : `'${to}'의 수식 끝에 ' * ${from}'을 붙였습니다. 연산이 맞는지 수식을 확인하세요.`)
}

/** Level의 흐름 하나를 유입 ↔ 유출로 바꾼다(다이어그램에서 흐름선을 골라 방향을 바꿀 때). */
export function flipFlow(doc: ModelDoc, level: string, flow: string): EditResult {
  const l = doc.def.levels[level]
  if (!l) return fail('Level을 찾을 수 없습니다.')
  const isIn = l.inflows.includes(flow)
  const isOut = l.outflows.includes(flow)
  if (!isIn && !isOut) return fail('그런 흐름이 없습니다.')
  const def: ModelDef = { ...doc.def, levels: { ...doc.def.levels, [level]: { ...l, inflows: isIn ? l.inflows.filter((f) => f !== flow) : [...l.inflows, flow], outflows: isOut ? l.outflows.filter((f) => f !== flow) : [...l.outflows, flow] } } }
  return ok({ ...doc, def }, `'${flow}'을(를) '${level}'의 ${isIn ? '유출' : '유입'}로 바꿨습니다.`)
}

/**
 * 선을 지운다. 정보선은 `to`의 수식에서 `from`의 참조를 상수 0으로 바꾸고(수식이 계속 컴파일된다), 흐름선은 Level의 유입·유출에서 뺀다.
 * `kind`는 지울 선의 종류(`flow`는 `sense`로 유입·유출을 구분하지 않고 둘 다에서 뺀다).
 */
export function disconnect(doc: ModelDoc, from: string, to: string, kind: 'info' | 'delayed' | 'init' | 'flow'): EditResult {
  if (kind === 'flow') {
    // 유입: Rate → Level(to가 Level), 유출: Level → Rate(from이 Level)
    const levelName = kindOf(doc.def, to) === 'level' ? to : from
    const flow = levelName === to ? from : to
    const l = doc.def.levels[levelName]
    if (!l) return fail('Level을 찾을 수 없습니다.')
    if (!l.inflows.includes(flow) && !l.outflows.includes(flow)) return fail('그런 흐름이 없습니다.')
    const def: ModelDef = { ...doc.def, levels: { ...doc.def.levels, [levelName]: { ...l, inflows: l.inflows.filter((f) => f !== flow), outflows: l.outflows.filter((f) => f !== flow) } } }
    return ok({ ...doc, def }, `'${levelName}'과(와) '${flow}'의 흐름 연결을 지웠습니다.`)
  }
  const k = kindOf(doc.def, to)
  if (k === 'level' && kind === 'init') {
    const l = doc.def.levels[to] as { init: string }
    const z = zeroRefs(l.init, from)
    if (z.count === 0) return fail('그런 연결이 없습니다.')
    const def: ModelDef = { ...doc.def, levels: { ...doc.def.levels, [to]: { ...(doc.def.levels[to] as object), init: z.source } as (typeof doc.def.levels)[string] } }
    return ok({ ...doc, def }, `'${to}'의 초기값 수식에서 '${from}'의 참조 ${z.count}곳을 0으로 바꿨습니다.`)
  }
  if (k !== 'rate' && k !== 'auxiliary') return fail('그런 연결이 없습니다.')
  const expr = (k === 'rate' ? doc.def.rates[to]?.expr : doc.def.auxiliaries[to]?.expr) as string
  const z = zeroRefs(expr, from)
  if (z.count === 0) return fail('그런 연결이 없습니다.')
  return ok({ ...doc, def: replaceExpr(doc.def, to, z.source) }, `'${to}'의 수식에서 '${from}'의 참조 ${z.count}곳을 0으로 바꿨습니다.`)
}

