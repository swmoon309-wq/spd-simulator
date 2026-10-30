import { create } from 'zustand'

interface ReportViewState {
  /** 상태 보고서의 보고 기준일. null이면 최근 보고일. 저장하지 않는 화면 상태다. */
  reportDay: number | null
  setReportDay(day: number | null): void
}

/**
 * 보고서 화면에서 저장하지 않는 상태. 종류·제목·작성자·절 선택·차트 크기는 프로젝트의 일부라
 * 앱 스토어의 `reports`(`reportSlice`)에 있고 프로젝트 파일에 저장된다(설계 09의 RPT-07).
 */
export const useReportStore = create<ReportViewState>()((set) => ({
  reportDay: null,
  setReportDay: (reportDay) => set({ reportDay })
}))
