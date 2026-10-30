import { evAt, pvAt, type Baseline, type EvmCredit } from './baseline'
import { DEFAULT_WINDOW, indicators, windowIndices, type Cumulative, type Indicators } from './indicators'

/** 실적 한 줄(보고일). 값은 모두 **누적**이다. 설계 05의 4.1. */
export interface ActualRow {
  /** 보고 시각(프로젝트 시작 후 일수) */
  day: number
  /** 단계별 누적 완료 태스크. 키는 어댑터 credits의 변수 이름 */
  cum: Record<string, number>
  /** 누적 투입 공수(맨데이) */
  effort: number
  /** 투입 인원(명), 선택 */
  headcount?: number
  /** 누적 발견 결함, 선택 */
  defects?: number
  note?: string
}

export const MAX_ACTUAL_ROWS = 400
export const MAX_ACTUAL_NOTE = 200
/** 개발 완료가 총 태스크의 이 배수를 넘으면 범위 증가를 의심한다 */
export const SCOPE_WARNING_FACTOR = 1.5

export interface RowIssues {
  /** 오류가 있으면 저장·계산에서 제외한다 */
  errors: string[]
  warnings: string[]
}

const bad = (x: unknown): boolean => typeof x !== 'number' || !Number.isFinite(x) || x < 0

/**
 * 실적 행을 검사한다(설계 05의 4.2). 오류가 있는 행은 계산에서 빠지지만 다른 행을 막지 않는다. 결과는 `rows`와 같은 길이.
 * 순서 검사(day 증가, 누적 감소)는 이전의 **오류 없는** 행과 비교한다.
 */
export function validateActuals(rows: ActualRow[], credits: EvmCredit[], totalTasks: number): RowIssues[] {
  const out: RowIssues[] = []
  let prev: ActualRow | null = null
  rows.forEach((row, i) => {
    const errors: string[] = []
    const warnings: string[] = []
    if (i >= MAX_ACTUAL_ROWS) errors.push(`행은 최대 ${MAX_ACTUAL_ROWS}개입니다`)
    if (bad(row.day)) errors.push('보고일은 0 이상의 수여야 합니다')
    else if (prev && !(row.day > prev.day)) errors.push(`보고일은 이전 행(${prev.day}일)보다 커야 합니다`)
    if (bad(row.effort)) errors.push('누적 공수는 0 이상의 수여야 합니다')
    for (const c of credits) {
      const v = row.cum[c.variable]
      if (v === undefined) {
        if (c.weight > 0) warnings.push(`'${c.variable}'이(가) 비어 있어 0으로 계산합니다`)
      } else if (bad(v)) errors.push(`'${c.variable}'은(는) 0 이상의 수여야 합니다`)
    }
    if (row.headcount !== undefined && bad(row.headcount)) errors.push('투입 인원은 0 이상의 수여야 합니다')
    if (row.defects !== undefined && bad(row.defects)) errors.push('누적 결함은 0 이상의 수여야 합니다')
    if ((row.note ?? '').length > MAX_ACTUAL_NOTE) errors.push(`메모는 ${MAX_ACTUAL_NOTE}자 이하여야 합니다`)

    if (errors.length === 0) {
      if (prev) {
        for (const c of credits) {
          if ((row.cum[c.variable] ?? 0) < (prev.cum[c.variable] ?? 0)) warnings.push(`'${c.variable}'이(가) 이전 행보다 줄었습니다(재작업이면 정상)`)
        }
        if (row.effort < prev.effort) warnings.push('누적 공수가 이전 행보다 줄었습니다')
        if ((row.defects ?? 0) < (prev.defects ?? 0)) warnings.push('누적 결함이 이전 행보다 줄었습니다')
      }
      // 단계 순서: credits는 흐르는 순서(개발 → QA → 시험)이므로 뒤 단계가 앞 단계를 넘을 수 없다.
      for (let j = 1; j < credits.length; j++) {
        const a = credits[j - 1] as EvmCredit
        const b = credits[j] as EvmCredit
        if ((row.cum[b.variable] ?? 0) > (row.cum[a.variable] ?? 0)) warnings.push(`'${b.variable}'이(가) '${a.variable}'보다 많습니다(단계 순서 어긋남)`)
      }
      const first = credits[0]
      if (first && (row.cum[first.variable] ?? 0) > totalTasks * SCOPE_WARNING_FACTOR) warnings.push('완료 태스크가 총 태스크의 1.5배를 넘었습니다. 범위 증가인가요? 기준선 개정을 검토하세요')
      prev = row
    }
    out.push({ errors, warnings })
  })
  return out
}

/** 단계별 누적 태스크로 만든 진척률 P = Σ(w × N) / N_total. 비어 있는 단계는 0. */
export function progressFromCum(credits: EvmCredit[], cum: Record<string, number>, totalTasks: number): number {
  let sum = 0
  for (const c of credits) sum += c.weight * (cum[c.variable] ?? 0)
  return sum / totalTasks
}

export interface EvmPoint extends Indicators {
  day: number
  /** 이 점을 계산한 기준선의 개정 번호(0 = 원 기준선) */
  revision?: number
  /** 이 점이 온 `rows`의 위치 */
  index: number
  pv: number
  ev: number
  ac: number
  progress: number
  /** 최근 k개 구간의 지수 */
  cpiK: number | null
  spiK: number | null
}

/**
 * 기준선과 실적으로 보고일별 EVM 시계열을 만든다. 오류가 있는 행은 제외한다. PV는 기준선의 계획 공수 곡선을 보고일에서
 * 읽고, EV는 실적 진척률에 계획이 처음 도달할 때까지 쓴 공수이다(비용 정렬, `baseline.ts`).
 */
export function evmSeries(
  baseline: Baseline,
  rows: ActualRow[],
  issues: RowIssues[],
  k: number = DEFAULT_WINDOW,
  /** 구간 지수가 첫 보고 앞에서 출발하는 점. 기본은 시각 0의 계획과 실적 0. 개정 기준선에서는 개정 시점의 값이다. */
  originOverride?: Cumulative
): EvmPoint[] {
  const base: { day: number; index: number; pv: number; ev: number; ac: number; progress: number }[] = []
  rows.forEach((row, index) => {
    if ((issues[index]?.errors.length ?? 0) > 0) return
    const progress = progressFromCum(baseline.credits, row.cum, baseline.totalTasks)
    base.push({ day: row.day, index, pv: pvAt(baseline, row.day), ev: evAt(baseline, progress), ac: row.effort, progress })
  })
  const cumulative: Cumulative[] = base
  const origin: Cumulative = originOverride ?? { pv: pvAt(baseline, 0), ev: 0, ac: 0 }
  return base.map((p, i) => {
    const w = windowIndices(cumulative, i, k, origin)
    return { ...p, ...indicators(p.pv, p.ev, p.ac), cpiK: w.cpi, spiK: w.spi }
  })
}
