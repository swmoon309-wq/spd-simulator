import { catalog } from '../../catalog'
import { askConfirm } from '../confirm'
import type { ModelDocRaw } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../modelDoc'
import { selectDirty, useEditorStore } from '../../stores/editorStore'
import { useUiStore } from '../../stores/uiStore'

/** 초안 자동 저장 간격(ms). */
export const DRAFT_INTERVAL_MS = 5000

/**
 * 복구할 초안을 편집기가 다룰 수 있는 문서로 바꾼다. 초안은 **아직 오류가 있는 상태**일 수 있으므로(비어 있는 수식, 정의되지 않은 변수 …) 엔진 검증이나
 * 컴파일은 하지 않고 모양(필요한 구역이 객체·배열인지, 시간 설정이 숫자인지)만 본다. 모양이 맞지 않으면 null.
 */
export function lenientModelDoc(raw: ModelDocRaw): ModelDoc | null {
  const d = raw.def as Record<string, unknown>
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const meta = d['meta']
  const time = d['time']
  if (!isObj(meta) || typeof meta['id'] !== 'string' || typeof meta['name'] !== 'string' || typeof meta['version'] !== 'number') return null
  if (!isObj(time) || !['start', 'end', 'dt'].every((k) => typeof time[k] === 'number')) return null
  for (const k of ['constants', 'levels', 'rates', 'auxiliaries', 'tables']) if (!isObj(d[k])) return null
  if (!Array.isArray(d['outputs'])) return null
  for (const l of Object.values(d['levels'] as Record<string, unknown>)) {
    if (!isObj(l) || typeof l['init'] !== 'string' || !Array.isArray(l['inflows']) || !Array.isArray(l['outflows'])) return null
  }
  for (const k of ['rates', 'auxiliaries']) for (const f of Object.values(d[k] as Record<string, unknown>)) if (!isObj(f) || typeof f['expr'] !== 'string') return null
  for (const c of Object.values(d['constants'] as Record<string, unknown>)) if (!isObj(c) || typeof c['value'] !== 'number') return null
  return raw as unknown as ModelDoc
}

export interface DraftAutosaveDeps {
  read(): { doc: ModelDoc | null; dirty: boolean }
  /** 이번 세션에서 쓰지 않았지만 디스크에 초안이 남아 있다(복구한 초안). 수정됨이 없어지면 그것도 지운다. */
  staleOnDisk?(): boolean
  write(doc: ModelDocRaw): Promise<{ status: 'saved' } | { status: 'error'; message: string }>
  clear(): Promise<void>
}

export type DraftOutcome = 'written' | 'cleared' | 'idle' | 'error'

/**
 * 편집 초안의 자동 저장. `tick`을 주기적으로 부르면 편집 중 **저장하지 않은 변경**(적용하지 않은 편집)이 있고 마지막으로 쓴 것과 문서가 다를 때만 쓴다.
 * 적용하거나 편집기를 닫아 변경이 없어지면 초안을 지운다. 쓰기에 실패해도 편집을 막지 않고 다음 주기에 다시 시도한다.
 */
export function createDraftAutosave(deps: DraftAutosaveDeps) {
  let last: ModelDoc | null = null
  let running = false
  async function tick(): Promise<DraftOutcome> {
    if (running) return 'idle'
    running = true
    try {
      const { doc, dirty } = deps.read()
      if (!doc || !dirty) {
        if (last === null && !deps.staleOnDisk?.()) return 'idle'
        last = null
        await deps.clear()
        return 'cleared'
      }
      if (doc === last) return 'idle'
      const r = await deps.write(doc as unknown as ModelDocRaw)
      if (r.status === 'error') return 'error'
      last = doc
      return 'written'
    } finally {
      running = false
    }
  }
  return { tick }
}

let draftOnDisk = false

/** 복구한 초안이 디스크에 남아 있음을 알린다(적용하거나 닫으면 자동 저장이 지운다). */
export const noteDraftOnDisk = (): void => void (draftOnDisk = true)
export const isDraftOnDisk = (): boolean => draftOnDisk

/** 데스크톱 앱에서 초안 자동 저장을 시작한다. 돌려받은 함수로 멈춘다. 브라우저(개발용)에서는 아무것도 하지 않는다. */
export function startDraftAutosave(): () => void {
  const spd = window.spd
  if (!spd) return () => undefined
  const autosave = createDraftAutosave({
    read: () => {
      const s = useEditorStore.getState()
      return { doc: s.doc, dirty: selectDirty(s) }
    },
    staleOnDisk: () => draftOnDisk,
    write: async (doc) => {
      const r = await spd.modelDraft.write(doc)
      if (r.status === 'saved') draftOnDisk = false // 이제 이번 세션이 쓴 초안이다
      return r
    },
    clear: async () => {
      await spd.modelDraft.clear()
      draftOnDisk = false
    }
  })
  const id = setInterval(() => void autosave.tick(), DRAFT_INTERVAL_MS)
  return () => clearInterval(id)
}

export type DraftRecovery = 'none' | 'restored' | 'discarded' | 'skipped' | 'invalid'

/**
 * 시작할 때 비정상 종료로 남은 편집 초안이 있으면 복구할지 묻는다. 복구하면 모델 탭에 저장하지 않은(수정됨) 상태로 열고, 버리면 지운다. 이미 편집 중인
 * 모델이 있으면 묻지 않고 건너뛴다(초안은 그대로 둔다). 모양이 맞지 않는 초안은 지운다.
 */
export async function checkDraftRecovery(confirm: (request: { message: string; detail: string; ok: string; cancel: string }) => boolean | Promise<boolean> = askConfirm): Promise<DraftRecovery> {
  const spd = window.spd
  if (!spd) return 'none'
  if (useEditorStore.getState().doc) return 'skipped'
  const r = await spd.modelDraft.read()
  if (r.status !== 'found') return 'none'
  const doc = lenientModelDoc(r.doc)
  if (!doc) {
    await spd.modelDraft.clear()
    return 'invalid'
  }
  const when = new Date(r.savedAt)
  const at = Number.isNaN(when.getTime()) ? r.savedAt : when.toLocaleString('ko-KR')
  const name = doc.def.meta.name
  if (!(await confirm({ message: '저장하지 않고 닫힌 모델 편집 초안을 찾았습니다.', detail: `'${name}' — ${at}에 자동 저장됨.\n복구할까요? 버리면 이 초안은 지워집니다.`, ok: '복구', cancel: '버리기' }))) {
    await spd.modelDraft.clear()
    return 'discarded'
  }
  const installed = catalog.find((m) => m.id === doc.def.meta.id && m.category === 'user')
  noteDraftOnDisk()
  useEditorStore.getState().restore(doc, installed?.def.meta.version ?? 0)
  useUiStore.getState().setTab('model')
  return 'restored'
}
