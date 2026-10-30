import { levelChanges, perturbChanges, perturbProblem, planExtremes, runExtremeCase, checklistItem, runStructureChecks, withChecklistEntry, type ChecklistStatus, runWithChanges, summarizeResponse, type PerturbSpec } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { getCompiledModel } from '../../engine/models'
import { BASE_ID } from '../../lib/scenarioRunner'
import { riskBaseParams } from '../../lib/risk'
import { defaultValidationSettings, MAX_CHECKLIST_NOTE, MAX_DATASET_POINTS_TOTAL, MAX_DATASETS, pointCount, toleranceProblem, totalPoints, type Dataset, type ValidationSettings } from '../../lib/validation'
import { externallyUsedVariables, extremeInputFor, extremeParams, extremesKey, levelsKey, perturbKey, structureKey, type ExtremesRun, type LevelCheckRun, type PerturbRun, type StructureRun } from '../../lib/validationRuns'
import { buildRecordFromState, emptyRecordReason, type RecordContents } from '../../lib/validationRecord'
import { checkRunSettings } from '../../lib/runSettings'
import { rt } from '../runtime'
import type { AppState, SliceCreator } from '../state'

export interface ValidationSlice {
  /** 모델 검증 설정(데이터셋·허용 기준·대상). 지표는 저장하지 않는다. */
  validation: ValidationSettings
  /** 검증 탭에서 보고 있는 데이터셋. 파일에 저장하지 않는다. */
  validationActiveId: string | null
  /** 극단 조건·교란 시험·Level 변화 점검의 결과. 파일에 저장하지 않는다. */
  validationExtremes: ExtremesRun | null
  validationPerturb: PerturbRun | null
  validationLevels: LevelCheckRun | null
  /** 구조 점검 S1~S6의 결과. 파일에 저장하지 않는다. */
  validationStructure: StructureRun | null

  /** 데이터셋을 더한다. 개수·점 수 한도를 넘으면 이유를 돌려주고 더하지 않는다. */
  addDataset(dataset: Dataset): string | null
  removeDataset(id: string): void
  /** 데이터셋의 이름·시간 단위·시간 이동·실제 완료일을 바꾼다. 올바르지 않으면 이유를 돌려주고 바꾸지 않는다. */
  updateDataset(id: string, patch: Partial<Pick<Dataset, 'name' | 'timeUnit' | 'offsetDay' | 'actualCompletionDay'>>): string | null
  /** 열의 연결 변수(null이면 비교 안 함)와 값 배율을 바꾼다. */
  setDatasetColumn(id: string, index: number, patch: { variable?: string | null; scale?: number }): string | null
  /** 허용 기준을 정한다(null이면 지운다). 올바르지 않으면 이유. */
  setTolerance(key: keyof ValidationSettings['tolerances'], value: number | null): string | null
  setValidationTarget(id: string): void
  setValidationActive(id: string | null): void
  /**
   * 대상 시나리오에서 모든 파라미터를 허용 범위의 양 끝과 범위 밖(0, ×10, ×0.1)으로 한 번에 하나씩 바꿔 실행한다(설계 07의 4.1).
   * UI를 막지 않게 조금씩 나눠 실행한다. 문제가 있으면 이유를 돌려주고 실행하지 않는다. 취소하면 그때까지의 셀이 남는다.
   */
  runExtremes(): Promise<string | null>
  cancelExtremes(): void
  /** 상수에 스텝·펄스·램프를 걸어 기준 실행과 비교한다(설계 07의 4.2). 문제가 있으면 이유. */
  runPerturb(spec: PerturbSpec, variables: string[]): string | null
  /** 짧은 구간을 실행해 변하는 Level을 낸다. 문제가 있으면 이유. */
  runLevelCheck(days: number): string | null
  /** 대상 시나리오에서 구조 점검 S1~S6을 실행한다(설계 07의 4.3). 문제가 있으면 이유. */
  runStructure(): string | null
  /** 체크리스트 항목의 상태나 메모를 바꾼다. 올바르지 않으면 이유. */
  setChecklistEntry(id: string, patch: { status?: ChecklistStatus; note?: string }): string | null
  /**
   * 지금의 결과로 검증 기록을 만들어 프로젝트에 남긴다(설계 07의 6장). 오래된 결과는 넣지 않는다. 넣은 내용과 못 넣은 내용을 돌려주고,
   * 기록할 내용이 없으면 `reason`을 돌려준다.
   */
  makeRecord(): { reason: string | null; contents: RecordContents | null }
  clearRecord(): void
}

export const createValidationSlice: SliceCreator<ValidationSlice> = (set, get) => ({
  validation: defaultValidationSettings(),
  validationActiveId: null,
  validationExtremes: null,
  validationPerturb: null,
  validationLevels: null,
  validationStructure: null,

  addDataset(dataset) {
    const s = get()
    if (s.validation.datasets.length >= MAX_DATASETS) return `데이터셋은 최대 ${MAX_DATASETS}개입니다.`
    if (totalPoints(s.validation.datasets) + pointCount(dataset) > MAX_DATASET_POINTS_TOTAL) return `저장할 수 있는 데이터 점은 합계 ${MAX_DATASET_POINTS_TOTAL}개까지입니다.`
    if (s.validation.datasets.some((d) => d.id === dataset.id)) return `데이터셋 id '${dataset.id}'가 겹칩니다.`
    set({ validation: { ...s.validation, datasets: [...s.validation.datasets, dataset] }, validationActiveId: dataset.id })
    return null
  },
  removeDataset(id) {
    const s = get()
    const datasets = s.validation.datasets.filter((d) => d.id !== id)
    set({ validation: { ...s.validation, datasets }, validationActiveId: s.validationActiveId === id ? (datasets[0]?.id ?? null) : s.validationActiveId })
  },
  updateDataset(id, patch) {
    const s = get()
    if (patch.name !== undefined && (patch.name.trim() === '' || patch.name.length > 100)) return '이름은 1~100자여야 합니다.'
    if (patch.offsetDay !== undefined && !Number.isFinite(patch.offsetDay)) return '시간 이동은 유한한 수여야 합니다.'
    if (patch.actualCompletionDay != null && !(Number.isFinite(patch.actualCompletionDay) && patch.actualCompletionDay > 0)) return '실제 완료일은 0보다 큰 수여야 합니다.'
    set({ validation: { ...s.validation, datasets: s.validation.datasets.map((d) => (d.id === id ? { ...d, ...patch } : d)) } })
    return null
  },
  setDatasetColumn(id, index, patch) {
    const s = get()
    const entry = getEntry(s.modelId)
    if (patch.variable != null && !entry.variables.some((v) => v.name === patch.variable)) return `'${patch.variable}'은(는) 이 모델의 변수가 아닙니다.`
    if (patch.scale !== undefined && !(Number.isFinite(patch.scale) && patch.scale > 0)) return '값 배율은 0보다 큰 수여야 합니다.'
    set({
      validation: {
        ...s.validation,
        datasets: s.validation.datasets.map((d) => (d.id === id ? { ...d, columns: d.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)) } : d))
      }
    })
    return null
  },
  setTolerance(key, value) {
    const s = get()
    const tolerances = { ...s.validation.tolerances }
    if (value === null) delete tolerances[key]
    else {
      const problem = toleranceProblem(key, value)
      if (problem) return problem
      tolerances[key] = value
    }
    set({ validation: { ...s.validation, tolerances } })
    return null
  },
  setValidationTarget(id) {
    const s = get()
    if (id !== BASE_ID && !s.scenarios.some((x) => x.id === id)) return
    set({ validation: { ...s.validation, targetScenarioId: id } })
  },
  setValidationActive: (id) => set({ validationActiveId: id }),

  async runExtremes() {
    const s = get()
    if (s.validationExtremes?.status === 'running') return '극단 조건 시험이 실행 중입니다.'
    if (Object.keys(s.paramErrors).length > 0) return '실험 탭의 입력 오류를 먼저 고치세요.'
    const combo = checkRunSettings(s.runSettings)
    if (combo) return combo
    const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
    if (base === null) return '비교 대상 시나리오를 찾을 수 없습니다.'
    const entry = getEntry(s.modelId)
    const cases = planExtremes(extremeParams(entry), base)
    const input = extremeInputFor(getCompiledModel(s.modelId), entry, base, s.runSettings)
    const key = extremesKey(entry, base, s.runSettings)
    const seq = ++rt.extremesSeq
    rt.extremesCancel = false
    const cells: ExtremesRun['cells'] = []
    const mine = (st: AppState) => rt.extremesSeq === seq && st.validationExtremes?.key === key
    set({ validationExtremes: { key, status: 'running', done: 0, total: cases.length, cells: [], error: null } })
    try {
      let sliceStart = performance.now()
      for (const c of cases) {
        if (rt.extremesCancel || rt.extremesSeq !== seq) break
        cells.push(runExtremeCase(input, c))
        // 12ms마다 UI에 양보한다(진행 막대와 취소 버튼이 반응하도록)
        if (performance.now() - sliceStart >= 12) {
          set((st) => (mine(st) ? { validationExtremes: { ...(st.validationExtremes as ExtremesRun), done: cells.length, cells: [...cells] } } : {}))
          await new Promise<void>((r) => setTimeout(r, 0))
          sliceStart = performance.now()
        }
      }
      if (rt.extremesSeq !== seq) return null
      const canceled = cells.length < cases.length
      set({ validationExtremes: { key, status: canceled ? 'canceled' : 'done', done: cells.length, total: cases.length, cells: [...cells], error: null } })
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (rt.extremesSeq === seq) set({ validationExtremes: { key, status: 'error', done: cells.length, total: cases.length, cells: [...cells], error: message } })
      return message
    }
  },
  cancelExtremes: () => void (rt.extremesCancel = true),

  runPerturb(spec, variables) {
    const s = get()
    if (Object.keys(s.paramErrors).length > 0) return '실험 탭의 입력 오류를 먼저 고치세요.'
    const combo = checkRunSettings(s.runSettings)
    if (combo) return combo
    const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
    if (base === null) return '비교 대상 시나리오를 찾을 수 없습니다.'
    const entry = getEntry(s.modelId)
    const problem = perturbProblem(spec, base[spec.name], { start: entry.def.time.start, end: s.runSettings.end })
    if (problem) return problem
    if (variables.length === 0) return '보고할 변수를 하나 이상 고르세요.'
    const unknown = variables.find((v) => !entry.variables.some((x) => x.name === v))
    if (unknown) return `'${unknown}'은(는) 이 모델의 변수가 아닙니다.`
    try {
      const model = getCompiledModel(s.modelId)
      const options = { end: s.runSettings.end, dt: s.runSettings.dt, seed: s.runSettings.seed }
      const changes = perturbChanges(spec, base[spec.name] as number)
      const baseRun = runWithChanges(model, base, options, [])
      const perturbed = runWithChanges(model, base, options, changes)
      const summaries = variables.map((v) => summarizeResponse(baseRun, perturbed, v))
      set({ validationPerturb: { key: perturbKey(entry, base, s.runSettings, spec, variables), spec, variables, changes, base: baseRun, perturbed, summaries } })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },

  runLevelCheck(days) {
    const s = get()
    if (!(Number.isFinite(days) && days > 0)) return '일수는 0보다 큰 수여야 합니다.'
    if (Object.keys(s.paramErrors).length > 0) return '실험 탭의 입력 오류를 먼저 고치세요.'
    const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
    if (base === null) return '비교 대상 시나리오를 찾을 수 없습니다.'
    const entry = getEntry(s.modelId)
    try {
      const rows = levelChanges(getCompiledModel(s.modelId), base, { dt: s.runSettings.dt, seed: s.runSettings.seed }, days)
      set({ validationLevels: { key: levelsKey(entry, base, s.runSettings, days), days, rows } })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },

  runStructure() {
    const s = get()
    if (Object.keys(s.paramErrors).length > 0) return '실험 탭의 입력 오류를 먼저 고치세요.'
    const combo = checkRunSettings(s.runSettings)
    if (combo) return combo
    const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
    if (base === null) return '비교 대상 시나리오를 찾을 수 없습니다.'
    const entry = getEntry(s.modelId)
    try {
      const report = runStructureChecks({
        model: getCompiledModel(s.modelId),
        params: base,
        options: { end: s.runSettings.end, dt: s.runSettings.dt, seed: s.runSettings.seed },
        kpis: entry.kpiSpecs,
        usedExternally: externallyUsedVariables(entry)
      })
      set({ validationStructure: { key: structureKey(entry, base, s.runSettings), report } })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },

  setChecklistEntry(id, patch) {
    const s = get()
    if (!checklistItem(id)) return `'${id}'은(는) 알 수 없는 체크리스트 항목입니다.`
    if (patch.note !== undefined && patch.note.length > MAX_CHECKLIST_NOTE) return `메모는 ${MAX_CHECKLIST_NOTE}자까지입니다.`
    set({ validation: { ...s.validation, checklist: withChecklistEntry(s.validation.checklist, id, patch) } })
    return null
  },

  makeRecord() {
    const s = get()
    const { record, contents } = buildRecordFromState({
      entry: getEntry(s.modelId),
      params: s.params,
      scenarios: s.scenarios,
      runSettings: s.runSettings,
      validation: s.validation,
      scenarioRuns: s.scenarioRuns,
      extremes: s.validationExtremes,
      structure: s.validationStructure,
      now: new Date()
    })
    const reason = emptyRecordReason(contents)
    if (reason) return { reason, contents }
    set({ validation: { ...s.validation, report: record } })
    return { reason: null, contents }
  },
  clearRecord: () => set((s) => ({ validation: { ...s.validation, report: null } }))
})

/** 극단 조건 시험 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없거나 실행 중이면 false. */
export function selectExtremesStale(s: AppState): boolean {
  const run = s.validationExtremes
  if (!run || run.status === 'running') return false
  const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
  return base === null || extremesKey(getEntry(s.modelId), base, s.runSettings) !== run.key
}

/** 교란 시험 결과가 지금 입력으로 만든 것인지. 결과가 없으면 false. */
export function selectPerturbStale(s: AppState): boolean {
  const run = s.validationPerturb
  if (!run) return false
  const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
  return base === null || perturbKey(getEntry(s.modelId), base, s.runSettings, run.spec, run.variables) !== run.key
}

/** Level 변화 점검 결과가 지금 입력으로 만든 것인지. 결과가 없으면 false. */
export function selectLevelsStale(s: AppState): boolean {
  const run = s.validationLevels
  if (!run) return false
  const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
  return base === null || levelsKey(getEntry(s.modelId), base, s.runSettings, run.days) !== run.key
}

/** 구조 점검 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없으면 false. */
export function selectStructureStale(s: AppState): boolean {
  const run = s.validationStructure
  if (!run) return false
  const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
  return base === null || structureKey(getEntry(s.modelId), base, s.runSettings) !== run.key
}
