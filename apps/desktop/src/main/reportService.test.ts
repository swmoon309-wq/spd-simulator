import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FOOTER_TEMPLATE, isAllowedRequestUrl, pdfFileName, pdfOptions, pdfWindowPreferences, ReportService, type PdfOptions, type PdfWindow } from './reportService'

let dir: string
let saveAnswer: string | null
let log: string[]

interface FakeOpts {
  loadError?: Error
  printError?: Error
  writeError?: Error
  pdf?: Buffer
}

function make(o: FakeOpts = {}) {
  const windows: { loaded: string[]; printed: PdfOptions[]; destroyed: boolean; html: string[] }[] = []
  const service = new ReportService({
    createWindow: () => {
      const w = { loaded: [] as string[], printed: [] as PdfOptions[], destroyed: false, html: [] as string[] }
      windows.push(w)
      const win: PdfWindow = {
        loadFile: async (p) => {
          w.loaded.push(p)
          w.html.push(await readFile(p, 'utf-8')) // 임시 파일이 실제로 있고 내용이 HTML이어야 한다
          if (o.loadError) throw o.loadError
        },
        printToPDF: async (opts) => {
          w.printed.push(opts)
          if (o.printError) throw o.printError
          return o.pdf ?? Buffer.from('%PDF-1.7 fake')
        },
        destroy: () => void (w.destroyed = true)
      }
      return win
    },
    tmpDir: join(dir, 'tmp'),
    fs: {
      writeFile: async (p, d) => {
        if (o.writeError && p.endsWith('.tmp')) throw o.writeError
        await fsp.writeFile(p, d)
      },
      rename: fsp.rename,
      rm: (p) => fsp.rm(p, { force: true }),
      mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined)
    },
    pickSavePath: async (name) => (log.push(name), saveAnswer)
  })
  return { service, windows }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spd-pdf-'))
  saveAnswer = null
  log = []
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('pdfFileName', () => {
  it('경로 문자를 바꾸고 .pdf를 보장한다', () => {
    expect(pdfFileName('내 프로젝트 계획서')).toBe('내 프로젝트 계획서.pdf')
    expect(pdfFileName('a/b:c.PDF')).toBe('a_b_c.PDF')
    expect(pdfFileName('  ')).toBe('report.pdf')
  })
})

describe('PDF 옵션과 창 설정(설계 09의 6.2)', () => {
  it('A4, 배경 인쇄, 쪽 번호 꼬리말, 문서 개요, 문서의 @page 크기 사용', () => {
    expect(pdfOptions()).toMatchObject({ pageSize: 'A4', printBackground: true, displayHeaderFooter: true, preferCSSPageSize: true, generateDocumentOutline: true, generateTaggedPDF: true })
    expect(FOOTER_TEMPLATE).toContain('pageNumber')
    expect(FOOTER_TEMPLATE).toContain('totalPages')
  })

  it('숨은 창: 샌드박스·컨텍스트 격리·노드 없음·스크립트 끔·별도(영속하지 않는) 파티션', () => {
    const p = pdfWindowPreferences('spd-report-pdf')
    expect(p).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, webSecurity: true })
    expect(p.partition).not.toMatch(/^persist:/) // 디스크에 남지 않는다
  })

  it('보고서 파일과 data: 주소만 허용한다', () => {
    expect(isAllowedRequestUrl('file:///tmp/report.html')).toBe(true)
    expect(isAllowedRequestUrl('data:image/png;base64,AAA')).toBe(true)
    for (const bad of ['https://evil.example/a.png', 'http://x', 'ftp://x', 'chrome://gpu', 'javascript:alert(1)', 'blob:https://x']) expect(isAllowedRequestUrl(bad), bad).toBe(false)
  })
})

describe('ReportService.exportPdf', () => {
  it('고른 경로에 PDF를 쓰고 파일 이름만 돌려준다. 확장자가 없으면 .pdf를 붙인다', async () => {
    saveAnswer = join(dir, '보고서')
    const { service, windows } = make({ pdf: Buffer.from('%PDF-1.7 내용') })
    const r = await service.exportPdf('내 보고서', '<!doctype html><p>안녕</p>')
    expect(r).toEqual({ status: 'saved', fileName: '보고서.pdf' })
    expect(log).toEqual(['내 보고서.pdf'])
    expect((await readFile(join(dir, '보고서.pdf'))).toString()).toBe('%PDF-1.7 내용')
    expect(windows).toHaveLength(1)
    expect(windows[0]?.html[0]).toBe('<!doctype html><p>안녕</p>') // 창이 읽은 것은 받은 HTML 그대로
    expect(windows[0]?.printed[0]).toMatchObject({ pageSize: 'A4', generateDocumentOutline: true })
  })

  it('끝나면 창을 닫고 임시 파일을 지운다(결과 폴더에도 임시 파일이 남지 않는다)', async () => {
    saveAnswer = join(dir, 'r.pdf')
    const { service, windows } = make()
    await service.exportPdf('x', '<p/>')
    expect(windows[0]?.destroyed).toBe(true)
    expect(await readdir(join(dir, 'tmp'))).toEqual([])
    expect((await readdir(dir)).sort()).toEqual(['r.pdf', 'tmp'])
  })

  it('저장 대화상자를 취소하면 창도 임시 파일도 만들지 않는다', async () => {
    const { service, windows } = make()
    expect(await service.exportPdf('x', '<p/>')).toEqual({ status: 'canceled' })
    expect(windows).toHaveLength(0)
    expect(await readdir(dir)).toEqual([])
  })

  it('20 MB를 넘으면 대화상자도 열지 않고 거절한다', async () => {
    const { service } = make()
    const r = await service.exportPdf('x', 'a'.repeat(20 * 1024 * 1024 + 1))
    expect(r).toMatchObject({ status: 'error' })
    expect(log).toEqual([])
  })

  it.each([
    ['불러오기 실패', { loadError: new Error('로드 실패') }, '로드 실패'],
    ['인쇄 실패', { printError: new Error('인쇄 실패') }, '인쇄 실패'],
    ['쓰기 실패', { writeError: new Error('디스크 오류') }, '디스크 오류']
  ] as const)('%s: 이유를 알리고 창·임시 파일을 정리한다', async (_n, opts, reason) => {
    saveAnswer = join(dir, 'r.pdf')
    const { service, windows } = make(opts as FakeOpts)
    const r = await service.exportPdf('x', '<p/>')
    expect(r).toEqual({ status: 'error', message: `PDF를 만들지 못했습니다: ${reason}` })
    expect(windows[0]?.destroyed).toBe(true)
    expect(await readdir(join(dir, 'tmp'))).toEqual([])
    expect((await readdir(dir)).sort()).toEqual(['tmp']) // 반쯤 쓴 PDF가 남지 않는다
  })
})
