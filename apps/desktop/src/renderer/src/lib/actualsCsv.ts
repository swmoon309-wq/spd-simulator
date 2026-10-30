import { MAX_ACTUAL_ROWS, type ActualRow, type EvmPoint } from '@spd/analysis'
import type { ModelEntry } from '../catalog'
import { CsvError, detectDelimiter, formatCsv, parseCsv } from '../../../shared/csv'
import { toNumber } from './referenceCsv'

export class ActualsCsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActualsCsvError'
  }
}

export interface ParsedActuals {
  rows: ActualRow[]
  /** 어느 열로도 쓰지 않아 무시한 열 이름 */
  ignored: string[]
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const strip = (s: string) => norm(s.replace(/\s*\([^)]*\)\s*$/, ''))

const EFFORT_NAMES = ['effort', '누적 공수', '공수', 'ac']
const HEADCOUNT_NAMES = ['headcount', '투입 인원', '인원']
const DEFECT_NAMES = ['defects', '누적 결함', '결함']
const NOTE_NAMES = ['note', '메모']
/** 내보내기가 덧붙이는 계산 열. 다시 가져올 때 조용히 건너뛴다. */
const COMPUTED_NAMES = ['pv', 'ev', 'cv', 'sv', 'cpi', 'spi', 'progress', '진척률']

type Target = { kind: 'cum'; variable: string } | { kind: 'effort' } | { kind: 'headcount' } | { kind: 'defects' } | { kind: 'note' } | { kind: 'computed' }

/** 열 이름을 실적 열에 맞춘다. 단계 변수는 이름 또는 라벨, 대소문자·공백·"(단위)"를 무시한다. */
function matchColumn(entry: ModelEntry, header: string): Target | null {
  const keys = [norm(header), strip(header)]
  const any = (names: string[]) => names.some((n) => keys.includes(n))
  for (const c of entry.evm?.credits ?? []) {
    if (keys.includes(norm(c.variable)) || keys.includes(norm(c.label))) return { kind: 'cum', variable: c.variable }
  }
  if (any(EFFORT_NAMES)) return { kind: 'effort' }
  if (any(HEADCOUNT_NAMES)) return { kind: 'headcount' }
  if (any(DEFECT_NAMES)) return { kind: 'defects' }
  if (any(NOTE_NAMES)) return { kind: 'note' }
  if (any(COMPUTED_NAMES)) return { kind: 'computed' }
  return null
}

/**
 * 실적 CSV를 읽는다(설계 05의 4.3). 첫 줄은 열 이름, 첫 열은 보고일(day). 값은 누적이다. 맞지 않는 열은 무시하고
 * 알린다. 숫자가 아닌 값은 행·열을 알려 거부한다. 단계 열이 비어 있으면 그 단계는 비운 채 두어 검증이 경고한다.
 */
export function parseActualsCsv(text: string, entry: ModelEntry): ParsedActuals {
  let table: string[][]
  const delimiter = detectDelimiter(text)
  try {
    table = parseCsv(text, delimiter)
  } catch (e) {
    if (e instanceof CsvError) throw new ActualsCsvError(e.message)
    throw e
  }
  if (table.length < 2) throw new ActualsCsvError('열 이름 줄과 데이터가 한 줄 이상 있어야 합니다.')
  if (table.length - 1 > MAX_ACTUAL_ROWS) throw new ActualsCsvError(`행이 너무 많습니다(최대 ${MAX_ACTUAL_ROWS}행).`)
  const header = table[0] as string[]
  if (header.length < 2) throw new ActualsCsvError('보고일 열과 값 열이 필요합니다. 구분자(쉼표 등)를 확인하세요.')

  const targets: (Target | null)[] = header.slice(1).map((h) => matchColumn(entry, h))
  const ignored = header.slice(1).filter((_, i) => targets[i] === null).map((h) => h.trim() || '(이름 없음)')
  if (!targets.some((t) => t?.kind === 'effort')) throw new ActualsCsvError("누적 공수 열('effort' 또는 '누적 공수')이 없습니다.")
  if (!targets.some((t) => t?.kind === 'cum')) throw new ActualsCsvError(`단계별 누적 태스크 열이 없습니다. 열 이름은 ${(entry.evm?.credits ?? []).map((c) => `'${c.label}'`).join(', ')} 중 하나여야 합니다.`)
  const seen = new Set<string>()
  for (const t of targets) {
    if (!t || t.kind === 'computed') continue
    const key = t.kind === 'cum' ? t.variable : t.kind
    if (seen.has(key)) throw new ActualsCsvError(`같은 항목에 해당하는 열이 둘 이상입니다(${key}).`)
    seen.add(key)
  }

  const decimalComma = delimiter === ';'
  const rows: ActualRow[] = []
  for (let r = 1; r < table.length; r++) {
    const cells = table[r] as string[]
    const num = (raw: string, where: string): number => {
      const v = toNumber(raw, decimalComma)
      if (v === null) throw new ActualsCsvError(`데이터 ${r}번째 행, ${where}: '${raw.trim()}'이(가) 숫자가 아닙니다.`)
      return v
    }
    const dayRaw = (cells[0] ?? '').trim()
    if (dayRaw === '') throw new ActualsCsvError(`데이터 ${r}번째 행: 보고일이 비어 있습니다.`)
    const row: ActualRow = { day: num(dayRaw, '보고일'), cum: {}, effort: 0 }
    targets.forEach((t, i) => {
      if (!t || t.kind === 'computed') return
      const raw = (cells[i + 1] ?? '').trim()
      const name = `'${(header[i + 1] as string).trim()}' 열`
      if (t.kind === 'note') {
        if (raw !== '') row.note = raw
        return
      }
      if (raw === '') {
        if (t.kind === 'effort') throw new ActualsCsvError(`데이터 ${r}번째 행, ${name}: 누적 공수가 비어 있습니다.`)
        return
      }
      const v = num(raw, name)
      if (t.kind === 'cum') row.cum[t.variable] = v
      else if (t.kind === 'effort') row.effort = v
      else if (t.kind === 'headcount') row.headcount = v
      else row.defects = v
    })
    rows.push(row)
  }
  return { rows, ignored }
}

export type MergeMode = 'append' | 'replace'

/**
 * 가져온 실적을 기존 실적과 합친다. 덧붙이기는 같은 보고일을 새 값으로 덮고 보고일 순서로 정렬한다.
 * 합친 행이 한도를 넘으면 null.
 */
export function mergeActuals(existing: ActualRow[], incoming: ActualRow[], mode: MergeMode): ActualRow[] | null {
  if (mode === 'replace') return incoming.length > MAX_ACTUAL_ROWS ? null : incoming
  const days = new Set(incoming.map((r) => r.day))
  const out = [...existing.filter((r) => !days.has(r.day)), ...incoming]
  out.sort((a, b) => a.day - b.day)
  return out.length > MAX_ACTUAL_ROWS ? null : out
}

/** 증분 입력: 이전 누적에 더해 누적 행을 만든다. 첫 줄은 0에서 센다. */
export interface ActualIncrement {
  /** 이전 보고일로부터 지난 일수 */
  days: number
  /** 단계별 이번 구간의 완료 태스크 */
  cum: Record<string, number>
  effort: number
  headcount?: number
  defects?: number
}

export function applyIncrement(last: ActualRow | undefined, inc: ActualIncrement, credits: { variable: string }[]): ActualRow {
  const cum: Record<string, number> = {}
  for (const c of credits) cum[c.variable] = (last?.cum[c.variable] ?? 0) + (inc.cum[c.variable] ?? 0)
  const row: ActualRow = { day: (last?.day ?? 0) + inc.days, cum, effort: (last?.effort ?? 0) + inc.effort }
  if (inc.headcount !== undefined) row.headcount = inc.headcount // 인원은 시점 값이라 더하지 않는다
  if (inc.defects !== undefined || last?.defects !== undefined) row.defects = (last?.defects ?? 0) + (inc.defects ?? 0)
  return row
}

const round4 = (x: number) => Number(x.toFixed(4))

/** 실적 표(입력 + 계산 열)를 CSV로 만든다. 오류 행은 입력만 쓰고 계산 열은 비운다. */
export function actualsToCsv(entry: ModelEntry, rows: ActualRow[], points: EvmPoint[]): string {
  const byIndex = new Map(points.map((p) => [p.index, p]))
  const credits = entry.evm?.credits ?? []
  const header = ['day', ...credits.map((c) => c.label), 'effort', 'headcount', 'defects', 'note', 'progress', 'PV', 'EV', 'CV', 'SV', 'CPI', 'SPI']
  const body = rows.map((r, i) => {
    const p = byIndex.get(i)
    return [
      r.day,
      ...credits.map((c) => r.cum[c.variable]),
      r.effort,
      r.headcount,
      r.defects,
      r.note,
      p ? round4(p.progress) : null,
      p ? round4(p.pv) : null,
      p ? round4(p.ev) : null,
      p ? round4(p.cv) : null,
      p ? round4(p.sv) : null,
      p?.cpi != null ? round4(p.cpi) : null,
      p?.spi != null ? round4(p.spi) : null
    ]
  })
  return formatCsv([header, ...body])
}

export const actualsFileName = (entry: ModelEntry): string => `실적-${entry.id}.csv`
