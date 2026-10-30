import { describe, expect, it } from 'vitest'
import {
  cdfAtSorted,
  convergence,
  ecdf,
  finiteSorted,
  histogram,
  meanCI,
  niceStep,
  pearson,
  percentileSorted,
  quantileCI,
  ranks,
  requiredSamples,
  spearman,
  sturges,
  summarize,
  wilson
} from '../src'

describe('백분위수(type 7)', () => {
  it('손으로 계산한 값', () => {
    const s = [1, 2, 3, 4, 5]
    expect(percentileSorted(s, 0.5)).toBe(3)
    expect(percentileSorted(s, 0.25)).toBe(2)
    expect(percentileSorted(s, 0.1)).toBeCloseTo(1.4, 12)
    expect(percentileSorted(s, 0)).toBe(1)
    expect(percentileSorted(s, 1)).toBe(5)
    expect(percentileSorted([10, 20, 30, 40], 0.8)).toBeCloseTo(34, 12) // pos = 3×0.8 = 2.4
  })
  it('경계: 비어 있음, 하나', () => {
    expect(percentileSorted([], 0.5)).toBeNaN()
    expect(percentileSorted([7], 0.9)).toBe(7)
    expect(percentileSorted([1, 2], -1)).toBe(1)
    expect(percentileSorted([1, 2], 2)).toBe(2)
  })
})

describe('summarize', () => {
  it('평균·표본 표준편차(n−1)·최소·최대·백분위수', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])
    expect(s.n).toBe(8)
    expect(s.mean).toBe(5)
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 12)
    expect(s.min).toBe(2)
    expect(s.max).toBe(9)
    expect(s.percentiles['0.5']).toBe(4.5)
  })
  it('유한하지 않은 값은 제외하고, 비어 있으면 NaN', () => {
    expect(summarize([1, NaN, 3, Infinity]).n).toBe(2)
    expect(summarize([NaN]).mean).toBeNaN()
    expect(summarize([5]).sd).toBe(0)
  })
  it('finiteSorted는 정렬한 복사본', () => {
    expect(Array.from(finiteSorted([3, NaN, 1, 2]))).toEqual([1, 2, 3])
  })
})

describe('평균의 신뢰구간(책 A.6.1.1)', () => {
  it('책의 예제: n = 16, 평균 238, 표준편차 58.8 → 90% 구간 212 ~ 264', () => {
    const ci = meanCI(238, 58.8, 16, 0.9)
    expect(ci.low).toBeCloseTo(212.2, 1)
    expect(ci.high).toBeCloseTo(263.8, 1)
    expect(Math.round(ci.low)).toBe(212)
    expect(Math.round(ci.high)).toBe(264)
  })
  it('신뢰 수준이 높을수록 넓고, 표본이 많을수록 좁다', () => {
    expect(meanCI(0, 1, 16, 0.95).half).toBeGreaterThan(meanCI(0, 1, 16, 0.9).half)
    expect(meanCI(0, 1, 64, 0.95).half).toBeLessThan(meanCI(0, 1, 16, 0.95).half)
  })
  it('n이 크면 정규 근사(1.96 s/√n)에 수렴한다', () => {
    expect(meanCI(0, 1, 40000, 0.95).half).toBeCloseTo((1.96 * 1) / Math.sqrt(40000), 5)
  })
  it('n < 2이면 구간이 점', () => {
    expect(meanCI(5, 0, 1)).toEqual({ low: 5, high: 5, half: 0 })
  })
  it('requiredSamples: 책의 관계 n ≥ (z·s/h)²', () => {
    expect(requiredSamples(58.8, 10, 0.95)).toBe(Math.ceil((1.959963984540054 * 5.88) ** 2))
    expect(requiredSamples(1, 0)).toBe(Infinity)
  })
})

describe('분위수의 신뢰구간', () => {
  const sorted = Array.from({ length: 1000 }, (_, i) => i + 1)
  it('점 추정을 포함하고 순위로 구한다', () => {
    const ci = quantileCI(sorted, 0.8, 0.95)
    expect(ci.low).toBeLessThan(percentileSorted(sorted, 0.8))
    expect(ci.high).toBeGreaterThan(percentileSorted(sorted, 0.8))
    // n p = 800, z√(n p (1−p)) ≈ 24.8
    expect(ci.low).toBe(775)
    expect(ci.high).toBe(826)
  })
  it('표본이 작거나 극단 분위수여도 범위 안', () => {
    const small = quantileCI([1, 2, 3], 0.99)
    expect(small.low).toBeGreaterThanOrEqual(1)
    expect(small.high).toBeLessThanOrEqual(3)
    expect(quantileCI([], 0.5).low).toBeNaN()
  })
  it('균등 표본에서 95% 구간이 실제 분위수를 포함하는 비율 ≈ 95%', () => {
    let hit = 0
    const trials = 400
    let s = 12345
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    for (let t = 0; t < trials; t++) {
      const x = Array.from({ length: 300 }, rnd).sort((a, b) => a - b)
      const ci = quantileCI(x, 0.8, 0.95)
      if (ci.low <= 0.8 && 0.8 <= ci.high) hit++
    }
    expect(hit / trials).toBeGreaterThan(0.9)
    expect(hit / trials).toBeLessThan(0.99)
  })
})

describe('Wilson 구간', () => {
  it('알려진 값: 5/10 → 0.2366 ~ 0.7634', () => {
    const w = wilson(5, 10, 0.95)
    expect(w.p).toBe(0.5)
    expect(w.low).toBeCloseTo(0.2366, 3)
    expect(w.high).toBeCloseTo(0.7634, 3)
  })
  it('경계: 0/10과 10/10', () => {
    const z = wilson(0, 10)
    expect(z.low).toBe(0)
    expect(z.high).toBeCloseTo(0.2775, 3)
    const a = wilson(10, 10)
    expect(a.high).toBe(1)
    expect(a.low).toBeCloseTo(0.7225, 3)
    expect(wilson(0, 0).p).toBeNaN()
  })
  it('n이 클수록 좁다', () => {
    const w1 = wilson(50, 100)
    const w2 = wilson(500, 1000)
    expect(w2.high - w2.low).toBeLessThan(w1.high - w1.low)
  })
})

describe('히스토그램과 누적분포', () => {
  it('도수의 합 = 값의 개수, 구간 수는 Sturges(n = 100 → 8)', () => {
    const v = Array.from({ length: 100 }, (_, i) => (i * 37) % 101)
    const h = histogram(v)
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(100)
    expect(sturges(100)).toBe(8)
    expect(h.edges.length).toBe(h.counts.length + 1)
    for (let i = 1; i < h.edges.length; i++) expect(h.edges[i]).toBeGreaterThan(h.edges[i - 1] as number)
  })
  it('경계는 보기 좋은 수이고 모든 값을 덮는다(최대값 포함)', () => {
    const h = histogram([3.2, 7.9, 12.4, 12.5, 18.8, 19.0], 5)
    expect(h.edges[0]).toBeLessThanOrEqual(3.2)
    expect(h.edges[h.edges.length - 1]).toBeGreaterThanOrEqual(19)
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(6)
    expect(h.binWidth).toBe(niceStep(h.binWidth))
  })
  it('지정한 구간 수를 따르고, 같은 값만 있으면 구간 하나', () => {
    expect(histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10).counts.length).toBeGreaterThanOrEqual(5)
    const same = histogram([5, 5, 5])
    expect(same.counts).toEqual([3])
    expect(histogram([]).counts).toEqual([])
  })
  it('niceStep', () => {
    expect(niceStep(0.7)).toBe(1)
    expect(niceStep(1.3)).toBe(2)
    expect(niceStep(2.2)).toBe(2.5)
    expect(niceStep(3)).toBe(5)
    expect(niceStep(7)).toBe(10)
    expect(niceStep(0.013)).toBeCloseTo(0.02, 12)
    expect(niceStep(0)).toBe(1)
  })
  it('ecdf와 cdfAtSorted', () => {
    const e = ecdf([3, 1, 2, 2])
    expect(e.x).toEqual([1, 2, 2, 3])
    expect(e.p).toEqual([0.25, 0.5, 0.75, 1])
    const s = [1, 2, 2, 3]
    expect(cdfAtSorted(s, 0)).toBe(0)
    expect(cdfAtSorted(s, 2)).toBe(0.75)
    expect(cdfAtSorted(s, 5)).toBe(1)
    expect(cdfAtSorted([], 1)).toBeNaN()
  })
})

describe('상관', () => {
  it('피어슨: 완전한 선형은 ±1, 분산 0은 NaN', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12)
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1, 12)
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNaN()
    expect(pearson([1], [1])).toBeNaN()
  })
  it('순위: 동순위는 평균', () => {
    expect(ranks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4])
    expect(ranks([3, 1, 2])).toEqual([3, 1, 2])
  })
  it('스피어만: 단조(비선형 포함)는 ±1, 유한하지 않은 쌍은 제외', () => {
    const x = [1, 2, 3, 4, 5]
    expect(spearman(x, x.map((v) => v ** 3))).toBeCloseTo(1, 12)
    expect(spearman(x, x.map((v) => -Math.exp(v)))).toBeCloseTo(-1, 12)
    expect(spearman([1, 2, NaN, 4], [1, 2, 3, 4])).toBeCloseTo(1, 12)
    expect(pearson(x, x.map((v) => v ** 3))).toBeLessThan(1) // 비선형이라 피어슨은 1이 아니다
  })
  it('스피어만: 동순위가 있어도 [−1, 1]', () => {
    const r = spearman([1, 1, 2, 2, 3], [5, 6, 6, 7, 9])
    expect(r).toBeLessThanOrEqual(1)
    expect(r).toBeGreaterThan(0.8)
  })
})

describe('수렴 곡선', () => {
  const v = Array.from({ length: 500 }, (_, i) => 100 + 20 * Math.sin(i * 12.9898))
  it('마지막 점이 전체 표본의 통계와 같다', () => {
    const c = convergence(v, 0.8, 10)
    const last = c[c.length - 1]!
    const s = summarize(v)
    expect(last.n).toBe(500)
    expect(last.mean).toBeCloseTo(s.mean, 12)
    expect(last.quantile).toBeCloseTo(s.percentiles['0.8'] as number, 12)
    expect(last.half).toBeCloseTo(meanCI(s.mean, s.sd, 500).half, 12)
  })
  it('표본 수가 늘고 신뢰구간 반폭이 대체로 줄어든다', () => {
    const c = convergence(v, 0.8, 10)
    expect(c.map((p) => p.n)).toEqual([50, 100, 150, 200, 250, 300, 350, 400, 450, 500])
    expect(c[c.length - 1]!.half).toBeLessThan(c[0]!.half)
  })
  it('표본이 적으면 중복되는 지점을 합치고, 비어 있으면 빈 목록', () => {
    expect(convergence([1, 2, 3], 0.5, 10).map((p) => p.n)).toEqual([1, 2, 3])
    expect(convergence([], 0.5)).toEqual([])
    expect(convergence([NaN, NaN], 0.5)).toEqual([])
  })
})
