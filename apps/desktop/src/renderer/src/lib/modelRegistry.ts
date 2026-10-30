import { getEntry as getCatalogEntry, registerEntry, unregisterEntry, catalog } from '../catalog'
import { buildEntry } from '../catalog/userModel'
import { registerModel, unregisterModel } from '../engine/engineClient'
import { registerUserModel, unregisterUserModel } from '../engine/models'
import { newUserModelId, type ModelDocRaw } from '../../../shared/modelDoc'
import { validateModelDoc, type ModelDoc } from './modelDoc'
import type { ModelEntry } from '../catalog'

export type InstallResult = { ok: true; entry: ModelEntry; replaced: boolean } | { ok: false; message: string }

/**
 * 사용자 모델을 앱에 올린다(설계 08의 5.1): 검증 → 카탈로그 항목 합성 → 엔진 정의(화면 쪽)와 Worker 등록 → 카탈로그 등록.
 * 같은 id가 이미 있으면 바꾼다(같은 해시면 컴파일도 다시 하지 않는다). 실패하면 아무것도 바꾸지 않는다.
 */
export function installUserModel(raw: ModelDocRaw): InstallResult {
  const v = validateModelDoc(raw)
  if (!v.ok) return v
  const existing = catalog.find((m) => m.id === v.doc.def.meta.id)
  if (existing && existing.category !== 'user') return { ok: false, message: `내장 모델 '${existing.id}'과(와) id가 같아 올릴 수 없습니다.` }
  try {
    registerUserModel(v.doc.def.meta.id, v.hash, v.doc.def)
    const entry = buildEntry(v.doc, v.hash)
    registerModel(entry.id, v.hash, v.doc)
    registerEntry(entry)
    return { ok: true, entry, replaced: existing !== undefined }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export function removeUserModel(id: string): void {
  unregisterEntry(id)
  unregisterUserModel(id)
  unregisterModel(id)
}

export function isInstalled(id: string): boolean {
  try {
    getCatalogEntry(id)
    return true
  } catch {
    return false
  }
}

/** 가져온 모델 문서에 새 id를 발급한다(같은 id가 이미 있는 모델을 가져올 때, 설계 08의 4.2). 정의의 이름·버전은 그대로 둔다. */
export function withNewId(raw: ModelDocRaw, random: () => number = Math.random): ModelDocRaw {
  const meta = raw.def['meta'] as { name?: string } | undefined
  const id = newUserModelId(meta?.name ?? 'model', random)
  return { ...raw, def: { ...raw.def, meta: { ...(meta ?? {}), id } } }
}

export type { ModelDoc }
