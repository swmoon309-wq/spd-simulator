import { z } from 'zod'
import { MAX_PRESETS, presetBodySchema } from './projectFile'

/**
 * 프리셋 내보내기 파일(설계 07의 5.4). 다른 프로젝트에서 가져와 쓸 수 있는 최소 형태(COM-04 템플릿·보정값 라이브러리의 시작)이다.
 * 프로젝트 파일과 달리 프리셋 id는 담지 않는다(가져올 때 새로 매긴다).
 */
export const PRESET_FILE_KIND = 'spd-presets'
export const PRESET_FILE_VERSION = 1

export const presetFileSchema = z.object({
  kind: z.literal(PRESET_FILE_KIND),
  version: z.literal(PRESET_FILE_VERSION),
  exportedAt: z.string().max(40).optional(),
  presets: z.array(presetBodySchema).min(1).max(MAX_PRESETS)
})

export type PresetExportFile = z.infer<typeof presetFileSchema>

export type ParsePresetsResult = { ok: true; file: PresetExportFile } | { ok: false; message: string }

/** 내보낸 프리셋 파일을 읽어 검증한다. 오류는 사용자에게 보일 한국어 메시지로 돌려준다. */
export function parsePresetFile(text: string): ParsePresetsResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'JSON 형식이 아니어서 프리셋 파일로 읽을 수 없습니다.' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, message: '프리셋 파일 형식이 아닙니다.' }
  const r = raw as { kind?: unknown; version?: unknown }
  if (r.kind !== PRESET_FILE_KIND) return { ok: false, message: '프리셋 파일이 아닙니다(이 앱에서 내보낸 프리셋 JSON이 아닙니다).' }
  if (typeof r.version === 'number' && r.version > PRESET_FILE_VERSION) return { ok: false, message: `이 파일은 더 새로운 버전(${r.version})에서 만들어졌습니다. 이 앱은 버전 ${PRESET_FILE_VERSION}까지 읽을 수 있습니다.` }
  const parsed = presetFileSchema.safeParse(raw)
  if (parsed.success) return { ok: true, file: parsed.data }
  const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(최상위)'}: ${i.message}`)
  return { ok: false, message: `프리셋 파일 내용이 올바르지 않습니다. ${issues.join('; ')}` }
}

export function serializePresets(presets: z.infer<typeof presetBodySchema>[], exportedAt: string): string {
  const file: PresetExportFile = { kind: PRESET_FILE_KIND, version: PRESET_FILE_VERSION, exportedAt, presets }
  return JSON.stringify(file, null, 2) + '\n'
}
