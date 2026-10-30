import { join } from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import type { RecoveryReadResult } from '../shared/ipc'
import { parseRecoveryJson, serializeRecovery, type RecoveryRecord } from '../shared/recoveryFile'

export interface RecoveryDeps {
  /** 자동 저장본을 두는 폴더(앱 데이터 폴더 아래) */
  dir: string
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    mkdir(path: string): Promise<void>
  }
}

export const RECOVERY_FILE = 'autosave.json'
/** 자동 저장본의 크기 상한. 프로젝트 파일 상한과 같다. */
const MAX_BYTES = 5 * 1024 * 1024

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const isMissing = (e: unknown) => typeof e === 'object' && e !== null && (e as { code?: string }).code === 'ENOENT'

/**
 * 자동 저장본 하나를 앱 데이터 폴더에 둔다(COM-05). 쓸 때는 임시 파일에 쓴 뒤 이름을 바꿔, 쓰는 도중 앱이 죽어도 이전 자동 저장본이
 * 깨지지 않는다. 읽은 내용이 올바르지 않으면 지우고 없는 것으로 본다. Electron에 의존하지 않아 파일 시스템을 주입해 시험한다.
 */
export class RecoveryService {
  constructor(private readonly deps: RecoveryDeps) {}

  /** 자동 저장본의 경로. 앱이 닫힐 때 동기로 지우는 데 쓴다. */
  get path(): string {
    return join(this.deps.dir, RECOVERY_FILE)
  }

  async write(record: RecoveryRecord): Promise<{ status: 'saved' } | { status: 'error'; message: string }> {
    try {
      const data = serializeRecovery(record)
      if (Buffer.byteLength(data) > MAX_BYTES) return { status: 'error', message: '자동 저장본이 너무 큽니다.' }
      await this.deps.fs.mkdir(this.deps.dir)
      await writeFileAtomic(this.deps.fs, this.path, data)
      return { status: 'saved' }
    } catch (e) {
      return { status: 'error', message: message(e) }
    }
  }

  async read(): Promise<RecoveryReadResult> {
    let text: string
    try {
      text = await this.deps.fs.readFile(this.path)
    } catch (e) {
      return isMissing(e) ? { status: 'none' } : { status: 'error', message: message(e) }
    }
    const parsed = text.length > MAX_BYTES ? ({ ok: false } as const) : parseRecoveryJson(text)
    if (!parsed.ok) {
      await this.clear()
      return { status: 'none' }
    }
    return { status: 'found', record: parsed.record }
  }

  async clear(): Promise<void> {
    await this.deps.fs.rm(this.path).catch(() => undefined)
  }
}
