import type { ProjectFile } from '../../../shared/projectFile'
import type { RecoveryRecord } from '../../../shared/recoveryFile'

/** 자동 저장 간격(ms). 짧으면 디스크를 자주 쓰고 길면 비정상 종료 때 잃는 것이 늘어난다. */
export const AUTOSAVE_INTERVAL_MS = 20_000

export interface AutosaveDeps {
  /** 지금 저장하지 않은 변경이 있는지와 저장할 내용 */
  read(): { dirty: boolean; project: ProjectFile; sourceFile: string | null }
  write(record: RecoveryRecord): Promise<{ status: 'saved' } | { status: 'error'; message: string }>
  clear(): Promise<void>
  now(): Date
}

export type AutosaveOutcome = 'written' | 'cleared' | 'idle' | 'error'

/** 저장할 때마다 바뀌는 수정 시각을 빼고 내용만 비교하는 열쇠 */
function contentKey(project: ProjectFile): string {
  return JSON.stringify({ ...project, meta: { ...project.meta, updatedAt: '' } })
}

/**
 * 자동 저장(COM-05). `tick`을 주기적으로 부르면, 저장하지 않은 변경이 있고 마지막으로 쓴 것과 내용이 다를 때만 자동 저장본을 쓴다.
 * 저장하거나 새로 시작해 변경이 없어지면 자동 저장본을 지운다. 사용자의 프로젝트 파일은 건드리지 않는다.
 * 쓰기에 실패해도 편집을 막지 않는다(`error`를 돌려줄 뿐이고, 다음 주기에 다시 시도한다).
 */
export function createAutosave(deps: AutosaveDeps) {
  let lastKey: string | null = null
  let running = false

  async function tick(): Promise<AutosaveOutcome> {
    if (running) return 'idle'
    running = true
    try {
      const { dirty, project, sourceFile } = deps.read()
      if (!dirty) {
        if (lastKey === null) return 'idle'
        lastKey = null
        await deps.clear()
        return 'cleared'
      }
      const key = contentKey(project)
      if (key === lastKey) return 'idle'
      const r = await deps.write({ savedAt: deps.now().toISOString(), sourceFile, project })
      if (r.status === 'error') return 'error'
      lastKey = key
      return 'written'
    } finally {
      running = false
    }
  }

  return { tick }
}

export interface AutosaveTimers {
  setInterval(handler: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

/** `tick`을 주기적으로 부른다. 돌려받은 함수로 멈춘다. */
export function startAutosave(autosave: { tick(): Promise<AutosaveOutcome> }, intervalMs = AUTOSAVE_INTERVAL_MS, timers: AutosaveTimers = { setInterval: (h, ms) => setInterval(h, ms), clearInterval: (id) => clearInterval(id as number) }): () => void {
  const id = timers.setInterval(() => void autosave.tick(), intervalMs)
  return () => timers.clearInterval(id)
}
