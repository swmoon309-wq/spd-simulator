import { CsvError, detectDelimiter, parseCsv } from '../../../shared/csv'
import { toNumber } from './referenceCsv'

export class PlanCurveCsvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanCurveCsvError'
  }
}

/** 계획서의 계획 곡선(CSV)으로 만든 기준선 재료(CTL-11, 설계 05의 3.1). 1일 간격으로 다시 표본화한 값이다. */
export interface PlanCurve {
  bac: number
  plannedCompletion: number
  series: { time: number[]; progress: number[]; effort: number[] }
  /** 진척률 열이 있었는가(없으면 진척률 = 누적 공수 ÷ 총 예산) */
  hasProgress: boolean
  /** 읽은 데이터 행 수 */
  rows: number
  /** 어느 열로도 쓰지 않아 무시한 열 이름 */
  ignored: string[]
  /** 가져와도 되지만 알아야 하는 것 */
  warnings: string[]
}

/** 기준선 한 개의 점 수 한도(`shared/projectFile.ts`의 MAX_BASELINE_POINTS) 안에서 1일 간격으로 쓸 수 있는 가장 긴 계획 일수 */
const MAX_DAYS = 4999
const EPS = 1e-9

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const unit = (s: string) => /\(\s*(%|퍼센트)\s*\)\s*$/.test(s.trim()) || /%\s*$/.test(s.trim())
const strip = (s: string) => norm(s.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*%\s*$/, ''))

const EFFORT_NAMES = ['effort', 'pv', '누적 공수', '계획 공수', '공수', '계획 누적 공수', 'planned effort', 'planned value']
const PROGRESS_NAMES = ['progress', '진척률', '진척', '계획 진척률', '누적 진척률', 'planned progress']

/**
 * 계획 곡선 CSV를 읽는다. 첫 줄은 열 이름, 첫 열은 일(day). 값은 **누적**이다.
 * - 누적 공수 열('effort', '누적 공수', 'PV' 등)은 필수다. 마지막 값이 총 예산(BAC)이다.
 * - 진척률 열('progress', '진척률')은 선택이다. 없으면 진척률을 누적 공수 ÷ 총 예산으로 둔다(비용 정렬, 설계 05의 2.2).
 *   열 이름 끝에 `%`가 있으면 백분율, 없으면 0~1의 비율로 읽는다.
 * - 첫 일이 0보다 크면 0일(공수 0, 진척률 0)을 앞에 붙인다. 일은 엄격히 증가해야 하고 값은 줄어들 수 없다.
 * 계획 완료일은 누적 공수가 총 예산에 처음 닿는 시각이다. 1일 간격으로 선형 보간해 다시 표본화한다.
 */
export function parsePlanCurveCsv(text: string): PlanCurve {
  const delimiter = detectDelimiter(text)
  let table: string[][]
  try {
    table = parseCsv(text, delimiter)
  } catch (e) {
    if (e instanceof CsvError) throw new PlanCurveCsvError(e.message)
    throw e
  }
  if (table.length < 2) throw new PlanCurveCsvError('열 이름 줄과 데이터가 한 줄 이상 있어야 합니다.')
  const header = table[0] as string[]
  if (header.length < 2) throw new PlanCurveCsvError('일 열과 값 열이 필요합니다. 구분자(쉼표 등)를 확인하세요.')

  let effortCol = -1
  let progressCol = -1
  let percent = false
  const ignored: string[] = []
  header.slice(1).forEach((h, k) => {
    const col = k + 1
    const keys = [norm(h), strip(h)]
    if (keys.some((x) => EFFORT_NAMES.includes(x))) {
      if (effortCol >= 0) throw new PlanCurveCsvError('누적 공수에 해당하는 열이 둘 이상입니다.')
      effortCol = col
    } else if (keys.some((x) => PROGRESS_NAMES.includes(x))) {
      if (progressCol >= 0) throw new PlanCurveCsvError('진척률에 해당하는 열이 둘 이상입니다.')
      progressCol = col
      percent = unit(h)
    } else ignored.push(h.trim() || '(이름 없음)')
  })
  if (effortCol < 0) throw new PlanCurveCsvError("누적 공수 열('effort', '누적 공수', 'PV')이 없습니다.")

  const decimalComma = delimiter === ';'
  const warnings: string[] = []
  const points: { day: number; effort: number; progress: number | null }[] = []
  for (let r = 1; r < table.length; r++) {
    const cells = table[r] as string[]
    if (cells.every((c) => c.trim() === '')) continue
    const num = (raw: string, where: string): number => {
      const v = toNumber(raw, decimalComma)
      if (v === null) throw new PlanCurveCsvError(`데이터 ${r}번째 행, ${where}: '${raw.trim()}'이(가) 숫자가 아닙니다.`)
      return v
    }
    const dayRaw = (cells[0] ?? '').trim()
    if (dayRaw === '') throw new PlanCurveCsvError(`데이터 ${r}번째 행: 일이 비어 있습니다.`)
    const effortRaw = (cells[effortCol] ?? '').trim()
    if (effortRaw === '') throw new PlanCurveCsvError(`데이터 ${r}번째 행, '${(header[effortCol] as string).trim()}' 열: 누적 공수가 비어 있습니다.`)
    let progress: number | null = null
    if (progressCol >= 0) {
      const raw = (cells[progressCol] ?? '').trim()
      if (raw === '') throw new PlanCurveCsvError(`데이터 ${r}번째 행, '${(header[progressCol] as string).trim()}' 열: 진척률이 비어 있습니다.`)
      const v = num(raw, `'${(header[progressCol] as string).trim()}' 열`)
      progress = percent ? v / 100 : v
      if (progress > 1 + 1e-6) throw new PlanCurveCsvError(`데이터 ${r}번째 행, 진척률 ${raw}이(가) 100%를 넘습니다. 백분율이면 열 이름 끝에 %를 붙이세요(예: 진척률(%)).`)
    }
    points.push({ day: num(dayRaw, '일'), effort: num(effortRaw, `'${(header[effortCol] as string).trim()}' 열`), progress })
  }
  if (points.length === 0) throw new PlanCurveCsvError('데이터가 없습니다.')

  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { day: number; effort: number; progress: number | null }
    const at = `데이터 ${i + 1}번째 행`
    if (p.day < 0) throw new PlanCurveCsvError(`${at}: 일은 0 이상이어야 합니다.`)
    if (p.effort < 0 || (p.progress !== null && p.progress < 0)) throw new PlanCurveCsvError(`${at}: 누적 공수와 진척률은 음수일 수 없습니다.`)
    const prev = points[i - 1]
    if (prev) {
      if (!(p.day > prev.day)) throw new PlanCurveCsvError(`${at}: 일(${p.day})이 앞 행(${prev.day})보다 커야 합니다.`)
      if (p.effort < prev.effort - EPS) throw new PlanCurveCsvError(`${at}: 누적 공수가 줄었습니다(${prev.effort} → ${p.effort}). 누적 값이어야 합니다.`)
      if (p.progress !== null && prev.progress !== null && p.progress < prev.progress - EPS) throw new PlanCurveCsvError(`${at}: 진척률이 줄었습니다. 누적 값이어야 합니다.`)
    }
  }

  const first = points[0] as { day: number; effort: number; progress: number | null }
  if (first.day > 0) {
    points.unshift({ day: 0, effort: 0, progress: progressCol >= 0 ? 0 : null })
    warnings.push(`첫 일이 ${first.day}일이라 0일(공수 0, 진척률 0)을 앞에 붙였습니다.`)
  }
  const last = points[points.length - 1] as { day: number; effort: number; progress: number | null }
  if (points.length < 2) throw new PlanCurveCsvError('일이 서로 다른 두 점 이상이 필요합니다.')
  const bac = last.effort
  if (!(bac > 0)) throw new PlanCurveCsvError('마지막 누적 공수(총 예산)가 0입니다.')
  if (last.day > MAX_DAYS) throw new PlanCurveCsvError(`계획 기간이 너무 깁니다(최대 ${MAX_DAYS}일).`)
  if (last.progress !== null && last.progress < 1 - 1e-6) warnings.push(`마지막 진척률이 ${(last.progress * 100).toFixed(1)}%입니다. 계획이 끝까지 가지 않으면 완료 판정과 EV가 어긋날 수 있습니다.`)
  if (last.progress !== null && last.progress > 1 + 1e-6) throw new PlanCurveCsvError('마지막 진척률이 100%를 넘습니다.')

  // 누적 공수가 총 예산에 처음 닿는 시각(보간) = 계획 완료일
  let plannedCompletion = last.day
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as (typeof points)[number]
    const b = points[i] as (typeof points)[number]
    if (b.effort >= bac - EPS * Math.max(1, bac)) {
      plannedCompletion = b.effort - a.effort <= EPS ? b.day : a.day + ((bac - a.effort) / (b.effort - a.effort)) * (b.day - a.day)
      break
    }
  }
  if (plannedCompletion < last.day - EPS) warnings.push(`누적 공수가 ${plannedCompletion.toFixed(1)}일에 총 예산에 닿고 이후는 평평합니다. 계획 완료일은 ${plannedCompletion.toFixed(1)}일입니다.`)

  const times: number[] = []
  for (let t = 0; t <= last.day + EPS; t++) times.push(t)
  if (last.day - Math.floor(last.day) > EPS) times.push(last.day)
  const at = (t: number, pick: (p: (typeof points)[number]) => number): number => {
    let hi = points.findIndex((p) => p.day >= t - EPS)
    if (hi < 0) hi = points.length - 1
    const b = points[hi] as (typeof points)[number]
    if (hi === 0 || b.day <= t + EPS) return pick(b)
    const a = points[hi - 1] as (typeof points)[number]
    return pick(a) + ((pick(b) - pick(a)) * (t - a.day)) / (b.day - a.day)
  }
  const round6 = (x: number) => Number(x.toFixed(6))
  const effort = times.map((t) => round6(at(t, (p) => p.effort)))
  const progress = times.map((t, i) => round6(progressCol >= 0 ? at(t, (p) => p.progress as number) : (effort[i] as number) / bac))
  return { bac: round6(bac), plannedCompletion: round6(plannedCompletion), series: { time: times, progress, effort }, hasProgress: progressCol >= 0, rows: table.length - 1, ignored, warnings }
}
