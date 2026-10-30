import { describe, expect, it } from 'vitest'
import { inputHash, inputKey, stableStringify, type RunInput } from '../src'

const input = (over: Partial<RunInput> = {}): RunInput => ({
  modelId: 'brooks',
  modelVersion: 1,
  params: { a: 1, b: 2.5 },
  run: { end: 400, dt: 0.25, seed: 1 },
  ...over
})

describe('stableStringify', () => {
  it('객체 키 순서와 무관하다', () => {
    expect(stableStringify({ b: 1, a: { d: 4, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 4 }, b: 1 }))
  })
  it('배열 순서는 의미가 있다', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })
  it('-0과 0을 같게, undefined 값은 키째 건너뛴다', () => {
    expect(stableStringify({ a: -0 })).toBe(stableStringify({ a: 0 }))
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })
  it('유한하지 않은 수는 거부한다', () => {
    expect(() => stableStringify({ a: NaN })).toThrow()
    expect(() => stableStringify({ a: Infinity })).toThrow()
  })
  it('문자열의 따옴표·한글을 안전하게 쓴다', () => {
    expect(stableStringify({ '키"': '값 "x"' })).toBe('{"키\\"":"값 \\"x\\""}')
  })
})

describe('inputKey와 inputHash', () => {
  it('같은 입력이면 같고(파라미터 키 순서 무관) 값 하나가 바뀌면 다르다', () => {
    expect(inputKey(input())).toBe(inputKey(input({ params: { b: 2.5, a: 1 } })))
    expect(inputKey(input())).not.toBe(inputKey(input({ params: { a: 1, b: 2.6 } })))
    expect(inputKey(input())).not.toBe(inputKey(input({ modelVersion: 2 })))
    expect(inputKey(input())).not.toBe(inputKey(input({ modelId: 'other' })))
    expect(inputKey(input())).not.toBe(inputKey(input({ run: { end: 400, dt: 0.25, seed: 2 } })))
    expect(inputKey(input())).not.toBe(inputKey(input({ run: { end: 400, dt: 0.5, seed: 1 } })))
  })
  it('해시는 결정적이고 14자리 16진수이며 입력이 다르면 달라진다', () => {
    const k = inputKey(input())
    expect(inputHash(k)).toBe(inputHash(k))
    expect(inputHash(k)).toMatch(/^[0-9a-f]{14}$/)
    expect(inputHash(k)).not.toBe(inputHash(inputKey(input({ params: { a: 1, b: 2.6 } }))))
  })
  it('서로 다른 입력 2000개에서 해시가 겹치지 않는다', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(inputHash(inputKey(input({ params: { a: i, b: i / 7 } }))))
    expect(seen.size).toBe(2000)
  })
})
