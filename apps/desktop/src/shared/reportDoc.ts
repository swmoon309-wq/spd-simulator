/**
 * 보고서 문서(설계 09의 5장). 화면의 상태에서 만든 **서식 없는 데이터**이고, 글꼴·색은 렌더러가 정한다. 숫자는 이미 표시용
 * 문자열이다(화면의 포맷터를 그대로 써서 화면과 같은 반올림). main과 renderer가 함께 쓴다.
 */
export const REPORT_LIMITS = {
  title: 200,
  author: 100,
  /** 문서(HTML) 크기 상한. 넘으면 PDF·저장을 거절한다. */
  maxHtmlBytes: 20 * 1024 * 1024
} as const

export const SECTION_IDS = [
  'overview',
  'inputs',
  'baseline',
  'adopted',
  'scenarios',
  'comparison',
  'charts',
  'riskInputs',
  'riskResults',
  'riskTargets',
  'riskSensitivity',
  'riskConvergence',
  'riskCompare',
  'statusIndicators',
  'statusCharts',
  'statusAlerts',
  'statusForecast',
  'statusActions',
  'validation',
  'reading',
  'conditions'
] as const
export type SectionId = (typeof SECTION_IDS)[number]

/** 절에 쓴 자료의 상태. `na`(해당 없음)는 이유를 절 안에 적는다. */
export type SectionStatus = 'fresh' | 'stale' | 'missing' | 'na'

export const STATUS_LABELS: Record<SectionStatus, string> = {
  fresh: '최신',
  stale: '오래됨',
  missing: '없음',
  na: '해당 없음'
}

export type Tone = 'normal' | 'warning' | 'note'

export interface Column {
  label: string
  align?: 'left' | 'right'
}

export type CellTone = 'better' | 'worse' | 'dim' | 'strong'
export type Cell = string | { text: string; tone?: CellTone }

export interface TableBlock {
  kind: 'table'
  caption?: string
  columns: Column[]
  rows: Cell[][]
  note?: string
}

export type Block =
  | { kind: 'paragraph'; text: string; tone?: Tone }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'keyValues'; rows: [label: string, value: string][] }
  | TableBlock
  /** `svg`는 차트 렌더러가 만든 문자열이다. `alt`는 요약 문장, `table`은 같은 값을 담은 표(접근성과 흑백 인쇄) */
  | { kind: 'chart'; title: string; alt: string; svg: string; table?: TableBlock }
  | { kind: 'callout'; title: string; text: string; tone: Exclude<Tone, 'normal'> }

export interface ReportSection {
  id: SectionId
  title: string
  status: SectionStatus
  blocks: Block[]
}

export interface ReportMeta {
  author?: string
  /** 작성 날짜(ISO) */
  date: string
  app: string
  model: { id: string; name: string; version: number; custom?: boolean; hash?: string }
}

export interface ReportDoc {
  title: string
  subtitle?: string
  meta: ReportMeta
  sections: ReportSection[]
}
