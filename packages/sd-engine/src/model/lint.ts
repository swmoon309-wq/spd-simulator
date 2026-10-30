import type { Node } from '../expr/ast'
import { ExprError } from '../expr/errors'
import { FUNCTIONS, isKnownFunction, type Table } from '../expr/functions'
import { parse } from '../expr/parser'
import { CycleError, topologicalOrder } from './graph'
import type { ModelDef } from './schema'

export type LintSeverity = 'error' | 'warning'

export type LintCode =
  | 'name-invalid'
  | 'name-reserved'
  | 'name-duplicate'
  | 'name-keyword-case'
  | 'syntax'
  | 'undefined-variable'
  | 'undefined-table'
  | 'unknown-function'
  | 'arity'
  | 'graph-form'
  | 'array-misplaced'
  | 'array-value'
  | 'table-invalid'
  | 'init-delay'
  | 'flow-undefined'
  | 'flow-kind'
  | 'output-undefined'
  | 'invariant-duplicate'
  | 'invariant-undefined'
  | 'cycle'
  | 'init-cycle'
  | 'orphan'
  | 'constant-rate'
  | 'level-no-flow'
  | 'table-unused'
  | 'flow-duplicate'

/** 수식·필드가 있는 곳. */
export type LintField = 'name' | 'init' | 'expr' | 'inflows' | 'outflows' | 'outputs' | 'invariants' | 'tables'

export interface LintIssue {
  severity: LintSeverity
  code: LintCode
  message: string
  /** 문제가 있는 변수(없으면 모델 전체) */
  variable?: string
  field?: LintField
  /** 수식 안의 글자 범위 [start, end) */
  range?: [number, number]
  /** 순환 경로(`code`가 cycle·init-cycle일 때): [a, b, a]는 a가 b에, b가 a에 의존함 */
  cycle?: string[]
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED = new Set(['TIME', 'DT', 'AND', 'OR', 'NOT'])

type Kind = 'constant' | 'level' | 'rate' | 'auxiliary'

/** 토큰 하나의 끝 위치(식별자·숫자는 이어지는 글자까지, 아니면 한 글자). */
function endOfToken(source: string, pos: number): number {
  const m = /^[A-Za-z0-9_.]+/.exec(source.slice(pos))
  return pos + (m ? m[0].length : 1)
}

/**
 * 모델 정의의 문제를 **모두** 모은다(설계 08의 6.1). `compileModel`은 첫 오류에서 던지지만 편집기는 한 번에 모든 문제를 보여야 한다. 오류(`error`)는
 * `compileModel`이 던지는 것과 같은 규칙이다: **오류가 하나라도 있으면 컴파일이 실패하고, 없으면 성공한다**(시험으로 고정). 경고(`warning`)는 컴파일을
 * 막지 않는 의심스러운 점이다(쓰이지 않는 변수, 상수 Rate 등). 순수 함수이며 결과 순서는 입력이 같으면 같다.
 */
export function lintModel(def: ModelDef): LintIssue[] {
  const issues: LintIssue[] = []
  const add = (i: LintIssue) => void issues.push(i)

  // ---------- 이름 ----------
  const kindOf = new Map<string, Kind>()
  const sections: [Record<string, unknown>, Kind][] = [
    [def.constants, 'constant'],
    [def.levels, 'level'],
    [def.rates, 'rate'],
    [def.auxiliaries, 'auxiliary']
  ]
  for (const [section, kind] of sections) {
    for (const name of Object.keys(section)) {
      if (!IDENT.test(name)) add({ severity: 'error', code: 'name-invalid', message: `변수 이름 '${name}'은 영문자·숫자·_만 쓸 수 있고 숫자로 시작할 수 없습니다`, variable: name, field: 'name' })
      else if (RESERVED.has(name)) add({ severity: 'error', code: 'name-reserved', message: `'${name}'은(는) 예약어라 변수 이름으로 쓸 수 없습니다`, variable: name, field: 'name' })
      else if (RESERVED.has(name.toUpperCase())) add({ severity: 'warning', code: 'name-keyword-case', message: `'${name}'은(는) 수식에서 연산자(${name.toUpperCase()})로 읽혀 참조할 수 없습니다`, variable: name, field: 'name' })
      if (kindOf.has(name)) add({ severity: 'error', code: 'name-duplicate', message: `변수 이름 '${name}'이(가) ${kindOf.get(name)}와(과) ${kind}에 중복 정의되었습니다`, variable: name, field: 'name' })
      else kindOf.set(name, kind)
    }
  }
  const tables = def.tables as Record<string, Table>

  // ---------- 수식 ----------
  interface Parsed {
    name: string
    field: 'init' | 'expr'
    kind: Kind
    source: string
    ok: boolean
    algebraic: Set<string>
    delayed: Set<string>
    usedVars: Set<string>
    usedTables: Set<string>
    hasTimeOrRandom: boolean
  }
  const parsed: Parsed[] = []
  const exprs: { name: string; field: 'init' | 'expr'; kind: Kind; source: string }[] = [
    ...Object.entries(def.levels).map(([name, l]) => ({ name, field: 'init' as const, kind: 'level' as Kind, source: l.init })),
    ...Object.entries(def.rates).map(([name, r]) => ({ name, field: 'expr' as const, kind: 'rate' as Kind, source: r.expr })),
    ...Object.entries(def.auxiliaries).map(([name, a]) => ({ name, field: 'expr' as const, kind: 'auxiliary' as Kind, source: a.expr }))
  ]

  for (const e of exprs) {
    const p: Parsed = { ...e, ok: true, algebraic: new Set(), delayed: new Set(), usedVars: new Set(), usedTables: new Set(), hasTimeOrRandom: false }
    parsed.push(p)
    const fail = (code: LintCode, message: string, pos: number, end?: number) => {
      p.ok = false
      add({ severity: 'error', code, message, variable: e.name, field: e.field, range: [pos, end ?? endOfToken(e.source, pos)] })
    }
    let ast: Node
    try {
      ast = parse(e.source)
    } catch (err) {
      if (err instanceof ExprError) fail('syntax', err.detail, err.pos)
      else throw err
      continue
    }
    const delayBefore = { used: false }
    const gen = (n: Node, deps: Set<string>, inDelay: boolean): void => {
      switch (n.kind) {
        case 'num':
          return
        case 'var': {
          if (n.name === 'TIME' || n.name === 'DT') {
            p.hasTimeOrRandom = true
            return
          }
          p.usedVars.add(n.name)
          if (!kindOf.has(n.name)) fail('undefined-variable', `정의되지 않은 변수 '${n.name}'`, n.pos, n.pos + n.name.length)
          else deps.add(n.name)
          return
        }
        case 'unary':
          gen(n.arg, deps, inDelay)
          return
        case 'binary':
          gen(n.left, deps, inDelay)
          gen(n.right, deps, inDelay)
          return
        case 'array':
          fail('array-misplaced', '배열은 GRAPH의 인자로만 쓸 수 있습니다', n.pos)
          return
        case 'call':
          call(n, deps, inDelay)
          return
      }
    }
    const call = (n: Extract<Node, { kind: 'call' }>, deps: Set<string>, inDelay: boolean): void => {
      const upper = n.name.toUpperCase()
      const nameEnd = n.pos + n.name.length
      if (!isKnownFunction(upper)) {
        fail('unknown-function', `알 수 없는 함수 '${n.name}'`, n.pos, nameEnd)
        n.args.forEach((a) => gen(a, deps, inDelay)) // 인자의 문제도 함께 보인다
        return
      }
      if (upper === 'GRAPH') {
        if (n.args.length !== 2 && n.args.length !== 3) {
          fail('graph-form', 'GRAPH의 인자는 (x, 테이블이름) 또는 (x, [x좌표], [y좌표])여야 합니다', n.pos, nameEnd)
          n.args.forEach((a) => gen(a, deps, inDelay))
          return
        }
        gen(n.args[0] as Node, deps, inDelay)
        if (n.args.length === 3) {
          const xs = constArray(n.args[1] as Node)
          const ys = constArray(n.args[2] as Node)
          if (xs && ys) checkTable({ x: xs, y: ys }, n.pos, nameEnd)
        } else {
          const ref = n.args[1] as Node
          if (ref.kind !== 'var') fail('graph-form', 'GRAPH의 두 번째 인자는 테이블 이름이어야 합니다', ref.pos)
          else {
            p.usedTables.add(ref.name)
            const found = tables[ref.name]
            if (!found) fail('undefined-table', `정의되지 않은 테이블 '${ref.name}'`, ref.pos, ref.pos + ref.name.length)
            else checkTable(found, n.pos, nameEnd)
          }
        }
        return
      }
      if (upper === 'SMOOTH' || upper === 'DELAY1' || upper === 'DELAY3') {
        if (n.args.length !== 2) {
          fail('arity', upper === 'DELAY3' ? 'DELAY3의 인자는 (입력, 지연시간) 2개여야 합니다' : `${upper}의 인자는 (입력, 지연시간) 2개여야 합니다`, n.pos, nameEnd)
          n.args.forEach((a) => gen(a, deps, inDelay))
          return
        }
        delayBefore.used = true
        for (const a of n.args) gen(a, p.delayed, true)
        return
      }
      const spec = FUNCTIONS[upper] as (typeof FUNCTIONS)[string]
      if (upper.startsWith('RANDOM_')) p.hasTimeOrRandom = true
      if (upper === 'STEP' || upper === 'PULSE' || upper === 'RAMP') p.hasTimeOrRandom = true
      if (n.args.length < spec.min || n.args.length > spec.max) {
        const range = spec.max === Infinity ? `${spec.min}개 이상` : spec.min === spec.max ? `${spec.min}개` : `${spec.min}~${spec.max}개`
        fail('arity', `${upper}의 인자는 ${range}여야 하는데 ${n.args.length}개입니다`, n.pos, nameEnd)
      }
      n.args.forEach((a) => gen(a, deps, inDelay))
    }
    const checkTable = (t: Table, pos: number, end: number): void => {
      if (t.x.length !== t.y.length) fail('table-invalid', 'GRAPH의 x와 y 개수가 다릅니다', pos, end)
      else if (t.x.length < 2) fail('table-invalid', 'GRAPH에는 점이 2개 이상 필요합니다', pos, end)
      else for (let i = 1; i < t.x.length; i++) if (!((t.x[i] as number) > (t.x[i - 1] as number))) return fail('table-invalid', 'GRAPH의 x 좌표는 엄격히 오름차순이어야 합니다', pos, end)
    }
    const constEval = (n: Node): number | null => {
      switch (n.kind) {
        case 'num':
          return n.value
        case 'unary': {
          if (n.op === 'NOT') break
          const v = constEval(n.arg)
          return v === null ? null : n.op === '-' ? -v : v
        }
        case 'binary': {
          const l = constEval(n.left)
          const r = constEval(n.right)
          if (l === null || r === null) return null
          if (n.op === '+') return l + r
          if (n.op === '-') return l - r
          if (n.op === '*') return l * r
          if (n.op === '/') return l / r
          if (n.op === '^') return Math.pow(l, r)
          break
        }
      }
      fail('array-value', '배열의 값은 숫자 상수여야 합니다', n.pos)
      return null
    }
    const constArray = (n: Node): number[] | null => {
      if (n.kind !== 'array') {
        fail('array-value', '상수 배열 [a, b, ...]이 필요합니다', n.pos)
        return null
      }
      const vals = n.items.map(constEval)
      return vals.some((v) => v === null) ? null : (vals as number[])
    }
    gen(ast, p.algebraic, false)
    if (e.field === 'init' && delayBefore.used) fail('init-delay', `'${e.name}'의 초기값에는 SMOOTH·DELAY를 쓸 수 없습니다`, 0, e.source.length)
  }

  // ---------- Level의 유입·유출 ----------
  const flowOf = (level: string, field: 'inflows' | 'outflows', flow: string) => {
    const kind = kindOf.get(flow)
    if (kind !== 'rate' && kind !== 'auxiliary') {
      add({
        severity: 'error',
        code: kind === undefined ? 'flow-undefined' : 'flow-kind',
        message: kind === undefined ? `Level '${level}'의 유입·유출 '${flow}'이(가) 정의되어 있지 않습니다` : `Level '${level}'의 유입·유출 '${flow}'은(는) ${kind}입니다. Rate 또는 Auxiliary여야 합니다`,
        variable: level,
        field
      })
    }
  }
  const flowUse = new Set<string>()
  for (const [name, l] of Object.entries(def.levels)) {
    for (const f of l.inflows) {
      flowOf(name, 'inflows', f)
      flowUse.add(f)
    }
    for (const f of l.outflows) {
      flowOf(name, 'outflows', f)
      flowUse.add(f)
    }
    if (l.inflows.some((f) => l.outflows.includes(f))) add({ severity: 'warning', code: 'flow-duplicate', message: `Level '${name}'의 같은 흐름이 유입과 유출에 모두 있습니다(서로 상쇄됩니다)`, variable: name, field: 'inflows' })
    if (l.inflows.length === 0 && l.outflows.length === 0) add({ severity: 'warning', code: 'level-no-flow', message: `Level '${name}'에 유입·유출이 없어 값이 바뀌지 않습니다`, variable: name, field: 'inflows' })
  }

  // ---------- 순환 ----------
  const okExprs = parsed.filter((p) => p.ok)
  const flowNames = parsed.filter((p) => p.kind !== 'level').map((p) => p.name)
  const byName = new Map(parsed.map((p) => [p.name, p]))
  // 순환 검사는 읽을 수 있는 수식만으로 한다(읽지 못한 수식의 오류는 위에 이미 있다).
  const readable = flowNames.filter((n) => byName.get(n)?.ok)
  try {
    topologicalOrder(readable, (n) => (byName.get(n) as Parsed).algebraic)
  } catch (e) {
    if (e instanceof CycleError) add({ severity: 'error', code: 'cycle', message: `순환 참조: ${e.cycle.join(' → ')} (→는 '의존함'). Level을 거치거나 SMOOTH·DELAY로 지연을 넣어 순환을 끊으세요`, variable: e.cycle[0] as string, cycle: e.cycle })
    else throw e
  }
  // 초기값 계산의 순환(`compileModel`의 buildInitPlan과 같은 규칙)
  if (okExprs.length === parsed.length) {
    const depsOf = (name: string): string[] => {
      const p = byName.get(name)
      return p ? [...p.algebraic, ...p.delayed] : []
    }
    const needed = new Set<string>(Object.keys(def.levels))
    const stack = Object.keys(def.levels).flatMap(depsOf)
    while (stack.length > 0) {
      const n = stack.pop() as string
      const kind = kindOf.get(n)
      if (kind === undefined || kind === 'constant' || needed.has(n)) continue
      needed.add(n)
      stack.push(...depsOf(n))
    }
    const nodes = [...kindOf.keys()].filter((n) => needed.has(n))
    try {
      topologicalOrder(nodes, depsOf)
    } catch (e) {
      if (e instanceof CycleError) {
        // 대수 순환으로 이미 보고했다면 중복해서 알리지 않는다
        if (!issues.some((i) => i.code === 'cycle')) add({ severity: 'error', code: 'init-cycle', message: `초기값 계산이 순환합니다: ${e.cycle.join(' → ')} (→는 '의존함'). Level의 초기값이 자기 자신의 값에 의존하지 않게 하세요`, variable: e.cycle[0] as string, cycle: e.cycle })
      } else throw e
    }
  }

  // ---------- outputs·invariants ----------
  for (const out of def.outputs) if (!kindOf.has(out)) add({ severity: 'error', code: 'output-undefined', message: `outputs의 '${out}'이(가) 정의되어 있지 않습니다`, variable: out, field: 'outputs' })
  const seenInv = new Set<string>()
  for (const inv of def.invariants ?? []) {
    if (seenInv.has(inv.name)) add({ severity: 'error', code: 'invariant-duplicate', message: `불변식 이름 '${inv.name}'이(가) 겹칩니다`, field: 'invariants' })
    seenInv.add(inv.name)
    for (const term of [...inv.lhs, ...inv.rhs]) {
      if (!kindOf.has(term.variable)) add({ severity: 'error', code: 'invariant-undefined', message: `불변식 '${inv.name}'의 변수 '${term.variable}'이(가) 정의되어 있지 않습니다`, variable: term.variable, field: 'invariants' })
    }
  }

  // ---------- 경고: 쓰이지 않는 것, 상수 Rate ----------
  const used = new Set<string>([...def.outputs, ...flowUse])
  for (const p of parsed) for (const v of p.usedVars) used.add(v)
  for (const inv of def.invariants ?? []) for (const t of [...inv.lhs, ...inv.rhs]) used.add(t.variable)
  for (const [name, kind] of kindOf) {
    // Level은 유입·유출이 있으면 모델의 상태이므로 쓰이지 않아도 결과로 본다. 나머지는 아무도 쓰지 않으면 의심스럽다.
    if (!used.has(name) && kind !== 'level') add({ severity: 'warning', code: 'orphan', message: `${kind === 'constant' ? '상수' : kind === 'rate' ? 'Rate' : 'Auxiliary'} '${name}'을(를) 아무 수식도 쓰지 않고 출력·불변식에도 없습니다`, variable: name })
  }
  for (const p of parsed) {
    if (p.kind === 'rate' && p.ok && p.usedVars.size === 0 && p.usedTables.size === 0 && !p.hasTimeOrRandom) {
      add({ severity: 'warning', code: 'constant-rate', message: `Rate '${p.name}'의 수식에 변수·시간이 없어 값이 항상 같습니다`, variable: p.name, field: 'expr' })
    }
  }
  const tableUsed = new Set(parsed.flatMap((p) => [...p.usedTables]))
  for (const t of Object.keys(tables)) if (!tableUsed.has(t)) add({ severity: 'warning', code: 'table-unused', message: `테이블 '${t}'을(를) 쓰는 수식이 없습니다`, field: 'tables' })
  return issues
}

/** 오류만 골라 낸다. */
export const lintErrors = (issues: LintIssue[]): LintIssue[] => issues.filter((i) => i.severity === 'error')
