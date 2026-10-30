import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { csvFileName, htmlFileName, jsonFileName, markdownFileName, MAX_IMPORT_BYTES, TextFileService } from './textFileService'

let dir: string
let saveAnswer: string | null
let openAnswer: string | null
let savedNames: string[]
let savedKinds: string[]
let openedKinds: string[]

const service = (overrideFs: Partial<Parameters<typeof make>[0]> = {}) => make(overrideFs)
function make(fsOverride: { writeFile?: (p: string, d: string) => Promise<void> } = {}) {
  return new TextFileService({
    pickSavePath: async (n, kind) => (savedNames.push(n), savedKinds.push(kind), saveAnswer),
    pickOpenPath: async (kind) => (openedKinds.push(kind), openAnswer),
    fs: {
      readFile: (p) => fsp.readFile(p, 'utf-8'),
      writeFile: fsOverride.writeFile ?? ((p, d) => fsp.writeFile(p, d, 'utf-8')),
      rename: fsp.rename,
      rm: (p) => fsp.rm(p),
      stat: fsp.stat
    }
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spd-csv-'))
  saveAnswer = null
  openAnswer = null
  savedNames = []
  savedKinds = []
  openedKinds = []
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('csvFileName', () => {
  it('경로에 쓸 수 없는 문자를 바꾸고 .csv를 보장한다', () => {
    expect(csvFileName('brooks-run1')).toBe('brooks-run1.csv')
    expect(csvFileName('a/b:c.CSV')).toBe('a_b_c.CSV')
    expect(csvFileName('  ')).toBe('export.csv')
  })
})

describe('exportCsv', () => {
  it('대화상자에서 고른 경로에 내용 그대로 쓰고 제안 이름은 .csv로 맞춘다', async () => {
    saveAnswer = join(dir, 'out.csv')
    const content = '﻿time,x\r\n0,1\r\n'
    expect(await service().exportCsv('brooks run', content)).toEqual({ status: 'saved', fileName: 'out.csv' })
    expect(savedNames).toEqual(['brooks run.csv'])
    expect(await readFile(saveAnswer, 'utf-8')).toBe(content)
    expect(await readdir(dir)).toEqual(['out.csv'])
  })

  it('확장자를 빼고 골라도 .csv를 붙인다', async () => {
    saveAnswer = join(dir, 'out')
    expect(await service().exportCsv('x', 'a')).toMatchObject({ fileName: 'out.csv' })
  })

  it('취소하면 아무것도 쓰지 않는다', async () => {
    expect(await service().exportCsv('x', 'a')).toEqual({ status: 'canceled' })
    expect(await readdir(dir)).toEqual([])
  })

  it('쓰기 실패 시 오류를 알리고 임시 파일을 남기지 않는다', async () => {
    saveAnswer = join(dir, 'out.csv')
    const failing = service({ writeFile: async (p) => (await writeFile(p, 'partial'), Promise.reject(new Error('디스크 가득 참'))) })
    const r = await failing.exportCsv('x', 'a')
    expect(r).toMatchObject({ status: 'error', message: expect.stringContaining('디스크 가득 참') })
    expect(await readdir(dir)).toEqual([])
  })

  it('없는 폴더에 저장하면 오류', async () => {
    saveAnswer = join(dir, 'nope', 'out.csv')
    expect((await service().exportCsv('x', 'a')).status).toBe('error')
  })
})

describe('importText', () => {
  it('고른 파일의 내용과 이름을 돌려준다', async () => {
    openAnswer = join(dir, 'ref.csv')
    await writeFile(openAnswer, 't,x\n0,1\n')
    expect(await service().importText()).toEqual({ status: 'opened', fileName: 'ref.csv', content: 't,x\n0,1\n' })
  })

  it('취소하면 canceled', async () => {
    expect(await service().importText()).toEqual({ status: 'canceled' })
  })

  it('너무 큰 파일은 읽지 않는다', async () => {
    openAnswer = join(dir, 'big.csv')
    await writeFile(openAnswer, ' '.repeat(MAX_IMPORT_BYTES + 1))
    expect(await service().importText()).toMatchObject({ status: 'error', message: expect.stringContaining('너무 큽니다') })
  })

  it('없는 파일은 읽기 오류', async () => {
    openAnswer = join(dir, 'missing.csv')
    expect(await service().importText()).toMatchObject({ status: 'error', message: expect.stringContaining('읽지 못했습니다') })
  })
})

describe('markdownFileName', () => {
  it('경로에 쓸 수 없는 문자를 바꾸고 .md를 보장한다', () => {
    expect(markdownFileName('검증 기록')).toBe('검증 기록.md')
    expect(markdownFileName('a/b:c.MD')).toBe('a_b_c.MD')
    expect(markdownFileName('  ')).toBe('export.md')
  })
})

describe('exportMarkdown', () => {
  it('마크다운 형식으로 대화상자를 열고 .md 파일에 쓴다', async () => {
    saveAnswer = join(dir, 'record.md')
    const content = '# 검증 기록\n\n| a | b |\n'
    expect(await service().exportMarkdown('검증 기록', content)).toEqual({ status: 'saved', fileName: 'record.md' })
    expect(await readFile(join(dir, 'record.md'), 'utf-8')).toBe(content)
    expect(savedNames).toEqual(['검증 기록.md'])
    expect(savedKinds).toEqual(['md'])
  })
  it('CSV 내보내기는 csv 형식으로 연다', async () => {
    saveAnswer = join(dir, 'a.csv')
    await service().exportCsv('x', 'a')
    expect(savedKinds).toEqual(['csv'])
  })
  it('확장자가 없으면 .md를 붙인다', async () => {
    saveAnswer = join(dir, 'noext')
    expect(await service().exportMarkdown('x', 'a')).toMatchObject({ fileName: 'noext.md' })
    expect((await readdir(dir)).sort()).toEqual(['noext.md'])
  })
  it('취소하면 파일을 만들지 않는다', async () => {
    saveAnswer = null
    expect(await service().exportMarkdown('x', 'a')).toEqual({ status: 'canceled' })
    expect(await readdir(dir)).toEqual([])
  })
  it('쓰기에 실패하면 오류를 알리고 남은 파일이 없다', async () => {
    saveAnswer = join(dir, 'fail.md')
    const failing = service({ writeFile: async () => { throw new Error('디스크가 가득 참') } })
    const r = await failing.exportMarkdown('x', 'a')
    expect(r).toMatchObject({ status: 'error' })
    expect(await readdir(dir)).toEqual([])
  })
})

describe('jsonFileName', () => {
  it('경로에 쓸 수 없는 문자를 바꾸고 .json을 보장한다', () => {
    expect(jsonFileName('프리셋')).toBe('프리셋.json')
    expect(jsonFileName('a/b:c.JSON')).toBe('a_b_c.JSON')
    expect(jsonFileName('  ')).toBe('export.json')
  })
})

describe('exportJson·importText(json)', () => {
  it('JSON 형식으로 대화상자를 열고 .json 파일에 쓴다', async () => {
    saveAnswer = join(dir, 'presets.json')
    const content = JSON.stringify({ kind: 'spd-presets', presets: [] }, null, 2)
    expect(await service().exportJson('프리셋', content)).toEqual({ status: 'saved', fileName: 'presets.json' })
    expect(await readFile(join(dir, 'presets.json'), 'utf-8')).toBe(content)
    expect(savedNames).toEqual(['프리셋.json'])
    expect(savedKinds).toEqual(['json'])
  })
  it('확장자가 없으면 붙이고, 취소하면 쓰지 않으며, 실패하면 남은 파일이 없다', async () => {
    saveAnswer = join(dir, 'noext')
    expect(await service().exportJson('x', '{}')).toMatchObject({ fileName: 'noext.json' })
    saveAnswer = null
    expect(await service().exportJson('x', '{}')).toEqual({ status: 'canceled' })
    saveAnswer = join(dir, 'fail.json')
    const failing = service({ writeFile: async () => { throw new Error('디스크가 가득 참') } })
    expect(await failing.exportJson('x', '{}')).toMatchObject({ status: 'error' })
    expect((await readdir(dir)).sort()).toEqual(['noext.json'])
  })
  it('가져오기는 형식 필터를 전달하고 파일 내용을 읽는다(기본은 csv)', async () => {
    await writeFile(join(dir, 'p.json'), '{"a":1}', 'utf-8')
    openAnswer = join(dir, 'p.json')
    expect(await service().importText('json')).toEqual({ status: 'opened', fileName: 'p.json', content: '{"a":1}' })
    await service().importText()
    expect(openedKinds).toEqual(['json', 'csv'])
  })
})

describe('보고서 HTML 저장 (RPT-05)', () => {
  it('파일 이름은 경로 문자를 바꾸고 .html을 보장한다', () => {
    expect(htmlFileName('내 프로젝트 계획서')).toBe('내 프로젝트 계획서.html')
    expect(htmlFileName('a/b:c.HTML')).toBe('a_b_c.HTML')
    expect(htmlFileName('x.htm')).toBe('x.htm')
    expect(htmlFileName('  ')).toBe('report.html')
  })

  it('고른 경로에 쓰고 파일 이름만 돌려준다. 확장자가 없으면 .html을 붙인다', async () => {
    saveAnswer = join(dir, '보고서')
    const r = await service().exportHtml('내 보고서', '<!doctype html><p>안녕</p>')
    expect(r).toEqual({ status: 'saved', fileName: '보고서.html' })
    expect(savedKinds).toEqual(['html'])
    expect(await readFile(join(dir, '보고서.html'), 'utf-8')).toBe('<!doctype html><p>안녕</p>')
    expect(await readdir(dir)).toEqual(['보고서.html']) // 임시 파일이 남지 않는다
  })

  it('저장 대화상자를 취소하면 아무것도 쓰지 않는다', async () => {
    expect(await service().exportHtml('x', '<p/>')).toEqual({ status: 'canceled' })
    expect(await readdir(dir)).toEqual([])
  })

  it('20 MB를 넘으면 거절하고 대화상자도 열지 않는다', async () => {
    const r = await service().exportHtml('x', 'a'.repeat(20 * 1024 * 1024 + 1))
    expect(r).toMatchObject({ status: 'error' })
    expect(savedNames).toEqual([])
  })

  it('쓰기에 실패하면 이유를 알린다', async () => {
    saveAnswer = join(dir, 'r.html')
    const r = await service({ writeFile: async () => { throw new Error('디스크 오류') } }).exportHtml('x', '<p/>')
    expect(r).toEqual({ status: 'error', message: '저장하지 못했습니다: 디스크 오류' })
  })
})
