import { dirname, join } from 'node:path'
import * as fsp from 'node:fs/promises'
import { z } from 'zod'
import { app, dialog, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { IPC, type DiscardChoice, type OpenResult, type RestoreChoice, type SaveResult } from '../shared/ipc'
import { RECOVERY_VERSION, parseRecoveryJson } from '../shared/recoveryFile'
import { REPORT_LIMITS } from '../shared/reportDoc'
import { DEFAULT_SETTINGS } from '../shared/settings'
import { PROJECT_EXTENSION, projectFileSchema } from '../shared/projectFile'
import { modelDocSchema } from '../shared/modelDoc'
import { ModelDraftService } from './modelDraftService'
import { ModelLibraryService } from './modelLibraryService'
import { ProjectService } from './projectService'
import { createPdfWindow } from './pdfWindow'
import { RecentService } from './recentService'
import { ReportService } from './reportService'
import { SettingsService } from './settingsService'
import { APP_TITLE, type MenuState } from '../shared/menuCommands'
import type { Settings } from '../shared/settings'
import { RecoveryService } from './recoveryService'
import { TextFileService } from './textFileService'

/** 창 하나의 프로젝트 상태. renderer가 알려준 변경 여부로 창을 닫을 때 확인한다. */
export interface WindowState {
  dirty: boolean
  /** 저장이 끝나면 창을 닫는다 */
  closeAfterSave: boolean
  /** 확인을 마쳤으니 그대로 닫는다 */
  forceClose: boolean
}

export interface ProjectContext {
  service: ProjectService
  files: TextFileService
  recovery: RecoveryService
  /** 최근 프로젝트 목록(PRJ-02) */
  recents: RecentService
  /** 보고서 PDF(RPT-05) */
  reports: ReportService
  /** 사용자 설정(COM-03) */
  settings: SettingsService
  /** 내 모델 목록(COM-04) */
  models: ModelLibraryService
  /** 모델 편집 초안(설계 08의 9장) */
  drafts: ModelDraftService
  state: WindowState
  /** 대화상자를 여는 폴더. 마지막으로 열거나 저장한 폴더를 기억한다. */
  recent: { dir: string }
}

const CSV_FILTERS = [{ name: 'CSV (*.csv)', extensions: ['csv'] }]
const MARKDOWN_FILTERS = [{ name: '마크다운 (*.md)', extensions: ['md'] }]
const JSON_FILTERS = [{ name: 'JSON (*.json)', extensions: ['json'] }]
const HTML_FILTERS = [{ name: 'HTML (*.html)', extensions: ['html'] }]
const IMPORT_FILTERS = [{ name: 'CSV·텍스트', extensions: ['csv', 'txt'] }, { name: '모든 파일', extensions: ['*'] }]
const exportRequestSchema = z.object({ suggestedName: z.string().max(200), content: z.string() })

const FILTERS = [{ name: `SPD 프로젝트 (*${PROJECT_EXTENSION})`, extensions: ['json'] }]

/** Electron 대화상자와 파일 시스템으로 프로젝트 서비스를 만든다. */
export function createProjectContext(getWindow: () => BrowserWindow | null): ProjectContext {
  const recent = { dir: app.getPath('documents') }
  const service = new ProjectService({
    pickOpenPath: async () => {
      const win = getWindow()
      const opts = { title: '프로젝트 열기', defaultPath: recent.dir, properties: ['openFile' as const], filters: FILTERS }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    pickSavePath: async (defaultName) => {
      const win = getWindow()
      const opts = { title: '프로젝트 저장', defaultPath: join(recent.dir, defaultName), filters: FILTERS }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    },
    fs: {
      readFile: (p) => fsp.readFile(p, 'utf-8'),
      writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'),
      rename: fsp.rename,
      rm: (p) => fsp.rm(p),
      stat: fsp.stat
    }
  })
  const nodeFs = {
    readFile: (p: string) => fsp.readFile(p, 'utf-8'),
    writeFile: (p: string, d: string) => fsp.writeFile(p, d, 'utf-8'),
    rename: fsp.rename,
    rm: (p: string) => fsp.rm(p),
    stat: fsp.stat
  }
  const files = new TextFileService({
    pickSavePath: async (defaultName, kind) => {
      const win = getWindow()
      const title = kind === 'md' ? '마크다운으로 내보내기' : kind === 'json' ? 'JSON으로 내보내기' : kind === 'html' ? '보고서를 HTML로 저장' : 'CSV로 내보내기'
      const opts = { title, defaultPath: join(recent.dir, defaultName), filters: kind === 'md' ? MARKDOWN_FILTERS : kind === 'json' ? JSON_FILTERS : kind === 'html' ? HTML_FILTERS : CSV_FILTERS }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    },
    pickOpenPath: async (kind) => {
      const win = getWindow()
      const opts = { title: kind === 'json' ? '프리셋 JSON 가져오기' : '기준 행동 CSV 가져오기', defaultPath: recent.dir, properties: ['openFile' as const], filters: kind === 'json' ? JSON_FILTERS : IMPORT_FILTERS }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      return r.canceled ? null : (r.filePaths[0] ?? null)
    },
    fs: nodeFs
  })
  const recovery = new RecoveryService({
    dir: join(app.getPath('userData'), 'recovery'),
    fs: { readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, rename: nodeFs.rename, rm: nodeFs.rm, mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined) }
  })
  const recents = new RecentService({ file: join(app.getPath('userData'), 'recent.json'), fs: nodeFs, now: () => new Date() })
  const settings = new SettingsService({ file: join(app.getPath('userData'), 'settings.json'), fs: nodeFs })
  const models = new ModelLibraryService({
    dir: join(app.getPath('userData'), 'models'),
    fs: { readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, rename: nodeFs.rename, rm: nodeFs.rm, mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined), readdir: fsp.readdir }
  })
  const drafts = new ModelDraftService({
    dir: join(app.getPath('userData'), 'recovery'),
    fs: { readFile: nodeFs.readFile, writeFile: nodeFs.writeFile, rename: nodeFs.rename, rm: nodeFs.rm, mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined) },
    now: () => new Date()
  })
  const reports = new ReportService({
    createWindow: createPdfWindow,
    tmpDir: join(app.getPath('userData'), 'tmp'),
    fs: { writeFile: (p, d) => fsp.writeFile(p, d), rename: fsp.rename, rm: (p) => fsp.rm(p, { force: true }), mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined) },
    pickSavePath: async (defaultName) => {
      const win = getWindow()
      const opts = { title: '보고서를 PDF로 저장', defaultPath: join(recent.dir, defaultName), filters: [{ name: 'PDF (*.pdf)', extensions: ['pdf'] }] }
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      return r.canceled || !r.filePath ? null : r.filePath
    }
  })
  return { service, files, recovery, recents, reports, settings, models, drafts, state: { dirty: false, closeAfterSave: false, forceClose: false }, recent }
}

/** 새 창을 열 때 프로젝트 상태를 처음으로 되돌린다. */
export function resetProjectContext(ctx: ProjectContext): void {
  ctx.service.reset()
  ctx.state.dirty = false
  ctx.state.closeAfterSave = false
  ctx.state.forceClose = false
}

/** 프로젝트 IPC를 등록한다. 앱 수명 동안 한 번만 호출한다. */
export interface IpcHooks {
  /** 설정이 바뀌었다(창 바깥의 운영체제 화면 모양을 맞추는 데 쓴다) */
  onSettings(settings: Settings): void
  /** 화면이 모델 목록 등을 알려 왔다(메뉴를 다시 만든다) */
  onMenuState(state: MenuState): void
}

export function registerProjectIpc(getWindow: () => BrowserWindow | null, ctx: ProjectContext, hooks: IpcHooks): void {
  const { service, state, recent } = ctx
  const trusted = (e: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow | null => {
    const win = getWindow()
    return win && e.sender === win.webContents ? win : null
  }
  const reject = { status: 'error', message: '허용되지 않은 요청입니다.' } as const
  const rememberDir = () => {
    if (service.path) recent.dir = dirname(service.path)
  }

  const afterSave = (win: BrowserWindow, r: SaveResult) => {
    if (r.status === 'saved') {
      state.dirty = false
      rememberDir()
      if (service.path) void ctx.recents.add(service.path)
    }
    if (state.closeAfterSave) {
      state.closeAfterSave = false
      if (r.status === 'saved') {
        state.forceClose = true
        win.close()
      }
    }
  }

  ipcMain.handle(IPC.projectOpen, async (e) => {
    if (!trusted(e)) return reject
    const r = await service.open()
    if (r.status === 'opened') {
      state.dirty = false
      rememberDir()
      if (service.path) void ctx.recents.add(service.path)
    }
    return r
  })

  ipcMain.handle(IPC.settingsGet, async (e) => {
    if (!trusted(e)) return DEFAULT_SETTINGS
    return ctx.settings.get()
  })

  ipcMain.handle(IPC.settingsSet, async (e, patch: unknown) => {
    if (!trusted(e)) return DEFAULT_SETTINGS
    const next = await ctx.settings.update(patch)
    hooks.onSettings(next)
    return next
  })

  ipcMain.handle(IPC.modelsList, async (e) => {
    if (!trusted(e)) return { status: 'ok', models: [], skipped: 0 }
    return ctx.models.list()
  })

  ipcMain.handle(IPC.modelsSave, async (e, doc: unknown) => {
    if (!trusted(e)) return reject
    const parsed = modelDocSchema.safeParse(doc)
    if (!parsed.success) return { status: 'error', message: '저장할 모델 내용이 올바르지 않습니다.' } as const
    return ctx.models.save(parsed.data)
  })

  ipcMain.handle(IPC.modelsRemove, async (e, id: unknown) => {
    if (trusted(e) && typeof id === 'string') await ctx.models.remove(id)
  })

  ipcMain.handle(IPC.dialogConfirm, async (e, request: unknown) => {
    const win = trusted(e)
    const parsed = z.object({ message: z.string().min(1).max(300), detail: z.string().max(1000).optional(), ok: z.string().min(1).max(30), cancel: z.string().min(1).max(30) }).safeParse(request)
    if (!win || !parsed.success) return false
    const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: [parsed.data.ok, parsed.data.cancel], defaultId: 0, cancelId: 1, message: parsed.data.message, ...(parsed.data.detail ? { detail: parsed.data.detail } : {}) })
    return response === 0
  })

  ipcMain.handle(IPC.draftWrite, async (e, doc: unknown) => {
    if (!trusted(e)) return reject
    const parsed = modelDocSchema.safeParse(doc)
    if (!parsed.success) return { status: 'error', message: '저장할 초안이 올바르지 않습니다.' } as const
    return ctx.drafts.write(parsed.data)
  })

  ipcMain.handle(IPC.draftRead, async (e) => {
    if (!trusted(e)) return { status: 'none' } as const
    return ctx.drafts.read()
  })

  ipcMain.handle(IPC.draftClear, async (e) => {
    if (trusted(e)) await ctx.drafts.clear()
  })

  ipcMain.handle(IPC.appInfo, (e) => {
    if (!trusted(e)) return { name: '', version: '', electron: '', platform: '' }
    return { name: APP_TITLE, version: app.getVersion(), electron: process.versions.electron, platform: process.platform }
  })

  ipcMain.on(IPC.menuUpdate, (e, state: unknown) => {
    if (!trusted(e)) return
    const parsed = z.object({ models: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(200) })).max(200), modelId: z.string().max(100) }).safeParse(state)
    if (parsed.success) hooks.onMenuState(parsed.data)
  })

  ipcMain.handle(IPC.recentList, async (e) => {
    if (!trusted(e)) return []
    return ctx.recents.list()
  })

  ipcMain.handle(IPC.recentOpen, async (e, id: unknown) => {
    if (!trusted(e)) return reject
    const path = typeof id === 'string' ? await ctx.recents.resolve(id) : null
    if (path === null) return { status: 'error', message: '최근 목록에서 찾을 수 없는 항목입니다.' } satisfies OpenResult
    if (!(await fsp.stat(path).then(() => true, () => false))) {
      await ctx.recents.remove(id as string)
      return { status: 'error', message: '파일을 찾을 수 없습니다. 옮기거나 지웠을 수 있어 목록에서 뺐습니다.' } satisfies OpenResult
    }
    const r = await service.openPath(path)
    if (r.status === 'opened') {
      state.dirty = false
      rememberDir()
      void ctx.recents.add(path)
    }
    return r
  })

  ipcMain.handle(IPC.recentRemove, async (e, id: unknown) => {
    if (trusted(e) && typeof id === 'string') await ctx.recents.remove(id)
  })

  ipcMain.handle(IPC.recentClear, async (e) => {
    if (trusted(e)) await ctx.recents.clear()
  })

  for (const [channel, saveAs] of [
    [IPC.projectSave, false],
    [IPC.projectSaveAs, true]
  ] as const) {
    ipcMain.handle(channel, async (e, project: unknown) => {
      const win = trusted(e)
      if (!win) return reject
      const parsed = projectFileSchema.safeParse(project)
      if (!parsed.success) {
        state.closeAfterSave = false
        return { status: 'error', message: '저장할 프로젝트 내용이 올바르지 않습니다.' } satisfies SaveResult
      }
      const r = saveAs ? await service.saveAs(parsed.data) : await service.save(parsed.data)
      afterSave(win, r)
      return r
    })
  }

  ipcMain.handle(IPC.projectReset, (e) => {
    if (!trusted(e)) return
    service.reset()
    state.dirty = false
  })

  ipcMain.handle(IPC.projectConfirmDiscard, async (e): Promise<DiscardChoice> => {
    const win = trusted(e)
    if (!win) return 'cancel'
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      message: '저장하지 않은 변경 사항이 있습니다.',
      detail: '저장하지 않으면 변경 사항이 사라집니다.'
    })
    return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel'
  })

  ipcMain.handle(IPC.recoveryWrite, async (e, record: unknown) => {
    if (!trusted(e)) return reject
    // 형식과 크기를 main에서도 확인한다(renderer가 보낸 값을 그대로 믿지 않는다).
    const parsed = parseRecoveryJson(JSON.stringify({ recoveryVersion: RECOVERY_VERSION, ...(record as object) }))
    if (!parsed.ok) return { status: 'error', message: '자동 저장할 내용이 올바르지 않습니다.' }
    return ctx.recovery.write(parsed.record)
  })

  ipcMain.handle(IPC.recoveryRead, async (e) => {
    if (!trusted(e)) return reject
    return ctx.recovery.read()
  })

  ipcMain.handle(IPC.recoveryClear, async (e) => {
    if (!trusted(e)) return
    await ctx.recovery.clear()
  })

  ipcMain.handle(IPC.recoveryConfirmRestore, async (e, info: unknown): Promise<RestoreChoice> => {
    const win = trusted(e)
    const parsed = z.object({ name: z.string().max(200), savedAt: z.string().max(64) }).safeParse(info)
    if (!win || !parsed.success) return 'discard'
    const when = new Date(parsed.data.savedAt)
    const at = Number.isNaN(when.getTime()) ? parsed.data.savedAt : when.toLocaleString('ko-KR')
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['복구', '버리기'],
      defaultId: 0,
      cancelId: 0, // Esc로 닫아도 지우지 않는다
      message: '저장하지 않고 종료된 작업을 찾았습니다.',
      detail: `'${parsed.data.name}' — ${at}에 자동 저장됨.\n버리면 이 자동 저장본은 지워집니다.`
    })
    return response === 0 ? 'restore' : 'discard'
  })

  ipcMain.handle(IPC.fileExportCsv, async (e, request: unknown) => {
    if (!trusted(e)) return reject
    const parsed = exportRequestSchema.safeParse(request)
    if (!parsed.success) return { status: 'error', message: '내보낼 내용이 올바르지 않습니다.' } satisfies SaveResult
    return ctx.files.exportCsv(parsed.data.suggestedName, parsed.data.content)
  })

  ipcMain.handle(IPC.fileExportMarkdown, async (e, request: unknown) => {
    if (!trusted(e)) return reject
    const parsed = exportRequestSchema.safeParse(request)
    if (!parsed.success) return { status: 'error', message: '내보낼 내용이 올바르지 않습니다.' } satisfies SaveResult
    return ctx.files.exportMarkdown(parsed.data.suggestedName, parsed.data.content)
  })

  ipcMain.handle(IPC.fileExportHtml, async (e, request: unknown) => {
    if (!trusted(e)) return reject
    const parsed = exportRequestSchema.safeParse(request)
    if (!parsed.success) return { status: 'error', message: '내보낼 내용이 올바르지 않습니다.' } satisfies SaveResult
    return ctx.files.exportHtml(parsed.data.suggestedName, parsed.data.content)
  })

  ipcMain.handle(IPC.reportExportPdf, async (e, request: unknown) => {
    if (!trusted(e)) return reject
    const parsed = z.object({ suggestedName: z.string().max(200), content: z.string().max(REPORT_LIMITS.maxHtmlBytes) }).safeParse(request)
    if (!parsed.success) return { status: 'error', message: '내보낼 보고서가 올바르지 않거나 너무 큽니다.' } satisfies SaveResult
    return ctx.reports.exportPdf(parsed.data.suggestedName, parsed.data.content)
  })

  ipcMain.handle(IPC.fileExportJson, async (e, request: unknown) => {
    if (!trusted(e)) return reject
    const parsed = exportRequestSchema.safeParse(request)
    if (!parsed.success) return { status: 'error', message: '내보낼 내용이 올바르지 않습니다.' } satisfies SaveResult
    return ctx.files.exportJson(parsed.data.suggestedName, parsed.data.content)
  })

  ipcMain.handle(IPC.fileImportCsv, async (e) => {
    if (!trusted(e)) return reject
    return ctx.files.importText('csv')
  })

  ipcMain.handle(IPC.fileImportJson, async (e) => {
    if (!trusted(e)) return reject
    return ctx.files.importText('json')
  })

  ipcMain.on(IPC.projectSetDirty, (e, dirty: unknown) => {
    if (trusted(e)) state.dirty = dirty === true
  })
}
