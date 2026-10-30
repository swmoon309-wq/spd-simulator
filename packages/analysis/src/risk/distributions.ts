/**
 * 입력 분포(설계 06의 2장). 모든 분포는 균등난수 하나 `u ∈ [0, 1]`를 받아 역변환(책 A.3.1, `x = F⁻¹(u)`)으로 값을 만든다.
 * 난수열이 가변인 방법(기각법 등)을 쓰지 않으므로 분포를 바꿔도 같은 `u`로 비교할 수 있다.
 */

export type DistSpec =
  | { kind: 'uniform'; min: number; max: number }
  | { kind: 'triangular'; min: number; mode: number; max: number }
  | { kind: 'pert'; min: number; mode: number; max: number }
  | {
      kind: 'normal'
      mean: number
      sd: number
      /** 절단 범위(없으면 무한). 파라미터에 걸 때 허용 범위로 채운다. */
      lo?: number
      hi?: number
    }

export const DIST_KINDS: DistSpec['kind'][] = ['uniform', 'triangular', 'pert', 'normal']

export const DIST_LABEL: Record<DistSpec['kind'], string> = {
  uniform: '균등',
  triangular: '삼각',
  pert: 'PERT',
  normal: '정규(절단)'
}

// ---------- 수치 보조 함수 ----------

/** 로그 감마(Lanczos 근사). */
function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (const cj of c) ser += cj / ++y
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

/** 불완전 베타 함수의 연분수(Lentz). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-16) break
  }
  return h
}

/** 정규화 불완전 베타 함수 I_x(a, b). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b
}

/** 베타 분포의 역누적(이분법). */
export function betaPpf(u: number, a: number, b: number): number {
  if (u <= 0) return 0
  if (u >= 1) return 1
  let lo = 0
  let hi = 1
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (betaCdf(mid, a, b) < u) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 상보 오차 함수 erfc(z), z ≥ 0. 작은 z는 급수, 큰 z는 연분수. */
function erfcPos(z: number): number {
  if (z < 2.5) {
    // erf(z) = 2/√π Σ (−1)^n z^(2n+1) / (n! (2n+1))
    let term = z
    let sum = z
    for (let n = 1; n < 200; n++) {
      term *= (-z * z) / n
      const add = term / (2 * n + 1)
      sum += add
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * sum
  }
  // erfc(z) = e^(−z²)/√π · 1/(z + (1/2)/(z + 1/(z + (3/2)/(z + 2/(z + …)))))
  let f = z
  for (let k = 80; k >= 1; k--) f = z + k / 2 / f
  return Math.exp(-z * z) / Math.sqrt(Math.PI) / f
}

/** 표준정규 누적분포 Φ(x). */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2
  const tail = 0.5 * erfcPos(z)
  return x >= 0 ? 1 - tail : tail
}

/** 표준정규 분위수 Φ⁻¹(p). Acklam의 근사에 한 번 Halley 보정을 해 거의 배정밀도까지 맞춘다. */
export function normalPpf(p: number): number {
  if (!(p > 0)) return -Infinity
  if (!(p < 1)) return Infinity
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  let x: number
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    x = (((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q + (c[5] as number)
    x /= ((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1
  } else if (p <= 1 - plow) {
    const q = p - 0.5
    const r = q * q
    x = (((((a[0] as number) * r + (a[1] as number)) * r + (a[2] as number)) * r + (a[3] as number)) * r + (a[4] as number)) * r + (a[5] as number)
    x *= q
    x /= (((((b[0] as number) * r + (b[1] as number)) * r + (b[2] as number)) * r + (b[3] as number)) * r + (b[4] as number)) * r + 1
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    x = -(((((c[0] as number) * q + (c[1] as number)) * q + (c[2] as number)) * q + (c[3] as number)) * q + (c[4] as number)) * q - (c[5] as number)
    x /= ((((d[0] as number) * q + (d[1] as number)) * q + (d[2] as number)) * q + (d[3] as number)) * q + 1
  }
  // Halley 보정
  const e = normalCdf(x) - p
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2)
  return x - u / (1 + (x * u) / 2)
}

/** 스튜던트 t 누적분포. */
export function tCdf(t: number, df: number): number {
  if (t === 0) return 0.5
  const x = df / (df + t * t)
  const tail = 0.5 * betaCdf(x, df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}

/** 스튜던트 t 분위수(이분법). df가 매우 크면 정규에 수렴한다. */
export function tPpf(p: number, df: number): number {
  if (!(p > 0)) return -Infinity
  if (!(p < 1)) return Infinity
  if (p === 0.5) return 0
  if (df > 1e6) return normalPpf(p)
  let lo = -1e3
  let hi = 1e3
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (tCdf(mid, df) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// ---------- 분포 ----------

const finite = (x: number) => Number.isFinite(x)

/** 입력 검사. 문제가 없으면 null. `bounds`가 있으면 지지구간이 그 안에 있어야 한다. */
export function validateDist(d: DistSpec, bounds?: { min: number; max: number }): string | null {
  const within = (lo: number, hi: number) => (bounds && (lo < bounds.min || hi > bounds.max) ? `값의 범위가 허용 범위(${bounds.min} ~ ${bounds.max})를 벗어납니다` : null)
  switch (d.kind) {
    case 'uniform':
      if (![d.min, d.max].every(finite)) return '최소와 최대는 유한한 수여야 합니다'
      if (d.min > d.max) return '최소는 최대보다 클 수 없습니다'
      return within(d.min, d.max)
    case 'triangular':
    case 'pert':
      if (![d.min, d.mode, d.max].every(finite)) return '최소·최빈·최대는 유한한 수여야 합니다'
      if (!(d.min <= d.mode && d.mode <= d.max)) return '최소 ≤ 최빈 ≤ 최대여야 합니다'
      return within(d.min, d.max)
    case 'normal': {
      if (![d.mean, d.sd].every(finite)) return '평균과 표준편차는 유한한 수여야 합니다'
      if (!(d.sd > 0)) return '표준편차는 0보다 커야 합니다'
      const lo = d.lo ?? -Infinity
      const hi = d.hi ?? Infinity
      if (!(lo < hi)) return '절단 범위의 최소는 최대보다 작아야 합니다'
      if (normalCdf((hi - d.mean) / d.sd) - normalCdf((lo - d.mean) / d.sd) < 1e-9) return '절단 범위에 확률이 거의 없습니다(평균이 범위에서 너무 멉니다)'
      if (bounds && ((d.lo !== undefined && d.lo < bounds.min) || (d.hi !== undefined && d.hi > bounds.max))) return `절단 범위가 허용 범위(${bounds.min} ~ ${bounds.max})를 벗어납니다`
      return null
    }
  }
}

/** 정규 분포의 절단 범위를 허용 범위로 채운다(설계 06의 2.3). 다른 분포는 그대로. */
export function resolveDist(d: DistSpec, bounds: { min: number; max: number }): DistSpec {
  if (d.kind !== 'normal') return d
  return { ...d, lo: Math.max(d.lo ?? -Infinity, bounds.min), hi: Math.min(d.hi ?? Infinity, bounds.max) }
}

/** 지지구간 [최소, 최대]. */
export function support(d: DistSpec): [number, number] {
  switch (d.kind) {
    case 'uniform':
      return [d.min, d.max]
    case 'triangular':
    case 'pert':
      return [d.min, d.max]
    case 'normal':
      return [d.lo ?? -Infinity, d.hi ?? Infinity]
  }
}

/** 누적분포 F(x). */
export function cdf(d: DistSpec, x: number): number {
  switch (d.kind) {
    case 'uniform':
      if (d.max === d.min) return x < d.min ? 0 : 1
      return x <= d.min ? 0 : x >= d.max ? 1 : (x - d.min) / (d.max - d.min)
    case 'triangular': {
      const { min: a, mode: c, max: b } = d
      if (b === a) return x < a ? 0 : 1
      if (x <= a) return 0
      if (x >= b) return 1
      if (x <= c) return ((x - a) * (x - a)) / ((b - a) * (c - a))
      return 1 - ((b - x) * (b - x)) / ((b - a) * (b - c))
    }
    case 'pert': {
      const { min: a, mode: m, max: b } = d
      if (b === a) return x < a ? 0 : 1
      const alpha = 1 + (4 * (m - a)) / (b - a)
      const beta = 1 + (4 * (b - m)) / (b - a)
      return betaCdf((x - a) / (b - a), alpha, beta)
    }
    case 'normal': {
      const lo = d.lo ?? -Infinity
      const hi = d.hi ?? Infinity
      if (x <= lo) return 0
      if (x >= hi) return 1
      const flo = normalCdf((lo - d.mean) / d.sd)
      const fhi = normalCdf((hi - d.mean) / d.sd)
      return (normalCdf((x - d.mean) / d.sd) - flo) / (fhi - flo)
    }
  }
}

/** 역누적(분위수) F⁻¹(u). `u`는 [0, 1]로 제한한다. 결과는 항상 지지구간 안이다. */
export function ppf(d: DistSpec, u: number): number {
  const r = Math.min(1, Math.max(0, u))
  switch (d.kind) {
    case 'uniform':
      return d.min + r * (d.max - d.min)
    case 'triangular': {
      const { min: a, mode: c, max: b } = d
      if (b === a) return a
      const f = (c - a) / (b - a)
      const x = r < f ? a + Math.sqrt(r * (b - a) * (c - a)) : b - Math.sqrt((1 - r) * (b - a) * (b - c))
      return Math.min(b, Math.max(a, x))
    }
    case 'pert': {
      const { min: a, mode: m, max: b } = d
      if (b === a) return a
      const alpha = 1 + (4 * (m - a)) / (b - a)
      const beta = 1 + (4 * (b - m)) / (b - a)
      return Math.min(b, Math.max(a, a + (b - a) * betaPpf(r, alpha, beta)))
    }
    case 'normal': {
      const lo = d.lo ?? -Infinity
      const hi = d.hi ?? Infinity
      if (r <= 0 && lo > -Infinity) return lo
      if (r >= 1 && hi < Infinity) return hi
      const flo = lo === -Infinity ? 0 : normalCdf((lo - d.mean) / d.sd)
      const fhi = hi === Infinity ? 1 : normalCdf((hi - d.mean) / d.sd)
      const p = flo + r * (fhi - flo)
      const x = d.mean + d.sd * normalPpf(p)
      return Math.min(hi, Math.max(lo, x))
    }
  }
}

/** 분포의 평균(절단 정규는 수치 적분 없이 닫힌 식). */
export function distMean(d: DistSpec): number {
  switch (d.kind) {
    case 'uniform':
      return (d.min + d.max) / 2
    case 'triangular':
      return (d.min + d.mode + d.max) / 3
    case 'pert':
      return (d.min + 4 * d.mode + d.max) / 6
    case 'normal': {
      const lo = d.lo ?? -Infinity
      const hi = d.hi ?? Infinity
      const alpha = (lo - d.mean) / d.sd
      const beta = (hi - d.mean) / d.sd
      const phi = (z: number) => (Math.abs(z) === Infinity ? 0 : Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI))
      const z = normalCdf(beta) - normalCdf(alpha)
      return d.mean + (d.sd * (phi(alpha) - phi(beta))) / z
    }
  }
}
