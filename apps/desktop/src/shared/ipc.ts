import type { ProjectFile } from './projectFile'
import type { MenuCommand, MenuState } from './menuCommands'
import type { ModelDocRaw } from './modelDoc'
import type { RecoveryRecord } from './recoveryFile'
import type { Settings } from './settings'

export type { MenuCommand, MenuState } from './menuCommands'

export const IPC = {
  projectOpen: 'project:open',
  projectSave: 'project:save',
  projectSaveAs: 'project:saveAs',
  projectReset: 'project:reset',
  projectConfirmDiscard: 'project:confirmDiscard',
  projectSetDirty: 'project:setDirty',
  fileExportCsv: 'file:exportCsv',
  fileExportMarkdown: 'file:exportMarkdown',
  fileExportJson: 'file:exportJson',
  fileExportHtml: 'file:exportHtml',
  reportExportPdf: 'report:exportPdf',
  fileImportCsv: 'file:importCsv',
  fileImportJson: 'file:importJson',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appInfo: 'app:info',
  menuUpdate: 'menu:update',
  recentList: 'recent:list',
  recentOpen: 'recent:open',
  recentRemove: 'recent:remove',
  recentClear: 'recent:clear',
  recoveryWrite: 'recovery:write',
  recoveryRead: 'recovery:read',
  recoveryClear: 'recovery:clear',
  recoveryConfirmRestore: 'recovery:confirmRestore',
  modelsList: 'models:list',
  modelsSave: 'models:save',
  modelsRemove: 'models:remove',
  dialogConfirm: 'dialog:confirm',
  draftWrite: 'draft:write',
  draftRead: 'draft:read',
  draftClear: 'draft:clear',
  menuCommand: 'menu:command'
} as const

// renderer에는 파일 경로를 주지 않는다. 경로는 main이 대화상자로만 받아 기억한다.
export type OpenResult =
  | { status: 'opened'; fileName: string; project: ProjectFile }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

export type SaveResult =
  | { status: 'saved'; fileName: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

export interface ExportCsvRequest {
  /** 저장 대화상자의 기본 파일 이름 */
  suggestedName: string
  content: string
}

export type ImportTextResult =
  | { status: 'opened'; fileName: string; content: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

/** 최근 프로젝트 한 건. 경로는 알리지 않고 `id`로만 다시 연다. */
export interface RecentEntry {
  id: string
  fileName: string
  /** 파일이 있는 폴더의 이름(경로 전체가 아니다) */
  folder: string
  openedAt: string
  /** 파일이 없어졌다(옮기거나 지웠다) */
  missing: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  platform: string
}

export type DiscardChoice = 'save' | 'discard' | 'cancel'

export type RecoveryReadResult =
  | { status: 'none' }
  | { status: 'found'; record: RecoveryRecord }
  | { status: 'error'; message: string }

export type RestoreChoice = 'restore' | 'discard'

/** 내 모델 목록(COM-04)의 모델 하나. 모델 문서는 구조만 확인한 것이라 renderer가 엔진으로 다시 검증한다. */
export interface LibraryModel {
  id: string
  doc: ModelDocRaw
}

export type LibraryListResult = { status: 'ok'; models: LibraryModel[]; /** 읽을 수 없어 건너뛴 파일 수 */ skipped: number } | { status: 'error'; message: string }

/** 모델 편집 초안(설계 08의 9장). 편집 중인 문서를 자동 저장해 비정상 종료 뒤에 복구한다. */
export type DraftReadResult = { status: 'none' } | { status: 'found'; savedAt: string; doc: ModelDocRaw } | { status: 'error'; message: string }

/** 확인 대화상자(네이티브). 버튼 이름을 정해 "예/아니오"를 묻는다. */
export interface ConfirmRequest {
  message: string
  detail?: string
  ok: string
  cancel: string
}

export interface SpdApi {
  platform: string
  project: {
    open(): Promise<OpenResult>
    /** 저장된 경로가 있으면 그 파일에, 없으면 저장 대화상자를 거쳐 저장한다. */
    save(project: ProjectFile): Promise<SaveResult>
    saveAs(project: ProjectFile): Promise<SaveResult>
    /** 새 프로젝트: 기억하던 파일 경로를 잊는다. */
    reset(): Promise<void>
    /** 저장하지 않은 변경 사항에 대한 확인 대화상자 */
    confirmDiscard(): Promise<DiscardChoice>
    /** 변경 여부를 알려 창 닫기 시 확인할 수 있게 한다. */
    setDirty(dirty: boolean): void
  }
  files: {
    /** CSV 저장 대화상자를 거쳐 내용을 파일로 쓴다. */
    exportCsv(request: ExportCsvRequest): Promise<SaveResult>
    /** 마크다운(.md) 저장 대화상자를 거쳐 내용을 파일로 쓴다(검증 기록 등). */
    exportMarkdown(request: ExportCsvRequest): Promise<SaveResult>
    /** JSON(.json) 저장 대화상자를 거쳐 내용을 파일로 쓴다(보정 프리셋 등). */
    exportJson(request: ExportCsvRequest): Promise<SaveResult>
    /** 보고서 HTML(.html) 저장 대화상자를 거쳐 내용을 파일로 쓴다. */
    exportHtml(request: ExportCsvRequest): Promise<SaveResult>
    /** 열기 대화상자에서 고른 JSON 파일의 내용을 읽는다. */
    importJson(): Promise<ImportTextResult>
    /** 열기 대화상자에서 고른 CSV/텍스트 파일의 내용을 읽는다. */
    importCsv(): Promise<ImportTextResult>
  }
  /** 보고서(RPT-05). PDF는 main의 격리된 숨은 창에서 만든다. */
  report: {
    /** 보고서 HTML을 A4 PDF로 만들어 저장 대화상자를 거쳐 쓴다. */
    exportPdf(request: ExportCsvRequest): Promise<SaveResult>
  }
  /** 최근에 열거나 저장한 프로젝트(PRJ-02). */
  recent: {
    list(): Promise<RecentEntry[]>
    /** 목록의 항목을 연다. 파일이 없으면 오류를 돌려주고 목록에서 뺀다. */
    open(id: string): Promise<OpenResult>
    remove(id: string): Promise<void>
    clear(): Promise<void>
  }
  /** 자동 저장본(COM-05). 사용자의 프로젝트 파일과 별개로 앱 데이터 폴더에 하나만 둔다. */
  recovery: {
    write(record: RecoveryRecord): Promise<{ status: 'saved' } | { status: 'error'; message: string }>
    read(): Promise<RecoveryReadResult>
    clear(): Promise<void>
    /** 복구할지 묻는 대화상자(복구·버리기) */
    confirmRestore(info: { name: string; savedAt: string }): Promise<RestoreChoice>
  }
  /** 사용자 설정(COM-03). 프로젝트 파일이 아니라 사용자별로 저장된다. */
  settings: {
    get(): Promise<Settings>
    /** 일부 값을 바꾸고 저장한 설정 전체를 돌려준다. 올바르지 않은 값은 무시한다. */
    set(patch: Partial<Settings>): Promise<Settings>
  }
  /** 내 모델 목록(설계 08의 4.2). 앱 데이터 폴더에 모델 하나씩 둔다. 모델 파일 가져오기·내보내기는 `files.importJson`·`exportJson`을 쓴다. */
  models: {
    list(): Promise<LibraryListResult>
    /** 같은 id가 있으면 바꾼다. */
    save(doc: ModelDocRaw): Promise<{ status: 'saved' } | { status: 'error'; message: string }>
    remove(id: string): Promise<void>
  }
  dialogs: {
    /** 확인 대화상자를 열어 `ok` 버튼을 눌렀는지 돌려준다(닫거나 Esc는 취소). */
    confirm(request: ConfirmRequest): Promise<boolean>
  }
  /** 모델 편집기의 편집 초안 하나(프로젝트 자동 저장본과 별개). */
  modelDraft: {
    write(doc: ModelDocRaw): Promise<{ status: 'saved' } | { status: 'error'; message: string }>
    read(): Promise<DraftReadResult>
    clear(): Promise<void>
  }
  app: {
    info(): Promise<AppInfo>
  }
  menu: {
    onCommand(handler: (command: MenuCommand) => void): () => void
    /** 화면의 상태(모델 목록과 현재 모델)를 알려 메뉴를 다시 만들게 한다. */
    update(state: MenuState): void
  }
}
