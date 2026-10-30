import { join } from 'node:path'
import { MODEL_FILE_EXTENSION, isUserModelId, parseModelFileText, serializeModelFile, type ModelDocRaw } from '../shared/modelDoc'
import { writeFileAtomic } from './atomicWrite'

export interface ModelLibraryDeps {
  /** 내 모델 폴더(앱 데이터 폴더 아래의 `models/`). 파일 하나에 모델 하나이고 파일 이름은 모델 id다. */
  dir: string
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    mkdir(path: string): Promise<void>
    readdir(path: string): Promise<string[]>
  }
}

export const MAX_LIBRARY_MODELS = 100
/** 파일 이름에 쓰는 id. 경로 문자를 막는다. */
export const LIBRARY_ID = /^user-[A-Za-z0-9_-]{1,80}$/

export interface LibraryEntry {
  id: string
  doc: ModelDocRaw
}

export type LibraryListResult = { status: 'ok'; models: LibraryEntry[]; /** 읽을 수 없어 건너뛴 파일 수 */ skipped: number } | { status: 'error'; message: string }
export type LibrarySaveResult = { status: 'saved' } | { status: 'error'; message: string }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 내 모델 목록(설계 08의 4.2, COM-04). 앱 데이터 폴더의 `models/<id>.spd-model.json`에 모델 하나씩 둔다. renderer에는 경로를 주지 않고
 * 모델 문서만 주고받는다. 엔진 검증(수식 컴파일)은 renderer가 하고, 여기서는 형식·크기·id만 본다.
 */
export class ModelLibraryService {
  constructor(private readonly deps: ModelLibraryDeps) {}

  private fileOf(id: string): string {
    return join(this.deps.dir, id + MODEL_FILE_EXTENSION)
  }

  /** 문서의 id(정의의 meta.id). 올바르지 않으면 null. */
  private static idOf(doc: ModelDocRaw): string | null {
    const meta = doc.def['meta']
    const id = typeof meta === 'object' && meta !== null ? (meta as { id?: unknown }).id : undefined
    return typeof id === 'string' && isUserModelId(id) && LIBRARY_ID.test(id) ? id : null
  }

  async list(): Promise<LibraryListResult> {
    let names: string[]
    try {
      names = await this.deps.fs.readdir(this.deps.dir)
    } catch {
      return { status: 'ok', models: [], skipped: 0 } // 폴더가 아직 없다
    }
    const models: LibraryEntry[] = []
    let skipped = 0
    for (const name of names.filter((n) => n.endsWith(MODEL_FILE_EXTENSION)).sort()) {
      const id = name.slice(0, -MODEL_FILE_EXTENSION.length)
      try {
        const parsed = parseModelFileText(await this.deps.fs.readFile(join(this.deps.dir, name)))
        if (!parsed.ok || ModelLibraryService.idOf(parsed.doc) !== id) {
          skipped++
          continue
        }
        if (models.length >= MAX_LIBRARY_MODELS) {
          skipped++
          continue
        }
        models.push({ id, doc: parsed.doc })
      } catch {
        skipped++
      }
    }
    return { status: 'ok', models, skipped }
  }

  async save(doc: ModelDocRaw): Promise<LibrarySaveResult> {
    const text = serializeModelFile(doc)
    const parsed = parseModelFileText(text)
    if (!parsed.ok) return { status: 'error', message: parsed.message }
    const id = ModelLibraryService.idOf(parsed.doc)
    if (id === null) return { status: 'error', message: '모델 id가 올바르지 않습니다(user-로 시작하는 영문자·숫자·_·-).' }
    try {
      await this.deps.fs.mkdir(this.deps.dir)
      const existing = (await this.deps.fs.readdir(this.deps.dir).catch(() => [] as string[])).filter((n) => n.endsWith(MODEL_FILE_EXTENSION))
      if (!existing.includes(id + MODEL_FILE_EXTENSION) && existing.length >= MAX_LIBRARY_MODELS) {
        return { status: 'error', message: `내 모델은 최대 ${MAX_LIBRARY_MODELS}개까지 둘 수 있습니다. 쓰지 않는 모델을 지우세요.` }
      }
      await writeFileAtomic(this.deps.fs, this.fileOf(id), text)
    } catch (e) {
      return { status: 'error', message: `저장하지 못했습니다: ${message(e)}` }
    }
    return { status: 'saved' }
  }

  async remove(id: string): Promise<void> {
    if (!LIBRARY_ID.test(id)) return
    await this.deps.fs.rm(this.fileOf(id)).catch(() => undefined)
  }
}
