import type { Params } from './effective'

export interface RunInput {
  modelId: string
  modelVersion: number
  params: Params
  run: { end: number; dt: number; seed: number }
}

/** 키 순서와 무관하게 같은 값이면 같은 문자열을 만드는 직렬화. 유한하지 않은 수는 거부한다. */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`직렬화할 수 없는 수: ${value}`)
      return JSON.stringify(value) // -0은 "0"
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
    }
    default:
      throw new Error(`직렬화할 수 없는 값: ${typeof value}`)
  }
}

/**
 * 실행 입력의 정규화된 키. 결과 캐시의 키로 쓴다. 해시가 아니므로 서로 다른 입력이 같은 키를
 * 가질 수 없다(충돌 없음).
 */
export function inputKey(input: RunInput): string {
  return stableStringify(input)
}

/** 키를 짧게 줄인 표시·로그용 값(cyrb53, 14자리 16진수). 캐시 정합성에는 `inputKey`를 쓴다. */
export function inputHash(key: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < key.length; i++) {
    const ch = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return n.toString(16).padStart(14, '0')
}
