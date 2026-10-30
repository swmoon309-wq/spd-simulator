import { basename } from 'node:path'
import type { ImportTextResult, SaveResult } from '../shared/ipc'
import { REPORT_LIMITS } from '../shared/reportDoc'
import { writeFileAtomic } from './atomicWrite'

export interface TextFileDeps {
  /** 저장 대화상자. `kind`로 파일 형식 필터를 정한다. */
  pickSavePath(defaultName: string, kind: 'csv' | 'md' | 'json' | 'html'): Promise<string | null>
  /** 열기 대화상자. `kind`로 파일 형식 필터를 정한다. */
  pickOpenPath(kind: 'csv' | 'json'): Promise<string | null>
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    stat(path: string): Promise<{ size: number }>
  }
}

export const MAX_EXPORT_BYTES = 100 * 1024 * 1024
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 제안 파일 이름에서 경로에 쓸 수 없는 문자를 바꾸고 `.csv`로 끝나게 한다. */
export function csvFileName(suggested: string): string {
  const safe = suggested.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export'
  return /\.csv$/i.test(safe) ? safe : safe + '.csv'
}

/** 제안 파일 이름에서 경로에 쓸 수 없는 문자를 바꾸고 `.md`로 끝나게 한다. */
export function markdownFileName(suggested: string): string {
  const safe = suggested.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export'
  return /\.md$/i.test(safe) ? safe : safe + '.md'
}

/** 제안 파일 이름에서 경로에 쓸 수 없는 문자를 바꾸고 `.json`으로 끝나게 한다. */
export function jsonFileName(suggested: string): string {
  const safe = suggested.replace(/[\\/:*?"<>|]/g, '_').trim() || 'export'
  return /\.json$/i.test(safe) ? safe : safe + '.json'
}

/** 제안 파일 이름에서 경로에 쓸 수 없는 문자를 바꾸고 `.html`로 끝나게 한다. */
export function htmlFileName(suggested: string): string {
  const safe = suggested.replace(/[\\/:*?"<>|]/g, '_').trim() || 'report'
  return /\.html?$/i.test(safe) ? safe : safe + '.html'
}

/**
 * 결과 내보내기(CSV 저장)와 외부 데이터 가져오기(CSV 읽기). Electron에 의존하지 않아 시험할 수 있다.
 * 경로는 사용자가 대화상자에서 고른 것만 쓰고 renderer에는 파일 이름만 돌려준다.
 */
export class TextFileService {
  constructor(private readonly deps: TextFileDeps) {}

  async exportCsv(suggestedName: string, content: string): Promise<SaveResult> {
    if (Buffer.byteLength(content, 'utf-8') > MAX_EXPORT_BYTES) {
      return { status: 'error', message: '내보낼 데이터가 너무 큽니다.' }
    }
    const picked = await this.deps.pickSavePath(csvFileName(suggestedName), 'csv')
    if (picked === null) return { status: 'canceled' }
    const path = /\.csv$/i.test(picked) ? picked : picked + '.csv'
    try {
      await writeFileAtomic(this.deps.fs, path, content)
    } catch (e) {
      return { status: 'error', message: `저장하지 못했습니다: ${message(e)}` }
    }
    return { status: 'saved', fileName: basename(path) }
  }

  async exportMarkdown(suggestedName: string, content: string): Promise<SaveResult> {
    if (Buffer.byteLength(content, 'utf-8') > MAX_EXPORT_BYTES) {
      return { status: 'error', message: '내보낼 데이터가 너무 큽니다.' }
    }
    const picked = await this.deps.pickSavePath(markdownFileName(suggestedName), 'md')
    if (picked === null) return { status: 'canceled' }
    const path = /\.md$/i.test(picked) ? picked : picked + '.md'
    try {
      await writeFileAtomic(this.deps.fs, path, content)
    } catch (e) {
      return { status: 'error', message: `저장하지 못했습니다: ${message(e)}` }
    }
    return { status: 'saved', fileName: basename(path) }
  }

  async exportJson(suggestedName: string, content: string): Promise<SaveResult> {
    if (Buffer.byteLength(content, 'utf-8') > MAX_EXPORT_BYTES) {
      return { status: 'error', message: '내보낼 데이터가 너무 큽니다.' }
    }
    const picked = await this.deps.pickSavePath(jsonFileName(suggestedName), 'json')
    if (picked === null) return { status: 'canceled' }
    const path = /\.json$/i.test(picked) ? picked : picked + '.json'
    try {
      await writeFileAtomic(this.deps.fs, path, content)
    } catch (e) {
      return { status: 'error', message: `저장하지 못했습니다: ${message(e)}` }
    }
    return { status: 'saved', fileName: basename(path) }
  }

  /** 보고서 HTML 저장(RPT-05). 문서 크기 상한은 보고서 한도(20 MB)를 따른다. */
  async exportHtml(suggestedName: string, content: string): Promise<SaveResult> {
    if (Buffer.byteLength(content, 'utf-8') > REPORT_LIMITS.maxHtmlBytes) {
      return { status: 'error', message: '보고서가 너무 큽니다(20 MB 초과). 절을 줄이거나 차트를 줄여 다시 만드세요.' }
    }
    const picked = await this.deps.pickSavePath(htmlFileName(suggestedName), 'html')
    if (picked === null) return { status: 'canceled' }
    const path = /\.html?$/i.test(picked) ? picked : picked + '.html'
    try {
      await writeFileAtomic(this.deps.fs, path, content)
    } catch (e) {
      return { status: 'error', message: `저장하지 못했습니다: ${message(e)}` }
    }
    return { status: 'saved', fileName: basename(path) }
  }

  async importText(kind: 'csv' | 'json' = 'csv'): Promise<ImportTextResult> {
    const path = await this.deps.pickOpenPath(kind)
    if (path === null) return { status: 'canceled' }
    try {
      const { size } = await this.deps.fs.stat(path)
      if (size > MAX_IMPORT_BYTES) {
        return { status: 'error', message: `파일이 너무 큽니다(${Math.round(size / 1024 / 1024)} MB). 최대 ${MAX_IMPORT_BYTES / 1024 / 1024} MB까지 가져올 수 있습니다.` }
      }
      return { status: 'opened', fileName: basename(path), content: await this.deps.fs.readFile(path) }
    } catch (e) {
      return { status: 'error', message: `파일을 읽지 못했습니다: ${message(e)}` }
    }
  }
}
