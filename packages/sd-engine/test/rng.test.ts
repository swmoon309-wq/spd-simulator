import { describe, expect, it } from 'vitest'
import { Rng } from '../src'

describe('Rng', () => {
  it('[0, 1) 범위이고 시드로 재현된다', () => {
    const a = new Rng(123)
    const b = new Rng(123)
    for (let i = 0; i < 1000; i++) {
      const x = a.next()
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      expect(x).toBe(b.next())
    }
  })
  it('삼각 분포는 min==max면 그 값', () => {
    expect(new Rng(1).triangular(3, 3, 3)).toBe(3)
  })
  it('삼각 분포의 mode는 범위로 제한된다', () => {
    const r = new Rng(1)
    for (let i = 0; i < 100; i++) {
      const v = r.triangular(0, 99, 1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
