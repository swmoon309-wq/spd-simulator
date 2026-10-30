import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type MenuCommand, type SpdApi } from '../shared/ipc'

// renderer에 노출하는 API는 여기에만 둔다. 파일 경로는 넘기지 않고 main이 대화상자로만 받는다.
const api: SpdApi = {
  platform: process.platform,
  project: {
    open: () => ipcRenderer.invoke(IPC.projectOpen),
    save: (project) => ipcRenderer.invoke(IPC.projectSave, project),
    saveAs: (project) => ipcRenderer.invoke(IPC.projectSaveAs, project),
    reset: () => ipcRenderer.invoke(IPC.projectReset),
    confirmDiscard: () => ipcRenderer.invoke(IPC.projectConfirmDiscard),
    setDirty: (dirty) => ipcRenderer.send(IPC.projectSetDirty, dirty)
  },
  files: {
    exportCsv: (request) => ipcRenderer.invoke(IPC.fileExportCsv, request),
    exportMarkdown: (request) => ipcRenderer.invoke(IPC.fileExportMarkdown, request),
    exportJson: (request) => ipcRenderer.invoke(IPC.fileExportJson, request),
    exportHtml: (request) => ipcRenderer.invoke(IPC.fileExportHtml, request),
    importCsv: () => ipcRenderer.invoke(IPC.fileImportCsv),
    importJson: () => ipcRenderer.invoke(IPC.fileImportJson)
  },
  report: {
    exportPdf: (request) => ipcRenderer.invoke(IPC.reportExportPdf, request)
  },
  recent: {
    list: () => ipcRenderer.invoke(IPC.recentList),
    open: (id) => ipcRenderer.invoke(IPC.recentOpen, id),
    remove: (id) => ipcRenderer.invoke(IPC.recentRemove, id),
    clear: () => ipcRenderer.invoke(IPC.recentClear)
  },
  recovery: {
    write: (record) => ipcRenderer.invoke(IPC.recoveryWrite, record),
    read: () => ipcRenderer.invoke(IPC.recoveryRead),
    clear: () => ipcRenderer.invoke(IPC.recoveryClear),
    confirmRestore: (info) => ipcRenderer.invoke(IPC.recoveryConfirmRestore, info)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  models: {
    list: () => ipcRenderer.invoke(IPC.modelsList),
    save: (doc) => ipcRenderer.invoke(IPC.modelsSave, doc),
    remove: (id) => ipcRenderer.invoke(IPC.modelsRemove, id)
  },
  dialogs: {
    confirm: (request) => ipcRenderer.invoke(IPC.dialogConfirm, request)
  },
  modelDraft: {
    write: (doc) => ipcRenderer.invoke(IPC.draftWrite, doc),
    read: () => ipcRenderer.invoke(IPC.draftRead),
    clear: () => ipcRenderer.invoke(IPC.draftClear)
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  menu: {
    update: (state) => ipcRenderer.send(IPC.menuUpdate, state),
    onCommand: (handler) => {
      const listener = (_e: unknown, command: MenuCommand) => handler(command)
      ipcRenderer.on(IPC.menuCommand, listener)
      return () => {
        ipcRenderer.removeListener(IPC.menuCommand, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('spd', api)
