import type { Node } from './ast'
import { ExprError } from './errors'
import { parse } from './parser'
import { tokenize } from './tokenizer'

/** 수식 안의 이름 하나와 그 위치(글자 범위 [start, end)). */
export interface ExprRef {
  name: string
  start: number
  end: number
  /** 변수 참조, 함수 이름, `GRAPH(x, 이름)`의 테이블 이름 */
  kind: 'variable' | 'function' | 'table'
}

export interface RefsResult {
  refs: ExprRef[]
  /** 수식을 읽지 못했으면 그 오류(이때 `refs`는 토큰으로 추정한 것이다) */
  error: ExprError | null
}

/**
 * 수식에서 변수·함수·테이블 이름의 위치를 모은다. 이름 바꾸기와 구문 강조, 오류 위치 표시가 쓴다. 문자열 치환이 아니라 **구문 분석**이
 * 기준이라 `rate`와 `rate2`를 헷갈리지 않고, 함수 이름·테이블 이름은 변수와 구분한다. 수식이 아직 완성되지 않아 읽지 못하면 토큰으로
 * 추정한다(괄호 앞의 이름은 함수, 나머지는 변수).
 */
export function findReferences(source: string): RefsResult {
  let ast: Node
  try {
    ast = parse(source)
  } catch (e) {
    if (!(e instanceof ExprError)) throw e
    return { refs: tokenRefs(source), error: e }
  }
  const refs: ExprRef[] = []
  const walk = (n: Node): void => {
    switch (n.kind) {
      case 'var':
        refs.push({ name: n.name, start: n.pos, end: n.pos + n.name.length, kind: 'variable' })
        return
      case 'unary':
        walk(n.arg)
        return
      case 'binary':
        walk(n.left)
        walk(n.right)
        return
      case 'array':
        n.items.forEach(walk)
        return
      case 'call': {
        refs.push({ name: n.name, start: n.pos, end: n.pos + n.name.length, kind: 'function' })
        const isGraph = n.name.toUpperCase() === 'GRAPH'
        n.args.forEach((a, i) => {
          if (isGraph && i === 1 && a.kind === 'var') refs.push({ name: a.name, start: a.pos, end: a.pos + a.name.length, kind: 'table' })
          else walk(a)
        })
        return
      }
      case 'num':
        return
    }
  }
  walk(ast)
  return { refs: refs.sort((a, b) => a.start - b.start), error: null }
}

function tokenRefs(source: string): ExprRef[] {
  let tokens
  try {
    tokens = tokenize(source)
  } catch {
    return [] // 허용되지 않는 문자가 있으면 위치를 추정하지 않는다
  }
  const refs: ExprRef[] = []
  tokens.forEach((t, i) => {
    if (t.type !== 'ident') return
    const next = tokens[i + 1]
    const isCall = next?.type === 'op' && next.value === '('
    refs.push({ name: t.value, start: t.pos, end: t.pos + t.value.length, kind: isCall ? 'function' : 'variable' })
  })
  return refs
}

/**
 * 수식 안의 변수 `from`을 `to`로 바꾼다(토큰 단위). 함수·테이블 이름과 이름이 같아도 건드리지 않는다. 바꾼 개수와 새 수식을 돌려준다.
 * `TIME`·`DT` 같은 예약어는 호출하는 쪽이 `to`로 거르게 한다.
 */
export function renameVariableInExpr(source: string, from: string, to: string): { source: string; count: number } {
  const targets = findReferences(source).refs.filter((r) => r.kind === 'variable' && r.name === from)
  let out = source
  for (const r of [...targets].reverse()) out = out.slice(0, r.start) + to + out.slice(r.end)
  return { source: out, count: targets.length }
}

/**
 * 수식 안의 테이블 이름(`GRAPH(x, 이름)`의 두 번째 인자)을 `to`로 바꾼다. 같은 이름의 변수 참조는 건드리지 않는다. 바꾼 개수와 새 수식을 돌려준다.
 */
export function renameTableInExpr(source: string, from: string, to: string): { source: string; count: number } {
  const targets = findReferences(source).refs.filter((r) => r.kind === 'table' && r.name === from)
  let out = source
  for (const r of [...targets].reverse()) out = out.slice(0, r.start) + to + out.slice(r.end)
  return { source: out, count: targets.length }
}
