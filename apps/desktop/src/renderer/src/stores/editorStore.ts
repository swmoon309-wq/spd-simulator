import { create } from 'zustand'
import { getEntry as getCatalogEntry } from '../catalog'
import type { ModelEntry } from '../catalog'
import { runApplyGate, type GateResult } from '../lib/modelEdit/apply'
import type { EditResult } from '../lib/modelEdit/commands'
import { canRedo, canUndo, commit, newHistory, redo, redoLabel, undo, undoLabel, type EditHistory } from '../lib/modelEdit/history'
import { sourceFor, blankModelDoc, type EditSource } from '../lib/modelEdit/session'
import type { ModelDoc } from '../lib/modelDoc'
import { installUserModel, isInstalled } from '../lib/modelRegistry'
import type { ModelDocRaw } from '../../../shared/modelDoc'
import { useAppStore } from './appStore'
import { useUiStore } from './uiStore'

export type ApplyOutcome =
  | { ok: true; entry: ModelEntry; gate: GateResult; /** 지금 열린 프로젝트에 반영했는가 */ projectUpdated: boolean; warnings: string[] }
  | { ok: false; gate?: GateResult; message: string }

interface EditorState {
  /** 편집 중인 초안. 없으면 편집기가 비어 있다. */
  doc: ModelDoc | null
  history: EditHistory<ModelDoc> | null
  /** 마지막으로 적용했거나 연 문서(바뀌었는지 판단) */
  baseline: ModelDoc | null
  /** 지금 앱에 올라와 있는 같은 id 모델의 버전(0이면 아직 없다) */
  installedVersion: number
  selected: string | null
  /** 가장 최근 편집 명령의 알림(바꾼 참조 수 등) 또는 오류 */
  message: { kind: 'info' | 'error'; text: string } | null
  /** 적용 게이트의 마지막 결과 */
  gate: GateResult | null
  open(source: EditSource): void
  openCurrent(): void
  openInstalled(id: string): void
  openBlank(): void
  /** 자동 저장된 초안을 복구한다: 저장하지 않은(수정됨) 상태로 열린다. */
  restore(doc: ModelDoc, installedVersion: number): void
  close(): void
  /** 명령을 실행해 초안에 반영한다. 거절되면 이유를 돌려주고 초안은 그대로다. `key`가 같은 연속 편집(글자 입력)은 한 단계로 합친다. */
  run(label: string, command: (doc: ModelDoc) => EditResult, key?: string): string | null
  /** 이미 만든 새 문서로 바꾼다(spec 편집 등). */
  replace(label: string, next: ModelDoc, key?: string): void
  select(name: string | null): void
  undo(): void
  redo(): void
  clearMessage(): void
  /** 적용 게이트만 돌려 결과를 보인다(적용하지 않는다). */
  check(): GateResult | null
  /** 적용한다. 단위 오류가 있으면 `confirmUnitErrors`가 true여야 한다(D5). */
  apply(options?: { confirmUnitErrors?: boolean }): Promise<ApplyOutcome>
}

let clock: () => number = () => Date.now()
/** 시험에서 시계를 바꾼다. */
export function setEditorClock(c: () => number): void {
  clock = c
}

export const selectDirty = (s: Pick<EditorState, 'doc' | 'baseline'>): boolean => s.doc !== null && s.doc !== s.baseline
export const selectCanUndo = (s: EditorState): boolean => s.history !== null && canUndo(s.history)
export const selectCanRedo = (s: EditorState): boolean => s.history !== null && canRedo(s.history)
export const selectUndoLabel = (s: EditorState): string | null => (s.history ? undoLabel(s.history) : null)
export const selectRedoLabel = (s: EditorState): string | null => (s.history ? redoLabel(s.history) : null)

const empty = { doc: null, history: null, baseline: null, installedVersion: 0, selected: null, message: null, gate: null } as const

export const useEditorStore = create<EditorState>()((set, get) => ({
  ...empty,

  open: (source) => set({ doc: source.doc, history: newHistory(source.doc), baseline: source.doc, installedVersion: source.installedVersion, selected: null, message: null, gate: null }),
  openCurrent: () => get().open(sourceFor(useAppStore.getState().modelId)),
  openInstalled: (id) => get().open(sourceFor(id)),
  openBlank: () => get().open({ doc: blankModelDoc(), installedVersion: 0 }),
  restore: (doc, installedVersion) => set({ doc, history: newHistory(doc), baseline: null, installedVersion, selected: null, message: { kind: 'info', text: '복구한 편집 초안입니다. 아직 적용하지 않았습니다.' }, gate: null }),
  close: () => set({ ...empty }),

  run(label, command, key) {
    const { history } = get()
    if (!history) return '편집할 모델이 없습니다.'
    const r = command(history.present)
    if (!r.ok) {
      set({ message: { kind: 'error', text: r.message } })
      return r.message
    }
    const next = commit(history, r.doc, label, clock(), key)
    set({ history: next, doc: next.present, gate: null, message: r.note ? { kind: 'info', text: r.note } : null })
    return null
  },

  replace(label, next, key) {
    const { history } = get()
    if (!history) return
    const h = commit(history, next, label, clock(), key)
    set({ history: h, doc: h.present, gate: null, message: null })
  },

  select: (name) => set({ selected: name }),

  undo() {
    const { history } = get()
    if (!history) return
    const h = undo(history)
    set({ history: h, doc: h.present, gate: null, message: null })
  },
  redo() {
    const { history } = get()
    if (!history) return
    const h = redo(history)
    set({ history: h, doc: h.present, gate: null, message: null })
  },
  clearMessage: () => set({ message: null }),

  check() {
    const { doc } = get()
    if (!doc) return null
    const gate = runApplyGate(doc)
    set({ gate })
    return gate
  },

  async apply(options = {}) {
    const { doc, installedVersion } = get()
    if (!doc) return { ok: false, message: '적용할 모델이 없습니다.' }
    const gate = runApplyGate(doc)
    set({ gate })
    if (!gate.canApply || !gate.validated) return { ok: false, gate, message: '적용을 막는 문제가 있습니다. 문제를 고친 뒤 다시 적용하세요.' }
    if (gate.unitErrors > 0 && !options.confirmUnitErrors) return { ok: false, gate, message: `단위 오류 ${gate.unitErrors}건이 있습니다. 확인하고 적용하려면 확인란을 체크하세요.` }

    // 적용할 때마다 버전이 오른다(결과의 "오래됨" 판단이 모델 버전을 키에 쓴다). 아직 올라온 적 없는 새 모델은 처음 버전을 그대로 쓴다.
    const id = doc.def.meta.id
    const version = installedVersion > 0 ? installedVersion + 1 : doc.def.meta.version
    const next: ModelDoc = { ...gate.validated.doc, def: { ...gate.validated.doc.def, meta: { ...gate.validated.doc.def.meta, version } } }
    const raw = next as ModelDocRaw

    // 지금 프로젝트가 이 모델을 쓰면, 고치기 전의 모델로 만든 파일에 새 모델을 끼워 다시 연다(없어진 상수는 버리고 알린다, 설계 08의 8.2).
    const app = useAppStore.getState()
    const usesIt = app.modelId === id && isInstalled(id)
    const file = usesIt ? app.buildProjectFile() : null
    if (file) file.model = { id, version, custom: raw }

    const installed = installUserModel(raw)
    if (!installed.ok) return { ok: false, gate, message: installed.message }
    const warnings: string[] = []
    const saved = await window.spd?.models.save(raw)
    if (saved && saved.status === 'error') warnings.push(`내 모델 목록에 저장하지 못했습니다(이 실행에서만 쓸 수 있습니다). ${saved.message}`)
    else if (window.spd) useUiStore.getState().addLibraryId(id)
    useUiStore.getState().modelsChanged()

    let projectUpdated = false
    if (file) {
      const name = app.projectName
      const fileName = app.projectFile
      projectUpdated = await useAppStore.getState().loadProjectFile(file, fileName ?? `${name}.spd.json`)
      if (projectUpdated) useAppStore.setState({ projectName: name, projectFile: fileName, savedSnapshot: '' }) // 모델이 바뀌었으니 저장해야 한다
    }

    const h = commit(get().history as EditHistory<ModelDoc>, next, '모델 적용', clock())
    set({ doc: next, history: h, baseline: next, installedVersion: version, message: { kind: 'info', text: `적용했습니다(버전 ${version}).` } })
    return { ok: true, entry: getCatalogEntry(id), gate, projectUpdated, warnings }
  }
}))
