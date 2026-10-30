import { getEntry } from '../../catalog'
import { selectCompareStale, selectOatStale, selectRiskStale, selectSweepStale, useAppStore } from '../../stores/appStore'
import { buildRecordFromState } from '../validationRecord'
import type { ReportState } from './model'

/** 스토어에서 보고서를 만드는 데 쓰는 상태를 가져온다. */
export function reportStateFrom(appName: string): ReportState {
  const s = useAppStore.getState()
  return {
    entry: getEntry(s.modelId),
    projectName: s.projectName,
    description: s.projectDescription,
    params: s.params,
    runSettings: s.runSettings,
    scenarios: s.scenarios,
    scenarioRuns: s.scenarioRuns,
    adopted: s.adopted,
    risk: { settings: s.risk, run: s.riskRun, compare: s.riskCompare, sens: s.riskSens, stale: { run: selectRiskStale(s), compare: selectCompareStale(s), oat: selectOatStale(s), sweep: selectSweepStale(s) } },
    control: { actuals: s.actuals, evm: s.evm, revisions: s.revisions, reforecast: s.reforecast, actionRun: s.actionRun, candidates: s.candidates },
    validation: buildRecordFromState({ entry: getEntry(s.modelId), params: s.params, scenarios: s.scenarios, runSettings: s.runSettings, validation: s.validation, scenarioRuns: s.scenarioRuns, extremes: s.validationExtremes, structure: s.validationStructure, now: new Date() }),
    appName
  }
}

/** 보고서 파일 이름의 기본값: 프로젝트 이름과 종류. */
export function reportFileName(projectName: string, kindLabel: string): string {
  return `${projectName} ${kindLabel}`.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 120) || '보고서'
}
