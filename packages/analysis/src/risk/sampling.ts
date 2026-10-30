import { Rng } from '@spd/sd-engine'
import { ppf, resolveDist, validateDist, type DistSpec } from './distributions'

/** 문자열의 32비트 FNV-1a 해시. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 32비트 정수 혼합(murmur3 fmix32). */
function fmix32(h0: number): number {
  let h = h0 >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/** 시드, 반복 번호, 이름에서 독립적인 32비트 난수 시드를 유도한다(설계 06의 3.1). */
export function mixSeed(seed: number, iteration: number, name: string): number {
  let h = fnv1a(name)
  h = fmix32(h ^ Math.imul(seed | 0, 0x9e3779b1))
  h = fmix32(h ^ Math.imul((iteration + 1) | 0, 0x85ebca6b))
  return h >>> 0
}

/** 반복·이름마다 독립인 균등난수 하나(0과 1을 피한다). */
export function uniformFor(seed: number, iteration: number, name: string): number {
  const u = new Rng(mixSeed(seed, iteration, name)).next()
  return Math.min(1 - 1e-12, Math.max(1e-12, u))
}

/** 반복마다 유도하는 모델의 난수 시드(모델이 난수 함수를 쓸 때). */
export const MODEL_SEED_NAME = '@model'
export const modelSeedFor = (seed: number, iteration: number): number => mixSeed(seed, iteration, MODEL_SEED_NAME)

/** 불확실한 입력 하나: 파라미터, 분포, 그 파라미터의 허용 범위와 정수 여부. */
export interface InputSpec {
  name: string
  dist: DistSpec
  /** 파라미터 폼의 허용 범위 */
  min: number
  max: number
  integer?: boolean
}

export function validateInput(spec: InputSpec): string | null {
  const d = validateDist(spec.dist, { min: spec.min, max: spec.max })
  if (d) return d
  if (spec.integer) {
    const [lo, hi] = [Math.ceil(spec.min), Math.floor(spec.max)]
    if (lo > hi) return '정수 범위가 비어 있습니다'
  }
  return null
}

/** 입력 목록 검사. 이름 중복도 거른다. 문제가 있으면 첫 메시지(이름 포함). */
export function validateInputs(specs: InputSpec[]): string | null {
  const seen = new Set<string>()
  for (const s of specs) {
    if (seen.has(s.name)) return `'${s.name}'이(가) 겹칩니다`
    seen.add(s.name)
    const e = validateInput(s)
    if (e) return `'${s.name}': ${e}`
  }
  return null
}

/** 입력 하나의 표본. 분포 → 허용 범위로 제한 → 정수면 반올림(범위 안으로). 난수는 (시드, 반복, 이름)에서만 나온다. */
export function sampleInput(spec: InputSpec, seed: number, iteration: number): number {
  const dist = resolveDist(spec.dist, { min: spec.min, max: spec.max })
  let x = ppf(dist, uniformFor(seed, iteration, spec.name))
  x = Math.min(spec.max, Math.max(spec.min, x))
  if (spec.integer) x = Math.min(Math.floor(spec.max), Math.max(Math.ceil(spec.min), Math.round(x)))
  return x
}

/** 한 반복의 입력 표본(이름 → 값). */
export function sampleRow(specs: InputSpec[], seed: number, iteration: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of specs) out[s.name] = sampleInput(s, seed, iteration)
  return out
}

/** 입력 분포의 P10·P90(정수는 반올림). 토네이도의 기본 낮은/높은 값(설계 06의 6.1). */
export function defaultRange(spec: InputSpec): [number, number] {
  const dist = resolveDist(spec.dist, { min: spec.min, max: spec.max })
  const round = (x: number) => (spec.integer ? Math.round(x) : x)
  return [round(ppf(dist, 0.1)), round(ppf(dist, 0.9))]
}

/** 기본 설정 값 `v`에서 만드는 분포 템플릿: 삼각(0.8v, v, 1.3v)을 허용 범위로 자른다(설계 06의 2.4). */
export function templateDist(value: number, bounds: { min: number; max: number }): DistSpec {
  const lo = Math.min(bounds.max, Math.max(bounds.min, value * 0.8))
  const hi = Math.min(bounds.max, Math.max(bounds.min, value * 1.3))
  const mode = Math.min(hi, Math.max(lo, value))
  // 값이 음수여도 최소 ≤ 최빈 ≤ 최대가 되게 정렬한다.
  const [a, c, b] = [lo, mode, hi].sort((x, y) => x - y) as [number, number, number]
  // 0.8 × 0.1 = 0.08000000000000002 같은 부동소수 잡음을 화면에 보이지 않도록 유효숫자 12자리로 맞춘다.
  const clean = (x: number) => Math.min(bounds.max, Math.max(bounds.min, Number(x.toPrecision(12))))
  return { kind: 'triangular', min: clean(a), mode: clean(Math.min(b, Math.max(a, mode))), max: clean(b) }
}
