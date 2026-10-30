import { create } from 'zustand'
import type { AppTab, HelpTopic } from '../../../shared/menuCommands'

export type Dialog = { kind: 'settings' } | { kind: 'help'; topic: HelpTopic }

interface UiState {
  /** 보고 있는 화면. 메뉴·단축키·홈의 버튼이 모두 이것을 바꾼다. */
  tab: AppTab
  /** 열려 있는 대화상자(없으면 null) */
  dialog: Dialog | null
  /** 사용자 모델이 올라오거나 내려갈 때마다 오른다(모델 목록을 그리는 곳이 다시 그리도록) */
  modelsVersion: number
  /** 내 모델 목록(앱 데이터 폴더)에 있는 모델 id */
  libraryIds: string[]
  modelsChanged(): void
  setLibraryIds(ids: string[]): void
  addLibraryId(id: string): void
  removeLibraryId(id: string): void
  setTab(tab: AppTab): void
  openSettings(): void
  openHelp(topic?: HelpTopic): void
  closeDialog(): void
}

/** 화면 이동과 대화상자(프로젝트 데이터가 아니라 보기 상태라 프로젝트 스토어와 따로 둔다). */
export const useUiStore = create<UiState>()((set) => ({
  tab: 'home',
  dialog: null,
  modelsVersion: 0,
  libraryIds: [],
  modelsChanged: () => set((s) => ({ modelsVersion: s.modelsVersion + 1 })),
  setLibraryIds: (libraryIds) => set({ libraryIds }),
  addLibraryId: (id) => set((s) => ({ libraryIds: s.libraryIds.includes(id) ? s.libraryIds : [...s.libraryIds, id] })),
  removeLibraryId: (id) => set((s) => ({ libraryIds: s.libraryIds.filter((x) => x !== id) })),
  setTab: (tab) => set({ tab }),
  openSettings: () => set({ dialog: { kind: 'settings' } }),
  openHelp: (topic = 'glossary') => set({ dialog: { kind: 'help', topic } }),
  closeDialog: () => set({ dialog: null })
}))
