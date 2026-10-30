import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { SaveResult } from '../shared/ipc'
import { REPORT_LIMITS } from '../shared/reportDoc'

/** PDF를 만드는 숨은 창. Electron의 `BrowserWindow`를 감싼 것이라 시험에서는 가짜로 바꾼다. */
export interface PdfWindow {
  loadFile(path: string): Promise<void>
  printToPDF(options: PdfOptions): Promise<Buffer>
  destroy(): void
}

export interface PdfOptions {
  pageSize: 'A4'
  printBackground: boolean
  displayHeaderFooter: boolean
  headerTemplate: string
  footerTemplate: string
  /** 문서의 `@page` 크기·여백을 쓴다(보고서 CSS가 A4와 여백을 정한다) */
  preferCSSPageSize: boolean
  /** 제목 구조를 PDF의 개요(북마크)로 */
  generateDocumentOutline: boolean
  /** 태그가 있는 PDF(제목·표·그림의 구조를 담아 접근성에 쓴다). 개요를 만들 때도 필요하다 */
  generateTaggedPDF: boolean
}

export interface ReportDeps {
  createWindow(): PdfWindow
  /** 임시 HTML 파일을 두는 폴더(앱 데이터 폴더 아래) */
  tmpDir: string
  fs: {
    writeFile(path: string, data: string | Uint8Array): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    mkdir(path: string): Promise<void>
  }
  pickSavePath(defaultName: string): Promise<string | null>
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 제안 이름에서 경로 문자를 바꾸고 `.pdf`를 보장한다. */
export function pdfFileName(suggested: string): string {
  const safe = suggested.replace(/[\\/:*?"<>|]/g, '_').trim() || 'report'
  return /\.pdf$/i.test(safe) ? safe : safe + '.pdf'
}

/** 쪽 번호만 있는 꼬리말(머리말은 비운다). 이 템플릿은 Chromium이 문서와 따로 그리므로 글꼴 크기를 직접 정한다. */
export const FOOTER_TEMPLATE = '<div style="font-size:9px;width:100%;text-align:center;color:#5d6470"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'

export function pdfOptions(): PdfOptions {
  return { pageSize: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: FOOTER_TEMPLATE, preferCSSPageSize: true, generateDocumentOutline: true, generateTaggedPDF: true }
}

/**
 * 숨은 창의 보안 설정(설계 09의 6.2). 프로젝트·모델 파일에서 온 문자열이 문서에 들어가므로 이스케이프에 더해
 * **스크립트를 끄고** 샌드박스에 가두며 새 창·이동·외부 요청을 막는다. 공유 세션을 건드리지 않도록 영속하지 않는 별도 파티션을 쓴다.
 */
export function pdfWindowPreferences(partition: string) {
  return { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true, partition, spellcheck: false } as const
}

/** 창이 열 수 있는 주소: 보고서 파일(`file:`)과 `data:`뿐이다. */
export function isAllowedRequestUrl(url: string): boolean {
  return url.startsWith('file://') || url.startsWith('data:')
}

/**
 * 보고서 HTML → PDF 저장(RPT-05). Electron에 의존하지 않아 창과 파일 시스템, 저장 대화상자를 주입해 시험한다.
 * 순서: 크기 확인 → 저장 위치 선택(취소하면 일을 하지 않는다) → 임시 파일에 HTML → 숨은 창에서 `printToPDF` → 저장 →
 * 임시 파일과 창 정리(실패해도 항상).
 */
export class ReportService {
  constructor(private readonly deps: ReportDeps) {}

  async exportPdf(suggestedName: string, html: string): Promise<SaveResult> {
    if (Buffer.byteLength(html, 'utf-8') > REPORT_LIMITS.maxHtmlBytes) return { status: 'error', message: '보고서가 너무 큽니다(20 MB 초과). 절을 줄이거나 차트를 줄여 다시 만드세요.' }
    const picked = await this.deps.pickSavePath(pdfFileName(suggestedName))
    if (picked === null) return { status: 'canceled' }
    const path = /\.pdf$/i.test(picked) ? picked : picked + '.pdf'

    const tmp = join(this.deps.tmpDir, `report-${process.pid}-${randomBytes(6).toString('hex')}.html`)
    let win: PdfWindow | null = null
    try {
      await this.deps.fs.mkdir(this.deps.tmpDir)
      await this.deps.fs.writeFile(tmp, html)
      win = this.deps.createWindow()
      await win.loadFile(tmp)
      const pdf = await win.printToPDF(pdfOptions())
      const part = `${path}.${process.pid}.tmp`
      try {
        await this.deps.fs.writeFile(part, pdf)
        await this.deps.fs.rename(part, path)
      } catch (e) {
        await this.deps.fs.rm(part).catch(() => undefined)
        throw e
      }
      return { status: 'saved', fileName: basename(path) }
    } catch (e) {
      return { status: 'error', message: `PDF를 만들지 못했습니다: ${message(e)}` }
    } finally {
      win?.destroy()
      await this.deps.fs.rm(tmp).catch(() => undefined)
    }
  }
}
