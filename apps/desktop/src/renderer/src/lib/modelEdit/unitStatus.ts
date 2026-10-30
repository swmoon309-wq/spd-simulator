import { checkModelUnits, type ModelDef } from '@spd/sd-engine'
import type { ModelEntry } from '../../catalog'

const cache = new Map<string, number>()

/** 모델 정의의 단위 오류 개수(확정된 불일치). 같은 모델은 한 번만 계산한다(내용 해시로 구분). */
export function unitErrorCount(def: ModelDef, key: string): number {
  let n = cache.get(key)
  if (n === undefined) {
    n = checkModelUnits(def).filter((i) => i.severity === 'error').length
    cache.set(key, n)
    if (cache.size > 200) cache.delete(cache.keys().next().value as string)
  }
  return n
}

/**
 * 단위 오류가 있는 사용자 모델이면 그 사실을 알리는 짧은 말, 아니면 null(설계 08의 D5: 단위 오류가 있어도 확인하고 적용할 수 있지만 그런 모델은
 * 어디서나 보여야 한다). 내장 모델은 단위 오류가 없다.
 */
export function unitNote(entry: ModelEntry): string | null {
  if (!entry.custom) return null
  const n = unitErrorCount(entry.def, `${entry.id}:${entry.custom.hash}`)
  return n > 0 ? `단위 오류 ${n}건` : null
}
