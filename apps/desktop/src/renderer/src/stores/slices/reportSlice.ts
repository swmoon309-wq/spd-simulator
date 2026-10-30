import { MAX_REPORT_AUTHOR, MAX_REPORT_TITLE, defaultReportSettings, type ReportSettings } from '../../lib/reportSettings'
import { REPORT_KINDS } from '../../lib/report/model'
import type { SectionId } from '../../../../shared/reportDoc'
import type { ReportKind } from '../../lib/report/model'
import type { SliceCreator } from '../state'

export interface ReportSlice {
  /** 보고서 설정(RPT-07). 프로젝트 파일에 저장하고 실행 취소·변경 감지의 대상이다. */
  reports: ReportSettings
  /** 종류를 바꾸면 절 선택은 처음 값으로 돌아간다. 모르는 종류는 무시한다. */
  setReportKind(kind: ReportKind): void
  setReportTitle(title: string): void
  setReportAuthor(author: string): void
  setReportSection(id: SectionId, on: boolean): void
  setReportIncludeStale(on: boolean): void
  setReportChartSize(size: 'normal' | 'large'): void
}

export const createReportSlice: SliceCreator<ReportSlice> = (set, get) => {
  const patch = (p: Partial<ReportSettings>) => set({ reports: { ...get().reports, ...p } })
  return {
    reports: defaultReportSettings(),
    setReportKind: (kind) => {
      if (!REPORT_KINDS.some((k) => k.kind === kind)) return
      if (kind !== get().reports.kind) patch({ kind, sections: {} })
    },
    setReportTitle: (title) => patch({ title: title.slice(0, MAX_REPORT_TITLE) }),
    setReportAuthor: (author) => patch({ author: author.slice(0, MAX_REPORT_AUTHOR) }),
    setReportSection: (id, on) => patch({ sections: { ...get().reports.sections, [id]: on } }),
    setReportIncludeStale: (includeStale) => patch({ includeStale }),
    setReportChartSize: (chartSize) => patch({ chartSize })
  }
}
