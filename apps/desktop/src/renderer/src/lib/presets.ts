import type { CalibrationResult } from '@spd/analysis'
import type { PresetBodyFile, PresetFile } from '../../../shared/projectFile'
import { MAX_PRESETS as SHARED_MAX_PRESETS } from '../../../shared/projectFile'
import type { PresetExportFile } from '../../../shared/presetFile'
import type { ModelEntry } from '../catalog'
import { paramSpecs } from './params'

/** 한도. `shared/projectFile.ts`와 같아야 하며 시험으로 확인한다. */
export const MAX_PRESETS = SHARED_MAX_PRESETS

export type Preset = PresetFile

const clean = (x: number): number => Number(x.toPrecision(12))

export function nextPresetId(presets: Preset[]): string {
  let n = 1
  const used = new Set(presets.map((p) => p.id))
  while (used.has(`p${n}`)) n++
  return `p${n}`
}

/** 이름이 겹치면 "이름 (2)"처럼 번호를 붙인다. */
export function uniquePresetName(presets: Pick<Preset, 'name'>[], name: string): string {
  const base = name.trim() || '프리셋'
  const used = new Set(presets.map((p) => p.name))
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

export interface MakePresetInput {
  entry: ModelEntry
  presets: Preset[]
  name: string
  result: CalibrationResult
  /** 보정에 쓴 데이터셋 이름과 비교한 열의 모델 변수 */
  dataset: string
  columns: string[]
  now: Date
}

/** 보정 결과로 프리셋을 만든다. 보정한 파라미터의 값만 담고, 출처(데이터·목적함수·시간 분할)를 남긴다. */
export function makePreset(input: MakePresetInput): Preset {
  const { result } = input
  const params: Record<string, number> = {}
  result.names.forEach((n, i) => (params[n] = clean(result.best[i] as number)))
  const finite = (v: number | null): number | null => (v !== null && Number.isFinite(v) ? v : null)
  return {
    id: nextPresetId(input.presets),
    name: uniquePresetName(input.presets, input.name),
    modelId: input.entry.id,
    modelVersion: input.entry.def.meta.version,
    params,
    origin: {
      dataset: input.dataset,
      columns: [...input.columns],
      objective: finite(result.jAfter),
      valObjective: finite(result.jValAfter),
      split: result.split ? result.split.fraction : null,
      at: input.now.toISOString()
    }
  }
}

/**
 * 프리셋의 파라미터를 현재 모델의 폼에 맞춘다(설계 07의 5.4 호환 검사): 모델에 없는 파라미터, 허용 범위를 벗어난 값, 정수가 아닌 값은
 * 버리고 이유를 돌려준다. 남은 것이 없으면 params가 비어 있다.
 */
export function fitPresetParams(entry: ModelEntry, name: string, params: Record<string, number>): { params: Record<string, number>; warnings: string[] } {
  const specs = paramSpecs(entry)
  const out: Record<string, number> = {}
  const warnings: string[] = []
  for (const [key, value] of Object.entries(params)) {
    const sp = specs.find((s) => s.name === key)
    const label = entry.def.constants[key]?.label ?? key
    if (!sp) warnings.push(`프리셋 '${name}': '${key}'은(는) 이 모델의 입력 항목이 아니어서 버렸습니다.`)
    else if (!Number.isFinite(value) || value < sp.min || value > sp.max) warnings.push(`프리셋 '${name}': '${label}' 값 ${value}이(가) 허용 범위(${sp.min} ~ ${sp.max})를 벗어나 버렸습니다.`)
    else if (sp.integer && !Number.isInteger(value)) warnings.push(`프리셋 '${name}': '${label}'은(는) 정수여야 하는데 ${value}이라 버렸습니다.`)
    else out[key] = value
  }
  return { params: out, warnings }
}

/** 프로젝트 파일의 프리셋을 정리한다. 다른 모델의 프리셋과 파라미터가 하나도 남지 않은 프리셋은 버린다. */
export function sanitizePresets(entry: ModelEntry, presets: PresetFile[]): { presets: Preset[]; warnings: string[] } {
  const out: Preset[] = []
  const warnings: string[] = []
  for (const p of presets) {
    if (p.modelId !== entry.id) {
      warnings.push(`프리셋 '${p.name}'은(는) 다른 모델('${p.modelId}')의 것이라 버렸습니다.`)
      continue
    }
    const fit = fitPresetParams(entry, p.name, p.params)
    warnings.push(...fit.warnings)
    if (Object.keys(fit.params).length === 0) {
      warnings.push(`프리셋 '${p.name}'은(는) 쓸 수 있는 파라미터가 없어 버렸습니다.`)
      continue
    }
    out.push({ ...p, params: fit.params, origin: { ...p.origin, columns: [...p.origin.columns] } })
  }
  return { presets: out, warnings }
}

/** 내보내기 파일에 담을 형태(id는 담지 않는다). */
export function presetsToExport(presets: Preset[]): PresetBodyFile[] {
  return presets.map(({ id: _id, ...body }) => ({ ...body, params: { ...body.params }, origin: { ...body.origin, columns: [...body.origin.columns] } }))
}

export interface ImportOutcome {
  presets: Preset[]
  /** 이번에 더한 프리셋 수 */
  added: number
  warnings: string[]
}

/**
 * 내보낸 프리셋 파일을 가져온다. 다른 모델의 프리셋과 쓸 수 있는 파라미터가 없는 프리셋은 건너뛰고, 모델 버전이 다르면 알리되 가져온다.
 * 이름이 겹치면 번호를 붙이고, 한도(최대 20개)를 넘는 것은 버린다. id는 새로 매긴다.
 */
export function importPresets(entry: ModelEntry, file: PresetExportFile, existing: Preset[]): ImportOutcome {
  const presets = [...existing]
  const warnings: string[] = []
  let added = 0
  for (const body of file.presets) {
    if (body.modelId !== entry.id) {
      warnings.push(`프리셋 '${body.name}'은(는) 다른 모델('${body.modelId}')의 것이라 건너뛰었습니다.`)
      continue
    }
    if (presets.length >= MAX_PRESETS) {
      warnings.push(`프리셋은 최대 ${MAX_PRESETS}개라 '${body.name}'부터는 가져오지 않았습니다.`)
      break
    }
    if (body.modelVersion !== entry.def.meta.version) warnings.push(`프리셋 '${body.name}'은(는) 다른 모델 버전(${body.modelVersion})으로 보정되었습니다. 현재 모델은 ${entry.def.meta.version}입니다.`)
    const fit = fitPresetParams(entry, body.name, body.params)
    warnings.push(...fit.warnings)
    if (Object.keys(fit.params).length === 0) {
      warnings.push(`프리셋 '${body.name}'은(는) 쓸 수 있는 파라미터가 없어 건너뛰었습니다.`)
      continue
    }
    presets.push({ ...body, id: nextPresetId(presets), name: uniquePresetName(presets, body.name), params: fit.params, origin: { ...body.origin, columns: [...body.origin.columns] } })
    added++
  }
  return { presets, added, warnings }
}

/**
 * 프리셋을 시나리오의 덮어쓰기로 바꾼다: 기본 설정과 다른 값만(시나리오는 달라지는 값만 저장한다). 모두 같으면 빈 객체.
 */
export function presetOverrides(base: Record<string, number>, preset: Pick<Preset, 'params'>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(preset.params)) if (base[k] !== v) out[k] = v
  return out
}
