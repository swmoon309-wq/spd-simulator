import type { Node } from '../expr/ast'
import { ExprError } from '../expr/errors'
import { parse } from '../expr/parser'
import type { ModelDef } from '../model/schema'
import { DEFAULT_UNIT_ALIASES, DIMENSIONLESS, divDim, equalDim, formatDim, isDimensionless, mulDim, parseUnit, powDim, type Dim, type UnitAliases } from './unit'

export type UnitCode =
  | 'unit-parse'
  | 'unit-mismatch'
  | 'unit-argument'
  | 'unit-init'
  | 'unit-flow'
  | 'unit-declared'
  | 'unit-unresolved'
  | 'unit-literal'
  | 'unit-missing'
  | 'unit-suggest'

export interface UnitIssue {
  /** 확정된 불일치는 오류, 추론할 수 없는 것은 경고, 단위 선언이 없거나 제안은 정보 */
  severity: 'error' | 'warning' | 'info'
  code: UnitCode
  message: string
  variable?: string
  field?: 'unit' | 'init' | 'expr' | 'inflows' | 'outflows' | 'tables'
  /** 수식 안의 글자 범위 [start, end) */
  range?: [number, number]
  /** "이 단위로 정하기"로 채울 단위 문자열(`unit-suggest`·`unit-declared`) */
  suggestion?: string
}

/** 식의 단위 추론 결과: 알고 있음 / 단위 미정(숫자 리터럴, 어떤 단위로도 쓸 수 있다) / 알 수 없음(단위 없는 변수 등). */
type Val = { t: 'known'; dim: Dim } | { t: 'free'; zero: boolean } | { t: 'unknown' }
const known = (dim: Dim): Val => ({ t: 'known', dim })
const UNKNOWN: Val = { t: 'unknown' }
const ONE: Val = known(DIMENSIONLESS)
const DAY: Dim = Object.freeze({ 일: 1 })

const OP_LEN: Record<string, number> = { AND: 3, OR: 2, NOT: 3, '<=': 2, '>=': 2, '<>': 2 }

/**
 * 모델의 수식 단위를 검사한다(설계 08의 6.3, EDT-03). 각 변수의 단위(선언한 것, 없으면 수식에서 추론한 것)로 수식 안의 항별 단위를 맞춰 본다.
 * **더하고 빼고 비교하는 항, MIN·MAX·IF의 분기, SMOOTH 지연시간(일), GRAPH의 입력·출력, Level의 유입·유출(Level 단위/일)과 초기값, 선언한 단위와 추론한
 * 단위**를 확인한다. 숫자 리터럴은 단위 미정이라 어떤 단위로도 쓸 수 있고 0은 어디서나 허용한다. 순수 함수이며 결과 순서는 입력이 같으면 같다.
 */
export function checkModelUnits(def: ModelDef): UnitIssue[] {
  const issues: UnitIssue[] = []
  const aliases: UnitAliases = { ...DEFAULT_UNIT_ALIASES, ...(def.units?.aliases ?? {}) }
  const add = (i: UnitIssue) => void issues.push(i)

  // ---------- 변수의 선언된 단위 ----------
  type Kind = 'constant' | 'level' | 'rate' | 'auxiliary'
  const kindOf = new Map<string, Kind>()
  const declared = new Map<string, string | undefined>()
  const record = (rec: Record<string, { unit?: string | undefined }>, kind: Kind) => {
    for (const [n, v] of Object.entries(rec)) {
      kindOf.set(n, kind)
      declared.set(n, v.unit)
    }
  }
  record(def.constants, 'constant')
  record(def.levels, 'level')
  record(def.rates, 'rate')
  record(def.auxiliaries, 'auxiliary')
  const dimOfDeclared = new Map<string, Dim | null>() // null: 선언이 없거나 읽을 수 없다
  for (const [n, u] of declared) {
    if (u === undefined || u.trim() === '') {
      dimOfDeclared.set(n, null)
      add({ severity: 'info', code: 'unit-missing', message: `'${n}'에 단위가 없습니다`, variable: n, field: 'unit' })
      continue
    }
    const p = parseUnit(u, aliases)
    if (!p.ok) {
      dimOfDeclared.set(n, null)
      add({ severity: 'warning', code: 'unit-parse', message: `'${n}'의 단위 '${u}'를 읽을 수 없습니다: ${p.error.message}`, variable: n, field: 'unit' })
    } else dimOfDeclared.set(n, p.dim)
  }
  const tableDim = (t: string | undefined): Dim => {
    if (t === undefined || t.trim() === '') return DIMENSIONLESS
    const p = parseUnit(t, aliases)
    return p.ok ? p.dim : DIMENSIONLESS
  }

  // ---------- 수식 추론 ----------
  const sources = new Map<string, { field: 'init' | 'expr'; source: string }>()
  for (const [n, l] of Object.entries(def.levels)) sources.set(n, { field: 'init', source: l.init })
  for (const [n, r] of Object.entries(def.rates)) sources.set(n, { field: 'expr', source: r.expr })
  for (const [n, a] of Object.entries(def.auxiliaries)) sources.set(n, { field: 'expr', source: a.expr })

  /** 수식의 추론 단위(선언이 없는 Rate·Auxiliary를 참조하면 그 수식에서 추론한다). 한 번만 계산한다. */
  const inferred = new Map<string, { val: Val; unknownRefs: Set<string> }>()
  const inProgress = new Set<string>()

  const unitOfVar = (name: string): Val => {
    const d = dimOfDeclared.get(name)
    if (d) return known(d)
    const k = kindOf.get(name)
    if (k === 'rate' || k === 'auxiliary') return inferVariable(name).val
    return UNKNOWN
  }

  function inferVariable(name: string): { val: Val; unknownRefs: Set<string> } {
    const memo = inferred.get(name)
    if (memo) return memo
    if (inProgress.has(name)) return { val: UNKNOWN, unknownRefs: new Set() } // 순환은 lintModel이 알린다
    inProgress.add(name)
    const src = sources.get(name)
    const out = { val: UNKNOWN as Val, unknownRefs: new Set<string>() }
    if (src) {
      const r = inferExpr(name, src.field, src.source, false)
      out.val = r.val
      out.unknownRefs = r.unknownRefs
    }
    inProgress.delete(name)
    inferred.set(name, out)
    return out
  }

  /** 수식 하나를 추론한다. `report`가 true일 때만 문제를 보고한다(다른 변수에서 참조하려고 추론할 때는 그 변수 자신의 검사가 보고한다). */
  const reported = new Set<string>()
  function inferExpr(name: string, field: 'init' | 'expr', source: string, report: boolean): { val: Val; unknownRefs: Set<string> } {
    const unknownRefs = new Set<string>()
    let ast: Node
    try {
      ast = parse(source)
    } catch (e) {
      if (e instanceof ExprError) return { val: UNKNOWN, unknownRefs }
      throw e
    }
    const err = (code: UnitCode, message: string, node: Node) => {
      if (!report) return
      add({ severity: 'error', code, message, variable: name, field, range: rangeOf(node, source) })
    }
    const note = (code: UnitCode, message: string, node: Node) => {
      if (!report) return
      add({ severity: 'info', code, message, variable: name, field, range: rangeOf(node, source) })
    }
    const litText = (n: Node | undefined): string => (n?.kind === 'num' ? String(n.value) : '숫자')
    const fmt = (v: Val): string => (v.t === 'known' ? formatDim(v.dim) : v.t === 'free' ? '(단위 미정)' : '(알 수 없음)')
    const dimOf = (v: Val): Dim | null => (v.t === 'known' ? v.dim : null)

    /** 두 값을 같은 단위로 맞춘다(+, −, 비교, MIN·MAX…). 확정된 불일치는 오류로 보고하고 알려진 쪽을 돌려준다. */
    const unify = (a: Val, b: Val, node: Node, what: string, nonzeroLiteral?: Node): Val => {
      if (a.t === 'known' && b.t === 'known') {
        if (!equalDim(a.dim, b.dim)) {
          err('unit-mismatch', `${what}의 단위가 다릅니다: ${fmt(a)} ≠ ${fmt(b)}`, node)
          return a
        }
        return a
      }
      if (a.t === 'known') {
        if (b.t === 'free' && !b.zero && !isDimensionless(a.dim) && nonzeroLiteral) note('unit-literal', `${what}에 단위가 없는 숫자 ${litText(nonzeroLiteral)}이(가) 섞여 있습니다. 숫자는 단위 미정으로 보고 ${fmt(a)}로 읽습니다`, nonzeroLiteral)
        return a
      }
      if (b.t === 'known') {
        if (a.t === 'free' && !a.zero && !isDimensionless(b.dim) && nonzeroLiteral) note('unit-literal', `${what}에 단위가 없는 숫자 ${litText(nonzeroLiteral)}이(가) 섞여 있습니다. 숫자는 단위 미정으로 보고 ${fmt(b)}로 읽습니다`, nonzeroLiteral)
        return b
      }
      if (a.t === 'free' && b.t === 'free') return { t: 'free', zero: a.zero && b.zero }
      return UNKNOWN
    }
    const mustBe = (v: Val, dim: Dim, node: Node, what: string): void => {
      if (v.t === 'known' && !equalDim(v.dim, dim)) err('unit-argument', `${what}의 단위는 ${formatDim(dim)}이어야 하는데 ${fmt(v)}입니다`, node)
    }

    const go = (n: Node): Val => {
      switch (n.kind) {
        case 'num':
          return { t: 'free', zero: n.value === 0 }
        case 'var': {
          if (n.name === 'TIME' || n.name === 'DT') return known(DAY)
          if (!kindOf.has(n.name)) return UNKNOWN // 정의되지 않은 변수는 lintModel이 알린다
          const v = unitOfVar(n.name)
          if (v.t === 'unknown') unknownRefs.add(n.name)
          return v
        }
        case 'unary': {
          const a = go(n.arg)
          if (n.op === 'NOT') return ONE
          return a
        }
        case 'binary': {
          const l = go(n.left)
          const r = go(n.right)
          switch (n.op) {
            case '+':
            case '-':
              return unify(l, r, n, `'${n.op}'의 양쪽`, n.left.kind === 'num' && n.left.value !== 0 ? n.left : n.right.kind === 'num' && n.right.value !== 0 ? n.right : undefined)
            case '*':
              return mulVal(l, r)
            case '/':
              return divVal(l, r)
            case '^': {
              const e = literalNumber(n.right)
              if (e !== null) return l.t === 'known' ? known(powDim(l.dim, e)) : l
              // 지수가 식이면 밑과 지수 모두 무차원이어야 한다
              if (l.t === 'known' && !isDimensionless(l.dim)) err('unit-argument', `지수가 상수가 아니면 밑은 무차원이어야 하는데 ${fmt(l)}입니다`, n)
              if (r.t === 'known' && !isDimensionless(r.dim)) err('unit-argument', `지수는 무차원이어야 하는데 ${fmt(r)}입니다`, n.right)
              return l.t === 'free' && r.t !== 'unknown' ? l : l.t === 'unknown' || r.t === 'unknown' ? UNKNOWN : ONE
            }
            case '<':
            case '>':
            case '<=':
            case '>=':
            case '=':
            case '<>':
              unify(l, r, n, `'${n.op}' 비교의 양쪽`)
              return ONE
            case 'AND':
            case 'OR':
              return ONE
          }
          return UNKNOWN
        }
        case 'array':
          return UNKNOWN
        case 'call':
          return call(n)
      }
    }

    const call = (n: Extract<Node, { kind: 'call' }>): Val => {
      const name2 = n.name.toUpperCase()
      const args = n.args
      const a = args.map(go)
      const ar = (i: number): Val => a[i] ?? UNKNOWN
      const same = (indices: number[], what: string): Val => indices.map(ar).reduce((acc, v, i) => (i === 0 ? v : unify(acc, v, n, what)), UNKNOWN as Val)
      switch (name2) {
        case 'IF': {
          const c = ar(0)
          if (c.t === 'known' && !isDimensionless(c.dim)) err('unit-argument', `IF의 조건은 무차원이어야 하는데 ${fmt(c)}입니다`, args[0] as Node)
          return unify(ar(1), ar(2), n, 'IF의 두 값(참·거짓)')
        }
        case 'MIN':
        case 'MAX':
          return a.length === 0 ? UNKNOWN : same(a.map((_, i) => i), `${name2}의 인자`)
        case 'CLAMP':
          return same([0, 1, 2], 'CLAMP의 인자')
        case 'ABS':
          return ar(0)
        case 'ROUND': {
          if (a.length > 1) mustBe(ar(1), DIMENSIONLESS, args[1] as Node, 'ROUND의 자릿수')
          return ar(0)
        }
        case 'SQRT': {
          const x = ar(0)
          return x.t === 'known' ? known(powDim(x.dim, 0.5)) : x
        }
        case 'EXP':
        case 'LN': {
          mustBe(ar(0), DIMENSIONLESS, args[0] as Node, `${name2}의 입력`)
          return ar(0).t === 'unknown' ? UNKNOWN : ONE
        }
        case 'SMOOTH':
        case 'DELAY1':
        case 'DELAY3':
          mustBe(ar(1), DAY, args[1] as Node, `${name2}의 지연시간`)
          return ar(0)
        case 'STEP':
          mustBe(ar(1), DAY, args[1] as Node, 'STEP의 시작시각')
          return ar(0)
        case 'PULSE':
          mustBe(ar(1), DAY, args[1] as Node, 'PULSE의 시작시각')
          mustBe(ar(2), DAY, args[2] as Node, 'PULSE의 폭')
          return ar(0)
        case 'RAMP': {
          mustBe(ar(1), DAY, args[1] as Node, 'RAMP의 시작시각')
          const s = ar(0)
          return s.t === 'known' ? known(mulDim(s.dim, DAY)) : s.t === 'free' ? known(DAY) : s
        }
        case 'RANDOM_UNIFORM':
        case 'RANDOM_NORMAL':
          return same([0, 1], `${name2}의 인자`)
        case 'RANDOM_TRIANGULAR':
          return same([0, 1, 2], 'RANDOM_TRIANGULAR의 인자')
        case 'GRAPH': {
          let xd = DIMENSIONLESS
          let yd = DIMENSIONLESS
          const ref = args[1]
          if (args.length === 2 && ref?.kind === 'var') {
            const t = def.tables[ref.name]
            if (t) {
              xd = tableDim(t.xUnit)
              yd = tableDim(t.yUnit)
            }
          }
          mustBe(ar(0), xd, args[0] as Node, `GRAPH의 입력(테이블의 x 단위)`)
          return known(yd)
        }
      }
      return UNKNOWN
    }

    const val = go(ast)
    if (report && !reported.has(`${name}:${field}`)) reported.add(`${name}:${field}`)
    return { val, unknownRefs }
  }

  const mulVal = (l: Val, r: Val): Val => {
    if (l.t === 'known' && r.t === 'known') return known(mulDim(l.dim, r.dim))
    if (l.t === 'unknown' || r.t === 'unknown') return UNKNOWN
    if (l.t === 'known') return l
    if (r.t === 'known') return r
    return { t: 'free', zero: (l as { zero: boolean }).zero || (r as { zero: boolean }).zero }
  }
  const divVal = (l: Val, r: Val): Val => {
    if (l.t === 'known' && r.t === 'known') return known(divDim(l.dim, r.dim))
    if (l.t === 'unknown' || r.t === 'unknown') return UNKNOWN
    if (l.t === 'known') return l
    if (r.t === 'known') return known(powDim(r.dim, -1))
    return { t: 'free', zero: (l as { zero: boolean }).zero }
  }

  // ---------- 변수별 검사 ----------
  const describeUnknown = (refs: Set<string>): string => `단위가 없거나 알 수 없는 변수(${[...refs].slice(0, 4).join(', ')}${refs.size > 4 ? ' …' : ''})를 쓰고 있습니다`

  for (const [name, src] of sources) {
    const kind = kindOf.get(name) as Kind
    const r = inferExpr(name, src.field, src.source, true)
    const d = dimOfDeclared.get(name) ?? null
    if (kind === 'level') {
      if (r.val.t === 'known' && d && !equalDim(r.val.dim, d)) add({ severity: 'error', code: 'unit-init', message: `'${name}'의 초기값 수식 단위(${formatDim(r.val.dim)})가 Level의 단위(${formatDim(d)})와 다릅니다`, variable: name, field: 'init', range: [0, src.source.length] })
      if (r.val.t === 'unknown' && d && r.unknownRefs.size > 0) add({ severity: 'warning', code: 'unit-unresolved', message: `'${name}'의 초기값을 검사하지 못했습니다: ${describeUnknown(r.unknownRefs)}`, variable: name, field: 'init' })
      continue
    }
    if (d && r.val.t === 'known' && !equalDim(d, r.val.dim)) {
      add({ severity: 'error', code: 'unit-declared', message: `'${name}'의 선언한 단위(${formatDim(d)})가 수식에서 추론한 단위(${formatDim(r.val.dim)})와 다릅니다`, variable: name, field: 'unit', suggestion: formatDim(r.val.dim) })
    } else if (!d && r.val.t === 'known' && dimOfDeclared.get(name) === null && (declared.get(name) ?? '').trim() === '') {
      add({ severity: 'info', code: 'unit-suggest', message: `'${name}'의 단위를 수식에서 추론하면 '${formatDim(r.val.dim)}'입니다`, variable: name, field: 'unit', suggestion: formatDim(r.val.dim) })
    } else if (d && r.val.t === 'unknown' && r.unknownRefs.size > 0) {
      add({ severity: 'warning', code: 'unit-unresolved', message: `'${name}'의 수식을 검사하지 못했습니다: ${describeUnknown(r.unknownRefs)}`, variable: name, field: 'expr' })
    }
  }

  // Level의 유입·유출: 단위는 "Level 단위/일"이어야 한다
  for (const [name, level] of Object.entries(def.levels)) {
    const ld = dimOfDeclared.get(name) ?? null
    const want = ld ? divDim(ld, DAY) : null
    for (const [list, flows] of [['inflows', level.inflows], ['outflows', level.outflows]] as const) {
      for (const f of flows) {
        if (!kindOf.has(f)) continue
        const u = unitOfVar(f)
        if (u.t === 'known' && want && !equalDim(u.dim, want)) add({ severity: 'error', code: 'unit-flow', message: `${list === 'inflows' ? '유입' : '유출'} '${f}'(${formatDim(u.dim)})의 단위가 Level '${name}'(${formatDim(ld as Dim)})에 맞지 않습니다. '${formatDim(want)}'이어야 합니다`, variable: name, field: list })
        else if (u.t === 'known' && !want && (level.unit ?? '').trim() === '' && !issues.some((i) => i.code === 'unit-suggest' && i.variable === name)) {
          const s = formatDim(mulDim(u.dim, DAY))
          add({ severity: 'info', code: 'unit-suggest', message: `'${name}'의 단위를 연결된 흐름에서 추론하면 '${s}'입니다`, variable: name, field: 'unit', suggestion: s })
        }
      }
    }
  }
  return issues
}

function literalNumber(n: Node): number | null {
  if (n.kind === 'num') return n.value
  if (n.kind === 'unary' && n.op !== 'NOT') {
    const v = literalNumber(n.arg)
    return v === null ? null : n.op === '-' ? -v : v
  }
  return null
}

/** 이 노드의 글자 범위(오류 밑줄). 변수·함수는 이름, 연산은 연산자 기호, 그 밖은 한 토큰. */
function rangeOf(n: Node, source: string): [number, number] {
  if (n.kind === 'var' || n.kind === 'call') return [n.pos, n.pos + n.name.length]
  if (n.kind === 'binary') return [n.pos, n.pos + (OP_LEN[n.op] ?? 1)]
  const m = /^[A-Za-z0-9_.]+/.exec(source.slice(n.pos))
  return [n.pos, n.pos + (m ? m[0].length : 1)]
}
