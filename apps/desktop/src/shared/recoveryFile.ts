import { z } from 'zod'
import { parseProjectJson, type ProjectFile } from './projectFile'

/** 자동 저장본(복구 파일)의 형식 버전. 프로젝트 파일 자체의 버전과는 별개다. */
export const RECOVERY_VERSION = 1

/** 자동 저장본. 사용자의 프로젝트 파일은 건드리지 않고 앱 데이터 폴더에만 둔다. */
export interface RecoveryRecord {
  /** 자동 저장한 시각(ISO) */
  savedAt: string
  /** 원래 열어 둔 파일 이름. 아직 저장한 적이 없으면 null. 경로는 아니다. */
  sourceFile: string | null
  project: ProjectFile
}

const envelopeSchema = z.object({
  recoveryVersion: z.literal(RECOVERY_VERSION),
  savedAt: z.string().min(1).max(64),
  sourceFile: z.string().max(300).nullable(),
  project: z.unknown()
})

export type ParseRecoveryResult = { ok: true; record: RecoveryRecord } | { ok: false; message: string }

export function serializeRecovery(record: RecoveryRecord): string {
  return JSON.stringify({ recoveryVersion: RECOVERY_VERSION, savedAt: record.savedAt, sourceFile: record.sourceFile, project: record.project })
}

/** 파일 내용을 읽는다. 안의 프로젝트는 프로젝트 파일과 같은 규칙으로 검증·변환한다. */
export function parseRecoveryJson(text: string): ParseRecoveryResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'JSON 형식이 아닙니다.' }
  }
  const envelope = envelopeSchema.safeParse(raw)
  if (!envelope.success) return { ok: false, message: '자동 저장 파일 형식이 아닙니다.' }
  const project = parseProjectJson(JSON.stringify(envelope.data.project))
  if (!project.ok) return { ok: false, message: project.message }
  return { ok: true, record: { savedAt: envelope.data.savedAt, sourceFile: envelope.data.sourceFile, project: project.project } }
}
