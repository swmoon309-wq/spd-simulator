import { describe, expect, it } from 'vitest'
import { betaCdf, betaPpf, cdf, distMean, normalCdf, normalPpf, ppf, resolveDist, support, tCdf, tPpf, validateDist, type DistSpec } from '../src'

describe('정규 분포', () => {
  it('표준정규 분위수의 알려진 값', () => {
    expect(normalPpf(0.5)).toBe(0)
    expect(normalPpf(0.975)).toBeCloseTo(1.959963984540054, 12)
    expect(normalPpf(0.95)).toBeCloseTo(1.6448536269514722, 12)
    expect(normalPpf(0.8)).toBeCloseTo(0.8416212335729143, 12)
    expect(normalPpf(0.025)).toBeCloseTo(-1.959963984540054, 12)
    expect(normalPpf(0.0001)).toBeCloseTo(-3.7190164854556804, 10)
    expect(normalPpf(0)).toBe(-Infinity)
    expect(normalPpf(1)).toBe(Infinity)
  })
  it('누적분포의 알려진 값과 대칭', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 15)
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 12)
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 12)
    for (const x of [0.3, 1.7, 4.2]) expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1, 14)
  })
  it('ppf(cdf(x)) = x (꼬리 포함)', () => {
    for (let x = -6; x <= 6; x += 0.25) expect(normalPpf(normalCdf(x))).toBeCloseTo(x, 7)
  })
  it('책의 예제: N(50, 10²)에서 r = 0.42 → 약 48, 0.86 → 약 61, 0.321 → 45.4 (그림 A.16, 표 A.3)', () => {
    const d: DistSpec = { kind: 'normal', mean: 50, sd: 10 }
    expect(ppf(d, 0.42)).toBeCloseTo(47.98, 1)
    expect(ppf(d, 0.86)).toBeCloseTo(60.8, 1)
    expect(ppf(d, 0.321)).toBeCloseTo(45.4, 1)
    expect(ppf(d, 0.55)).toBeCloseTo(51.3, 1)
    expect(ppf(d, 0.954)).toBeCloseTo(66.8, 1)
  })
  it('절단 정규는 범위 안에 머물고 양 끝에서 범위 끝값이 된다', () => {
    const d: DistSpec = { kind: 'normal', mean: 50, sd: 10, lo: 40, hi: 70 }
    expect(ppf(d, 0)).toBe(40)
    expect(ppf(d, 1)).toBe(70)
    for (let u = 0; u <= 1; u += 0.01) {
      const x = ppf(d, u)
      expect(x).toBeGreaterThanOrEqual(40)
      expect(x).toBeLessThanOrEqual(70)
      expect(cdf(d, x)).toBeCloseTo(u, 9)
    }
    // 평균이 절단 범위 밖이어도 분포가 정의된다
    const far: DistSpec = { kind: 'normal', mean: 100, sd: 10, lo: 40, hi: 70 }
    expect(ppf(far, 0.5)).toBeGreaterThan(60)
  })
  it('절단 정규의 평균은 수치 적분과 같다', () => {
    const d: DistSpec = { kind: 'normal', mean: 50, sd: 10, lo: 40, hi: 80 }
    let sum = 0
    const n = 20000
    for (let i = 0; i < n; i++) sum += ppf(d, (i + 0.5) / n)
    expect(distMean(d)).toBeCloseTo(sum / n, 3)
  })
})

describe('삼각·PERT·균등', () => {
  const tri: DistSpec = { kind: 'triangular', min: 0, mode: 3, max: 10 }
  const pert: DistSpec = { kind: 'pert', min: 2, mode: 4, max: 12 }
  const mid = (d: DistSpec, n = 20000) => {
    let s = 0
    for (let i = 0; i < n; i++) s += ppf(d, (i + 0.5) / n)
    return s / n
  }
  it('균등: 선형, 평균은 중점', () => {
    const u: DistSpec = { kind: 'uniform', min: 2, max: 6 }
    expect(ppf(u, 0.25)).toBe(3)
    expect(cdf(u, 5)).toBe(0.75)
    expect(distMean(u)).toBe(4)
  })
  it('삼각: 닫힌 식의 분위수와 최빈값에서의 누적', () => {
    expect(cdf(tri, 3)).toBeCloseTo(0.3, 12) // (c−a)/(b−a)
    expect(ppf(tri, 0.3)).toBeCloseTo(3, 12)
    expect(ppf(tri, 0)).toBe(0)
    expect(ppf(tri, 1)).toBe(10)
    expect(distMean(tri)).toBeCloseTo(13 / 3, 12)
    expect(mid(tri)).toBeCloseTo(13 / 3, 3)
  })
  it('삼각: 엔진의 RANDOM_TRIANGULAR와 같은 역변환(같은 u에서 같은 값)', async () => {
    const { Rng } = await import('@spd/sd-engine')
    for (const seed of [1, 7, 99]) {
      const a = new Rng(seed)
      const b = new Rng(seed)
      for (let i = 0; i < 20; i++) expect(ppf(tri, a.next())).toBeCloseTo(b.triangular(0, 3, 10), 12)
    }
  })
  it('PERT: 평균 (a + 4m + b)/6, 분위수·누적의 역관계', () => {
    expect(distMean(pert)).toBeCloseTo((2 + 16 + 12) / 6, 12)
    expect(mid(pert)).toBeCloseTo(5, 3)
    for (let u = 0.02; u < 1; u += 0.04) expect(cdf(pert, ppf(pert, u))).toBeCloseTo(u, 9)
  })
  it('PERT는 삼각보다 최빈값 쪽에 몰린다(분산이 작다)', () => {
    const t: DistSpec = { kind: 'triangular', min: 2, mode: 4, max: 12 }
    const sd = (d: DistSpec) => {
      const n = 4000
      const xs = Array.from({ length: n }, (_, i) => ppf(d, (i + 0.5) / n))
      const m = xs.reduce((a, b) => a + b, 0) / n
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / n)
    }
    expect(sd(pert)).toBeLessThan(sd(t))
  })
  it('퇴화(최소 = 최대)는 고정값', () => {
    for (const d of [
      { kind: 'uniform', min: 5, max: 5 },
      { kind: 'triangular', min: 5, mode: 5, max: 5 },
      { kind: 'pert', min: 5, mode: 5, max: 5 }
    ] as DistSpec[]) {
      for (const u of [0, 0.3, 1]) expect(ppf(d, u)).toBe(5)
      expect(cdf(d, 4.9)).toBe(0)
      expect(cdf(d, 5)).toBe(1)
    }
  })
  it('누적분포는 비감소이고 지지구간 밖에서 0과 1', () => {
    for (const d of [tri, pert, { kind: 'uniform', min: 1, max: 9 } as DistSpec]) {
      const [lo, hi] = support(d)
      expect(cdf(d, lo - 1)).toBe(0)
      expect(cdf(d, hi + 1)).toBe(1)
      let prev = -1
      for (let x = lo; x <= hi; x += (hi - lo) / 100) {
        const f = cdf(d, x)
        expect(f).toBeGreaterThanOrEqual(prev - 1e-12)
        prev = f
      }
    }
  })
  it('u는 [0, 1]로 제한한다(범위 밖 입력에도 지지구간 안의 값)', () => {
    expect(ppf(tri, -3)).toBe(0)
    expect(ppf(tri, 3)).toBe(10)
  })
})

describe('베타·t 분포 보조 함수', () => {
  it('불완전 베타: I_x(1,1) = x, I_0.5(2,2) = 0.5, 대칭 관계, 알려진 값', () => {
    for (const x of [0.1, 0.5, 0.9]) expect(betaCdf(x, 1, 1)).toBeCloseTo(x, 12)
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 12)
    expect(betaCdf(0.3, 2, 5) + betaCdf(0.7, 5, 2)).toBeCloseTo(1, 12)
    expect(betaCdf(0.4, 2, 3)).toBeCloseTo(0.5248, 4)
    expect(betaCdf(0, 2, 3)).toBe(0)
    expect(betaCdf(1, 2, 3)).toBe(1)
  })
  it('베타 분위수는 누적의 역', () => {
    for (const [a, b] of [[2, 3], [5, 1.5], [1, 1]] as const) for (const u of [0.05, 0.5, 0.95]) expect(betaCdf(betaPpf(u, a, b), a, b)).toBeCloseTo(u, 10)
  })
  it('t 분위수: 표의 값(0.95, df 15 → 1.7531, 0.975, df 10 → 2.2281, 0.975, df 30 → 2.0423)', () => {
    expect(tPpf(0.95, 15)).toBeCloseTo(1.7531, 4)
    expect(tPpf(0.975, 10)).toBeCloseTo(2.2281, 4)
    expect(tPpf(0.975, 30)).toBeCloseTo(2.0423, 4)
    expect(tPpf(0.5, 7)).toBeCloseTo(0, 10)
  })
  it('t는 대칭이고 df가 커지면 정규에 수렴', () => {
    expect(tPpf(0.1, 12)).toBeCloseTo(-tPpf(0.9, 12), 10)
    expect(tCdf(1.3, 8) + tCdf(-1.3, 8)).toBeCloseTo(1, 12)
    expect(tPpf(0.975, 1e7)).toBeCloseTo(normalPpf(0.975), 8)
    expect(tPpf(0.975, 5000)).toBeCloseTo(1.96, 2)
  })
})

describe('validateDist / resolveDist', () => {
  const bounds = { min: 0.1, max: 2 }
  it('올바른 분포는 통과', () => {
    expect(validateDist({ kind: 'uniform', min: 0.5, max: 1 }, bounds)).toBeNull()
    expect(validateDist({ kind: 'triangular', min: 0.5, mode: 1, max: 1.5 }, bounds)).toBeNull()
    expect(validateDist({ kind: 'pert', min: 0.5, mode: 1, max: 1.5 }, bounds)).toBeNull()
    expect(validateDist({ kind: 'normal', mean: 1, sd: 0.2 }, bounds)).toBeNull()
    expect(validateDist({ kind: 'uniform', min: 1, max: 1 }, bounds)).toBeNull() // 퇴화 허용
  })
  it.each([
    ['최소 > 최대', { kind: 'uniform', min: 2, max: 1 }, '최대보다 클 수 없'],
    ['최빈이 범위 밖', { kind: 'triangular', min: 1, mode: 3, max: 2 }, '최소 ≤ 최빈 ≤ 최대'],
    ['PERT 순서', { kind: 'pert', min: 1, mode: 0.5, max: 2 }, '최소 ≤ 최빈 ≤ 최대'],
    ['표준편차 0', { kind: 'normal', mean: 1, sd: 0 }, '0보다 커야'],
    ['NaN', { kind: 'uniform', min: NaN, max: 1 }, '유한'],
    ['허용 범위 아래', { kind: 'triangular', min: 0.05, mode: 1, max: 1.5 }, '허용 범위'],
    ['허용 범위 위', { kind: 'uniform', min: 1, max: 3 }, '허용 범위'],
    ['정규의 절단이 허용 범위 밖', { kind: 'normal', mean: 1, sd: 1, lo: 0, hi: 1 }, '허용 범위'],
    ['정규 절단 범위가 뒤집힘', { kind: 'normal', mean: 1, sd: 1, lo: 2, hi: 1 }, '최소는 최대보다 작아야'],
    ['절단 범위에 확률이 없음', { kind: 'normal', mean: 100, sd: 1, lo: 1, hi: 2 }, '거의 없습니다']
  ])('거부: %s', (_n, d, msg) => {
    expect(validateDist(d as DistSpec, bounds)).toContain(msg)
  })
  it('resolveDist: 정규의 절단 범위를 허용 범위로 채우고 다른 분포는 그대로', () => {
    expect(resolveDist({ kind: 'normal', mean: 1, sd: 0.3 }, bounds)).toEqual({ kind: 'normal', mean: 1, sd: 0.3, lo: 0.1, hi: 2 })
    expect(resolveDist({ kind: 'normal', mean: 1, sd: 0.3, lo: 0.5, hi: 5 }, bounds)).toEqual({ kind: 'normal', mean: 1, sd: 0.3, lo: 0.5, hi: 2 })
    const t: DistSpec = { kind: 'triangular', min: 0.5, mode: 1, max: 1.5 }
    expect(resolveDist(t, bounds)).toBe(t)
  })
})
