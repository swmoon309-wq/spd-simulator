import type { RunResult } from '@spd/sd-engine'
import { getEntry, type Kpis } from '../../catalog'
import { startRun } from '../../engine/engineClient'
import { colorFor } from '../../lib/palette'
import { defaultParams, describeRun } from '../../lib/params'
import { matchVariable, type ParsedReference } from '../../lib/referenceCsv'
import { checkRunSettings, defaultRunSettings, stepsPerStepDays, type RunSettings } from '../../lib/runSettings'
import { rt } from '../runtime'
import { initialEntry, initialParams, initialRun } from '../initial'
import { busyReason } from '../busy'
import type { SliceCreator } from '../state'

export interface RunRecord {
  id: number
  name: string
  color: string
  visible: boolean
  params: Record<string, number>
  result: RunResult
  kpis: Kpis
}

export interface LiveRun {
  time: number[]
  values: Record<string, number[]>
}

/** 외부에서 가져온 기준 행동의 시계열 하나(CSV의 열 하나). 프로젝트 파일에는 저장하지 않는다. */
export interface ReferenceSeries {
  id: number
  fileName: string
  column: string
  /** 연결된 모델 변수. null이면 그래프에 표시되지 않는다. */
  variable: string | null
  points: [number, number][]
  visible: boolean
}

export interface ExperimentSlice {
  modelId: string
  params: Record<string, number>
  runSettings: RunSettings
  /** 입력 오류 메시지(없으면 키 없음). 모델 파라미터는 이름, 실행 설정은 "run:이름" */
  paramErrors: Record<string, string>
  runs: RunRecord[]
  references: ReferenceSeries[]
  status: 'idle' | 'running'
  /** 실행 중인 실행이 멈춰 있는지(일시정지 또는 스텝 사이). `status`는 멈춰 있어도 'running'이다. */
  paused: boolean
  progress: number
  live: LiveRun | null
  error: string | null
  chartVariable: string
  autoRan: boolean

  setParam(name: string, value: number): void
  setRunSetting(key: keyof RunSettings, value: number): void
  setParamError(key: string, message: string | null): void
  resetParams(): void
  setChartVariable(name: string): void
  /** 현재 파라미터(+덮어쓰기)로 실행해 결과를 목록에 추가한다. */
  run(overrides?: Record<string, number>, options?: { startPaused?: boolean }): Promise<void>
  /** 프리셋을 차례로 실행한다. */
  runPresets(presets: Record<string, number>[]): Promise<void>
  cancel(): void
  /** 실행 중인 실행을 멈춘다(다음 청크가 끝난 뒤). 실행 중이 아니면 아무것도 하지 않는다. */
  pause(): void
  /** 멈춘 실행을 끝까지 이어서 실행한다. */
  resume(): void
  /**
   * 1일(`STEP_DAYS`)만큼 진행하고 멈춘다. 실행 중이면 먼저 멈춘 뒤 진행하고, 실행 중이 아니면 시각 0에서 멈춘 새 실행을 시작해
   * 진행한다(다른 실행이 진행 중이거나 입력 오류가 있으면 아무것도 하지 않는다).
   */
  step(): void
  /** 진행 중인 실행을 버리고 같은 입력으로 시각 0에서 멈춘 새 실행을 시작한다. 스텝으로 처음부터 따라갈 때 쓴다. */
  reset(): Promise<void>
  toggleRun(id: number): void
  removeRun(id: number): void
  clearRuns(): void
  /** 가져온 열마다 시계열을 만들고 이름이 맞는 모델 변수에 자동 연결한다. 연결된 열 수를 돌려준다. */
  addReferences(fileName: string, parsed: ParsedReference): number
  setReferenceVariable(id: number, variable: string | null): void
  toggleReference(id: number): void
  removeReference(id: number): void
  clearReferences(): void
  runBaselineOnce(): void
}

export const createExperimentSlice: SliceCreator<ExperimentSlice> = (set, get, api) => ({
  modelId: initialEntry.id,
  params: initialParams,
  runSettings: initialRun,
  paramErrors: {},
  runs: [],
  references: [],
  status: 'idle',
  paused: false,
  progress: 0,
  live: null,
  error: null,
  chartVariable: initialEntry.defaultVariable,
  autoRan: false,

  setParam: (name, value) => set((s) => ({ params: { ...s.params, [name]: value } })),

  setRunSetting: (key, value) => set((s) => ({ runSettings: { ...s.runSettings, [key]: value } })),

  setParamError: (key, message) =>
    set((s) => {
      const next = { ...s.paramErrors }
      if (message === null) delete next[key]
      else next[key] = message
      return { paramErrors: next }
    }),

  resetParams: () =>
    set((s) => {
      const entry = getEntry(s.modelId)
      return { params: defaultParams(entry), runSettings: defaultRunSettings(entry), paramErrors: {} }
    }),

  setChartVariable: (name) => set({ chartVariable: name }),

  async run(overrides = {}, options = {}) {
    const s = get()
    if (busyReason(s) !== null || Object.keys(s.paramErrors).length > 0 || checkRunSettings(s.runSettings)) return
    const entry = getEntry(s.modelId)
    const params = { ...s.params, ...overrides }
    const runSettings = s.runSettings
    set({ status: 'running', paused: options.startPaused === true, progress: 0, error: null, live: { time: [], values: {} } })

    const current = startRun({ modelId: s.modelId, overrides: params, options: runSettings, ...(options.startPaused ? { startPaused: true } : {}) }, (p) =>
      set((st) => {
        const live = st.live ?? { time: [], values: {} }
        live.time.push(p.time)
        for (const [k, v] of Object.entries(p.values)) (live.values[k] ??= []).push(v)
        return { progress: p.fraction, live: { time: live.time, values: live.values } }
      })
    )
    rt.handle = current
    try {
      const result = await current.promise
      if (result.meta.completed) {
        const id = ++rt.runSeq
        const record: RunRecord = {
          id,
          name: `#${id} ${describeRun(entry, params, runSettings)}`,
          color: colorFor(get().runs.length),
          visible: true,
          params,
          result,
          kpis: entry.kpis(result)
        }
        set((st) => ({ runs: [...st.runs, record] }))
      }
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    } finally {
      rt.handle = null
      set({ status: 'idle', paused: false, progress: 0, live: null })
    }
  },

  async runPresets(presets) {
    for (const overrides of presets) {
      // 같은 파라미터의 결과가 이미 있으면 다시 실행하지 않는다(예: 기준과 같은 "추가 없음").
      const params = { ...get().params, ...overrides }
      const exists = get().runs.some((r) => Object.keys(params).every((k) => r.params[k] === params[k]))
      if (exists) continue
      await get().run(overrides)
      if (get().error) break
    }
  },

  cancel: () => rt.handle?.cancel(),

  pause() {
    if (get().status !== 'running' || !rt.handle) return
    rt.handle.pause()
    set({ paused: true })
  },

  resume() {
    if (get().status !== 'running' || !rt.handle) return
    rt.handle.resume()
    set({ paused: false })
  },

  step() {
    const s = get()
    const days = stepsPerStepDays(s.runSettings.dt)
    if (s.status === 'running') {
      if (!rt.handle) return
      rt.handle.step(days)
      set({ paused: true })
      return
    }
    if (busyReason(s) !== null) return
    // `run`은 첫 await 전에 핸들을 만들어 두므로 바로 스텝을 요청할 수 있다. 입력 오류로 시작하지 못했으면 아무것도 하지 않는다.
    void get().run({}, { startPaused: true })
    if (get().status === 'running') rt.handle?.step(days)
  },

  async reset() {
    if (get().status === 'running') {
      rt.handle?.cancel()
      await new Promise<void>((resolve) => {
        if (get().status === 'idle') return resolve()
        const unsubscribe = api.subscribe((st) => {
          if (st.status === 'idle') {
            unsubscribe()
            resolve()
          }
        })
      })
    }
    if (busyReason(get()) !== null) return
    void get().run({}, { startPaused: true })
  },

  toggleRun: (id) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)) })),

  removeRun: (id) => set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),

  clearRuns: () => set({ runs: [] }),

  addReferences(fileName, parsed) {
    const entry = getEntry(get().modelId)
    const added: ReferenceSeries[] = parsed.columns.map((c) => ({
      id: ++rt.refSeq,
      fileName,
      column: c.name,
      variable: matchVariable(entry, c.name),
      points: c.points,
      visible: true
    }))
    set((st) => ({ references: [...st.references, ...added] }))
    return added.filter((r) => r.variable !== null).length
  },

  setReferenceVariable: (id, variable) =>
    set((s) => ({ references: s.references.map((r) => (r.id === id ? { ...r, variable } : r)) })),

  toggleReference: (id) =>
    set((s) => ({ references: s.references.map((r) => (r.id === id ? { ...r, visible: !r.visible } : r)) })),

  removeReference: (id) => set((s) => ({ references: s.references.filter((r) => r.id !== id) })),

  clearReferences: () => set({ references: [] }),

  runBaselineOnce() {
    if (get().autoRan) return
    set({ autoRan: true })
    void get().run()
  }
})
