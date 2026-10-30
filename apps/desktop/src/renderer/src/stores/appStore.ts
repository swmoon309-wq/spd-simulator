import { create } from 'zustand'
import { installHistory } from './history'
import type { AppState } from './state'
import { createExperimentSlice } from './slices/experimentSlice'
import { createScenarioSlice } from './slices/scenarioSlice'
import { createControlSlice } from './slices/controlSlice'
import { createRiskSlice } from './slices/riskSlice'
import { createValidationSlice } from './slices/validationSlice'
import { createCalibrationSlice } from './slices/calibrationSlice'
import { createReportSlice } from './slices/reportSlice'
import { createProjectSlice } from './slices/projectSlice'

// 화면 상태는 영역별 슬라이스(`slices/*Slice.ts`)로 나뉘어 있고, 여기서 하나의 스토어로 합친다.
// 기존 import 경로(`stores/appStore`)가 바뀌지 않도록 공개 타입·선택자도 여기서 다시 내보낸다.
export const useAppStore = create<AppState>()((...a) => ({
  ...createExperimentSlice(...a),
  ...createScenarioSlice(...a),
  ...createControlSlice(...a),
  ...createRiskSlice(...a),
  ...createValidationSlice(...a),
  ...createCalibrationSlice(...a),
  ...createReportSlice(...a),
  ...createProjectSlice(...a)
}))

// 입력 편집의 실행 취소/다시 실행 기록(COM-02)
installHistory(useAppStore)

export { selectCalibrationStale } from './slices/calibrationSlice'
export type { ReforecastState, Candidate, ActionRunEntry, ActionRunState } from './slices/controlSlice'
export type { RunRecord, LiveRun, ReferenceSeries } from './slices/experimentSlice'
export type { Notice } from './slices/projectSlice'
export { UNTITLED, FILE_SUFFIX, projectNameFromFile, selectIsDirty } from './slices/projectSlice'
export type { RiskRunState, RiskCompareState, RiskSensState } from './slices/riskSlice'
export { selectRiskStale, selectCompareStale, selectOatStale, selectSweepStale } from './slices/riskSlice'
export { selectExtremesStale, selectPerturbStale, selectLevelsStale, selectStructureStale } from './slices/validationSlice'
export { busyReason } from './busy'
