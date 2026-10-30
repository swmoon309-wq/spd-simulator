import { findReferences, interpolate, parse, renameTableInExpr, ExprError, type ModelDef, type Node } from '@spd/sd-engine'
import { MODEL_LIMITS } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../modelDoc'
import { kindOf, type EditResult } from './commands'

/**
 * 그래프 함수(이름 있는 테이블) 편집(EDT-04, 설계 08의 7장). 엔진의 `GRAPH`는 이름 있는 테이블 `GRAPH(x, 이름)`과 인라인 `GRAPH(x, [x…], [y…])` 두
 * 가지를 쓰는데, 편집기는 **이름 있는 테이블을 권장**하고 인라인은 "테이블로 바꾸기"를 제공한다. 보간은 엔진 규칙(선형, 범위 밖은 양 끝값)이다.
 * 모두 순수 함수다.
 */

export type TableData = ModelDef['tables'][string]

const fail = (message: string): EditResult => ({ ok: false, message })
const ok = (doc: ModelDoc, note?: string): EditResult => ({ ok: true, doc, ...(note ? { note } : {}) })
const round = (v: number): number => Number(v.toPrecision(8))

// ---------- 곡선 모양 ----------

export interface CurveShape {
  id: string
  label: string
  description: string
  x: number[]
  y: number[]
}

/**
 * 시작점으로 쓰는 곡선 모양(책 2.6.3.1의 형태만, 수치는 사용자가 정한다). 입력을 기준값에 대한 비(기준 = 1)로 정규화하고 기준점 x = 1에서 y = 1이
 * 되게 했다. 모두 단조다.
 */
export const CURVE_SHAPES: CurveShape[] = [
  { id: 'linear-up', label: '선형 증가', description: '입력에 비례해 늘어납니다.', x: [0, 1, 2], y: [0, 1, 2] },
  { id: 'linear-down', label: '선형 감소', description: '입력이 늘수록 일정하게 줄어듭니다.', x: [0, 1, 2], y: [2, 1, 0] },
  { id: 'saturating', label: '포화(수확 체감) 증가', description: '처음엔 빠르게 늘다가 점점 완만해집니다.', x: [0, 0.5, 1, 1.5, 2], y: [0, 0.65, 1, 1.2, 1.3] },
  { id: 's-up', label: 'S자 증가', description: '완만하다가 가운데에서 빠르게 늘고 다시 완만해집니다.', x: [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2], y: [0, 0.05, 0.25, 0.7, 1, 1.3, 1.45, 1.5] },
  { id: 's-down', label: 'S자 감소', description: '완만하다가 가운데에서 빠르게 줄고 다시 완만해집니다.', x: [0, 0.5, 1, 1.5, 2], y: [2, 1.7, 1, 0.3, 0.1] }
]

// ---------- 조회 ----------

/** 테이블을 쓰는 변수(수식 안의 `GRAPH(x, 이름)`). */
export function tableUsage(def: ModelDef, table: string): string[] {
  const out: string[] = []
  const scan = (variable: string, source: string) => {
    if (findReferences(source).refs.some((r) => r.kind === 'table' && r.name === table)) out.push(variable)
  }
  for (const [n, l] of Object.entries(def.levels)) scan(n, l.init)
  for (const [n, r] of Object.entries(def.rates)) scan(n, r.expr)
  for (const [n, a] of Object.entries(def.auxiliaries)) scan(n, a.expr)
  return out
}

/** 테이블 이름 규칙(영문자·숫자·_). 쓸 수 있으면 null, 아니면 이유. */
export function tableNameProblem(def: ModelDef, name: string, ignore?: string): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return '영문자·숫자·_만 쓸 수 있고 숫자로 시작할 수 없습니다.'
  if (name.length > 64) return '이름은 64자 이하여야 합니다.'
  if (name !== ignore && name in def.tables) return '이미 있는 테이블 이름입니다.'
  if (kindOf(def, name)) return '같은 이름의 변수가 있습니다.'
  return null
}

function uniqueTableName(def: ModelDef, base: string, taken: Set<string> = new Set()): string {
  let name = base
  for (let i = 2; name in def.tables || kindOf(def, name) || taken.has(name); i++) name = `${base}_${i}`
  return name
}

// ---------- 곡선 분석(권고) ----------

export interface CurveAdvice {
  severity: 'warning' | 'info'
  message: string
}

export interface CurveAnalysis {
  direction: 'increasing' | 'decreasing' | 'flat' | 'non-monotone'
  /** 방향이 바뀌는 점의 번호(0부터, 단조가 아닐 때) */
  turns: number[]
  /** 기준점 x = 1에서의 y(보간). x 범위가 1을 지나지 않으면 null */
  atOne: number | null
  advice: CurveAdvice[]
}

/**
 * 곡선을 책 2.6.3의 권고에 비춰 본다: **입력을 기준값에 대한 비로 정규화하고 기준점에서 1이 되게** 하며 **매끈한 단조 곡선**을 쓴다. 단조가 아니면 경고,
 * 기준점(x = 1)에서 y가 1이 아니면 정보, 입력·출력 단위가 무차원이 아니면 정규화를 권하는 정보. 권고일 뿐 막지 않는다.
 */
export function analyzeCurve(t: TableData): CurveAnalysis {
  const diffs = t.y.slice(1).map((v, i) => v - (t.y[i] as number))
  const up = diffs.some((d) => d > 1e-12)
  const down = diffs.some((d) => d < -1e-12)
  const direction: CurveAnalysis['direction'] = up && down ? 'non-monotone' : up ? 'increasing' : down ? 'decreasing' : 'flat'
  const turns: number[] = []
  if (direction === 'non-monotone') {
    let last = 0
    diffs.forEach((d, i) => {
      const s = Math.abs(d) <= 1e-12 ? 0 : d > 0 ? 1 : -1
      if (s !== 0 && last !== 0 && s !== last) turns.push(i)
      if (s !== 0) last = s
    })
  }
  const first = t.x[0] as number
  const lastX = t.x[t.x.length - 1] as number
  const atOne = first <= 1 && lastX >= 1 ? interpolate(t)(1) : null
  const advice: CurveAdvice[] = []
  if (direction === 'non-monotone') advice.push({ severity: 'warning', message: `곡선이 단조가 아닙니다(${turns.map((i) => `${i + 1}번째 점에서`).join(', ')} 방향이 바뀝니다). 책 2.6.3은 매끈한 단조 곡선을 권합니다.` })
  if (direction === 'flat') advice.push({ severity: 'info', message: '모든 점의 y가 같아 입력과 무관한 상수 함수입니다.' })
  if (atOne !== null && Math.abs(atOne - 1) > 1e-9) advice.push({ severity: 'info', message: `기준점(x = 1)에서 y가 ${round(atOne)}입니다. 입력을 기준값에 대한 비로 정규화하면 기준점에서 1이 되게 하는 것을 책 2.6.3이 권합니다.` })
  const nonNormalized = (u: string | undefined) => u !== undefined && u.trim() !== '' && !['비율', '배', '1', '0/1'].includes(u.trim())
  if (nonNormalized(t.xUnit)) advice.push({ severity: 'info', message: `입력에 단위(${t.xUnit})가 있습니다. 책 2.6.3은 입력을 기준값에 대한 비로 정규화해 무차원으로 쓰기를 권합니다.` })
  return { direction, turns, atOne, advice }
}

// ---------- 편집 ----------

const validate = (x: number[], y: number[]): string | null => {
  if (x.length !== y.length) return 'x와 y의 개수가 다릅니다.'
  if (x.length < 2) return '점이 2개 이상 필요합니다.'
  if (x.length > MODEL_LIMITS.tablePoints) return `점은 최대 ${MODEL_LIMITS.tablePoints}개입니다.`
  if (![...x, ...y].every(Number.isFinite)) return '모든 값이 유한한 수여야 합니다.'
  for (let i = 1; i < x.length; i++) {
    if ((x[i] as number) === (x[i - 1] as number)) return `${i}번째와 ${i + 1}번째 점의 x가 같습니다.`
    if ((x[i] as number) < (x[i - 1] as number)) return `x는 오름차순이어야 합니다(${i + 1}번째 점이 앞보다 작습니다). "정렬"로 순서를 맞출 수 있습니다.`
  }
  return null
}

const withTables = (doc: ModelDoc, tables: ModelDef['tables']): ModelDoc => ({ ...doc, def: { ...doc.def, tables } })

/** 테이블을 더한다. 점은 곡선 모양에서(기본 선형 증가). 이름이 없으면 `curve`, `curve_2`, … */
export function addTable(doc: ModelDoc, wanted?: string, shape: string = 'linear-up'): EditResult {
  if (Object.keys(doc.def.tables).length >= MODEL_LIMITS.tables) return fail(`테이블은 최대 ${MODEL_LIMITS.tables}개입니다.`)
  const s = CURVE_SHAPES.find((c) => c.id === shape)
  if (!s) return fail('알 수 없는 곡선 모양입니다.')
  const name = wanted && wanted.trim() !== '' ? wanted.trim() : uniqueTableName(doc.def, 'curve')
  const problem = tableNameProblem(doc.def, name)
  if (problem) return fail(`'${name}': ${problem}`)
  return ok(withTables(doc, { ...doc.def.tables, [name]: { x: [...s.x], y: [...s.y] } }), `테이블 '${name}'을(를) 더했습니다(${s.label}).`)
}

/** 테이블 이름을 바꾸고 그 테이블을 쓰는 모든 `GRAPH(x, 이름)`을 함께 고친다(토큰 단위). */
export function renameTable(doc: ModelDoc, from: string, to: string): EditResult {
  if (from === to) return ok(doc)
  if (!(from in doc.def.tables)) return fail(`테이블 '${from}'을(를) 찾을 수 없습니다.`)
  const problem = tableNameProblem(doc.def, to)
  if (problem) return fail(`'${to}': ${problem}`)
  let count = 0
  const rx = (s: string) => {
    const r = renameTableInExpr(s, from, to)
    count += r.count
    return r.source
  }
  const d = doc.def
  const def: ModelDef = {
    ...d,
    tables: Object.fromEntries(Object.entries(d.tables).map(([k, v]) => [k === from ? to : k, v])),
    levels: Object.fromEntries(Object.entries(d.levels).map(([n, l]) => [n, { ...l, init: rx(l.init) }])),
    rates: Object.fromEntries(Object.entries(d.rates).map(([n, r]) => [n, { ...r, expr: rx(r.expr) }])),
    auxiliaries: Object.fromEntries(Object.entries(d.auxiliaries).map(([n, a]) => [n, { ...a, expr: rx(a.expr) }]))
  }
  return ok({ ...doc, def }, `테이블 '${from}' → '${to}': 수식 ${count}곳을 함께 바꿨습니다.`)
}

/** 테이블을 지운다. 쓰는 수식이 있으면 거절하고 목록을 알린다. */
export function deleteTable(doc: ModelDoc, name: string): EditResult {
  if (!(name in doc.def.tables)) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  const used = tableUsage(doc.def, name)
  if (used.length > 0) return fail(`테이블 '${name}'을(를) ${used.map((u) => `'${u}'`).join(', ')}의 수식이 쓰고 있습니다. 먼저 수식을 고치세요.`)
  return ok(withTables(doc, Object.fromEntries(Object.entries(doc.def.tables).filter(([k]) => k !== name))), `테이블 '${name}'을(를) 지웠습니다.`)
}

const tableOf = (doc: ModelDoc, name: string): TableData | null => doc.def.tables[name] ?? null
const replaceTable = (doc: ModelDoc, name: string, t: TableData): ModelDoc => withTables(doc, { ...doc.def.tables, [name]: t })

/** 점 전체를 바꾼다. x는 엄격한 오름차순, 2~100개, 유한한 수. */
export function setTable(doc: ModelDoc, name: string, x: number[], y: number[]): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  const problem = validate(x, y)
  if (problem) return fail(problem)
  return ok(replaceTable(doc, name, { ...t, x: [...x], y: [...y] }))
}

/** 점 하나의 x·y를 바꾼다. `sort`이면 x를 바꿔 순서가 어긋난 점을 자동으로 정렬한다(아니면 거절). */
export function setTablePoint(doc: ModelDoc, name: string, index: number, patch: { x?: number; y?: number }, sort = false): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  if (!Number.isInteger(index) || index < 0 || index >= t.x.length) return fail('그런 점이 없습니다.')
  let pts = t.x.map((x, i) => ({ x, y: t.y[i] as number }))
  pts[index] = { x: patch.x ?? (t.x[index] as number), y: patch.y ?? (t.y[index] as number) }
  if (sort) pts = pts.sort((a, b) => a.x - b.x)
  return setTable(doc, name, pts.map((p) => p.x), pts.map((p) => p.y))
}

/** `index`번째 점 뒤에 점을 더한다(앞뒤 점의 가운데 x, 보간한 y). 마지막 점 뒤면 간격만큼 오른쪽에 더한다. */
export function insertTablePoint(doc: ModelDoc, name: string, index: number): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  if (t.x.length >= MODEL_LIMITS.tablePoints) return fail(`점은 최대 ${MODEL_LIMITS.tablePoints}개입니다.`)
  const i = Math.min(Math.max(index, 0), t.x.length - 1)
  const f = interpolate(t)
  const last = i === t.x.length - 1
  const x = last ? (t.x[i] as number) + ((t.x[i] as number) - (t.x[Math.max(0, i - 1)] as number) || 1) : round(((t.x[i] as number) + (t.x[i + 1] as number)) / 2)
  const y = last ? (t.y[i] as number) : round(f(x))
  const xs = [...t.x.slice(0, i + 1), x, ...t.x.slice(i + 1)]
  const ys = [...t.y.slice(0, i + 1), y, ...t.y.slice(i + 1)]
  return setTable(doc, name, xs, ys)
}

/** 점 하나를 지운다. 2개 밑으로는 줄일 수 없다. */
export function removeTablePoint(doc: ModelDoc, name: string, index: number): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  if (t.x.length <= 2) return fail('점이 2개 이상 있어야 합니다.')
  if (!Number.isInteger(index) || index < 0 || index >= t.x.length) return fail('그런 점이 없습니다.')
  return setTable(doc, name, t.x.filter((_, i) => i !== index), t.y.filter((_, i) => i !== index))
}

/** x 범위를 그대로 두고 점 `n`개로 균등 분할한다(y는 보간). */
export function resampleTable(doc: ModelDoc, name: string, n: number): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  if (!Number.isInteger(n) || n < 2 || n > MODEL_LIMITS.tablePoints) return fail(`점 개수는 2~${MODEL_LIMITS.tablePoints}의 정수여야 합니다.`)
  const a = t.x[0] as number
  const b = t.x[t.x.length - 1] as number
  const f = interpolate(t)
  const xs = Array.from({ length: n }, (_, i) => (i === n - 1 ? b : round(a + ((b - a) * i) / (n - 1))))
  return setTable(doc, name, xs, xs.map((x) => round(f(x))))
}

/** 점의 순서를 x 오름차순으로 맞춘다(x가 겹치면 거절). */
export function sortTable(doc: ModelDoc, name: string): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  const pts = t.x.map((x, i) => ({ x, y: t.y[i] as number })).sort((p, q) => p.x - q.x)
  return setTable(doc, name, pts.map((p) => p.x), pts.map((p) => p.y))
}

/** 입력·출력 단위(없으면 무차원). 빈 문자열이면 단위를 없앤다. */
export function setTableUnits(doc: ModelDoc, name: string, units: { xUnit?: string; yUnit?: string }): EditResult {
  const t = tableOf(doc, name)
  if (!t) return fail(`테이블 '${name}'을(를) 찾을 수 없습니다.`)
  const next: TableData = { ...t }
  for (const k of ['xUnit', 'yUnit'] as const) {
    const v = units[k]
    if (v === undefined) continue
    if (v.trim() === '') delete next[k]
    else next[k] = v.trim()
  }
  return ok(replaceTable(doc, name, next))
}

/** 곡선 모양으로 점을 통째로 바꾼다(시작점). */
export function applyCurveShape(doc: ModelDoc, name: string, shape: string): EditResult {
  const s = CURVE_SHAPES.find((c) => c.id === shape)
  if (!s) return fail('알 수 없는 곡선 모양입니다.')
  return setTable(doc, name, s.x, s.y)
}

// ---------- 인라인 GRAPH → 테이블 ----------

export interface InlineGraph {
  variable: string
  field: 'init' | 'expr'
  /** 수식 안에서 `[x…], [y…]`가 차지하는 글자 범위 */
  start: number
  end: number
  x: number[]
  y: number[]
  /** 이 호출이 수식 전체인가(`GRAPH(...)` 하나뿐) */
  whole: boolean
}

function constValue(n: Node): number | null {
  switch (n.kind) {
    case 'num':
      return n.value
    case 'unary': {
      if (n.op === 'NOT') return null
      const v = constValue(n.arg)
      return v === null ? null : n.op === '-' ? -v : v
    }
    case 'binary': {
      const l = constValue(n.left)
      const r = constValue(n.right)
      if (l === null || r === null) return null
      if (n.op === '+') return l + r
      if (n.op === '-') return l - r
      if (n.op === '*') return l * r
      if (n.op === '/') return l / r
      if (n.op === '^') return Math.pow(l, r)
      return null
    }
    default:
      return null
  }
}

function constArray(n: Node): number[] | null {
  if (n.kind !== 'array') return null
  const vals = n.items.map(constValue)
  return vals.some((v) => v === null) ? null : (vals as number[])
}

function inlineIn(variable: string, field: 'init' | 'expr', source: string): InlineGraph[] {
  let ast: Node
  try {
    ast = parse(source)
  } catch (e) {
    if (e instanceof ExprError) return []
    throw e
  }
  const found: InlineGraph[] = []
  const walk = (n: Node): void => {
    if (n.kind === 'call') {
      if (n.name.toUpperCase() === 'GRAPH' && n.args.length === 3) {
        const xs = constArray(n.args[1] as Node)
        const ys = constArray(n.args[2] as Node)
        const a2 = (n.args[1] as Node).pos
        const a3 = (n.args[2] as Node).pos
        const close = source.indexOf(']', a3)
        if (xs && ys && close >= 0) found.push({ variable, field, start: a2, end: close + 1, x: xs, y: ys, whole: ast === n })
      }
      n.args.forEach(walk)
    } else if (n.kind === 'unary') walk(n.arg)
    else if (n.kind === 'binary') {
      walk(n.left)
      walk(n.right)
    } else if (n.kind === 'array') n.items.forEach(walk)
  }
  walk(ast)
  return found
}

/** 인라인 `GRAPH(x, [x…], [y…])`(좌표가 상수 숫자인 것)를 모두 찾는다. 정의 순서를 따른다. */
export function findInlineGraphs(def: ModelDef): InlineGraph[] {
  return [
    ...Object.entries(def.levels).flatMap(([n, l]) => inlineIn(n, 'init', l.init)),
    ...Object.entries(def.rates).flatMap(([n, r]) => inlineIn(n, 'expr', r.expr)),
    ...Object.entries(def.auxiliaries).flatMap(([n, a]) => inlineIn(n, 'expr', a.expr))
  ]
}

/**
 * 인라인 GRAPH를 이름 있는 테이블로 바꾼다(`variable`을 주면 그 변수만). 테이블 이름은 `<변수>_curve`(겹치면 `_2`…)이고 점은 그대로이며, 수식이 GRAPH
 * 하나뿐이고 변수에 단위가 선언되어 있으면 그 단위를 출력 단위(`yUnit`)로 적는다. **보간 규칙이 같아 결과는 비트 단위로 같다.**
 */
export function inlineToTables(doc: ModelDoc, variable?: string): EditResult {
  const all = findInlineGraphs(doc.def).filter((g) => variable === undefined || g.variable === variable)
  if (all.length === 0) return fail(variable ? `'${variable}'에는 바꿀 인라인 GRAPH가 없습니다.` : '바꿀 인라인 GRAPH가 없습니다.')
  const taken = new Set<string>()
  const tables = { ...doc.def.tables }
  let def: ModelDef = doc.def
  // 변수·필드별로 수식 뒤쪽부터 바꿔 앞쪽의 글자 위치가 어긋나지 않게 한다
  const groups = new Map<string, InlineGraph[]>()
  for (const g of all) groups.set(`${g.variable}\u0000${g.field}`, [...(groups.get(`${g.variable}\u0000${g.field}`) ?? []), g])
  const names = new Map<InlineGraph, string>()
  for (const g of all) {
    const name = uniqueTableName({ ...doc.def, tables }, `${g.variable}_curve`, taken)
    taken.add(name)
    names.set(g, name)
    tables[name] = { x: g.x, y: g.y }
  }
  for (const list of groups.values()) {
    const first = list[0] as InlineGraph
    const k = kindOf(def, first.variable)
    let source = (first.field === 'init' ? def.levels[first.variable]?.init : k === 'rate' ? def.rates[first.variable]?.expr : def.auxiliaries[first.variable]?.expr) as string
    for (const g of [...list].sort((a, b) => b.start - a.start)) source = source.slice(0, g.start) + (names.get(g) as string) + source.slice(g.end)
    if (first.field === 'init') def = { ...def, levels: { ...def.levels, [first.variable]: { ...(def.levels[first.variable] as object), init: source } as (typeof def.levels)[string] } }
    else if (k === 'rate') def = { ...def, rates: { ...def.rates, [first.variable]: { ...(def.rates[first.variable] as object), expr: source } as (typeof def.rates)[string] } }
    else def = { ...def, auxiliaries: { ...def.auxiliaries, [first.variable]: { ...(def.auxiliaries[first.variable] as object), expr: source } as (typeof def.auxiliaries)[string] } }
    if (list.length === 1 && first.whole) {
      const unit = (first.field === 'init' ? def.levels[first.variable]?.unit : k === 'rate' ? def.rates[first.variable]?.unit : def.auxiliaries[first.variable]?.unit)?.trim()
      if (unit) tables[names.get(first) as string] = { ...(tables[names.get(first) as string] as TableData), yUnit: unit }
    }
  }
  return ok({ ...doc, def: { ...def, tables } }, `인라인 GRAPH ${all.length}곳을 테이블 ${[...names.values()].join(', ')}(으)로 바꿨습니다.`)
}
