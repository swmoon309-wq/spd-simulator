import { ExprError } from './errors'

export type TokenType = 'num' | 'ident' | 'op' | 'eof'

export interface Token {
  type: TokenType
  value: string
  pos: number
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/y
const KEYWORDS = new Set(['AND', 'OR', 'NOT'])
const TWO_CHAR = new Set(['<=', '>=', '<>', '!=', '=='])
const ONE_CHAR = new Set(['+', '-', '*', '/', '^', '(', ')', '[', ']', ',', '<', '>', '='])

/** `!=`와 `==`는 각각 `<>`와 `=`로 정규화한다. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source.charAt(i)
    if (/\s/.test(ch)) {
      i++
      continue
    }
    NUMBER.lastIndex = i
    const num = NUMBER.exec(source)
    if (num) {
      tokens.push({ type: 'num', value: num[0], pos: i })
      i += num[0].length
      continue
    }
    IDENT.lastIndex = i
    const id = IDENT.exec(source)
    if (id) {
      const upper = id[0].toUpperCase()
      if (KEYWORDS.has(upper)) tokens.push({ type: 'op', value: upper, pos: i })
      else tokens.push({ type: 'ident', value: id[0], pos: i })
      i += id[0].length
      continue
    }
    const two = source.slice(i, i + 2)
    if (TWO_CHAR.has(two)) {
      const value = two === '!=' ? '<>' : two === '==' ? '=' : two
      tokens.push({ type: 'op', value, pos: i })
      i += 2
      continue
    }
    if (ONE_CHAR.has(ch)) {
      tokens.push({ type: 'op', value: ch, pos: i })
      i++
      continue
    }
    throw new ExprError(`허용되지 않는 문자 '${ch}'`, i, source)
  }
  tokens.push({ type: 'eof', value: '', pos: source.length })
  return tokens
}
