import { type OatResult, type SweepResult, templateDist, type DistSpec, type McResult, type McTarget } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { getCompiledModel } from '../../engine/models'
import { startMonteCarlo } from '../../engine/engineClient'
import { BASE_ID } from '../../lib/scenarioRunner'
import { paramSpecs } from '../../lib/params'
import { buildInputSpecs, compareKey, compareProblems, defaultRiskSettings, MAX_COMPARE, MAX_RISK_INPUTS, riskBaseParams, riskKey, riskProblems, type RiskInput, type RiskSettings } from '../../lib/risk'
import { computeOat, computeSweep, oatKey, sweepKey, sweepProblem, type SweepRequest } from '../../lib/riskSensitivity'
import { rt } from '../runtime'
import { busyReason } from '../busy'
import type { AppState, SliceCreator } from '../state'

/** 위험 분석(Monte Carlo) 실행 상태. 결과는 파일에 저장하지 않는다(설정과 시드로 재현한다). */
export interface RiskRunState {
  /** 입력 식별 키(`riskKey`). 지금 입력의 키와 다르면 "오래됨" */
  key: string
  status: 'running' | 'done' | 'canceled' | 'error'
  /** 끝난 반복 수와 전체 */
  completed: number
  total: number
  /** 최종(또는 취소 시 부분) 결과 */
  result: McResult | null
  /** 실행 중에 가끔 오는 중간 결과 */
  partial: McResult | null
  error: string | null
}

/** 시나리오 간 비교(설계 06의 5.4) 실행 상태. 같은 입력 분포·시드로 시나리오마다 한 번씩 순서대로 실행한다. */
export interface RiskCompareState {
  /** 대상 시나리오별 `riskKey`를 묶은 키(`compareKey`). 지금 입력의 키와 다르면 "오래됨" */
  key: string
  status: 'running' | 'done' | 'canceled' | 'error'
  /** 끝난 시나리오의 결과(실행 순서). 취소하면 끝나지 않은 것은 없다. */
  results: { id: string; result: McResult }[]
  /** 지금 실행 중인 시나리오 번호(0부터)와 그 안의 끝난 반복 수, 반복 전체 */
  index: number
  completed: number
  total: number
  error: string | null
}

/** 민감도 결과(즉시 계산, 파일에 저장하지 않는다). 입력이 바뀌면 키가 달라져 "오래됨". */
export interface RiskSensState {
  oat: { key: string; result: OatResult } | null
  sweep: { key: string; request: SweepRequest; result: SweepResult } | null
}

export interface RiskSlice {
  /** 위험 분석(Monte Carlo) 설정. 파일 저장은 설계 06의 순서 6에서 한다. */
  risk: RiskSettings
  /** 위험 분석 실행 상태와 결과(없으면 null). 파일에 저장하지 않는다. */
  riskRun: RiskRunState | null
  /** 시나리오 간 비교 결과(없으면 null). 파일에 저장하지 않는다. */
  riskCompare: RiskCompareState | null
  /** 민감도 결과. 파일에 저장하지 않는다. */
  riskSens: RiskSensState

  setRiskScenario(id: string): void
  setRiskIterations(n: number): void
  setRiskSeed(seed: number): void
  /** 파라미터를 불확실한 입력으로 더한다(분포는 대상의 현재 값에서 만든 삼각 템플릿). 문제가 있으면 이유. */
  addRiskInput(name: string): string | null
  updateRiskInput(name: string, dist: DistSpec): void
  removeRiskInput(name: string): void
  setRiskTargets(targets: McTarget[]): void
  setRiskBand(variable: string | null): void
  clearRiskRun(): void
  cancelRisk(): void
  /** 비교할 시나리오를 고르거나 뺀다(최대 3개). 꽉 찼으면 이유를 돌려준다. */
  toggleRiskCompare(id: string): string | null
  clearRiskCompare(): void
  /**
   * 고른 시나리오를 같은 표본으로 차례로 실행한다(공통난수). 다른 실행이 진행 중이거나 설정에 문제가 있으면 이유를 돌려주고
   * 실행하지 않는다. 취소하면 끝난 시나리오의 결과만 남는다.
   */
  runRiskCompare(): Promise<string | null>
  /** 입력 분포의 P10/P90으로 한 번에 하나씩 바꾸는 토네이도를 즉시 계산한다. 문제가 있으면 이유. */
  runRiskOat(): string | null
  /** 파라미터 하나를 범위의 k개 수준으로 바꾸는 스윕을 즉시 계산한다. 문제가 있으면 이유. */
  runRiskSweep(request: SweepRequest): string | null
  /**
   * 위험 분석(Monte Carlo)을 실행한다(설계 06의 4장). 다른 실행이 진행 중이거나 설정에 문제가 있으면 이유를 돌려주고 실행하지
   * 않는다. 취소하면 그때까지 끝난 반복의 결과가 남는다.
   */
  runRisk(): Promise<string | null>
}

export const createRiskSlice: SliceCreator<RiskSlice> = (set, get) => ({
  risk: defaultRiskSettings(),
  riskRun: null,
  riskCompare: null,
  riskSens: { oat: null, sweep: null },

  setRiskScenario(id) {
    const s = get()
    if (id !== BASE_ID && !s.scenarios.some((x) => x.id === id)) return
    set({ risk: { ...s.risk, scenarioId: id } })
  },
  setRiskIterations: (n) => set((s) => (Number.isFinite(n) ? { risk: { ...s.risk, n } } : {})),
  setRiskSeed: (seed) => set((s) => (Number.isFinite(seed) ? { risk: { ...s.risk, seed } } : {})),

  addRiskInput(name) {
    const s = get()
    const entry = getEntry(s.modelId)
    const spec = paramSpecs(entry).find((p) => p.name === name)
    if (!spec) return `'${name}'은(는) 이 모델의 입력 항목이 아닙니다.`
    if (s.risk.inputs.some((i) => i.name === name)) return '이미 추가한 입력입니다.'
    if (s.risk.inputs.length >= MAX_RISK_INPUTS) return `불확실한 입력은 최대 ${MAX_RISK_INPUTS}개입니다.`
    const base = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId) ?? s.params
    const dist = templateDist(base[name] ?? 0, { min: spec.min, max: spec.max })
    const input: RiskInput = { name, dist: spec.integer && dist.kind === 'triangular' ? { ...dist, min: Math.ceil(dist.min), mode: Math.round(dist.mode), max: Math.floor(dist.max) } : dist }
    set({ risk: { ...s.risk, inputs: [...s.risk.inputs, input] } })
    return null
  },
  updateRiskInput: (name, dist) => set((s) => ({ risk: { ...s.risk, inputs: s.risk.inputs.map((i) => (i.name === name ? { ...i, dist } : i)) } })),
  removeRiskInput: (name) => set((s) => ({ risk: { ...s.risk, inputs: s.risk.inputs.filter((i) => i.name !== name) } })),
  setRiskTargets: (targets) => set((s) => ({ risk: { ...s.risk, targets } })),
  setRiskBand: (variable) => set((s) => ({ risk: { ...s.risk, bandVariable: variable } })),
  clearRiskRun: () => set({ riskRun: null }),
  cancelRisk: () => rt.riskControl?.cancel(),

  toggleRiskCompare(id) {
    const s = get()
    if (s.risk.compareIds.includes(id)) {
      set({ risk: { ...s.risk, compareIds: s.risk.compareIds.filter((x) => x !== id) } })
      return null
    }
    if (id !== BASE_ID && !s.scenarios.some((x) => x.id === id)) return '시나리오를 찾을 수 없습니다.'
    if (s.risk.compareIds.length >= MAX_COMPARE) return `비교는 최대 ${MAX_COMPARE}개입니다.`
    set({ risk: { ...s.risk, compareIds: [...s.risk.compareIds, id] } })
    return null
  },
  clearRiskCompare: () => set({ riskCompare: null }),

  async runRiskCompare() {
    const s = get()
    const busy = busyReason(s)
    if (busy) return busy
    const entry = getEntry(s.modelId)
    const problems = compareProblems(entry, s.risk, s.params, s.scenarios)
    if (problems.length > 0) return problems[0] as string
    const ids = s.risk.compareIds
    const bases = ids.map((id) => riskBaseParams(s.params, s.scenarios, id) as Record<string, number>)
    const key = compareKey(entry, bases, s.runSettings, s.risk)
    const total = s.risk.n
    const results: { id: string; result: McResult }[] = []
    const update = (patch: Partial<RiskCompareState>) =>
      set((st) => (st.riskCompare?.key === key ? { riskCompare: { ...st.riskCompare, ...patch } } : {}))
    set({ riskCompare: { key, status: 'running', results: [], index: 0, completed: 0, total, error: null } })
    try {
      for (let i = 0; i < ids.length; i++) {
        update({ index: i, completed: 0 })
        const current = startMonteCarlo(
          {
            modelId: s.modelId,
            overrides: bases[i] as Record<string, number>,
            options: { end: s.runSettings.end, dt: s.runSettings.dt },
            inputs: buildInputSpecs(entry, s.risk.inputs),
            n: total,
            seed: s.risk.seed,
            band: null
          },
          (completed) => update({ completed })
        )
        rt.riskControl = current
        const { result, canceled } = await current.promise
        // 실행하는 동안 프로젝트가 바뀌었으면(새 프로젝트·열기) 결과를 버린다.
        if (get().riskCompare?.key !== key) return null
        if (canceled) {
          // 일부만 끝난 시나리오는 다른 시나리오와 쌍을 이룰 수 없으므로 버린다.
          set({ riskCompare: { key, status: 'canceled', results, index: i, completed: result.completed, total, error: null } })
          return null
        }
        results.push({ id: ids[i] as string, result })
        update({ results: [...results] })
      }
      update({ status: 'done', index: ids.length - 1, completed: total })
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      update({ status: 'error', error: message })
      return message
    } finally {
      rt.riskControl = null
    }
  },

  runRiskOat() {
    const s = get()
    const busy = busyReason(s)
    if (busy) return busy
    const entry = getEntry(s.modelId)
    if (s.risk.inputs.length === 0) return '불확실한 입력을 하나 이상 추가하세요.'
    const base = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId)
    if (base === null) return '대상 시나리오를 찾을 수 없습니다.'
    const problems = riskProblems(entry, { ...s.risk, n: Math.max(s.risk.n, 20) }, s.params, s.scenarios)
    if (problems.length > 0) return problems[0] as string
    try {
      const result = computeOat(getCompiledModel(s.modelId), entry, base, s.runSettings, s.risk.inputs)
      set({ riskSens: { ...s.riskSens, oat: { key: oatKey(entry, base, s.runSettings, s.risk.inputs), result } } })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },

  runRiskSweep(request) {
    const s = get()
    const busy = busyReason(s)
    if (busy) return busy
    const entry = getEntry(s.modelId)
    const base = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId)
    if (base === null) return '대상 시나리오를 찾을 수 없습니다.'
    const problem = sweepProblem(entry, request)
    if (problem) return problem
    try {
      const result = computeSweep(getCompiledModel(s.modelId), entry, base, s.runSettings, request)
      set({ riskSens: { ...s.riskSens, sweep: { key: sweepKey(entry, base, s.runSettings, request), request, result } } })
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  },

  async runRisk() {
    const s = get()
    const busy = busyReason(s)
    if (busy) return busy
    const entry = getEntry(s.modelId)
    const problems = riskProblems(entry, s.risk, s.params, s.scenarios)
    if (problems.length > 0) return problems[0] as string
    const baseParams = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId) as Record<string, number>
    const key = riskKey(entry, baseParams, s.runSettings, s.risk)
    const total = s.risk.n
    set({ riskRun: { key, status: 'running', completed: 0, total, result: null, partial: null, error: null } })
    const current = startMonteCarlo(
      {
        modelId: s.modelId,
        overrides: baseParams,
        options: { end: s.runSettings.end, dt: s.runSettings.dt },
        inputs: buildInputSpecs(entry, s.risk.inputs),
        n: total,
        seed: s.risk.seed,
        band: s.risk.bandVariable ? { variable: s.risk.bandVariable } : null
      },
      (completed, _total, snapshot) =>
        set((st) => (st.riskRun?.key === key && st.riskRun.status === 'running' ? { riskRun: { ...st.riskRun, completed, partial: snapshot ?? st.riskRun.partial } } : {}))
    )
    rt.riskControl = current
    try {
      const { result, canceled } = await current.promise
      // 실행하는 동안 프로젝트가 바뀌었으면(새 프로젝트·열기) 결과를 버린다.
      if (get().riskRun?.key !== key) return null
      set({ riskRun: { key, status: canceled ? 'canceled' : 'done', completed: result.completed, total, result, partial: null, error: null } })
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (get().riskRun?.key === key) set({ riskRun: { key, status: 'error', completed: 0, total, result: null, partial: null, error: message } })
      return message
    } finally {
      rt.riskControl = null
    }
  }
})

/** 위험 분석 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없으면 false. */
export function selectRiskStale(s: AppState): boolean {
  if (!s.riskRun || s.riskRun.status === 'running') return false
  const entry = getEntry(s.modelId)
  const base = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId)
  return base === null || riskKey(entry, base, s.runSettings, s.risk) !== s.riskRun.key
}

/** 시나리오 간 비교 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없으면 false. */
export function selectCompareStale(s: AppState): boolean {
  if (!s.riskCompare || s.riskCompare.status === 'running') return false
  const entry = getEntry(s.modelId)
  const bases = s.risk.compareIds.map((id) => riskBaseParams(s.params, s.scenarios, id))
  if (bases.some((b) => b === null)) return true
  return compareKey(entry, bases as Record<string, number>[], s.runSettings, s.risk) !== s.riskCompare.key
}

/** 토네이도(OAT) 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없으면 false. 원시값을 돌려줘야 구독이 안정적이다. */
export function selectOatStale(s: AppState): boolean {
  const oat = s.riskSens.oat
  if (!oat) return false
  const base = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId)
  return base === null || oatKey(getEntry(s.modelId), base, s.runSettings, s.risk.inputs) !== oat.key
}

/** 스윕 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없으면 false. */
export function selectSweepStale(s: AppState): boolean {
  const sweep = s.riskSens.sweep
  if (!sweep) return false
  const base = riskBaseParams(s.params, s.scenarios, s.risk.scenarioId)
  return base === null || sweepKey(getEntry(s.modelId), base, s.runSettings, sweep.request) !== sweep.key
}
