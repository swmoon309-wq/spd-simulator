import type { ActualRow, EvmSettings, Revision, Scenario } from '@spd/analysis'
import type { ModelEntry } from '../../catalog'
import type { ReportDoc, SectionId, SectionStatus } from '../../../../shared/reportDoc'
import type { Adopted } from '../adoption'
import type { RunSettings } from '../runSettings'
import type { RiskSettings } from '../risk'
import type { ScenarioRun } from '../scenarioRunner'
import type { ValidationReportState } from './validationSections'
import type { ActionRunState, Candidate, ReforecastState, RiskCompareState, RiskRunState, RiskSensState } from '../../stores/appStore'

/** 보고서 종류(설계 09의 3장). 위험 분석·상태·종합은 R3에서 더한다. */
export type ReportKind = 'plan' | 'scenarios' | 'risk' | 'status'

export const REPORT_KINDS: { kind: ReportKind; label: string; title: string }[] = [
  { kind: 'plan', label: '계획서 요약', title: '계획서 요약' },
  { kind: 'scenarios', label: '시나리오 비교', title: '시나리오 비교 보고서' },
  { kind: 'risk', label: '위험 분석', title: '위험 분석 보고서' },
  { kind: 'status', label: '상태 보고서', title: '상태 보고서' }
]

/** 위험 분석 자료(설정, 실행 결과, 비교, 민감도)와 각 결과가 오래되었는지(스토어의 `select*Stale` 판단). */
export interface RiskReportState {
  settings: RiskSettings
  run: RiskRunState | null
  compare: RiskCompareState | null
  sens: RiskSensState
  stale: { run: boolean; compare: boolean; oat: boolean; sweep: boolean }
}

export const EMPTY_RISK_STATE = (settings: RiskSettings): RiskReportState => ({ settings, run: null, compare: null, sens: { oat: null, sweep: null }, stale: { run: false, compare: false, oat: false, sweep: false } })

/** 통제(Earned Value) 자료: 실적·경고 설정·개정 이력과 재예측·조치 시험 결과. */
export interface ControlReportState {
  actuals: ActualRow[]
  evm: EvmSettings
  revisions: Revision[]
  reforecast: ReforecastState | null
  actionRun: ActionRunState | null
  candidates: Candidate[]
}

import { DEFAULT_EVM_SETTINGS } from '@spd/analysis'

export const EMPTY_CONTROL_STATE: ControlReportState = { actuals: [], evm: DEFAULT_EVM_SETTINGS, revisions: [], reforecast: null, actionRun: null, candidates: [] }

/** 보고서를 만드는 데 쓰는 프로젝트 상태(스토어에서 가져온 읽기 전용 조각). */
export interface ReportState {
  entry: ModelEntry
  projectName: string
  description: string
  params: Record<string, number>
  runSettings: RunSettings
  scenarios: Scenario[]
  scenarioRuns: Record<string, ScenarioRun | undefined>
  adopted: Adopted | null
  risk: RiskReportState
  control: ControlReportState
  /** 지금의 결과로 만든 검증 기록. 없으면 null(검증 절은 "없음") */
  validation: ValidationReportState | null
  appName: string
}

export interface ReportOptions {
  kind: ReportKind
  title?: string
  author?: string
  /** 작성 시각 */
  date: Date
  /** 절 선택. 없으면 자료 상태에 따른 기본값(최신인 절만 켜짐) */
  sections?: Partial<Record<SectionId, boolean>>
  /** 오래된 결과를 숫자와 함께 싣는다(절 머리에 "오래된 결과" 표시). 기본 false */
  includeStale?: boolean
  chartSize?: 'normal' | 'large'
  /** 상태 보고서의 보고 기준일(실적의 보고일). 없으면 마지막 보고일 */
  reportDay?: number | null
}

/** 한 절의 준비 결과. `blocks`는 자료가 최신이 아니면 숫자 없는 안내 블록이다. */
export interface SectionInfo {
  id: SectionId
  title: string
  status: SectionStatus
  /** 상태가 최신이 아닐 때 이유 한 줄(화면의 절 목록에 보인다) */
  reason: string | null
  /** 이 절이 기본으로 켜지는가 */
  defaultOn: boolean
  /** 항상 들어가는 절(끌 수 없다) */
  locked: boolean
  enabled: boolean
}

export interface BuildResult {
  doc: ReportDoc
  /** 이 종류의 모든 절(꺼진 것 포함)과 상태 */
  sections: SectionInfo[]
}
