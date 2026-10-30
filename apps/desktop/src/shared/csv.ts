export class CsvError extends Error {
  /** 1부터 시작하는 행 번호(알 수 있을 때) */
  readonly row?: number

  constructor(message: string, row?: number) {
    super(row === undefined ? message : `${row}행: ${message}`)
    this.name = 'CsvError'
    if (row !== undefined) this.row = row
  }
}

export type Cell = string | number | null | undefined

const NEEDS_QUOTE = /[",\r\n]/

function formatCell(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : ''
  return NEEDS_QUOTE.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/**
 * CSV 텍스트를 만든다(RFC 4180). 줄 끝은 CRLF, 숫자는 로케일과 무관하게 `.` 소수점과 전체 자릿수로 쓰고,
 * 한글이 Excel에서 깨지지 않도록 UTF-8 BOM을 붙인다. 유한하지 않은 수와 null은 빈 칸이다.
 */
export function formatCsv(rows: Cell[][]): string {
  return '﻿' + rows.map((r) => r.map(formatCell).join(',')).join('\r\n') + '\r\n'
}

/** 첫 줄에서 가장 많이 나타나는 구분자(쉼표, 세미콜론, 탭)를 고른다. 따옴표 안은 세지 않는다. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.replace(/^﻿/, '').split(/\r\n|\n|\r/, 1)[0] ?? ''
  const counts = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (const ch of first) {
    if (ch === '"') quoted = !quoted
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';'
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t'
  return ','
}

/**
 * CSV를 행렬로 읽는다. 따옴표 필드(줄바꿈 포함, `""` 이스케이프), CRLF/LF/CR, BOM을 처리하고
 * 완전히 빈 줄은 건너뛴다. 닫히지 않은 따옴표는 `CsvError`.
 */
export function parseCsv(text: string, delimiter: string = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  let line = 1

  const endField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i)
    if (quoted) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          field += '"'
          i++
        } else quoted = false
      } else {
        if (ch === '\n') line++
        field += ch
      }
      continue
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
    } else if (ch === delimiter) {
      endField()
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src.charAt(i + 1) === '\n') i++
      endRow()
      line++
    } else {
      field += ch
      fieldStarted = true
    }
  }
  if (quoted) throw new CsvError('따옴표가 닫히지 않았습니다', line)
  if (fieldStarted || field !== '' || row.length > 0) endRow()
  return rows
}
