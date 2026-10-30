import type { ModelEntry } from '../catalog'
import { CsvError, detectDelimiter, parseCsv } from '../../../shared/csv'

export interface RefColumn {
  name: string
  /** 시간 오름차순 [시각, 값] */
  points: [number, number][]
}

export interface ParsedReference {
  timeHeader: string
  columns: RefColumn[]
  /** 숫자 값이 하나도 없어 제외한 열 */
  emptyColumns: string[]
}

export const MAX_REFERENCE_ROWS = 100_000
export const MAX_REFERENCE_COLUMNS = 50

export class ReferenceCsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceCsvError'
  }
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

export function toNumber(raw: string, decimalComma: boolean): number | null {
  const t = (decimalComma ? raw.trim().replace(',', '.') : raw.trim())
  return NUMBER.test(t) ? Number(t) : null
}

/**
 * 외부 기준 행동 CSV를 읽는다. 첫 줄은 열 이름, 첫 열은 시간(일), 나머지 열은 각각 하나의 시계열이다.
 * 빈 칸은 그 시점의 값이 없는 것으로 보고 건너뛰며, 숫자가 아닌 값은 위치와 함께 오류로 알린다.
 */
export function parseReferenceCsv(text: string): ParsedReference {
  let rows: string[][]
  const delimiter = detectDelimiter(text)
  try {
    rows = parseCsv(text, delimiter)
  } catch (e) {
    if (e instanceof CsvError) throw new ReferenceCsvError(e.message)
    throw e
  }
  if (rows.length < 2) throw new ReferenceCsvError('열 이름 줄과 데이터가 한 줄 이상 있어야 합니다.')
  const header = rows[0] as string[]
  if (header.length < 2) throw new ReferenceCsvError('시간 열과 값 열이 최소 한 개씩 필요합니다. 구분자(쉼표 등)를 확인하세요.')
  if (header.length - 1 > MAX_REFERENCE_COLUMNS) {
    throw new ReferenceCsvError(`열이 너무 많습니다(최대 ${MAX_REFERENCE_COLUMNS}개).`)
  }
  if (rows.length - 1 > MAX_REFERENCE_ROWS) {
    throw new ReferenceCsvError(`행이 너무 많습니다(최대 ${MAX_REFERENCE_ROWS.toLocaleString('ko-KR')}행).`)
  }

  // 열 이름: 비어 있으면 "열 N", 중복되면 "이름 (2)"
  const seen = new Map<string, number>()
  const names = header.slice(1).map((h, i) => {
    const base = h.trim() || `열 ${i + 2}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })

  const decimalComma = delimiter === ';'
  const columns: RefColumn[] = names.map((name) => ({ name, points: [] }))
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r] as string[]
    const t = toNumber(cells[0] ?? '', decimalComma)
    if (t === null) {
      throw new ReferenceCsvError(`데이터 ${r}번째 행: 시간 값 '${(cells[0] ?? '').trim()}'이(가) 숫자가 아닙니다.`)
    }
    for (let c = 0; c < columns.length; c++) {
      const raw = (cells[c + 1] ?? '').trim()
      if (raw === '') continue
      const v = toNumber(raw, decimalComma)
      if (v === null) {
        throw new ReferenceCsvError(`데이터 ${r}번째 행, '${names[c]}' 열: '${raw}'이(가) 숫자가 아닙니다.`)
      }
      ;(columns[c] as RefColumn).points.push([t, v])
    }
  }

  const withData = columns.filter((c) => c.points.length > 0)
  if (withData.length === 0) throw new ReferenceCsvError('숫자 데이터가 있는 열이 없습니다.')
  for (const c of withData) c.points.sort((a, b) => a[0] - b[0])
  return {
    timeHeader: header[0]?.trim() ?? '',
    columns: withData,
    emptyColumns: columns.filter((c) => c.points.length === 0).map((c) => c.name)
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** 열 이름을 모델 변수와 연결한다. 변수 이름, 표시 이름, "표시 이름 (단위)"를 대소문자와 공백을 무시하고 비교한다. */
export function matchVariable(entry: ModelEntry, header: string): string | null {
  const stripped = norm(header.replace(/\s*\([^)]*\)\s*$/, ''))
  const full = norm(header)
  for (const v of entry.variables) {
    const keys = [norm(v.name), norm(v.label), norm(`${v.label} (${v.unit})`)]
    if (keys.includes(full) || keys.includes(stripped)) return v.name
  }
  return null
}
