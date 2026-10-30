import { getEntry } from '../../catalog'
import { evmOf } from '../../catalog/evm'
import { startReforecast } from '../../engine/engineClient'
import { actionChanges, buildRevisionBaseline, cloneEvmSettings, DEFAULT_EVM_SETTINGS, getAction, MAX_ACTUAL_ROWS, MAX_CANDIDATES, MAX_REVISIONS, MAX_REVISION_REASON, baselineOfPoint, defaultActionValues, describeAction, validateAction, type ActionInput, type ActionKind, type ActualRow, type EvmSettings, type ReforecastOutcome, type Revision } from '@spd/analysis'
import { buildControlView, kappasOf, reforecastUnsupported } from '../../lib/control'
import { reforecastKey } from '../../lib/reforecastView'
import { busyReason } from '../busy'
import type { SliceCreator } from '../state'

/** 시뮬레이션 기반 재예측의 상태. 파일에 저장하지 않는다(입력이 같으면 다시 계산할 수 있다). */
export interface ReforecastState {
  /** 입력 식별 키(`reforecastKey`). 지금 입력의 키와 다르면 "오래됨" */
  key: string
  day: number
  status: 'running' | 'done' | 'error'
  outcome: ReforecastOutcome | null
  error: string | null
}

/** 시정 조치 후보 한 건(파일에 저장하지 않는다. 개정 이력에는 채택한 조치만 남는다). */
export interface Candidate {
  id: string
  input: ActionInput
}

export interface ActionRunEntry {
  /** `none`(조치 없음) 또는 후보 id */
  id: string
  label: string
  outcome: ReforecastOutcome
}

/** 조치 후보 비교의 상태. 파일에 저장하지 않는다. */
export interface ActionRunState {
  key: string
  day: number
  /** 모든 후보에 같게 쓴 생산성 보정 계수(누적과 최근 구간 κ의 평균) */
  kappa: number
  status: 'running' | 'done' | 'error'
  entries: ActionRunEntry[]
  error: string | null
}

export interface ControlSlice {
  /** 실적(보고일별 누적값). 오류 있는 행도 입력 그대로 보관하고 계산에서만 제외한다. */
  actuals: ActualRow[]
  /** 경고 임계값·구간 설정 */
  evm: EvmSettings
  /** 기준선 개정 이력(오래된 것부터). 파일에 저장한다. */
  revisions: Revision[]
  /** 재예측 결과(없으면 null). 파일에 저장하지 않는다. */
  reforecast: ReforecastState | null
  /** 조치 후보 비교 결과(없으면 null). 파일에 저장하지 않는다. */
  actionRun: ActionRunState | null
  /** 시정 조치 후보(최대 6). 파일에 저장하지 않는다. */
  candidates: Candidate[]

  /** 실적 한 줄을 끝에 더한다(이전 줄의 값을 이어받고 보고일은 7일 뒤). 새 줄의 위치, 가득 찼으면 null. */
  addActual(): number | null
  updateActual(index: number, patch: Partial<Omit<ActualRow, 'cum'>> & { cum?: Record<string, number> }): void
  removeActual(index: number): void
  clearActuals(): void
  /** 실적 전체를 바꾼다(CSV 가져오기·증분 입력 결과). 한도를 넘으면 false. */
  setActuals(rows: ActualRow[]): boolean
  setEvmSettings(evm: EvmSettings): void
  clearReforecast(): void
  /** 조치 후보를 더한다(처음 값은 모델의 현재 상수에서 제안). 상한이면 null. */
  addCandidate(kind: ActionKind, day?: number): string | null
  updateCandidate(id: string, patch: { kind?: ActionKind; values?: Record<string, number>; day?: number }): void
  removeCandidate(id: string): void
  /**
   * 보고일에서 "조치 없음"과 후보들을 같은 κ로 이어 실행해 비교한다(설계 05의 8.2). 할 수 없으면 이유를 돌려준다.
   */
  runActions(day: number): Promise<string | null>
  /**
   * 비교한 항목(`none` 또는 후보 id)으로 기준선을 개정한다(설계 05의 8.3). 사유가 필요하다. 문제가 있으면 이유를 돌려준다.
   */
  reviseWith(entryId: string, reason: string): string | null
  /** 가장 최근 개정을 되돌린다(그 전 기준선이 다시 쓰인다). */
  undoLastRevision(): void
  /**
   * 채택 계획을 보고일(`day`)까지 실행해 실적으로 상태를 덮어쓰고 κ를 곱해 이어서 실행한다(설계 05의 7.2).
   * 누적 CPI와 최근 구간 CPI로 두 번 실행해 범위를 낸다. 할 수 없으면 이유를 돌려주고 상태를 바꾸지 않는다.
   */
  runReforecast(day: number): Promise<string | null>
}

export const createControlSlice: SliceCreator<ControlSlice> = (set, get) => ({
  actuals: [],
  evm: cloneEvmSettings(DEFAULT_EVM_SETTINGS),
  revisions: [],
  reforecast: null,
  actionRun: null,
  candidates: [],

  addActual() {
    const rows = get().actuals
    if (rows.length >= MAX_ACTUAL_ROWS) return null
    const last = rows[rows.length - 1]
    const row: ActualRow = last
      ? { day: last.day + 7, cum: { ...last.cum }, effort: last.effort }
      : { day: 7, cum: Object.fromEntries((getEntry(get().modelId).evm?.credits ?? []).map((c) => [c.variable, 0])), effort: 0 }
    set({ actuals: [...rows, row] })
    return rows.length
  },

  updateActual: (index, patch) =>
    set((s) => ({
      actuals: s.actuals.map((r, i) => {
        if (i !== index) return r
        const { cum, ...rest } = patch
        return { ...r, ...rest, cum: cum ? { ...r.cum, ...cum } : r.cum }
      })
    })),

  removeActual: (index) => set((s) => ({ actuals: s.actuals.filter((_, i) => i !== index) })),

  clearActuals: () => set({ actuals: [] }),

  setActuals(rows) {
    if (rows.length > MAX_ACTUAL_ROWS) return false
    set({ actuals: structuredClone(rows) })
    return true
  },

  setEvmSettings: (evm) => set({ evm: cloneEvmSettings(evm) }),

  clearReforecast: () => set({ reforecast: null }),

  addCandidate(kind, day) {
    const s = get()
    if (s.candidates.length >= MAX_CANDIDATES) return null
    const n = s.candidates.reduce((m, c) => Math.max(m, Number(c.id.slice(1)) || 0), 0) + 1
    const id = `c${n}`
    const start = day ?? 0
    set({ candidates: [...s.candidates, { id, input: { kind, values: defaultActionValues(kind, s.adopted?.params ?? s.params), day: start } }] })
    return id
  },

  updateCandidate: (id, patch) =>
    set((s) => ({
      candidates: s.candidates.map((c) => {
        if (c.id !== id) return c
        const kind = patch.kind ?? c.input.kind
        const values = patch.kind && patch.kind !== c.input.kind ? defaultActionValues(kind, s.adopted?.params ?? s.params) : { ...c.input.values, ...patch.values }
        return { id, input: { kind, values, day: patch.day ?? c.input.day } }
      })
    })),

  removeCandidate: (id) => set((s) => ({ candidates: s.candidates.filter((c) => c.id !== id) })),

  async runActions(day) {
    const s = get()
    if (!s.adopted) return '채택한 계획이 없습니다.'
    const unsupported = reforecastUnsupported(s.modelId, getEntry(s.modelId).title)
    if (unsupported) return unsupported
    if (s.actionRun?.status === 'running') return '조치 시험이 이미 실행 중입니다.'
    const busy = busyReason(s)
    if (busy) return busy
    if (s.candidates.length === 0) return '후보를 하나 이상 추가하세요.'
    const entry = getEntry(s.modelId)
    if (s.adopted.model.id !== entry.id) return '채택 계획의 모델이 현재 모델과 다릅니다.'
    const view = buildControlView(s.adopted, s.actuals, { credits: evmOf(entry).credits, totalTasks: evmOf(entry).totalTasks(s.params) }, s.evm, { revisions: s.revisions })
    const point = view.points.find((p) => p.day === day)
    if (!point) return '이 보고일의 지표를 계산할 수 없습니다(오류가 있는 행은 제외됩니다).'
    const row = s.actuals[point.index] as ActualRow
    for (const [i, c] of s.candidates.entries()) {
      const problem = validateAction(c.input, { modelId: s.modelId, atDay: row.day, end: s.adopted.run.end })
      if (problem) return `후보 ${i + 1}(${getAction(c.input.kind).label}): ${problem}`
    }
    const ks = kappasOf(point, s.revisions)
    const have = [ks.cum, ks.recent].filter((x): x is number => x !== null)
    if (have.length === 0) return '비용 지수(CPI)를 계산할 수 없어 생산성 보정 계수를 정할 수 없습니다(공수가 0이거나 획득 가치가 0).'
    const kappa = have.reduce((a, b) => a + b, 0) / have.length
    const key = JSON.stringify([reforecastKey(s.adopted, row, s.evm.k), s.revisions.length, kappa, s.candidates])
    const items: { id: string; label: string; changes: ReturnType<typeof actionChanges> }[] = [
      { id: 'none', label: '조치 없음', changes: [] },
      ...s.candidates.map((c) => ({ id: c.id, label: describeAction(c.input), changes: actionChanges(c.input, { modelId: s.modelId }) }))
    ]
    set({ actionRun: { key, day, kappa, status: 'running', entries: [], error: null } })
    try {
      const outcomes = await Promise.all(
        items.map((it) =>
          startReforecast({
            modelId: s.modelId,
            overrides: s.adopted!.params,
            options: { end: s.adopted!.run.end, dt: s.adopted!.run.dt, seed: s.adopted!.run.seed },
            observed: { day: row.day, cum: row.cum, effort: row.effort, ...(row.headcount !== undefined ? { headcount: row.headcount } : {}) },
            kappas: [{ name: 'k', kappa }],
            changes: it.changes
          })
        )
      )
      if (get().actionRun?.key !== key) return null
      set({ actionRun: { key, day, kappa, status: 'done', entries: items.map((it, i) => ({ id: it.id, label: it.label, outcome: outcomes[i] as ReforecastOutcome })), error: null } })
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (get().actionRun?.key === key) set({ actionRun: { key, day, kappa, status: 'error', entries: [], error: message } })
      return message
    }
  },

  reviseWith(entryId, reason) {
    const s = get()
    const run = s.actionRun
    if (!s.adopted) return '채택한 계획이 없습니다.'
    if (!run || run.status !== 'done') return '먼저 조치 후보를 실행해 비교하세요.'
    const entry = getEntry(s.modelId)
    const view = buildControlView(s.adopted, s.actuals, { credits: evmOf(entry).credits, totalTasks: evmOf(entry).totalTasks(s.params) }, s.evm, { revisions: s.revisions })
    const point = view.points.find((p) => p.day === run.day)
    if (!point) return '비교한 보고일의 지표가 없어졌습니다. 다시 실행하세요.'
    const row = s.actuals[point.index] as ActualRow
    const key = JSON.stringify([reforecastKey(s.adopted, row, s.evm.k), s.revisions.length, run.kappa, s.candidates])
    if (key !== run.key) return '실적·계획·후보가 바뀌어 비교 결과가 오래되었습니다. 다시 실행하세요.'
    const trimmed = reason.trim()
    if (trimmed === '') return '개정 사유를 입력하세요.'
    if (trimmed.length > MAX_REVISION_REASON) return `사유는 ${MAX_REVISION_REASON}자 이하여야 합니다.`
    if (s.revisions.length >= MAX_REVISIONS) return `개정은 최대 ${MAX_REVISIONS}번입니다.`
    const last = s.revisions[s.revisions.length - 1]
    if (last && !(row.day > last.day)) return `이미 ${last.day}일에 개정했습니다. 그 이후 보고일로 개정하세요.`
    const picked = run.entries.find((e) => e.id === entryId)
    if (!picked) return '선택한 후보를 찾을 수 없습니다.'
    const candidate = s.candidates.find((c) => c.id === entryId)
    const tail = (picked.outcome.runs[0] as { result: import('@spd/sd-engine').RunResult }).result
    const current = baselineOfPoint(s.adopted, s.revisions, point)
    const evm = evmOf(entry)
    const progress = evm.credits.reduce((sum, c) => sum + c.weight * (row.cum[c.variable] ?? 0), 0) / s.adopted.totalTasks
    let built
    try {
      built = buildRevisionBaseline({
        current,
        tail,
        credits: s.adopted.credits,
        totalTasks: s.adopted.totalTasks,
        effortVariable: evm.effortVariable,
        completion: evm.completion(tail),
        day: row.day,
        progress
      })
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
    const rev: Revision = {
      number: s.revisions.length + 1,
      revisedAt: new Date().toISOString(),
      day: row.day,
      reason: trimmed,
      action: candidate ? { kind: candidate.input.kind, label: describeAction(candidate.input), values: { ...candidate.input.values }, day: candidate.input.day } : null,
      kappa: run.kappa,
      before: { plannedCompletion: current.plannedCompletion, bac: current.bac },
      after: { plannedCompletion: built.baseline.plannedCompletion, bac: built.baseline.bac },
      ev0: built.ev0,
      ac0: row.effort,
      baseline: built.baseline
    }
    set({ revisions: [...s.revisions, rev], actionRun: null, reforecast: null })
    return null
  },

  undoLastRevision: () => set((s) => ({ revisions: s.revisions.slice(0, -1), actionRun: null, reforecast: null })),

  async runReforecast(day) {
    const s = get()
    if (!s.adopted) return '채택한 계획이 없습니다.'
    const unsupported = reforecastUnsupported(s.modelId, getEntry(s.modelId).title)
    if (unsupported) return unsupported
    if (s.reforecast?.status === 'running') return '재예측이 이미 실행 중입니다.'
    const busy = busyReason(s)
    if (busy) return busy
    const entry = getEntry(s.modelId)
    if (s.adopted.model.id !== entry.id) return '채택 계획의 모델이 현재 모델과 다릅니다.'
    const view = buildControlView(s.adopted, s.actuals, { credits: evmOf(entry).credits, totalTasks: evmOf(entry).totalTasks(s.params) }, s.evm, { revisions: s.revisions })
    const point = view.points.find((p) => p.day === day)
    if (!point) return '이 보고일의 지표를 계산할 수 없습니다(오류가 있는 행은 제외됩니다).'
    const row = s.actuals[point.index] as ActualRow
    const kappas: { name: string; kappa: number }[] = []
    const ks = kappasOf(point, s.revisions)
    if (ks.cum !== null) kappas.push({ name: 'cum', kappa: ks.cum })
    if (ks.recent !== null) kappas.push({ name: 'recent', kappa: ks.recent })
    if (kappas.length === 0) return '비용 지수(CPI)를 계산할 수 없어 생산성 보정 계수를 정할 수 없습니다(공수가 0이거나 획득 가치가 0).'
    const key = reforecastKey(s.adopted, row, s.evm.k)
    set({ reforecast: { key, day, status: 'running', outcome: null, error: null } })
    try {
      const outcome = await startReforecast({
        modelId: s.modelId,
        overrides: s.adopted.params,
        options: { end: s.adopted.run.end, dt: s.adopted.run.dt, seed: s.adopted.run.seed },
        observed: { day: row.day, cum: row.cum, effort: row.effort, ...(row.headcount !== undefined ? { headcount: row.headcount } : {}) },
        kappas
      })
      // 실행하는 동안 프로젝트가 바뀌었으면(새 프로젝트·열기) 결과를 버린다.
      if (get().reforecast?.key !== key) return null
      set({ reforecast: { key, day, status: 'done', outcome, error: null } })
      return null
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (get().reforecast?.key === key) set({ reforecast: { key, day, status: 'error', outcome: null, error: message } })
      return message
    }
  }
})
