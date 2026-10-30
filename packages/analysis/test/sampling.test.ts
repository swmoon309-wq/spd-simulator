import { describe, expect, it } from 'vitest'
import { defaultRange, mixSeed, pearson, ppf, sampleInput, sampleRow, templateDist, uniformFor, validateInput, validateInputs, type InputSpec } from '../src'

const tri = (name = 'a'): InputSpec => ({ name, dist: { kind: 'triangular', min: 0.8, mode: 1, max: 1.3 }, min: 0.1, max: 3 })

describe('난수 유도', () => {
  it('같은 (시드, 반복, 이름)은 항상 같은 값', () => {
    expect(uniformFor(1, 5, 'a')).toBe(uniformFor(1, 5, 'a'))
    expect(mixSeed(1, 5, 'a')).toBe(mixSeed(1, 5, 'a'))
  })
  it('시드·반복·이름 중 하나만 달라도 값이 달라진다', () => {
    const base = uniformFor(1, 5, 'a')
    expect(uniformFor(2, 5, 'a')).not.toBe(base)
    expect(uniformFor(1, 6, 'a')).not.toBe(base)
    expect(uniformFor(1, 5, 'b')).not.toBe(base)
  })
  it('값은 (0, 1) 안이다', () => {
    for (let i = 0; i < 2000; i++) {
      const u = uniformFor(i, i * 3, `p${i % 7}`)
      expect(u).toBeGreaterThan(0)
      expect(u).toBeLessThan(1)
    }
  })
  it('균등성: 평균 0.5, 분산 1/12(허용 오차 안), 구간별 도수가 고르다', () => {
    const n = 30000
    const xs = Array.from({ length: n }, (_, i) => uniformFor(7, i, 'x'))
    const m = xs.reduce((a, b) => a + b, 0) / n
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / n
    expect(m).toBeCloseTo(0.5, 2)
    expect(v).toBeCloseTo(1 / 12, 2)
    const bins = new Array(10).fill(0)
    for (const x of xs) bins[Math.min(9, Math.floor(x * 10))]++
    for (const c of bins) expect(Math.abs(c - n / 10)).toBeLessThan(0.1 * (n / 10))
  })
  it('독립성: 이름이 다른 두 난수열, 시드가 다른 두 난수열, 인접한 반복의 상관이 거의 0', () => {
    const n = 20000
    const a = Array.from({ length: n }, (_, i) => uniformFor(1, i, 'a'))
    const b = Array.from({ length: n }, (_, i) => uniformFor(1, i, 'b'))
    const c = Array.from({ length: n }, (_, i) => uniformFor(2, i, 'a'))
    expect(Math.abs(pearson(a, b))).toBeLessThan(0.03)
    expect(Math.abs(pearson(a, c))).toBeLessThan(0.03)
    expect(Math.abs(pearson(a.slice(1), a.slice(0, -1)))).toBeLessThan(0.03)
  })
})

describe('표본 추출', () => {
  it('입력 하나의 표본은 그 입력의 이름·시드·반복에만 의존한다(다른 입력을 더하거나 빼도 같다)', () => {
    const a = tri('a')
    const b = tri('b')
    const solo = [0, 1, 2, 3].map((i) => sampleInput(a, 5, i))
    const both = [0, 1, 2, 3].map((i) => sampleRow([b, a], 5, i)['a'])
    expect(both).toEqual(solo)
  })
  it('반복 수를 늘려도 앞의 표본이 같다(접두 안정)', () => {
    const f = (n: number) => Array.from({ length: n }, (_, i) => sampleInput(tri(), 9, i))
    expect(f(100).slice(0, 40)).toEqual(f(40))
  })
  it('표본의 평균·분포가 이론과 맞다(삼각 0.8/1/1.3 → 평균 1.0333)', () => {
    const n = 20000
    const xs = Array.from({ length: n }, (_, i) => sampleInput(tri(), 3, i))
    expect(xs.reduce((a, b) => a + b, 0) / n).toBeCloseTo((0.8 + 1 + 1.3) / 3, 2)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.8)
    expect(Math.max(...xs)).toBeLessThanOrEqual(1.3)
  })
  it('허용 범위로 제한한다(정규는 절단 범위가 허용 범위)', () => {
    const spec: InputSpec = { name: 'p', dist: { kind: 'normal', mean: 1, sd: 2 }, min: 0.5, max: 1.5 }
    const xs = Array.from({ length: 3000 }, (_, i) => sampleInput(spec, 1, i))
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0.5)
    expect(Math.max(...xs)).toBeLessThanOrEqual(1.5)
  })
  it('정수 파라미터는 반올림하고 범위 안의 정수만 낸다', () => {
    const spec: InputSpec = { name: 'n', dist: { kind: 'uniform', min: 1, max: 10 }, min: 0, max: 12, integer: true }
    const xs = Array.from({ length: 2000 }, (_, i) => sampleInput(spec, 1, i))
    expect(xs.every((x) => Number.isInteger(x))).toBe(true)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1)
    expect(Math.max(...xs)).toBeLessThanOrEqual(10)
    expect(new Set(xs).size).toBeGreaterThan(8)
  })
  it('퇴화 분포는 항상 고정값', () => {
    const spec: InputSpec = { name: 'f', dist: { kind: 'uniform', min: 0.7, max: 0.7 }, min: 0, max: 1 }
    for (let i = 0; i < 50; i++) expect(sampleInput(spec, 2, i)).toBe(0.7)
  })
  it('sampleRow는 입력마다 한 값', () => {
    const row = sampleRow([tri('a'), tri('b')], 1, 3)
    expect(Object.keys(row).sort()).toEqual(['a', 'b'])
    expect(row['a']).not.toBe(row['b'])
  })
  it('같은 u에서 분포를 바꿔도 순위가 보존된다(분위수 대응)', () => {
    const u = [0.1, 0.4, 0.7, 0.95].map((q) => ppf({ kind: 'triangular', min: 0, mode: 5, max: 10 }, q))
    expect([...u].sort((a, b) => a - b)).toEqual(u)
  })
})

describe('입력 검사·범위·템플릿', () => {
  it('validateInput / validateInputs', () => {
    expect(validateInput(tri())).toBeNull()
    expect(validateInput({ ...tri(), min: 1.0, max: 1.2 })).toContain('허용 범위')
    expect(validateInput({ name: 'n', dist: { kind: 'uniform', min: 1, max: 2 }, min: 1.2, max: 1.8, integer: true })).toContain('허용 범위') // 정수 범위가 비는 경우보다 먼저 분포 범위 검사
    expect(validateInputs([tri('a'), tri('a')])).toContain('겹칩니다')
    expect(validateInputs([tri('a'), { ...tri('b'), dist: { kind: 'uniform', min: 3, max: 1 } }])).toContain("'b'")
    expect(validateInputs([tri('a'), tri('b')])).toBeNull()
  })
  it('defaultRange: 분포의 P10·P90(정수는 반올림)', () => {
    const [lo, hi] = defaultRange(tri())
    expect(lo).toBeCloseTo(ppf({ kind: 'triangular', min: 0.8, mode: 1, max: 1.3 }, 0.1), 12)
    expect(hi).toBeCloseTo(ppf({ kind: 'triangular', min: 0.8, mode: 1, max: 1.3 }, 0.9), 12)
    const ints = defaultRange({ name: 'n', dist: { kind: 'uniform', min: 0, max: 10 }, min: 0, max: 20, integer: true })
    expect(ints).toEqual([1, 9])
  })
  it('templateDist: 삼각(0.8v, v, 1.3v)을 허용 범위로 자른다', () => {
    expect(templateDist(10, { min: 0, max: 100 })).toEqual({ kind: 'triangular', min: 8, mode: 10, max: 13 })
    expect(templateDist(10, { min: 9, max: 11 })).toEqual({ kind: 'triangular', min: 9, mode: 10, max: 11 })
    const edge = templateDist(2, { min: 0, max: 2 })
    expect(edge).toEqual({ kind: 'triangular', min: 1.6, mode: 2, max: 2 })
    const d = templateDist(0, { min: 0, max: 5 })
    expect(d.kind === 'triangular' && d.min <= d.mode && d.mode <= d.max).toBe(true)
    const neg = templateDist(-10, { min: -20, max: 0 })
    expect(neg.kind === 'triangular' && neg.min <= neg.mode && neg.mode <= neg.max).toBe(true)
  })
})
