import type { RunResult } from '@spd/sd-engine'
import type { ModelDoc } from '../lib/modelDoc'
import type { McResult, ReforecastOutcome } from '@spd/analysis'
import type { McRequest, ReforecastRequest, RunRequest, WorkerIn, WorkerOut } from './protocol'

export interface RunProgress {
  time: number
  fraction: number
  values: Record<string, number>
}

export interface McOutcome {
  /** 끝난 반복의 결과(취소했으면 일부) */
  result: McResult
  canceled: boolean
}

export interface McHandle {
  promise: Promise<McOutcome>
  cancel(): void
}

export interface RunHandle {
  /** 끝까지 실행하면 결과, 취소되면 `completed=false`인 부분 결과. 오류면 reject. */
  promise: Promise<RunResult>
  cancel(): void
  /** 다음 청크가 끝나면 멈춘다. 이미 멈춰 있으면 아무것도 하지 않는다. */
  pause(): void
  /** 멈춘 실행을 끝까지 이어서 실행한다. */
  resume(): void
  /** 멈춘 채로 `steps` 스텝(적분 간격) 진행하고 다시 멈춘다. 실행 중이면 먼저 멈춘다. */
  step(steps: number): void
}

interface Pending {
  onProgress: (p: RunProgress) => void
  resolve: (r: RunResult) => void
  reject: (e: Error) => void
}

const pendingReforecast = new Map<number, { resolve: (o: ReforecastOutcome) => void; reject: (e: Error) => void }>()
interface PendingMc {
  onProgress: (completed: number, total: number, snapshot?: McResult) => void
  resolve: (r: McOutcome) => void
  reject: (e: Error) => void
}
const pendingMc = new Map<number, PendingMc>()
let worker: Worker | null = null
/** Worker에 등록해야 하는 사용자 모델. Worker가 (다시) 시작될 때마다 먼저 보낸다. */
const registered = new Map<string, { hash: string; doc: ModelDoc }>()
let nextId = 1
const pending = new Map<number, Pending>()

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<WorkerOut>) => {
    const m = e.data
    const mc = pendingMc.get(m.id)
    if (mc) {
      if (m.type === 'mcProgress') mc.onProgress(m.completed, m.total, m.snapshot)
      else {
        pendingMc.delete(m.id)
        if (m.type === 'mcDone') mc.resolve({ result: m.result, canceled: m.canceled })
        else if (m.type === 'error') mc.reject(new Error(m.message))
      }
      return
    }
    const re = pendingReforecast.get(m.id)
    if (re) {
      pendingReforecast.delete(m.id)
      if (m.type === 'reforecastDone') re.resolve(m.outcome)
      else if (m.type === 'error') re.reject(new Error(m.message))
      return
    }
    const p = pending.get(m.id)
    if (!p) return
    if (m.type === 'progress') p.onProgress({ time: m.time, fraction: m.fraction, values: m.values })
    else {
      pending.delete(m.id)
      if (m.type === 'done') p.resolve(m.result)
      else if (m.type === 'error') p.reject(new Error(m.message))
    }
  }
  w.onerror = (e) => {
    const err = new Error(e.message || 'Worker 오류')
    for (const p of pending.values()) p.reject(err)
    for (const p of pendingReforecast.values()) p.reject(err)
    for (const p of pendingMc.values()) p.reject(err)
    pending.clear()
    pendingReforecast.clear()
    pendingMc.clear()
    worker = null
  }
  worker = w
  for (const [id, m] of registered) w.postMessage({ type: 'registerModel', id, hash: m.hash, doc: m.doc } satisfies WorkerIn)
  return w
}

/** 사용자 모델을 Worker에 등록한다. 이미 시작한 Worker에는 바로 보내고, 아니면 시작할 때 보낸다. 해시가 같으면 Worker가 다시 컴파일하지 않는다. */
export function registerModel(id: string, hash: string, doc: ModelDoc): void {
  registered.set(id, { hash, doc })
  worker?.postMessage({ type: 'registerModel', id, hash, doc } satisfies WorkerIn)
}

export function unregisterModel(id: string): void {
  registered.delete(id)
}

/** 시뮬레이션을 Worker에서 실행한다. UI 스레드는 막히지 않는다. */
export function startRun(
  req: Omit<RunRequest, 'id'>,
  onProgress: (p: RunProgress) => void = () => {}
): RunHandle {
  const id = nextId++
  const w = ensureWorker()
  const promise = new Promise<RunResult>((resolve, reject) => {
    pending.set(id, { onProgress, resolve, reject })
  })
  const message: WorkerIn = { type: 'run', id, ...req }
  w.postMessage(message)
  return {
    promise,
    cancel: () => w.postMessage({ type: 'cancel', id } satisfies WorkerIn),
    pause: () => w.postMessage({ type: 'control', id, action: 'pause' } satisfies WorkerIn),
    resume: () => w.postMessage({ type: 'control', id, action: 'resume' } satisfies WorkerIn),
    step: (steps) => w.postMessage({ type: 'control', id, action: 'step', steps } satisfies WorkerIn)
  }
}

/** 재예측을 Worker에서 실행한다(E5). 결과는 보고일부터 종료 시각까지다. */
export function startReforecast(req: Omit<ReforecastRequest, 'id'>): Promise<ReforecastOutcome> {
  const id = nextId++
  const w = ensureWorker()
  const promise = new Promise<ReforecastOutcome>((resolve, reject) => {
    pendingReforecast.set(id, { resolve, reject })
  })
  w.postMessage({ type: 'reforecast', id, ...req } satisfies WorkerIn)
  return promise
}

/** Monte Carlo를 Worker에서 실행한다(설계 06의 4.2). 취소하면 끝난 반복의 결과로 resolve한다. */
export function startMonteCarlo(req: Omit<McRequest, 'id'>, onProgress: PendingMc['onProgress'] = () => {}): McHandle {
  const id = nextId++
  const w = ensureWorker()
  const promise = new Promise<McOutcome>((resolve, reject) => {
    pendingMc.set(id, { onProgress, resolve, reject })
  })
  w.postMessage({ type: 'montecarlo', id, ...req } satisfies WorkerIn)
  return { promise, cancel: () => w.postMessage({ type: 'cancel', id } satisfies WorkerIn) }
}
