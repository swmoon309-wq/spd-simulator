import { findReferences, parse, ExprError, type ModelDef, type Node } from '@spd/sd-engine'

/**
 * 다이어그램의 연결선(설계 08의 3.3). **저장하지 않고 수식에서 파생한다**: 선과 수식이 어긋날 수 없다(진실의 원천은 수식 하나).
 * - `info`: 수식이 현재 스텝의 값을 직접 참조한다(정보선, 가는 화살표). `u → v`는 v의 수식이 u를 쓴다.
 * - `delayed`: SMOOTH·DELAY의 입력·지연시간처럼 상태를 거쳐 다음 스텝에 영향을 준다(지연 정보선, `//` 표시, 순환을 끊는다).
 * - `init`: Level 초기값 수식이 참조한다(시작 시각에만 영향).
 * - `flow`: Level의 유입·유출(물질 흐름, 굵은 선). 방향은 물질이 가는 쪽: 유입은 `Rate → Level`, 유출은 `Level → Rate`.
 */
export type ConnectorKind = 'info' | 'delayed' | 'init' | 'flow'

export interface Connector {
  from: string
  to: string
  kind: ConnectorKind
  /** `flow`일 때: 유입(Rate → Level)인지 유출(Level → Rate)인지 */
  sense?: 'in' | 'out'
}

const DELAY_FNS = new Set(['SMOOTH', 'DELAY1', 'DELAY3'])

/** 수식 하나가 참조하는 변수를 (일반 참조, 지연 참조)로 나눈다. 수식을 읽지 못하면 토큰으로 추정해 모두 일반 참조로 본다. */
export function referencedVariables(source: string): { direct: Set<string>; delayed: Set<string> } {
  const direct = new Set<string>()
  const delayed = new Set<string>()
  let ast: Node
  try {
    ast = parse(source)
  } catch (e) {
    if (!(e instanceof ExprError)) throw e
    for (const r of findReferences(source).refs) if (r.kind === 'variable') direct.add(r.name)
    return { direct, delayed }
  }
  const walk = (n: Node, inDelay: boolean): void => {
    switch (n.kind) {
      case 'var':
        if (n.name !== 'TIME' && n.name !== 'DT') (inDelay ? delayed : direct).add(n.name)
        return
      case 'unary':
        walk(n.arg, inDelay)
        return
      case 'binary':
        walk(n.left, inDelay)
        walk(n.right, inDelay)
        return
      case 'array':
        n.items.forEach((x) => walk(x, inDelay))
        return
      case 'call': {
        const upper = n.name.toUpperCase()
        const isGraph = upper === 'GRAPH'
        n.args.forEach((a, i) => {
          if (isGraph && i === 1 && a.kind === 'var') return // 테이블 이름은 변수가 아니다
          walk(a, inDelay || DELAY_FNS.has(upper))
        })
        return
      }
      case 'num':
        return
    }
  }
  walk(ast, false)
  return { direct, delayed }
}

/**
 * 모델 정의에서 모든 연결선을 파생한다. 정의된 변수 사이의 선만 만들고(정의되지 않은 참조는 lint가 알린다), 같은 두 변수 사이에 일반 참조와
 * 지연 참조가 함께 있으면 일반 참조만 남긴다. 순서는 정의 순서를 따라 결정적이다.
 */
export function deriveConnectors(def: ModelDef): Connector[] {
  const names = new Set([...Object.keys(def.constants), ...Object.keys(def.levels), ...Object.keys(def.rates), ...Object.keys(def.auxiliaries)])
  const out: Connector[] = []
  const exprs: [string, string, 'expr' | 'init'][] = [
    ...Object.entries(def.levels).map(([n, l]) => [n, l.init, 'init'] as [string, string, 'expr' | 'init']),
    ...Object.entries(def.rates).map(([n, r]) => [n, r.expr, 'expr'] as [string, string, 'expr' | 'init']),
    ...Object.entries(def.auxiliaries).map(([n, a]) => [n, a.expr, 'expr'] as [string, string, 'expr' | 'init'])
  ]
  for (const [to, source, field] of exprs) {
    const { direct, delayed } = referencedVariables(source)
    for (const from of direct) if (names.has(from) && from !== to) out.push({ from, to, kind: field === 'init' ? 'init' : 'info' })
    for (const from of delayed) if (names.has(from) && !direct.has(from)) out.push({ from, to, kind: field === 'init' ? 'init' : 'delayed' })
    // 자기 자신을 참조하는 수식(Level의 되먹임 등)은 선으로 그리지 않는다
  }
  for (const [level, l] of Object.entries(def.levels)) {
    for (const f of l.inflows) if (names.has(f)) out.push({ from: f, to: level, kind: 'flow', sense: 'in' })
    for (const f of l.outflows) if (names.has(f)) out.push({ from: level, to: f, kind: 'flow', sense: 'out' })
  }
  return out
}
