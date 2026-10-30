import { BrowserWindow, session } from 'electron'
import { isAllowedRequestUrl, pdfWindowPreferences, type PdfWindow } from './reportService'

/** 영속하지 않는 파티션(앱의 기본 세션과 분리된다). */
const PARTITION = 'spd-report-pdf'

/** 보고서를 PDF로 만드는 숨은 창을 만든다(설정은 `pdfWindowPreferences`). */
export function createPdfWindow(): PdfWindow {
  const ses = session.fromPartition(PARTITION)
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isAllowedRequestUrl(details.url) }))
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: pdfWindowPreferences(PARTITION) })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  return {
    loadFile: (path) => win.loadFile(path),
    printToPDF: (options) => win.webContents.printToPDF(options),
    destroy: () => {
      if (!win.isDestroyed()) win.destroy()
    }
  }
}
