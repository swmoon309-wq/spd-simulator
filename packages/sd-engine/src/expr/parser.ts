import type { BinaryOp, Node } from './ast'
import { ExprError } from './errors'
import { tokenize, type Token } from './tokenizer'

const COMPARE = new Set(['<', '>', '<=', '>=', '=', '<>'])

/**
 * 수식 중첩 깊이의 상한(괄호·함수 인자·배열·NOT·단항 부호가 겹치는 단계). 사용자 모델 파일(신뢰할 수 없는 입력)이 파서의 재귀로
 * 호출 스택을 넘기지 못하게 한다(설계 08의 5.3). 정상적인 수식은 이보다 훨씬 얕다.
 */
export const MAX_EXPR_DEPTH = 64

class Parser {
  private index = 0
  private depth = 0

  constructor(
    private readonly tokens: Token[],
    private readonly source: string
  ) {}

  parse(): Node {
    const node = this.or()
    const t = this.peek()
    if (t.type !== 'eof') this.fail(`예상하지 못한 '${t.value}'`, t)
    return node
  }

  private peek(): Token {
    return this.tokens[this.index] as Token
  }

  private next(): Token {
    const t = this.peek()
    if (t.type !== 'eof') this.index++
    return t
  }

  private isOp(value: string): boolean {
    const t = this.peek()
    return t.type === 'op' && t.value === value
  }

  private expectOp(value: string): Token {
    const t = this.peek()
    if (t.type === 'op' && t.value === value) return this.next()
    return this.fail(
      t.type === 'eof' ? `'${value}'가 필요합니다` : `'${value}'가 필요한데 '${t.value}'가 있습니다`,
      t
    )
  }

  private fail(detail: string, t: Token): never {
    throw new ExprError(detail, t.pos, this.source)
  }

  /** 한 단계 더 깊이 들어간다. 상한을 넘으면 수식 오류로 거절한다. */
  private nested<T>(fn: () => T): T {
    if (this.depth >= MAX_EXPR_DEPTH) this.fail(`수식이 너무 깊게 중첩되어 있습니다(최대 ${MAX_EXPR_DEPTH}단계)`, this.peek())
    this.depth++
    try {
      return fn()
    } finally {
      this.depth--
    }
  }

  private or(): Node {
    return this.nested(() => this.orBody())
  }

  private orBody(): Node {
    let left = this.and()
    while (this.isOp('OR')) {
      const op = this.next()
      left = { kind: 'binary', op: 'OR', left, right: this.and(), pos: op.pos }
    }
    return left
  }

  private and(): Node {
    let left = this.not()
    while (this.isOp('AND')) {
      const op = this.next()
      left = { kind: 'binary', op: 'AND', left, right: this.not(), pos: op.pos }
    }
    return left
  }

  private not(): Node {
    if (this.isOp('NOT')) {
      const op = this.next()
      return { kind: 'unary', op: 'NOT', arg: this.nested(() => this.not()), pos: op.pos }
    }
    return this.comparison()
  }

  private comparison(): Node {
    const left = this.additive()
    const t = this.peek()
    if (t.type === 'op' && COMPARE.has(t.value)) {
      this.next()
      const right = this.additive()
      const after = this.peek()
      if (after.type === 'op' && COMPARE.has(after.value)) {
        this.fail('비교 연산자는 연속해서 쓸 수 없습니다. AND로 나누세요', after)
      }
      return { kind: 'binary', op: t.value as BinaryOp, left, right, pos: t.pos }
    }
    return left
  }

  private additive(): Node {
    let left = this.multiplicative()
    for (;;) {
      const t = this.peek()
      if (t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next()
        left = { kind: 'binary', op: t.value, left, right: this.multiplicative(), pos: t.pos }
      } else return left
    }
  }

  private multiplicative(): Node {
    let left = this.unary()
    for (;;) {
      const t = this.peek()
      if (t.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.next()
        left = { kind: 'binary', op: t.value, left, right: this.unary(), pos: t.pos }
      } else return left
    }
  }

  /** 단항 마이너스는 거듭제곱보다 약하게 묶인다: -2^2 = -(2^2). */
  private unary(): Node {
    const t = this.peek()
    if (t.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next()
      return { kind: 'unary', op: t.value, arg: this.nested(() => this.unary()), pos: t.pos }
    }
    return this.power()
  }

  /** 거듭제곱은 오른쪽 결합: 2^3^2 = 2^(3^2). */
  private power(): Node {
    const base = this.primary()
    if (this.isOp('^')) {
      const op = this.next()
      return { kind: 'binary', op: '^', left: base, right: this.unary(), pos: op.pos }
    }
    return base
  }

  private primary(): Node {
    const t = this.next()
    if (t.type === 'num') return { kind: 'num', value: Number(t.value), pos: t.pos }
    if (t.type === 'ident') {
      if (this.isOp('(')) {
        this.next()
        const args: Node[] = []
        if (!this.isOp(')')) {
          args.push(this.or())
          while (this.isOp(',')) {
            this.next()
            args.push(this.or())
          }
        }
        this.expectOp(')')
        return { kind: 'call', name: t.value, args, pos: t.pos }
      }
      return { kind: 'var', name: t.value, pos: t.pos }
    }
    if (t.type === 'op' && t.value === '(') {
      const inner = this.or()
      this.expectOp(')')
      return inner
    }
    if (t.type === 'op' && t.value === '[') {
      const items: Node[] = []
      if (!this.isOp(']')) {
        items.push(this.or())
        while (this.isOp(',')) {
          this.next()
          items.push(this.or())
        }
      }
      this.expectOp(']')
      return { kind: 'array', items, pos: t.pos }
    }
    return this.fail(t.type === 'eof' ? '수식이 끝났습니다. 값이 필요합니다' : `예상하지 못한 '${t.value}'`, t)
  }
}

export function parse(source: string): Node {
  return new Parser(tokenize(source), source).parse()
}
