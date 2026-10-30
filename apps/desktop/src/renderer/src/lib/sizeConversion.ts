import type { ModelEntry, ParamSpec, SizeInfo } from '../catalog'
import { paramSpecs, parseParam } from './params'

/** 책 6.3(p.374): 태스크 하나는 약 60라인(0.06 KDSI)이다. */
export const SLOC_PER_TASK = 60

export type ConvertResult = { value: number } | { error: string }

/** 입력 글자를 양의 유한한 수로 읽는다. 쉼표(1,200)와 공백은 허용한다. */
export function parsePositive(text: string): number | null {
  const t = text.replace(/[,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * SLOC를 모델의 규모 단위로 환산한다(CFG-01): `SLOC ÷ (SLOC/단위)`. 정수 파라미터는 가장 가까운 정수로 반올림한다.
 * 결과가 그 파라미터의 허용 범위 밖이면 오류 메시지를 돌려준다(적용하지 않는다).
 */
export function slocToUnits(spec: ParamSpec, slocText: string, perUnitText: string): ConvertResult {
  const sloc = parsePositive(slocText)
  if (sloc === null) return { error: 'SLOC는 0보다 큰 수여야 합니다.' }
  const perUnit = parsePositive(perUnitText)
  if (perUnit === null) return { error: '단위당 SLOC는 0보다 큰 수여야 합니다.' }
  const raw = sloc / perUnit
  const value = spec.integer ? Math.round(raw) : Number(raw.toPrecision(6))
  const checked = parseParam(String(value), spec)
  if ('error' in checked) return { error: `환산 결과 ${value.toLocaleString('ko-KR')}은(는) 허용 범위를 벗어납니다. ${checked.error}` }
  return { value: checked.value }
}

/** 지금 규모 값이 몇 SLOC에 해당하는지(`값 × SLOC/단위`). 단위당 SLOC를 모르면 null. */
export function unitsToSloc(units: number, perUnit: number | null): number | null {
  return perUnit === null || !(perUnit > 0) ? null : Math.round(units * perUnit)
}

/** 모델의 규모 입력 정보와 그 파라미터의 사양. 규모 입력이 없는 모델이면 null. */
export function sizeSpecOf(entry: ModelEntry): { size: SizeInfo; spec: ParamSpec } | null {
  const size = entry.size
  if (!size) return null
  const spec = paramSpecs(entry).find((s) => s.name === size.param)
  return spec ? { size, spec } : null
}
