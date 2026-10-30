import { describe, expect, it } from 'vitest'
import { ExprError, MAX_EXPR_DEPTH, parse, type Node } from '../src'
import { value } from './helpers'

describe('parse 구조', () => {
  it('호출과 배열을 AST로 만든다', () => {
    const n = parse('GRAPH(x, [0, 1], [2, 3])') as Extract<Node, { kind: 'call' }>
    expect(n.kind).toBe('call')
    expect(n.name).toBe('GRAPH')
    expect(n.args.map((a) => a.kind)).toEqual(['var', 'array', 'array'])
  })

  it('인자 없는 호출을 허용한다', () => {
    expect((parse('F()') as Extract<Node, { kind: 'call' }>).args).toHaveLength(0)
  })
})

describe('연산자 우선순위와 결합', () => {
  it('곱셈이 덧셈보다 먼저', () => expect(value('2 + 3 * 4')).toBe(14))
  it('괄호', () => expect(value('(2 + 3) * 4')).toBe(20))
  it('뺄셈과 나눗셈은 왼쪽 결합', () => {
    expect(value('10 - 3 - 2')).toBe(5)
    expect(value('100 / 10 / 5')).toBe(2)
  })
  it('거듭제곱은 오른쪽 결합', () => expect(value('2 ^ 3 ^ 2')).toBe(512))
  it('단항 마이너스는 거듭제곱보다 약하다', () => {
    expect(value('-2 ^ 2')).toBe(-4)
    expect(value('2 ^ -1')).toBe(0.5)
    expect(value('--3')).toBe(3)
  })
  it('비교는 산술보다 약하고 AND/OR보다 강하다', () => {
    expect(value('1 + 1 = 2 AND 3 > 2')).toBe(1)
    expect(value('1 < 0 OR 2 < 1 + 5')).toBe(1)
  })
  it('NOT은 비교보다 약하다', () => {
    expect(value('NOT 1 > 2')).toBe(1)
    expect(value('NOT 1 < 2')).toBe(0)
  })
  it('AND가 OR보다 먼저', () => expect(value('1 OR 0 AND 0')).toBe(1))
})

describe('구문 오류', () => {
  const bad = (s: string) => () => parse(s)
  it.each(['1 +', '(1 + 2', '1 2', 'F(1,', '[1, 2', ')', '1 < 2 < 3'])('"%s"', (s) => {
    expect(bad(s)).toThrow(ExprError)
  })
  it('오류 메시지에 위치가 들어간다', () => {
    try {
      parse('1 + * 2')
      expect.unreachable()
    } catch (e) {
      expect((e as ExprError).pos).toBe(4)
    }
  })
})

describe('중첩 깊이 상한 (사용자 모델 파일의 안전)', () => {
  const nest = (depth: number, open: string, close: string, core = '1') => open.repeat(depth) + core + close.repeat(depth)

  it('상한(64단계)까지는 읽는다', () => {
    expect(() => parse(nest(MAX_EXPR_DEPTH - 1, '(', ')'))).not.toThrow()
    expect(() => parse(nest(MAX_EXPR_DEPTH - 1, 'MAX(1, ', ')'))).not.toThrow()
  })

  it.each([
    ['괄호', nest(MAX_EXPR_DEPTH + 1, '(', ')')],
    ['함수 인자', nest(MAX_EXPR_DEPTH + 1, 'ABS(', ')')],
    ['배열', nest(MAX_EXPR_DEPTH + 1, '[', ']')],
    ['NOT', 'NOT '.repeat(MAX_EXPR_DEPTH + 1) + '1'],
    ['단항 마이너스', '-'.repeat(MAX_EXPR_DEPTH + 1) + '1']
  ])('%s가 너무 깊으면 위치가 있는 수식 오류로 거절한다(스택을 넘기지 않는다)', (_name, source) => {
    try {
      parse(source)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ExprError)
      expect((e as ExprError).detail).toMatch(/너무 깊게 중첩/)
      expect((e as ExprError).pos).toBeGreaterThan(0)
    }
  })

  it('아주 깊은 입력(수만 단계)도 오류로 끝난다', () => {
    expect(() => parse(nest(50_000, '(', ')'))).toThrow(ExprError)
  })

  it('오른쪽으로 길게 이어진 덧셈(깊이 1)은 상한과 무관하다', () => {
    expect(() => parse(Array(400).fill('1').join(' + '))).not.toThrow()
  })
})
