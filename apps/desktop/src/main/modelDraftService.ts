import { join } from 'node:path'
import { MODEL_LIMITS, modelDocSchema, type ModelDocRaw } from '../shared/modelDoc'
import { writeFileAtomic } from './atomicWrite'

export interface ModelDraftDeps {
  /** 초안을 두는 폴더(앱 데이터 폴더의 복구 폴더) */
  dir: string
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    mkdir(path: string): Promise<void>
  }
  now(): Date
}

export const DRAFT_FILE = 'model-draft.json'
const DRAFT_VERSION = 1

export type DraftReadResult = { status: 'none' } | { status: 'found'; savedAt: string; doc: ModelDocRaw } | { status: 'error'; message: string }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isMissing = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'

/**
 * 모델 편집기의 **편집 초안** 하나를 앱 데이터 폴더에 둔다(설계 08의 9장 "초안은 자동 저장", COM-05의 방식). 프로젝트 자동 저장본과는 별도 파일이다.
 * 임시 파일에 쓴 뒤 이름을 바꿔 쓰는 도중 앱이 죽어도 이전 초안이 깨지지 않고, 읽은 내용이 올바르지 않으면 지우고 없는 것으로 본다. 정상 종료해도
 * 지우지 않는다(적용하거나 사용자가 버릴 때 지운다).
 */
export class ModelDraftService {
  constructor(private readonly deps: ModelDraftDeps) {}

  get path(): string {
    return join(this.deps.dir, DRAFT_FILE)
  }

  async write(doc: ModelDocRaw): Promise<{ status: 'saved' } | { status: 'error'; message: string }> {
    try {
      const data = JSON.stringify({ draftVersion: DRAFT_VERSION, savedAt: this.deps.now().toISOString(), doc })
      if (Buffer.byteLength(data) > MODEL_LIMITS.docBytes * 1.2) return { status: 'error', message: '초안이 너무 큽니다.' }
      await this.deps.fs.mkdir(this.deps.dir)
      await writeFileAtomic(this.deps.fs, this.path, data)
      return { status: 'saved' }
    } catch (e) {
      return { status: 'error', message: message(e) }
    }
  }

  async read(): Promise<DraftReadResult> {
    let text: string
    try {
      text = await this.deps.fs.readFile(this.path)
    } catch (e) {
      return isMissing(e) ? { status: 'none' } : { status: 'error', message: message(e) }
    }
    try {
      const raw = JSON.parse(text) as { draftVersion?: unknown; savedAt?: unknown; doc?: unknown }
      const doc = modelDocSchema.safeParse(raw.doc)
      if (raw.draftVersion === DRAFT_VERSION && typeof raw.savedAt === 'string' && doc.success) return { status: 'found', savedAt: raw.savedAt.slice(0, 64), doc: doc.data }
    } catch {
      // 아래에서 지운다
    }
    await this.clear()
    return { status: 'none' }
  }

  async clear(): Promise<void> {
    await this.deps.fs.rm(this.path).catch(() => undefined)
  }
}
