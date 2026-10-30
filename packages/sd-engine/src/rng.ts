/** 시드 가능한 PRNG(mulberry32). 같은 시드는 같은 수열을 만든다. */
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  /** 내부 상태. 저장했다가 `restore`하면 같은 수열을 이어서 만든다. */
  get state(): number {
    return this.s
  }

  restore(state: number): void {
    this.s = state >>> 0
  }

  /** [0, 1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next()
  }

  /** Box–Muller 변환. */
  normal(mean: number, sd: number): number {
    const u1 = 1 - this.next() // (0, 1]
    const u2 = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  /** 역변환법. mode는 [min, max]로 제한한다. */
  triangular(min: number, mode: number, max: number): number {
    if (max <= min) return min
    const m = Math.min(Math.max(mode, min), max)
    const u = this.next()
    const f = (m - min) / (max - min)
    return u < f
      ? min + Math.sqrt(u * (max - min) * (m - min))
      : max - Math.sqrt((1 - u) * (max - min) * (max - m))
  }
}
