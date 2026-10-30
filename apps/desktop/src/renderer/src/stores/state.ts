import type { StateCreator } from 'zustand'
import type { ExperimentSlice } from './slices/experimentSlice'
import type { ScenarioSlice } from './slices/scenarioSlice'
import type { ControlSlice } from './slices/controlSlice'
import type { RiskSlice } from './slices/riskSlice'
import type { ValidationSlice } from './slices/validationSlice'
import type { CalibrationSlice } from './slices/calibrationSlice'
import type { ReportSlice } from './slices/reportSlice'
import type { ProjectSlice } from './slices/projectSlice'

/** 화면 상태 전체. 영역별 슬라이스를 합친 것이다. */
export type AppState = ExperimentSlice & ScenarioSlice & ControlSlice & RiskSlice & ValidationSlice & CalibrationSlice & ReportSlice & ProjectSlice

/** 슬라이스 생성 함수의 형식. 다른 슬라이스의 상태와 액션도 `get()`으로 읽을 수 있다. */
export type SliceCreator<T> = StateCreator<AppState, [], [], T>
