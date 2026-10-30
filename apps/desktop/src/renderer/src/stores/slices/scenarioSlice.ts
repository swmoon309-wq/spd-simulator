import { canAddScenario, copyScenarioName, MAX_SCENARIO_NOTE, nextScenarioId, nextScenarioName, sanitizeOverrides, validateScenarioName, type Scenario } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { startRun } from '../../engine/engineClient'
import { allTasks, BASE_ID, createControl, EMPTY_RUN, executeBatch, planBatch, taskFor, type BatchOutcome, type RunMode, type ScenarioRun } from '../../lib/scenarioRunner'
import { paramSpecs, parseParam } from '../../lib/params'
import { BASE_SCENARIO_ID, createAdoption, createAdoptionFromPlan, type Adopted, type PlanCurve } from '../../lib/adoption'
import { checkRunSettings } from '../../lib/runSettings'
import { rt } from '../runtime'
import { busyReason } from '../busy'
import type { SliceCreator } from '../state'

export interface ScenarioSlice {
  /** 시나리오 목록. 기본 설정(params)과 달라지는 값만 가진다. */
  scenarios: Scenario[]
  /** 채택 계획(계획 기준선 스냅샷). 없으면 null. 채택 시점의 값으로 고정되어 이후 수정에 따라 바뀌지 않는다. */
  adopted: Adopted | null
  /** 시나리오 탭에서 선택한 시나리오. null이면 암묵적인 "기준"(기본 설정)이다. 파일에 저장하지 않는다. */
  activeScenarioId: string | null
  /** 시나리오 일괄 실행의 행별 상태. 키는 `BASE_ID`(기준) 또는 시나리오 id. 파일에 저장하지 않는다. */
  scenarioRuns: Record<string, ScenarioRun>
  /** 일괄 실행 중이면 입력 단위 진행 개수. 아니면 null. */
  batch: { total: number; done: number } | null
  /** 마지막으로 끝난 일괄 실행의 결과. 탭을 오가도 유지되고, 새 일괄 실행을 시작하거나 프로젝트를 바꾸면 지운다. */
  lastBatch: BatchOutcome | null
  /** 비교 차트에서 숨긴 열(기준 또는 시나리오 id). 파일에 저장하지 않는다. */
  compareHidden: Record<string, true>

  setScenarios(scenarios: Scenario[]): void
  /** 새 시나리오(기본 설정에서 시작)를 만들어 선택한다. 개수 상한이면 null. */
  addScenario(): string | null
  /** 시나리오를 복제해 원본 바로 뒤에 넣고 선택한다. 개수 상한이거나 원본이 없으면 null. */
  duplicateScenario(id: string): string | null
  /**
   * 실험 탭의 실행 기록을 시나리오로 저장한다(SCN-07, 한 방향만). 지금 기본 설정과 값이 다른 파라미터만 시나리오의 override가 되고,
   * 시나리오를 선택한다. 실행 설정(종료 시각·dt·시드)은 시나리오가 아니라 프로젝트에 속하므로 가져오지 않는다.
   * 만들지 못하면 `scenarioId`가 null이고 이유가 `message`에 있다. 만들었어도 버린 값이 있으면 `message`에 경고가 있다.
   */
  saveRunAsScenario(runId: number): { scenarioId: string | null; message: string | null }
  /** 이름을 바꾼다. 문제가 있으면 오류 메시지를 돌려주고 바꾸지 않는다. */
  renameScenario(id: string, name: string): string | null
  /** 메모를 바꾼다(빈 문자열이면 메모를 지운다). 길이 상한을 넘는 부분은 버린다. */
  setScenarioNote(id: string, note: string): void
  deleteScenario(id: string): void
  setActiveScenario(id: string | null): void
  /** 시나리오의 파라미터 하나를 바꾼다. 기본 설정과 같은 값이면 override를 지운다. 문제가 있으면 오류 메시지. */
  setScenarioOverride(id: string, name: string, value: number): string | null
  /** 한 항목을 기본 설정 값으로 되돌린다(override 삭제). */
  resetScenarioValue(id: string, name: string): void
  /** 모든 항목을 기본 설정으로 되돌린다. */
  resetScenarioOverrides(id: string): void
  /**
   * 기준과 시나리오를 목록 순서대로 하나씩 실행한다. `missing`은 결과가 없거나 오래된 행만(입력이 같은
   * 결과는 캐시에서 가져온다), `all`은 모두 다시 실행한다. `ids`를 주면 그 행만 다시 실행한다.
   * 다른 실행이 진행 중이거나 입력 오류가 있으면 null.
   */
  runScenarios(mode: RunMode, ids?: string[]): Promise<BatchOutcome | null>
  /** 일괄 실행을 취소한다. 실행 중인 입력과 대기 중인 입력을 멈추고 끝난 결과는 유지한다. */
  cancelBatch(): void
  /**
   * 시나리오(또는 `BASE_ID`가 아닌 기준 `@base`)를 채택해 계획 기준선 스냅샷을 만든다. 이전 채택은 해제된다.
   * 최신 결과가 있고 종료 시각 안에 끝난 시나리오만 채택할 수 있다. 문제가 있으면 오류 메시지를 돌려준다.
   */
  adoptScenario(id: string): string | null
  /** 계획서의 계획 곡선(CSV)을 PV로 쓰는 채택 계획을 만든다(CTL-11). 실패하면 이유를 돌려준다. */
  adoptPlanCurve(curve: PlanCurve, fileName: string): string | null
  /** 채택을 해제한다(스냅샷을 지운다). */
  releaseAdoption(): void
  /** 비교 막대·레이더·시계열 차트에 그 열을 표시할지 바꾼다. */
  toggleCompareVisible(id: string): void
}

export const createScenarioSlice: SliceCreator<ScenarioSlice> = (set, get) => ({
  scenarios: [],
  adopted: null,
  activeScenarioId: null,
  scenarioRuns: {},
  batch: null,
  lastBatch: null,
  compareHidden: {},

  setScenarios: (scenarios) => set({ scenarios }),

  addScenario() {
    const { scenarios } = get()
    if (!canAddScenario(scenarios.length)) return null
    const id = nextScenarioId(scenarios)
    set({ scenarios: [...scenarios, { id, name: nextScenarioName(scenarios), overrides: {} }], activeScenarioId: id })
    return id
  },

  duplicateScenario(id) {
    const { scenarios } = get()
    const index = scenarios.findIndex((sc) => sc.id === id)
    if (index < 0 || !canAddScenario(scenarios.length)) return null
    const original = scenarios[index] as Scenario
    const copy: Scenario = {
      id: nextScenarioId(scenarios),
      name: copyScenarioName(original.name, scenarios),
      ...(original.note !== undefined ? { note: original.note } : {}),
      overrides: { ...original.overrides }
    }
    set({ scenarios: [...scenarios.slice(0, index + 1), copy, ...scenarios.slice(index + 1)], activeScenarioId: copy.id })
    return copy.id
  },

  saveRunAsScenario(runId) {
    const s = get()
    const run = s.runs.find((r) => r.id === runId)
    if (!run) return { scenarioId: null, message: '실행 기록을 찾을 수 없습니다.' }
    if (!canAddScenario(s.scenarios.length)) return { scenarioId: null, message: '시나리오를 더 만들 수 없습니다(최대 12개). 하나를 지운 뒤 저장하세요.' }
    const bounds = paramSpecs(getEntry(s.modelId)).map((x) => ({ name: x.name, min: x.min, max: x.max, ...(x.integer ? { integer: true } : {}) }))
    const { overrides, warnings } = sanitizeOverrides(s.params, run.params, bounds)
    if (Object.keys(overrides).length === 0 && warnings.length === 0) return { scenarioId: null, message: '이 실행은 지금 기본 설정과 값이 같아 시나리오로 저장할 내용이 없습니다.' }
    // 실행 이름("#3 추가 투입 30명")에서 번호를 떼어 시나리오 이름으로 쓴다. 겹치거나 길면 "실행 #3", 그래도 안 되면 기본 이름.
    const described = run.name.replace(/^#\d+\s*/, '')
    const name = [described, `실행 #${run.id}`].find((n) => n !== '기준' && validateScenarioName(n, s.scenarios) === null) ?? nextScenarioName(s.scenarios)
    const id = nextScenarioId(s.scenarios)
    set({ scenarios: [...s.scenarios, { id, name: name.trim(), note: `실험 탭의 실행 #${run.id}에서 저장`, overrides }], activeScenarioId: id })
    return { scenarioId: id, message: warnings.length > 0 ? warnings.join(' ') : null }
  },

  renameScenario(id, name) {
    const { scenarios } = get()
    const error = validateScenarioName(name, scenarios, id)
    if (error) return error
    const trimmed = name.trim()
    set({ scenarios: scenarios.map((sc) => (sc.id === id ? { ...sc, name: trimmed } : sc)) })
    return null
  },

  setScenarioNote(id, note) {
    const cut = note.slice(0, MAX_SCENARIO_NOTE)
    set((st) => ({
      scenarios: st.scenarios.map((sc) => {
        if (sc.id !== id) return sc
        const { note: _old, ...rest } = sc
        return cut === '' ? rest : { ...rest, note: cut }
      })
    }))
  },

  deleteScenario(id) {
    set((st) => {
      const { [id]: _removed, ...runs } = st.scenarioRuns
      const { [id]: _hidden, ...hidden } = st.compareHidden
      return {
        compareHidden: hidden,
        // 채택한 시나리오를 지우면 채택도 해제된다(스냅샷은 시나리오에 매여 있다).
        adopted: st.adopted?.scenarioId === id ? null : st.adopted,
        revisions: st.adopted?.scenarioId === id ? [] : st.revisions,
        scenarios: st.scenarios.filter((sc) => sc.id !== id),
        activeScenarioId: st.activeScenarioId === id ? null : st.activeScenarioId,
        scenarioRuns: runs
      }
    })
  },

  setActiveScenario: (id) => set({ activeScenarioId: id }),

  setScenarioOverride(id, name, value) {
    const st = get()
    const sc = st.scenarios.find((x) => x.id === id)
    if (!sc) return '시나리오를 찾을 수 없습니다'
    const specs = paramSpecs(getEntry(st.modelId))
    const spec = specs.find((x) => x.name === name)
    if (!spec) return `알 수 없는 항목 '${name}'`
    const checked = parseParam(String(value), spec)
    if ('error' in checked) return checked.error
    const bounds = specs.map((x) => ({ name: x.name, min: x.min, max: x.max, ...(x.integer ? { integer: true } : {}) }))
    // 기본 설정과 같은 값은 override에서 빠지고, 나머지 항목도 함께 정리된다.
    const { overrides } = sanitizeOverrides(st.params, { ...sc.overrides, [name]: value }, bounds)
    set({ scenarios: st.scenarios.map((x) => (x.id === id ? { ...x, overrides } : x)) })
    return null
  },

  resetScenarioValue: (id, name) =>
    set((st) => ({
      scenarios: st.scenarios.map((sc) => {
        if (sc.id !== id) return sc
        const { [name]: _removed, ...rest } = sc.overrides
        return { ...sc, overrides: rest }
      })
    })),

  resetScenarioOverrides: (id) =>
    set((st) => ({ scenarios: st.scenarios.map((sc) => (sc.id === id ? { ...sc, overrides: {} } : sc)) })),

  async runScenarios(mode, ids) {
    const s = get()
    if (busyReason(s) !== null || Object.keys(s.paramErrors).length > 0 || checkRunSettings(s.runSettings)) return null
    const inputs = { modelId: s.modelId, params: s.params, settings: s.runSettings, scenarios: s.scenarios }
    const wanted = ids ? new Set(ids) : null
    const tasks = allTasks(inputs).filter((t) => !wanted || wanted.has(t.id))
    const plan = planBatch(tasks, s.scenarioRuns, rt.resultCache, ids ? 'all' : mode)

    const control = createControl()
    rt.batchControl = control
    set({ batch: { total: plan.groups.length, done: 0 }, lastBatch: null })
    const exists = (id: string) => id === BASE_ID || get().scenarios.some((sc) => sc.id === id)
    try {
      const outcome = await executeBatch(
        plan,
        {
          cache: rt.resultCache,
          start: (task, onProgress) =>
            startRun({ modelId: task.modelId, overrides: task.params, options: task.settings }, (p) => onProgress(p.fraction)),
          update: (rowIds, patch) =>
            set((st) => {
              const next = { ...st.scenarioRuns }
              for (const id of rowIds) if (exists(id)) next[id] = { ...(next[id] ?? EMPTY_RUN), ...patch }
              return { scenarioRuns: next }
            }),
          onGroupFinished: () => set((st) => (st.batch ? { batch: { ...st.batch, done: st.batch.done + 1 } } : {}))
        },
        control
      )
      set({ lastBatch: outcome })
      return outcome
    } finally {
      rt.batchControl = null
      set({ batch: null })
    }
  },

  cancelBatch: () => rt.batchControl?.cancel(),

  adoptScenario(id) {
    const s = get()
    const inputs = { modelId: s.modelId, params: s.params, settings: s.runSettings, scenarios: s.scenarios }
    const runKey = id === BASE_SCENARIO_ID ? BASE_ID : id
    const task = taskFor(inputs, runKey)
    if (!task) return '시나리오를 찾을 수 없습니다.'
    const name = id === BASE_SCENARIO_ID ? '기준' : (s.scenarios.find((x) => x.id === id)?.name ?? id)
    const made = createAdoption({ entry: getEntry(s.modelId), scenarioId: id, scenarioName: name, task, run: s.scenarioRuns[runKey] })
    if (!made.ok) return made.message
    // 새로 채택하면 이전 기준선에 매인 개정 이력과 조치 시험은 의미가 없어진다.
    set({ adopted: made.adopted, revisions: [], actionRun: null, reforecast: null })
    return null
  },

  adoptPlanCurve(curve, fileName) {
    const s = get()
    const made = createAdoptionFromPlan({ entry: getEntry(s.modelId), params: s.params, settings: s.runSettings, curve, fileName })
    if (!made.ok) return made.message
    set({ adopted: made.adopted, revisions: [], actionRun: null, reforecast: null })
    return null
  },

  releaseAdoption: () => set({ adopted: null, revisions: [], actionRun: null, reforecast: null }),

  toggleCompareVisible: (id) =>
    set((st) => {
      const { [id]: was, ...rest } = st.compareHidden
      return { compareHidden: was ? rest : { ...rest, [id]: true as const } }
    })
})
