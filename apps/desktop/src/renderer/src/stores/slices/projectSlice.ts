import { MAX_DESCRIPTION, type ProjectFile } from '../../../../shared/projectFile'
import { getEntry } from '../../catalog'
import type { ScenarioRun } from '../../lib/scenarioRunner'
import { defaultParams, snapshotOf } from '../../lib/params'
import { cloneEvmSettings, DEFAULT_EVM_SETTINGS } from '@spd/analysis'
import { riskToFile, defaultRiskSettings } from '../../lib/risk'
import { catalog } from '../../catalog'
import { installUserModel } from '../../lib/modelRegistry'
import { defaultReportSettings, reportsToFile } from '../../lib/reportSettings'
import { defaultValidationSettings, validationToFile } from '../../lib/validation'
import { applyProjectFile, buildProjectFile } from '../../lib/projectApply'
import { defaultRunSettings } from '../../lib/runSettings'
import { replaceProject } from '../history'
import { rt } from '../runtime'
import { initialEntry, initialParams, initialRun } from '../initial'
import type { AppState, SliceCreator } from '../state'

export interface Notice {
  kind: 'info' | 'warning' | 'error'
  text: string
  details?: string[]
}

export const UNTITLED = '이름 없는 프로젝트'
export const FILE_SUFFIX = '.spd.json'

/** "a.spd.json" → "a" */
export function projectNameFromFile(fileName: string): string {
  return fileName.endsWith(FILE_SUFFIX) ? fileName.slice(0, -FILE_SUFFIX.length) : fileName
}

export interface ProjectSlice {
  projectName: string
  /** 프로젝트 설명(PRJ-01). 프로젝트 파일에 저장하고 "수정됨" 판단에 들어간다. */
  projectDescription: string
  /** 저장·열기한 파일 이름. 아직 저장하지 않았으면 null */
  projectFile: string | null
  createdAt: string
  /** 마지막으로 저장(또는 열기)한 시점의 입력 스냅샷 */
  savedSnapshot: string
  notice: Notice | null

  /** 설명을 바꾼다(최대 길이를 넘는 부분은 버린다). */
  setProjectDescription(text: string): void
  buildProjectFile(): ProjectFile
  markSaved(fileName: string): void
  /** 파일을 열어 화면 상태를 바꾸고 기준 실행을 한다. 열 수 없으면 false. */
  loadProjectFile(file: ProjectFile, fileName: string): Promise<boolean>
  /**
   * 자동 저장본(COM-05)을 저장하지 않은 프로젝트로 연다. 파일에 연결되지 않고(`projectFile`은 null이라 저장하면 이름을 묻는다)
   * 항상 "수정됨"이다. 열 수 없으면 false.
   */
  restoreRecovered(project: ProjectFile): Promise<boolean>
  /**
   * 내장 예제(PRJ-03)를 **복사본**으로 연다. 파일에 연결되지 않아 저장하면 새 파일이 되고(원본 예제는 바뀌지 않는다), 열었을 때는
   * 수정되지 않은 상태다. `runPresets`면 기준 실행이 끝난 뒤 모델의 프리셋을 모두 실행해 겹쳐 보인다. 열 수 없으면 false.
   */
  openExample(project: ProjectFile, options?: { runPresets?: boolean }): Promise<boolean>
  /** 새 프로젝트. 모델을 지정하면 그 모델로 시작하고, 이름·설명을 주면 그 값으로 시작한다(이름은 처음 저장할 때 파일 이름의 기본값이 된다). */
  newProject(modelId?: string, init?: { name?: string; description?: string }): Promise<void>
  setNotice(notice: Notice | null): void
}

export const createProjectSlice: SliceCreator<ProjectSlice> = (set, get, api) => {
  /** 진행 중인 실행을 취소하고 끝날 때까지 기다린다. */
  const stopRunning = async () => {
    const waitUntil = (done: (s: AppState) => boolean) =>
      new Promise<void>((resolve) => {
        if (done(get())) return resolve()
        const unsubscribe = api.subscribe((s) => {
          if (done(s)) {
            unsubscribe()
            resolve()
          }
        })
      })
    if (get().batch) {
      rt.batchControl?.cancel()
      await waitUntil((s) => s.batch === null)
    }
    if (get().status === 'running') {
      rt.handle?.cancel()
      await waitUntil((s) => s.status === 'idle')
    }
    if (get().riskRun?.status === 'running') {
      rt.riskControl?.cancel()
      await waitUntil((s) => s.riskRun?.status !== 'running')
    }
    if (get().validationCalibration?.status === 'running') {
      rt.calibCancel = true
      await waitUntil((s) => s.validationCalibration?.status !== 'running')
    }
    if (get().validationExtremes?.status === 'running') {
      rt.extremesCancel = true
      await waitUntil((s) => s.validationExtremes?.status !== 'running')
    }
    if (get().riskCompare?.status === 'running') {
      rt.riskControl?.cancel()
      await waitUntil((s) => s.riskCompare?.status !== 'running')
    }
  }
  /** 프로젝트를 바꿀 때 시나리오 실행 상태와 캐시를 비운다. */
  const clearScenarioRuns = () => {
    rt.resultCache.clear()
    return { scenarioRuns: {} as Record<string, ScenarioRun>, batch: null, lastBatch: null, compareHidden: {} as Record<string, true> }
  }

  return {
    projectName: UNTITLED,
    projectDescription: '',
    projectFile: null,
    createdAt: new Date().toISOString(),
    savedSnapshot: snapshotOf(initialEntry, initialParams, initialRun),
    notice: null,

    setProjectDescription: (text) => set({ projectDescription: text.slice(0, MAX_DESCRIPTION) }),

    buildProjectFile() {
      const s = get()
      return buildProjectFile({
        entry: getEntry(s.modelId),
        name: s.projectName,
        description: s.projectDescription,
        createdAt: s.createdAt,
        params: s.params,
        runSettings: s.runSettings,
        chartVariable: s.chartVariable,
        scenarios: s.scenarios,
        adopted: s.adopted,
        actuals: s.actuals,
        evm: s.evm,
        revisions: s.revisions,
        risk: s.risk,
        validation: s.validation,
        reports: s.reports
      })
    },

    markSaved(fileName) {
      const s = get()
      set({
        projectFile: fileName,
        projectName: projectNameFromFile(fileName),
        savedSnapshot: snapshotOf(getEntry(s.modelId), s.params, s.runSettings, s.scenarios, s.adopted, s.actuals, s.evm, s.revisions, riskToFile(s.risk), validationToFile(s.validation), s.projectDescription, reportsToFile(s.reports))
      })
    },

    async loadProjectFile(file, fileName) {
      const applied = applyProjectFile(file)
      if (!applied.ok) {
        set({ notice: { kind: 'error', text: `프로젝트를 열 수 없습니다. ${applied.message}` } })
        return false
      }
      // 사용자 모델은 프로젝트에 내장된 것을 앱에 올려 쓴다. 같은 id의 내 모델이 다른 내용이면 파일의 것으로 바꾸고 알린다(설계 08의 4.1).
      const custom = applied.state.entry.custom
      const warnings = [...applied.warnings]
      if (custom) {
        const prior = catalog.find((m) => m.id === applied.state.entry.id && m.category === 'user')
        const installed = installUserModel(custom.doc)
        if (!installed.ok) {
          set({ notice: { kind: 'error', text: `프로젝트를 열 수 없습니다. ${installed.message}` } })
          return false
        }
        if (prior?.custom && prior.custom.hash !== custom.hash) warnings.push(`이 프로젝트에 내장된 모델 '${installed.entry.title}'의 내용이 앱에 있던 같은 id의 모델과 달라 프로젝트의 것으로 바꿨습니다.`)
      }
      await stopRunning()
      rt.runSeq = 0
      rt.refSeq = 0
      const { entry, params, runSettings, chartVariable, createdAt, description, scenarios, adopted, actuals, evm, revisions, risk, validation, reports } = applied.state
      replaceProject(() =>
        set({
          modelId: entry.id,
          params,
          runSettings,
          chartVariable,
          createdAt,
          paramErrors: {},
          runs: [],
          references: [],
          scenarios,
          adopted,
          actuals,
          evm,
          revisions,
          reforecast: null,
          actionRun: null,
          candidates: [],
          risk,
          riskRun: null,
          riskCompare: null,
          riskSens: { oat: null, sweep: null },
          validation,
          reports,
          validationActiveId: validation.datasets[0]?.id ?? null,
          validationExtremes: null,
          validationPerturb: null,
          validationLevels: null,
          validationStructure: null,
          validationCalibration: null,
          activeScenarioId: null,
          ...clearScenarioRuns(),
          error: null,
          projectName: projectNameFromFile(fileName),
          projectFile: fileName,
          savedSnapshot: snapshotOf(entry, params, runSettings, scenarios, adopted, actuals, evm, revisions, riskToFile(risk), validationToFile(validation), description, reportsToFile(reports)),
          projectDescription: description,
          autoRan: true,
          notice:
            warnings.length > 0
              ? { kind: 'warning', text: `'${fileName}'을(를) 열었지만 일부 값을 조정했습니다.`, details: warnings }
              : null
        })
      )
      void get().run()
      return true
    },

    async restoreRecovered(project) {
      if (!(await get().loadProjectFile(project, project.meta.name + FILE_SUFFIX))) return false
      const prev = get().notice
      set({
        projectFile: null,
        savedSnapshot: '',
        notice: prev
          ? { ...prev, text: `${prev.text} 자동 저장본에서 복구했습니다.` }
          : { kind: 'info', text: '저장하지 않고 종료된 작업을 자동 저장본에서 복구했습니다. 저장하면 확정됩니다.' }
      })
      return true
    },

    async openExample(project, options = {}) {
      if (!(await get().loadProjectFile(project, project.meta.name + FILE_SUFFIX))) return false
      const prev = get().notice
      set({
        projectFile: null,
        notice: prev ?? { kind: 'info', text: `'${project.meta.name}'을(를) 복사본으로 열었습니다. 고친 내용은 복사본에만 반영되고, 저장하면 새 파일이 됩니다.` }
      })
      if (options.runPresets) {
        // 기준 실행이 끝나야 이어서 실행할 수 있다.
        await new Promise<void>((resolve) => {
          if (get().status === 'idle') return resolve()
          const unsubscribe = api.subscribe((s) => {
            if (s.status === 'idle') {
              unsubscribe()
              resolve()
            }
          })
        })
        const entry = getEntry(get().modelId)
        await get().runPresets(entry.presets.map((p) => p.overrides))
      }
      return true
    },

    async newProject(modelId, init = {}) {
      await stopRunning()
      rt.runSeq = 0
      rt.refSeq = 0
      const entry = getEntry(modelId ?? get().modelId)
      const params = defaultParams(entry)
      const runSettings = defaultRunSettings(entry)
      const description = (init.description ?? '').slice(0, MAX_DESCRIPTION)
      replaceProject(() =>
        set({
          modelId: entry.id,
          params,
          runSettings,
          paramErrors: {},
          runs: [],
          references: [],
          scenarios: [],
          adopted: null,
          actuals: [],
          evm: cloneEvmSettings(DEFAULT_EVM_SETTINGS),
          revisions: [],
          reforecast: null,
          actionRun: null,
          candidates: [],
          risk: defaultRiskSettings(),
          riskRun: null,
          riskCompare: null,
          riskSens: { oat: null, sweep: null },
          validation: defaultValidationSettings(),
          reports: defaultReportSettings(),
          validationActiveId: null,
          validationExtremes: null,
          validationPerturb: null,
          validationLevels: null,
          validationStructure: null,
          validationCalibration: null,
          activeScenarioId: null,
          ...clearScenarioRuns(),
          error: null,
          chartVariable: entry.defaultVariable,
          projectName: init.name?.trim() || UNTITLED,
          projectDescription: description,
          projectFile: null,
          createdAt: new Date().toISOString(),
          savedSnapshot: snapshotOf(entry, params, runSettings, undefined, undefined, undefined, undefined, undefined, undefined, undefined, description),
          autoRan: true,
          notice: null
        })
      )
      void get().run()
    },

    setNotice: (notice) => set({ notice })
  }
}

/** 마지막 저장(열기) 이후 입력이 바뀌었는지. */
export const selectIsDirty = (s: AppState): boolean =>
  snapshotOf(getEntry(s.modelId), s.params, s.runSettings, s.scenarios, s.adopted, s.actuals, s.evm, s.revisions, riskToFile(s.risk), validationToFile(s.validation), s.projectDescription, reportsToFile(s.reports)) !== s.savedSnapshot
