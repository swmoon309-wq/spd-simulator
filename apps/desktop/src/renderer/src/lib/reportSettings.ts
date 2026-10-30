import { SECTION_IDS, type SectionId } from '../../../shared/reportDoc'
import type { ReportsFile } from '../../../shared/projectFile'
import { REPORT_KINDS, type ReportKind } from './report/model'

/** 보고서 화면의 설정(RPT-07). 프로젝트 파일에 저장된다. 보고 기준일은 화면 상태라 여기에 없다. */
export interface ReportSettings {
  kind: ReportKind
  title: string
  author: string
  /** 사용자가 고른 절. 없으면 자료 상태에 따른 기본값 */
  sections: Partial<Record<SectionId, boolean>>
  includeStale: boolean
  chartSize: 'normal' | 'large'
}

export const MAX_REPORT_TITLE = 200
export const MAX_REPORT_AUTHOR = 100

export const defaultReportSettings = (): ReportSettings => ({ kind: 'plan', title: '', author: '', sections: {}, includeStale: false, chartSize: 'normal' })

/** 파일에 쓸 모양. 처음 값이면 null(파일에 넣지 않는다). */
export function reportsToFile(s: ReportSettings): ReportsFile | null {
  const sections = Object.fromEntries(SECTION_IDS.filter((id) => typeof s.sections[id] === 'boolean').map((id) => [id, s.sections[id] as boolean]))
  const file: ReportsFile = { kind: s.kind, title: s.title, author: s.author, sections, includeStale: s.includeStale, chartSize: s.chartSize }
  const d = defaultReportSettings()
  const isDefault = file.kind === d.kind && file.title === '' && file.author === '' && Object.keys(sections).length === 0 && !file.includeStale && file.chartSize === d.chartSize
  return isDefault ? null : file
}

/** 파일에서 읽은 설정을 정리한다. 모르는 종류·절은 버리고 알린다. */
export function sanitizeReports(file: ReportsFile | null): { settings: ReportSettings; warnings: string[] } {
  if (!file) return { settings: defaultReportSettings(), warnings: [] }
  const warnings: string[] = []
  let kind: ReportKind = 'plan'
  if (REPORT_KINDS.some((k) => k.kind === file.kind)) kind = file.kind as ReportKind
  else warnings.push(`보고서 종류 '${file.kind}'을(를) 알 수 없어 '계획서 요약'으로 돌렸습니다.`)
  const sections: Partial<Record<SectionId, boolean>> = {}
  let dropped = 0
  for (const [id, on] of Object.entries(file.sections)) {
    if ((SECTION_IDS as readonly string[]).includes(id)) sections[id as SectionId] = on
    else dropped++
  }
  if (dropped > 0) warnings.push(`알 수 없는 보고서 절 선택 ${dropped}개를 버렸습니다.`)
  return { settings: { kind, title: file.title.slice(0, MAX_REPORT_TITLE), author: file.author.slice(0, MAX_REPORT_AUTHOR), sections, includeStale: file.includeStale, chartSize: file.chartSize }, warnings }
}
