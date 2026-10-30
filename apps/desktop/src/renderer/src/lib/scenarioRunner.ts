import { effectiveParams, inputKey, type Params, type Scenario } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import { getEntry } from '../catalog'

/** 기본 설정("기준")의 행 id. 시나리오 id는 `@`를 쓸 수 없어 겹치지 않는다. */
export const BASE_ID = '@base'

export type Settings = { end: number; dt: number; seed: number }

export interface RunTask {
  id: string
  /** 입력 키(모델·버전·유효 파라미터·실행 설정). 결과 캐시와 "오래됨" 판정의 기준이다. */
  key: string
  modelId: string
  params: Params
  settings: Settings
}

/** 한 행(기준 또는 시나리오)의 실행 상태. 마지막으로 성공한 결과와 진행·오류를 따로 가진다. */
export interface ScenarioRun {
  /** 마지막으로 성공한 결과. 입력이 바뀌면 "오래됨"이 되지만 비교를 위해 남겨 둔다. */
  result?: RunResult
  /** 그 결과를 만든 입력 키 */
  resultKey?: string
  /** 그 결과를 만든 유효 파라미터. 입력이 바뀐 뒤에도 그 결과의 지표를 올바르게 계산하는 데 쓴다. */
  resultParams?: Params
  phase: 'idle' | 'queued' | 'running'
  /** 0~1, `running`일 때만 의미 있다 */
  progress: number
  /** 마지막 실패. 어떤 입력에서 실패했는지 알아야 입력이 바뀌면 지울 수 있다. */
  error?: { message: string; key: string }
}

export const EMPTY_RUN: ScenarioRun = { phase: 'idle', progress: 0 }

export type RowStatus =
  | { kind: 'none' }
  | { kind: 'queued' }
  | { kind: 'running'; progress: number }
  | { kind: 'done' }
  | { kind: 'stale' }
  | { kind: 'error'; message: string }

/** 화면에 보일 상태. `currentKey`는 지금 입력의 키이다. */
export function rowStatus(run: ScenarioRun | undefined, currentKey: string): RowStatus {
  if (!run) return { kind: 'none' }
  if (run.phase === 'running') return { kind: 'running', progress: run.progress }
  if (run.phase === 'queued') return { kind: 'queued' }
  if (run.error && run.error.key === currentKey) return { kind: 'error', message: run.error.message }
  if (run.result && run.resultKey === currentKey) return { kind: 'done' }
  return run.result ? { kind: 'stale' } : { kind: 'none' }
}

/** 입력이 같은 실행의 결과를 재사용하는 LRU 캐시(결과가 크므로 개수를 제한한다). */
export class ResultCache {
  private readonly map = new Map<string, RunResult>()

  constructor(private readonly maxEntries = 30) {}

  get size(): number {
    return this.map.size
  }

  get(key: string): RunResult | undefined {
    const v = this.map.get(key)
    if (v !== undefined) {
      // 최근에 쓴 것으로 옮긴다
      this.map.delete(key)
      this.map.set(key, v)
    }
    return v
  }

  set(key: string, result: RunResult): void {
    this.map.delete(key)
    this.map.set(key, result)
    while (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value as string)
  }

  clear(): void {
    this.map.clear()
  }
}

export interface ScenarioInputs {
  modelId: string
  params: Params
  settings: Settings
  scenarios: Scenario[]
}

/** 행 하나의 실행 입력. 시나리오가 없으면 null. */
export function taskFor(inputs: ScenarioInputs, id: string): RunTask | null {
  let params: Params
  if (id === BASE_ID) params = inputs.params
  else {
    const scenario = inputs.scenarios.find((s) => s.id === id)
    if (!scenario) return null
    params = effectiveParams(inputs.params, scenario)
  }
  const version = getEntry(inputs.modelId).def.meta.version
  return {
    id,
    key: inputKey({ modelId: inputs.modelId, modelVersion: version, params, run: inputs.settings }),
    modelId: inputs.modelId,
    params,
    settings: inputs.settings
  }
}

/** 목록 순서의 모든 행(기준 먼저). */
export function allTasks(inputs: ScenarioInputs): RunTask[] {
  return [BASE_ID, ...inputs.scenarios.map((s) => s.id)].flatMap((id) => taskFor(inputs, id) ?? [])
}

export type RunMode = 'missing' | 'all'

export interface Group {
  key: string
  /** 같은 입력을 가진 행들. 한 번만 실행해 모두에 나눠 준다. */
  ids: string[]
  task: RunTask
}

export interface Plan {
  /** 실제로 실행할 입력(목록 순서의 첫 등장 순) */
  groups: Group[]
  /** 캐시에서 바로 채울 행 */
  fromCache: { ids: string[]; key: string; result: RunResult; params: Params }[]
  /** 이미 최신이라 건드리지 않는 행 */
  skipped: string[]
}

/**
 * 어떤 행을 어떻게 처리할지 정한다.
 *  - `missing`: 결과가 없거나 오래된 행만. 같은 입력에서 이미 실패한 행은 다시 해도 같은 결과라 건너뛰고,
 *    캐시에 결과가 있으면 실행하지 않고 가져온다.
 *  - `all`: 모든 행을 다시 실행한다(캐시를 쓰지 않는다). 같은 입력의 행은 한 번만 실행한다.
 */
export function planBatch(tasks: RunTask[], rows: Record<string, ScenarioRun | undefined>, cache: ResultCache, mode: RunMode): Plan {
  const plan: Plan = { groups: [], fromCache: [], skipped: [] }
  const byKey = new Map<string, Group>()
  const cachedByKey = new Map<string, { ids: string[]; key: string; result: RunResult; params: Params }>()

  for (const task of tasks) {
    const row = rows[task.id]
    const fresh = row?.result !== undefined && row.resultKey === task.key
    const failedSame = row?.error?.key === task.key
    if (mode === 'missing' && (fresh || failedSame)) {
      plan.skipped.push(task.id)
      continue
    }
    const hit = mode === 'missing' ? cache.get(task.key) : undefined
    if (hit) {
      const entry = cachedByKey.get(task.key) ?? { ids: [], key: task.key, result: hit, params: task.params }
      entry.ids.push(task.id)
      if (!cachedByKey.has(task.key)) {
        cachedByKey.set(task.key, entry)
        plan.fromCache.push(entry)
      }
      continue
    }
    const group = byKey.get(task.key)
    if (group) group.ids.push(task.id)
    else {
      const g: Group = { key: task.key, ids: [task.id], task }
      byKey.set(task.key, g)
      plan.groups.push(g)
    }
  }
  return plan
}

export interface RunHandle {
  promise: Promise<RunResult>
  cancel(): void
}

export interface BatchDeps {
  /** 한 입력을 실행한다. 취소되면 `meta.completed = false`인 결과로 끝난다. 오류면 reject. */
  start(task: RunTask, onProgress: (fraction: number) => void): RunHandle
  /** 행 상태를 갱신한다(얕은 병합). */
  update(ids: string[], patch: Partial<ScenarioRun>): void
  cache: ResultCache
  /** 입력 하나의 처리가 끝날 때마다 호출한다(성공, 실패, 취소 모두). 진행 개수 표시용이다. */
  onGroupFinished?: (group: Group) => void
}

export interface BatchOutcome {
  completed: number
  failed: number
  canceled: boolean
}

export interface BatchControl {
  cancel(): void
  readonly canceled: boolean
}

export function createControl(): BatchControl & { setCurrent(h: RunHandle | null): void } {
  let canceled = false
  let current: RunHandle | null = null
  return {
    get canceled() {
      return canceled
    },
    cancel() {
      canceled = true
      current?.cancel()
    },
    setCurrent(h) {
      current = h
      if (canceled) h?.cancel()
    }
  }
}

/**
 * 계획한 입력을 목록 순서대로 하나씩 실행한다.
 *  - 한 입력이 실패해도 나머지는 계속한다. 실패한 행에는 오류와 그 입력 키를 남긴다.
 *  - 취소하면 실행 중인 입력과 대기 중인 입력을 멈추고, 끝난 결과는 그대로 둔다. 멈춘 행은 이전 결과를 유지한다.
 *  - 성공한 결과는 캐시에 넣는다.
 */
export async function executeBatch(plan: Plan, deps: BatchDeps, control: ReturnType<typeof createControl>): Promise<BatchOutcome> {
  const { start, update, cache } = deps
  const outcome: BatchOutcome = { completed: 0, failed: 0, canceled: false }

  for (const hit of plan.fromCache) {
    update(hit.ids, { result: hit.result, resultKey: hit.key, resultParams: hit.params, error: undefined })
  }
  update(plan.groups.flatMap((g) => g.ids), { phase: 'queued', progress: 0 })

  let next = 0
  for (; next < plan.groups.length; next++) {
    if (control.canceled) break
    const group = plan.groups[next] as Group
    update(group.ids, { phase: 'running', progress: 0 })
    const handle = start(group.task, (fraction) => update(group.ids, { progress: fraction }))
    control.setCurrent(handle)
    try {
      const result = await handle.promise
      if (!result.meta.completed) {
        update(group.ids, { phase: 'idle', progress: 0 })
        outcome.canceled = true
        next++
        break
      }
      cache.set(group.key, result)
      update(group.ids, { phase: 'idle', progress: 0, result, resultKey: group.key, resultParams: group.task.params, error: undefined })
      outcome.completed += group.ids.length
    } catch (e) {
      update(group.ids, { phase: 'idle', progress: 0, error: { message: e instanceof Error ? e.message : String(e), key: group.key } })
      outcome.failed += group.ids.length
    } finally {
      control.setCurrent(null)
      deps.onGroupFinished?.(group)
    }
  }

  // 시작하지 못한 대기 행을 되돌린다
  const rest = plan.groups.slice(next).flatMap((g) => g.ids)
  if (rest.length > 0) {
    update(rest, { phase: 'idle', progress: 0 })
    outcome.canceled = true
  }
  return outcome
}
