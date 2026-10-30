import { describe, expect, it } from 'vitest'
import { ExprError, tokenize } from '../src'

const kinds = (s: string) => tokenize(s).map((t) => `${t.type}:${t.value}`)

describe('tokenize', () => {
  it('숫자 형식을 읽는다', () => {
    expect(kinds('1 2.5 .5 3. 1e3 2.5E-2')).toEqual([
      'num:1', 'num:2.5', 'num:.5', 'num:3.', 'num:1e3', 'num:2.5E-2', 'eof:'
    ])
  })

  it('식별자와 연산자를 구분한다', () => {
    expect(kinds('hr_total*2+x1')).toEqual([
      'ident:hr_total', 'op:*', 'num:2', 'op:+', 'ident:x1', 'eof:'
    ])
  })

  it('AND/OR/NOT은 대소문자를 구분하지 않고 연산자가 된다', () => {
    expect(kinds('a and b Or NOT c')).toEqual([
      'ident:a', 'op:AND', 'ident:b', 'op:OR', 'op:NOT', 'ident:c', 'eof:'
    ])
  })

  it('이름에 포함된 키워드는 식별자로 유지한다', () => {
    expect(kinds('android not_x')).toEqual(['ident:android', 'ident:not_x', 'eof:'])
  })

  it('두 글자 연산자를 정규화한다', () => {
    expect(kinds('a<=b>=c<>d!=e==f')).toEqual([
      'ident:a', 'op:<=', 'ident:b', 'op:>=', 'ident:c', 'op:<>', 'ident:d',
      'op:<>', 'ident:e', 'op:=', 'ident:f', 'eof:'
    ])
  })

  it('허용되지 않는 문자는 위치와 함께 오류를 던진다', () => {
    try {
      tokenize('1 + $')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ExprError)
      expect((e as ExprError).pos).toBe(4)
    }
  })
})
