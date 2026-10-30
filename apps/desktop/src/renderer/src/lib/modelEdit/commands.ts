import { DEFAULT_UNIT_ALIASES, findReferences, parseUnit, renameVariableInExpr, type ModelDef } from '@spd/sd-engine'
import type { ModelSpec } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../modelDoc'

/**
 * 모델 편집 명령(설계 08의 6.2). 모두 순수 함수이며 새 문서를 돌려준다(입력은 바꾸지 않는다). 이름을 바꾸거나 지우면 수식·흐름·출력·불변식·
 * 앱 연결(`spec`)·섹터·위치의 참조를 **토큰 단위로** 함께 고친다(문자열 치환 금지).
 */

export type VarKind = 'constant' | 'level' | 'rate' | 'auxiliary'

export const KIND_LABEL: Record<VarKind, string> = { constant: '상수', level: 'Level', rate: 'Rate', auxiliary: 'Auxiliary' }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED = new Set(['TIME', 'DT', 'AND', 'OR', 'NOT'])

export type EditResult = { ok: true; doc: ModelDoc; /** 화면에 알릴 말(바꾼 참조 수 등) */ note?: string } | { ok: false; message: string }
const fail = (message: string): EditResult => ({ ok: false, message })
const ok = (doc: ModelDoc, note?: string): EditResult => ({ ok: true, doc, ...(note ? { note } : {}) })

export function kindOf(def: ModelDef, name: string): VarKind | null {
  if (name in def.constants) return 'constant'
  if (name in def.levels) return 'level'
  if (name in def.rates) return 'rate'
  if (name in def.auxiliaries) return 'auxiliary'
  return null
}

/** 모든 변수 이름(상수, Level, Rate, Auxiliary 순). */
export function variableNames(def: ModelDef): string[] {
  return [...Object.keys(def.constants), ...Object.keys(def.levels), ...Object.keys(def.rates), ...Object.keys(def.auxiliaries)]
}

/** 이름이 변수 이름으로 쓸 수 있는지(형식·예약어·중복). 쓸 수 있으면 null, 아니면 이유. */
export function nameProblem(def: ModelDef, name: string, ignore?: string): string | null {
  if (!IDENT.test(name)) return '영문자·숫자·_만 쓸 수 있고 숫자로 시작할 수 없습니다.'
  if (name.length > 64) return '이름은 64자 이하여야 합니다.'
  if (RESERVED.has(name.toUpperCase())) return `'${name}'은(는) 예약어(TIME·DT·AND·OR·NOT)라 쓸 수 없습니다.`
  if (name !== ignore && kindOf(def, name)) return `이미 있는 이름입니다(${KIND_LABEL[kindOf(def, name) as VarKind]}).`
  if (name in def.tables) return `같은 이름의 테이블이 있습니다.`
  return null
}

/** 안 쓰는 새 이름(`base`, `base_2`, …). */
export function uniqueName(def: ModelDef, base: string): string {
  let name = base
  for (let i = 2; kindOf(def, name) || name in def.tables; i++) name = `${base}_${i}`
  return name
}

const withDef = (doc: ModelDoc, def: ModelDef): ModelDoc => ({ ...doc, def })

/** 같은 순서를 유지하면서 키 하나를 바꾼다. */
function renameKey<T>(rec: Record<string, T>, from: string, to: string): Record<string, T> {
  return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k === from ? to : k, v]))
}

/** 상수의 기본 파라미터 범위 제안: [0.1×값, 10×값], 값이 0이면 [0, 1]. */
export function suggestRange(value: number): { min: number; max: number; step: number } {
  if (value === 0) return { min: 0, max: 1, step: 0.1 }
  const a = Math.abs(value) * 0.1
  const b = Math.abs(value) * 10
  const [min, max] = value > 0 ? [a, b] : [-b, -a]
  const step = Number((10 ** Math.floor(Math.log10(max - min) - 2)).toPrecision(1))
  return { min, max, step: step > 0 ? step : 0.01 }
}

// ---------- 추가 ----------

/** 변수 하나를 더한다. 이름이 없으면 종류에 맞는 새 이름을 만든다. 상수면 파라미터 정의(`spec.params`)도 함께 만든다. */
export function addVariable(doc: ModelDoc, kind: VarKind, wanted?: string): EditResult {
  const base = { constant: 'new_constant', level: 'new_level', rate: 'new_rate', auxiliary: 'new_aux' }[kind]
  const name = wanted ?? uniqueName(doc.def, base)
  const problem = nameProblem(doc.def, name)
  if (problem) return fail(`'${name}': ${problem}`)
  const def: ModelDef = { ...doc.def }
  if (kind === 'constant') def.constants = { ...def.constants, [name]: { value: 0 } }
  else if (kind === 'level') def.levels = { ...def.levels, [name]: { init: '0', inflows: [], outflows: [] } }
  else if (kind === 'rate') def.rates = { ...def.rates, [name]: { expr: '0' } }
  else def.auxiliaries = { ...def.auxiliaries, [name]: { expr: '0' } }
  return ok(syncSpec(withDef(doc, def)), `${KIND_LABEL[kind]} '${name}'을(를) 더했습니다.`)
}

// ---------- 참조 ----------

export interface Reference {
  /** 어디에 쓰였는지(화면에 보인다) */
  where: string
  /** 수식 안이면 변수 이름 */
  variable?: string
}

/** 변수 `name`을 가리키는 곳을 모두 찾는다(삭제 전 확인, 이름 바꾸기 미리보기). */
export function referencesTo(doc: ModelDoc, name: string): Reference[] {
  const { def, spec } = doc
  const out: Reference[] = []
  const scan = (variable: string, field: string, source: string) => {
    const n = findReferences(source).refs.filter((r) => r.kind === 'variable' && r.name === name).length
    if (n > 0) out.push({ where: `'${variable}'의 ${field ? `${field} ` : ''}수식(${n}곳)`, variable })
  }
  for (const [v, l] of Object.entries(def.levels)) {
    scan(v, '초기값', l.init)
    if (l.inflows.includes(name)) out.push({ where: `Level '${v}'의 유입`, variable: v })
    if (l.outflows.includes(name)) out.push({ where: `Level '${v}'의 유출`, variable: v })
  }
  for (const [v, r] of Object.entries(def.rates)) scan(v, '', r.expr)
  for (const [v, a] of Object.entries(def.auxiliaries)) scan(v, '', a.expr)
  if (def.outputs.includes(name)) out.push({ where: '출력(outputs)' })
  for (const inv of def.invariants ?? []) if ([...inv.lhs, ...inv.rhs].some((t) => t.variable === name)) out.push({ where: `불변식 '${inv.name}'` })
  if (spec.params.some((p) => p.name === name)) out.push({ where: '파라미터 정의' })
  if (spec.variables?.some((v) => v.name === name)) out.push({ where: '그래프 변수 목록' })
  if (spec.defaultVariable === name) out.push({ where: '기본 그래프 변수' })
  if (spec.completion?.variable === name) out.push({ where: '완료 조건' })
  for (const k of spec.kpis) if (k.variable === name) out.push({ where: `지표 '${k.label}'` })
  if (spec.staffVariable === name) out.push({ where: '인원 변수' })
  if (spec.evm) {
    if (spec.evm.totalTasks.param === name) out.push({ where: '진척: 총 태스크' })
    for (const c of spec.evm.credits) if (c.variable === name) out.push({ where: `진척 인정 '${c.label}'` })
    if (spec.evm.effortVariable === name) out.push({ where: '진척: 누적 공수' })
  }
  if (spec.size?.param === name) out.push({ where: '규모 입력' })
  for (const p of spec.presets) if (name in p.overrides) out.push({ where: `프리셋 '${p.label}'` })
  return out
}

// ---------- 이름 바꾸기 ----------

/** 변수의 이름을 바꾸고 모든 참조를 함께 고친다. 새 이름이 올바르지 않거나 겹치면 거절한다. */
export function renameVariable(doc: ModelDoc, from: string, to: string): EditResult {
  if (from === to) return ok(doc)
  const k = kindOf(doc.def, from)
  if (!k) return fail(`변수 '${from}'을(를) 찾을 수 없습니다.`)
  const problem = nameProblem(doc.def, to)
  if (problem) return fail(`'${to}': ${problem}`)
  let count = 0
  const rx = (source: string): string => {
    const r = renameVariableInExpr(source, from, to)
    count += r.count
    return r.source
  }
  const swap = (v: string) => (v === from ? to : v)
  const d = doc.def
  const def: ModelDef = {
    ...d,
    constants: k === 'constant' ? renameKey(d.constants, from, to) : d.constants,
    levels: Object.fromEntries(Object.entries(d.levels).map(([n, l]) => [swap(n), { ...l, init: rx(l.init), inflows: l.inflows.map(swap), outflows: l.outflows.map(swap) }])),
    rates: Object.fromEntries(Object.entries(d.rates).map(([n, r]) => [swap(n), { ...r, expr: rx(r.expr) }])),
    auxiliaries: Object.fromEntries(Object.entries(d.auxiliaries).map(([n, a]) => [swap(n), { ...a, expr: rx(a.expr) }])),
    outputs: d.outputs.map(swap),
    ...(d.invariants ? { invariants: d.invariants.map((inv) => ({ ...inv, lhs: inv.lhs.map((t) => ({ ...t, variable: swap(t.variable) })), rhs: inv.rhs.map((t) => ({ ...t, variable: swap(t.variable) })) })) } : {})
  }
  const s = doc.spec
  const spec: ModelSpec = {
    ...s,
    params: s.params.map((p) => ({ ...p, name: swap(p.name) })),
    ...(s.variables ? { variables: s.variables.map((v) => ({ ...v, name: swap(v.name) })) } : {}),
    ...(s.defaultVariable ? { defaultVariable: swap(s.defaultVariable) } : {}),
    ...(s.completion ? { completion: { ...s.completion, variable: swap(s.completion.variable) } } : {}),
    kpis: s.kpis.map((x) => ({ ...x, variable: swap(x.variable) })),
    ...(s.staffVariable ? { staffVariable: swap(s.staffVariable) } : {}),
    ...(s.evm ? { evm: { totalTasks: { param: swap(s.evm.totalTasks.param) }, credits: s.evm.credits.map((c) => ({ ...c, variable: swap(c.variable) })), effortVariable: swap(s.evm.effortVariable) } } : {}),
    ...(s.size ? { size: { ...s.size, param: swap(s.size.param) } } : {}),
    presets: s.presets.map((p) => ({ ...p, overrides: renameKey(p.overrides, from, to) }))
  }
  const view = {
    ...doc.view,
    positions: renameKey(doc.view.positions, from, to),
    sectors: doc.view.sectors.map((sec) => ({ ...sec, members: sec.members.map(swap) }))
  }
  return ok({ ...doc, def, spec, view }, `'${from}' → '${to}': 수식 ${count}곳과 연결된 설정의 이름을 함께 바꿨습니다.`)
}

// ---------- 삭제 ----------

/**
 * 변수를 지운다. 다른 곳이 참조하면 **거절하고 목록을 알린다**(`replaceWithZero`로 수식의 참조를 상수 0으로 바꿔 지울 수 있다). 흐름·출력·불변식·
 * `spec`의 참조는 그냥 없앤다(불변식은 한쪽 변이 비면 불변식 자체를 지운다).
 */
export function deleteVariable(doc: ModelDoc, name: string, options: { replaceWithZero?: boolean } = {}): EditResult {
  const k = kindOf(doc.def, name)
  if (!k) return fail(`변수 '${name}'을(를) 찾을 수 없습니다.`)
  const refs = referencesTo(doc, name)
  const exprRefs = refs.filter((r) => r.variable !== undefined && r.variable !== name && /수식/.test(r.where))
  if (exprRefs.length > 0 && !options.replaceWithZero) {
    return fail(`'${name}'을(를) 다른 수식이 쓰고 있습니다: ${exprRefs.map((r) => r.where).join(', ')}. 참조를 상수 0으로 바꿔 지우거나, 먼저 수식을 고치세요.`)
  }
  let count = 0
  const zero = (source: string): string => {
    const targets = findReferences(source).refs.filter((r) => r.kind === 'variable' && r.name === name)
    count += targets.length
    let out = source
    for (const r of [...targets].reverse()) out = out.slice(0, r.start) + '0' + out.slice(r.end)
    return out
  }
  const d = doc.def
  const omit = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([n]) => n !== name))
  const keep = (v: string) => v !== name
  const def: ModelDef = {
    ...d,
    constants: omit(d.constants),
    levels: Object.fromEntries(Object.entries(omit(d.levels)).map(([n, l]) => [n, { ...l, init: zero(l.init), inflows: l.inflows.filter(keep), outflows: l.outflows.filter(keep) }])),
    rates: Object.fromEntries(Object.entries(omit(d.rates)).map(([n, r]) => [n, { ...r, expr: zero(r.expr) }])),
    auxiliaries: Object.fromEntries(Object.entries(omit(d.auxiliaries)).map(([n, a]) => [n, { ...a, expr: zero(a.expr) }])),
    outputs: d.outputs.filter(keep),
    ...(d.invariants
      ? {
          invariants: d.invariants
            .map((inv) => ({ ...inv, lhs: inv.lhs.filter((t) => t.variable !== name), rhs: inv.rhs.filter((t) => t.variable !== name) }))
            .filter((inv) => inv.lhs.length > 0 && inv.rhs.length > 0)
        }
      : {})
  }
  const s = doc.spec
  const spec: ModelSpec = {
    ...s,
    params: s.params.filter((p) => p.name !== name),
    kpis: s.kpis.filter((x) => x.variable !== name),
    presets: s.presets.map((p) => ({ ...p, overrides: Object.fromEntries(Object.entries(p.overrides).filter(([n]) => n !== name)) }))
  }
  if (s.variables) spec.variables = s.variables.filter((v) => v.name !== name)
  else delete spec.variables
  if (s.defaultVariable === name) delete spec.defaultVariable
  else if (s.defaultVariable) spec.defaultVariable = s.defaultVariable
  if (s.completion?.variable === name) {
    delete spec.completion
    delete spec.evm // 완료 조건 없이는 진척 정의를 쓸 수 없다
    spec.kpis = spec.kpis.filter((x) => x.kind !== 'atCompletion')
  } else if (s.completion) spec.completion = s.completion
  if (s.staffVariable === name) delete spec.staffVariable
  else if (s.staffVariable) spec.staffVariable = s.staffVariable
  if (spec.evm) {
    const credits = spec.evm.credits.filter((c) => c.variable !== name)
    if (spec.evm.totalTasks.param === name || spec.evm.effortVariable === name || credits.length === 0) delete spec.evm
    else spec.evm = { ...spec.evm, credits }
  }
  if (s.size?.param === name) delete spec.size
  const view = {
    ...doc.view,
    positions: Object.fromEntries(Object.entries(doc.view.positions).filter(([n]) => n !== name)),
    sectors: doc.view.sectors.map((sec) => ({ ...sec, members: sec.members.filter(keep) }))
  }
  return ok(syncSpec({ ...doc, def, spec, view }), `'${name}'을(를) 지웠습니다.${count > 0 ? ` 수식의 참조 ${count}곳을 0으로 바꿨습니다.` : ''}`)
}

// ---------- 필드 수정 ----------

export type FieldEdit =
  | { field: 'unit'; value: string }
  | { field: 'label'; value: string }
  | { field: 'value'; value: number }
  | { field: 'expr'; value: string }
  | { field: 'init'; value: string }
  | { field: 'inflows'; value: string[] }
  | { field: 'outflows'; value: string[] }

/** 변수의 필드 하나를 바꾼다. 종류에 없는 필드는 거절한다. 상수의 값이 바뀌면 파라미터 범위 밖이 되지 않는지는 적용 때 확인한다. */
export function setField(doc: ModelDoc, name: string, edit: FieldEdit): EditResult {
  const d = doc.def
  const k = kindOf(d, name)
  if (!k) return fail(`변수 '${name}'을(를) 찾을 수 없습니다.`)
  switch (edit.field) {
    case 'unit':
      if (k === 'constant') return ok(withDef(doc, { ...d, constants: { ...d.constants, [name]: withUnit(d.constants[name] as { value: number; unit?: string; label?: string }, edit.value) } }))
      if (k === 'level') return ok(withDef(doc, { ...d, levels: { ...d.levels, [name]: withUnit(d.levels[name] as (typeof d.levels)[string], edit.value) } }))
      if (k === 'rate') return ok(withDef(doc, { ...d, rates: { ...d.rates, [name]: withUnit(d.rates[name] as (typeof d.rates)[string], edit.value) } }))
      return ok(withDef(doc, { ...d, auxiliaries: { ...d.auxiliaries, [name]: withUnit(d.auxiliaries[name] as (typeof d.auxiliaries)[string], edit.value) } }))
    case 'label': {
      if (k !== 'constant') return fail('이름표(label)는 상수에만 있습니다.')
      const c = d.constants[name] as { value: number; unit?: string; label?: string }
      const { label: _drop, ...rest } = c
      return ok(withDef(doc, { ...d, constants: { ...d.constants, [name]: edit.value.trim() === '' ? rest : { ...rest, label: edit.value } } }))
    }
    case 'value':
      if (k !== 'constant') return fail('값은 상수에만 있습니다.')
      if (!Number.isFinite(edit.value)) return fail('유한한 수여야 합니다.')
      return ok(withDef(doc, { ...d, constants: { ...d.constants, [name]: { ...(d.constants[name] as object), value: edit.value } as (typeof d.constants)[string] } }))
    case 'expr':
      if (k === 'rate') return ok(withDef(doc, { ...d, rates: { ...d.rates, [name]: { ...(d.rates[name] as object), expr: edit.value } as (typeof d.rates)[string] } }))
      if (k === 'auxiliary') return ok(withDef(doc, { ...d, auxiliaries: { ...d.auxiliaries, [name]: { ...(d.auxiliaries[name] as object), expr: edit.value } as (typeof d.auxiliaries)[string] } }))
      return fail('수식은 Rate와 Auxiliary에만 있습니다(Level은 초기값과 유입·유출).')
    case 'init':
      if (k !== 'level') return fail('초기값 수식은 Level에만 있습니다.')
      return ok(withDef(doc, { ...d, levels: { ...d.levels, [name]: { ...(d.levels[name] as object), init: edit.value } as (typeof d.levels)[string] } }))
    case 'inflows':
      if (k !== 'level') return fail('유입·유출은 Level에만 있습니다.')
      return ok(withDef(doc, { ...d, levels: { ...d.levels, [name]: { ...(d.levels[name] as (typeof d.levels)[string]), inflows: [...edit.value] } } }))
    case 'outflows':
      if (k !== 'level') return fail('유입·유출은 Level에만 있습니다.')
      return ok(withDef(doc, { ...d, levels: { ...d.levels, [name]: { ...(d.levels[name] as (typeof d.levels)[string]), outflows: [...edit.value] } } }))
  }
}

function withUnit<T extends { unit?: string }>(v: T, unit: string): T {
  const { unit: _drop, ...rest } = v
  return (unit.trim() === '' ? rest : { ...rest, unit }) as T
}

/** Rate와 Auxiliary는 같은 모양이라 서로 바꿀 수 있다(Level의 유입·유출 목록에서의 위치는 그대로). */
export function changeFlowKind(doc: ModelDoc, name: string, to: 'rate' | 'auxiliary'): EditResult {
  const k = kindOf(doc.def, name)
  if (k !== 'rate' && k !== 'auxiliary') return fail('Rate와 Auxiliary만 서로 바꿀 수 있습니다.')
  if (k === to) return ok(doc)
  const d = doc.def
  const src = (k === 'rate' ? d.rates : d.auxiliaries)[name] as { expr: string; unit?: string }
  const rest = Object.fromEntries(Object.entries(k === 'rate' ? d.rates : d.auxiliaries).filter(([n]) => n !== name))
  const def: ModelDef = k === 'rate' ? { ...d, rates: rest, auxiliaries: { ...d.auxiliaries, [name]: src } } : { ...d, auxiliaries: rest, rates: { ...d.rates, [name]: src } }
  return ok(withDef(doc, def), `'${name}'을(를) ${KIND_LABEL[to]}로 바꿨습니다.`)
}

// ---------- 모델 정보 ----------

export function setMeta(doc: ModelDoc, patch: { name?: string; end?: number; dt?: number; start?: number }): EditResult {
  if (patch.name !== undefined && patch.name.trim() === '') return fail('모델 이름이 비어 있습니다.')
  if (patch.dt !== undefined && !(patch.dt > 0)) return fail('적분 간격은 0보다 커야 합니다.')
  const t = { ...doc.def.time, ...(patch.end !== undefined ? { end: patch.end } : {}), ...(patch.dt !== undefined ? { dt: patch.dt } : {}), ...(patch.start !== undefined ? { start: patch.start } : {}) }
  if (![t.start, t.end, t.dt].every(Number.isFinite)) return fail('시간 설정은 유한한 수여야 합니다.')
  if (!(t.end > t.start)) return fail('종료 시각은 시작 시각보다 커야 합니다.')
  return ok(withDef(doc, { ...doc.def, meta: { ...doc.def.meta, ...(patch.name !== undefined ? { name: patch.name } : {}) }, time: t }))
}

/** 사용자 정의 단위의 글 형식: 줄마다 `이름 = 단위`(예: `인월 = 명·월`). */
export function unitAliasesToText(def: ModelDef): string {
  return Object.entries(def.units?.aliases ?? {}).map(([n, u]) => `${n} = ${u}`).join('\n')
}

/**
 * 사용자 정의 단위(별칭)를 바꾼다(설계 08의 6.3 `units`). 줄마다 `이름 = 단위`이며 비우면 없앤다. 이름은 기본 별칭(맨데이·비율·배·FTE·신입)과 달라야 하고
 * 단위는 읽을 수 있어야 한다. 단위 검사에만 쓰이고 계산에는 영향이 없다.
 */
export function setUnitAliases(doc: ModelDoc, text: string): EditResult {
  const aliases: Record<string, string> = {}
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (line === '') continue
    const at = line.indexOf('=')
    if (at <= 0) return fail(`${i + 1}번째 줄: '이름 = 단위' 형식이어야 합니다.`)
    const name = line.slice(0, at).trim()
    const unit = line.slice(at + 1).trim()
    if (name === '' || /[\s·*/^()（）0-9²³]/.test(name)) return fail(`${i + 1}번째 줄: 이름 '${name}'에 공백·연산자·숫자를 쓸 수 없습니다.`)
    if (name in DEFAULT_UNIT_ALIASES) return fail(`${i + 1}번째 줄: '${name}'은(는) 기본 별칭이라 다시 정의할 수 없습니다.`)
    if (name in aliases) return fail(`${i + 1}번째 줄: '${name}'이(가) 겹칩니다.`)
    aliases[name] = unit
  }
  for (const [name, unit] of Object.entries(aliases)) {
    const p = parseUnit(unit, { ...DEFAULT_UNIT_ALIASES, ...aliases })
    if (!p.ok) return fail(`'${name} = ${unit}': ${p.error.message}`)
  }
  const { units: _drop, ...rest } = doc.def
  const def: ModelDef = Object.keys(aliases).length > 0 ? { ...rest, units: { aliases } } : rest
  return ok({ ...doc, def })
}

export function setInfo(doc: ModelDoc, patch: { description?: string; author?: string }): ModelDoc {
  const info = { ...doc.info, ...(patch.description !== undefined ? { description: patch.description } : {}), ...(patch.author !== undefined ? (patch.author === '' ? {} : { author: patch.author }) : {}) }
  if (patch.author === '') delete (info as { author?: string }).author
  return { ...doc, info }
}

/** `spec`을 통째로 바꾼다(앱 연결 편집 화면이 쓴다). 상수에 없는 파라미터 같은 불일치는 적용 게이트가 알린다. */
export function setSpec(doc: ModelDoc, spec: ModelSpec): ModelDoc {
  return { ...doc, spec }
}

/**
 * `spec`을 모델과 맞춘다: 모든 상수에 파라미터 정의가 있게(없으면 제안 범위로 만든다) 하고, 상수가 아니게 된 이름·없는 변수를 가리키는 항목을
 * 정리한다. 변수를 더하거나 지우는 명령이 부른다.
 */
export function syncSpec(doc: ModelDoc): ModelDoc {
  const { def, spec } = doc
  const constants = Object.keys(def.constants)
  const have = new Set(spec.params.map((p) => p.name))
  const params = [
    ...spec.params.filter((p) => p.name in def.constants),
    ...constants.filter((c) => !have.has(c)).map((c) => ({ name: c, group: spec.params[0]?.group ?? '기본', ...suggestRange((def.constants[c] as { value: number }).value) }))
  ]
  return { ...doc, spec: { ...spec, params } }
}
