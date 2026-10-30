import { compile, ExprError, StateStore, type CompiledExpr, type Runtime } from '../expr'
import { ModelError } from './errors'
import { CycleError, topologicalOrder } from './graph'
import type { ModelDef } from './schema'

export type VarKind = 'constant' | 'level' | 'rate' | 'auxiliary'

export interface CompiledLevel {
  name: string
  slot: number
  init: CompiledExpr
  inflows: number[]
  outflows: number[]
}

export interface CompiledFlow {
  name: string
  slot: number
  kind: 'rate' | 'auxiliary'
  expr: CompiledExpr
}

/** 초기화 때 한 번 평가하는 단계. */
export interface InitStep {
  name: string
  slot: number
  eval: (rt: Runtime) => number
}

export interface CompiledModel {
  def: ModelDef
  /** 슬롯 순서: 상수, Level, Rate, Auxiliary (정의 순서) */
  names: string[]
  slotOf: Map<string, number>
  kindOf: Map<string, VarKind>
  constants: { name: string; slot: number; value: number }[]
  levels: CompiledLevel[]
  /** Rate와 Auxiliary. 의존하는 변수가 먼저 오도록 정렬되어 있다. */
  flows: CompiledFlow[]
  /** Level 초기값과 그에 필요한 변수를 평가하는 순서 */
  initPlan: InitStep[]
  store: StateStore
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED = new Set(['TIME', 'DT', 'AND', 'OR', 'NOT'])

function checkName(name: string): void {
  if (!IDENT.test(name)) {
    throw new ModelError('name', `변수 이름 '${name}'은 영문자·숫자·_만 쓸 수 있고 숫자로 시작할 수 없습니다`, { variable: name })
  }
  if (RESERVED.has(name.toUpperCase())) {
    throw new ModelError('name', `'${name}'은 예약어라 변수 이름으로 쓸 수 없습니다`, { variable: name })
  }
}

/**
 * 모델 정의를 검증하고 수식을 컴파일한다. 결과는 파라미터(상수) 덮어쓰기만 다른 여러 실행에 재사용할 수 있다.
 * Level의 inflows/outflows에는 Rate 또는 Auxiliary의 이름을 쓴다.
 */
export function compileModel(def: ModelDef): CompiledModel {
  const names: string[] = []
  const slotOf = new Map<string, number>()
  const kindOf = new Map<string, VarKind>()
  const register = (section: Record<string, unknown>, kind: VarKind) => {
    for (const name of Object.keys(section)) {
      checkName(name)
      if (slotOf.has(name)) {
        throw new ModelError('name', `변수 이름 '${name}'이(가) ${kindOf.get(name)}와(과) ${kind}에 중복 정의되었습니다`, { variable: name })
      }
      slotOf.set(name, names.length)
      kindOf.set(name, kind)
      names.push(name)
    }
  }
  register(def.constants, 'constant')
  register(def.levels, 'level')
  register(def.rates, 'rate')
  register(def.auxiliaries, 'auxiliary')

  const store = new StateStore()
  const env = { resolve: (n: string) => slotOf.get(n), state: store, tables: def.tables }
  const build = (variable: string, field: string, source: string): CompiledExpr => {
    try {
      return compile(source, env)
    } catch (e) {
      if (e instanceof ExprError) {
        throw new ModelError('expression', `'${variable}'의 ${field} 오류: ${e.detail} (위치 ${e.pos}) — ${source}`, { variable })
      }
      throw e
    }
  }

  const constants = Object.entries(def.constants).map(([name, c]) => ({
    name,
    slot: slotOf.get(name) as number,
    value: c.value
  }))

  const initExprs = new Map<string, CompiledExpr>()
  for (const [name, level] of Object.entries(def.levels)) {
    const before = store.stateSize
    const init = build(name, '초기값 수식', level.init)
    if (store.stateSize !== before) {
      throw new ModelError('expression', `'${name}'의 초기값에는 SMOOTH·DELAY를 쓸 수 없습니다`, { variable: name })
    }
    initExprs.set(name, init)
  }

  const flowExprs = new Map<string, CompiledExpr>()
  const flowKind = new Map<string, 'rate' | 'auxiliary'>()
  for (const [name, f] of Object.entries(def.rates)) {
    flowExprs.set(name, build(name, '수식', f.expr))
    flowKind.set(name, 'rate')
  }
  for (const [name, f] of Object.entries(def.auxiliaries)) {
    flowExprs.set(name, build(name, '수식', f.expr))
    flowKind.set(name, 'auxiliary')
  }

  // 평가 순서: 현재 스텝 값에 직접 의존하는 관계만 간선으로 본다. SMOOTH·DELAY의 입력과 Level은 순환을 끊는다.
  const flowNames = [...flowExprs.keys()]
  let order: string[]
  try {
    order = topologicalOrder(flowNames, (n) => (flowExprs.get(n) as CompiledExpr).algebraicDeps)
  } catch (e) {
    if (e instanceof CycleError) {
      throw new ModelError(
        'cycle',
        `순환 참조: ${e.cycle.join(' → ')} (→는 '의존함'). Level을 거치거나 SMOOTH·DELAY로 지연을 넣어 순환을 끊으세요`,
        { variable: e.cycle[0] as string, cycle: e.cycle }
      )
    }
    throw e
  }
  const flows: CompiledFlow[] = order.map((name) => ({
    name,
    slot: slotOf.get(name) as number,
    kind: flowKind.get(name) as 'rate' | 'auxiliary',
    expr: flowExprs.get(name) as CompiledExpr
  }))

  const flowSlot = (level: string, flow: string): number => {
    const kind = kindOf.get(flow)
    if (kind !== 'rate' && kind !== 'auxiliary') {
      throw new ModelError(
        'flow',
        kind === undefined
          ? `Level '${level}'의 유입·유출 '${flow}'이(가) 정의되어 있지 않습니다`
          : `Level '${level}'의 유입·유출 '${flow}'은(는) ${kind}입니다. Rate 또는 Auxiliary여야 합니다`,
        { variable: level }
      )
    }
    return slotOf.get(flow) as number
  }
  const levels: CompiledLevel[] = Object.entries(def.levels).map(([name, l]) => ({
    name,
    slot: slotOf.get(name) as number,
    init: initExprs.get(name) as CompiledExpr,
    inflows: l.inflows.map((f) => flowSlot(name, f)),
    outflows: l.outflows.map((f) => flowSlot(name, f))
  }))

  for (const out of def.outputs) {
    if (!slotOf.has(out)) throw new ModelError('output', `outputs의 '${out}'이(가) 정의되어 있지 않습니다`, { variable: out })
  }

  const seenInvariants = new Set<string>()
  for (const inv of def.invariants ?? []) {
    if (seenInvariants.has(inv.name)) throw new ModelError('invariant', `불변식 이름 '${inv.name}'이(가) 겹칩니다`)
    seenInvariants.add(inv.name)
    for (const term of [...inv.lhs, ...inv.rhs]) {
      if (!slotOf.has(term.variable)) {
        throw new ModelError('invariant', `불변식 '${inv.name}'의 변수 '${term.variable}'이(가) 정의되어 있지 않습니다`, { variable: term.variable })
      }
      if (!Number.isFinite(term.coef)) throw new ModelError('invariant', `불변식 '${inv.name}'의 '${term.variable}' 계수가 유한한 수가 아닙니다`, { variable: term.variable })
    }
  }

  return {
    def,
    names,
    slotOf,
    kindOf,
    constants,
    levels,
    flows,
    initPlan: buildInitPlan(slotOf, kindOf, levels, flowExprs),
    store
  }
}

/**
 * Level 초기값 수식이 참조하는 Auxiliary·Rate(와 그 의존 변수)를 포함해 평가 순서를 정한다.
 * 이 단계에서는 Level이 초기값을 가진 상태이고 SMOOTH·DELAY는 입력을 그대로 돌려주므로 지연 의존도 간선으로 본다.
 */
function buildInitPlan(
  slotOf: Map<string, number>,
  kindOf: Map<string, VarKind>,
  levels: CompiledLevel[],
  flowExprs: Map<string, CompiledExpr>
): InitStep[] {
  const depsOf = (name: string): string[] => {
    const e = kindOf.get(name) === 'level' ? levels.find((l) => l.name === name)?.init : flowExprs.get(name)
    return e ? [...e.algebraicDeps, ...e.delayedDeps] : []
  }

  const needed = new Set<string>(levels.map((l) => l.name))
  const stack = levels.flatMap((l) => depsOf(l.name))
  while (stack.length > 0) {
    const n = stack.pop() as string
    const kind = kindOf.get(n)
    if (kind === undefined || kind === 'constant' || needed.has(n)) continue
    needed.add(n)
    stack.push(...depsOf(n))
  }

  const nodes = [...slotOf.keys()].filter((n) => needed.has(n))
  let order: string[]
  try {
    order = topologicalOrder(nodes, depsOf)
  } catch (e) {
    if (e instanceof CycleError) {
      throw new ModelError(
        'init-cycle',
        `초기값 계산이 순환합니다: ${e.cycle.join(' → ')} (→는 '의존함'). Level의 초기값이 자기 자신의 값에 의존하지 않게 하세요`,
        { variable: e.cycle[0] as string, cycle: e.cycle }
      )
    }
    throw e
  }
  return order.map((name) => {
    const expr = kindOf.get(name) === 'level' ? (levels.find((l) => l.name === name) as CompiledLevel).init : (flowExprs.get(name) as CompiledExpr)
    return { name, slot: slotOf.get(name) as number, eval: expr.eval }
  })
}
