import { describe, expect, it } from 'vitest'
import { CycleError, topologicalOrder } from '../src'

const order = (deps: Record<string, string[]>, nodes = Object.keys(deps)) =>
  topologicalOrder(nodes, (n) => deps[n] ?? [])

describe('topologicalOrder', () => {
  it('의존하는 노드가 먼저 온다', () => {
    expect(order({ c: ['b'], b: ['a'], a: [] })).toEqual(['a', 'b', 'c'])
  })

  it('독립 노드는 선언 순서를 유지한다(결정적)', () => {
    expect(order({ x: [], y: [], z: [] })).toEqual(['x', 'y', 'z'])
    expect(order({ z: ['a'], y: [], a: [], x: [] })).toEqual(['y', 'a', 'z', 'x'])
  })

  it('다이아몬드 의존', () => {
    const o = order({ d: ['b', 'c'], b: ['a'], c: ['a'], a: [] })
    expect(o[0]).toBe('a')
    expect(o[3]).toBe('d')
  })

  it('노드 집합에 없는 의존은 무시한다', () => {
    expect(order({ a: ['constant_k', 'TIME'], b: ['a'] })).toEqual(['a', 'b'])
  })

  it('같은 의존이 중복되어도 된다', () => {
    expect(order({ a: [], b: ['a', 'a'] })).toEqual(['a', 'b'])
  })

  it('빈 입력', () => expect(order({})).toEqual([]))

  it('자기 참조는 순환', () => {
    try {
      order({ a: ['a'] })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(CycleError)
      expect((e as CycleError).cycle).toEqual(['a', 'a'])
    }
  })

  it('순환 경로를 [a, b, a] 형태로 알려준다', () => {
    try {
      order({ ok: [], a: ['b'], b: ['a'] })
      expect.unreachable()
    } catch (e) {
      const c = (e as CycleError).cycle
      expect(c[0]).toBe(c[c.length - 1])
      expect(new Set(c)).toEqual(new Set(['a', 'b']))
      expect((e as Error).message).toContain('→')
    }
  })

  it('순환에 이르는 꼬리는 경로에서 제외한다', () => {
    // t는 순환(a↔b)에 의존하지만 순환의 일부는 아니다
    try {
      order({ t: ['a'], a: ['b'], b: ['a'] })
      expect.unreachable()
    } catch (e) {
      expect(new Set((e as CycleError).cycle)).toEqual(new Set(['a', 'b']))
    }
  })

  it('3개 이상의 순환', () => {
    try {
      order({ a: ['c'], b: ['a'], c: ['b'] })
      expect.unreachable()
    } catch (e) {
      expect((e as CycleError).cycle).toHaveLength(4)
    }
  })

  it('큰 체인도 처리한다', () => {
    const deps: Record<string, string[]> = {}
    for (let i = 0; i < 500; i++) deps[`n${i}`] = i === 0 ? [] : [`n${i - 1}`]
    const nodes = Object.keys(deps).reverse() // 선언은 거꾸로
    expect(topologicalOrder(nodes, (n) => deps[n] as string[])[0]).toBe('n0')
  })
})
