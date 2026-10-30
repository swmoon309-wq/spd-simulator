import { McError, McRunner, reforecast, reforecastAdapters, ReforecastError, type McResult, type ReforecastOutcome } from '@spd/analysis'
import { ModelError, Simulation, SimulationError, type RunResult } from '@spd/sd-engine'
import { getEntry } from '../catalog'
import { getCompiledModel } from './models'
import type { McRequest, ReforecastRequest, RunRequest, WorkerOut } from './protocol'

/**
 * 일시정지·스텝 제어(SIM-05). Worker가 제어 메시지를 받으면 값을 바꾸고 `wake`를 불러 멈춰 있는 실행을 깨운다.
 * 실행기는 청크 사이마다 이 값을 확인하므로 일시정지는 다음 청크(전체의 약 1%)가 끝난 뒤에 걸린다.
 */
export interface RunControl {
  paused: boolean
  /** 일시정지 중에 진행할 스텝 수(요청이 쌓이면 더해진다) */
  steps: number
  /** 멈춰 기다리는 실행을 깨운다. 기다리는 중에만 채워져 있다. */
  wake: (() => void) | null
}

export function newRunControl(): RunControl {
  return { paused: false, steps: 0, wake: null }
}

/** 제어 요청 하나를 반영한다. 이미 끝난 실행의 요청은 호출하는 쪽이 거른다. */
export function applyControl(control: RunControl, action: 'pause' | 'resume' | 'step', steps = 1): void {
  if (action === 'pause') control.paused = true
  else if (action === 'resume') {
    control.paused = false
    control.steps = 0
  } else {
    control.paused = true
    control.steps += Math.max(1, Math.floor(steps))
  }
  control.wake?.()
}

export interface ExecuteDeps {
  post: (message: WorkerOut, transfer?: Transferable[]) => void
  isCancelled: () => boolean
  /** 메시지(취소 요청 등)를 처리할 수 있도록 제어를 넘긴다. */
  yieldToEventLoop: () => Promise<void>
  now: () => number
  /** 일시정지·스텝 제어. 없으면 멈추지 않고 끝까지 실행한다. */
  control?: RunControl
}

/** 한 번 실행에서 계산을 이어서 하는 최대 시간(ms). 넘으면 이벤트 루프에 양보한다. */
const SLICE_MS = 12

function transferables(result: RunResult): Transferable[] {
  return [result.time.buffer, ...Object.values(result.series).map((s) => s.buffer)] as Transferable[]
}

/**
 * 모델을 실행하며 진행 상황과 결과를 `post`로 보낸다. Worker 본체는 이 함수를 감싸기만 한다.
 * 취소되면 그때까지의 결과를 `meta.completed = false`로 돌려준다.
 */
export async function executeRun(req: RunRequest, deps: ExecuteDeps): Promise<void> {
  const { post, isCancelled, yieldToEventLoop, now, control } = deps
  try {
    const sim = new Simulation(getCompiledModel(req.modelId), { overrides: req.overrides, ...req.options })
    let lastStep = -1
    const hooks = {
      onProgress: (p: { time: number; step: number; fraction: number; values: Record<string, number> }) => {
        // `advance`는 시작 상태(스텝 0)를 호출마다 다시 알리므로 같은 스텝은 한 번만 보낸다.
        if (p.step === lastStep) return
        lastStep = p.step
        post({ type: 'progress', id: req.id, time: p.time, fraction: p.fraction, values: p.values })
      }
    }
    if (control && req.startPaused) control.paused = true
    sim.advance(0, hooks) // 시각 0의 진행 상황

    let sliceStart = now()
    while (!sim.done && !isCancelled()) {
      if (control?.paused) {
        if (control.steps > 0) {
          const n = control.steps
          control.steps = 0
          sim.advance(n, hooks)
          // 진행 간격이 아닌 곳에서 멈췄어도 화면이 지금 상태를 보이도록 알린다.
          if (lastStep !== sim.currentStep) sim.reportProgress(hooks)
        } else {
          await new Promise<void>((resolve) => {
            control.wake = resolve
          })
          control.wake = null
        }
        sliceStart = now()
        continue
      }
      sim.advance(sim.progressEvery, hooks)
      if (!sim.done && now() - sliceStart > SLICE_MS) {
        await yieldToEventLoop()
        sliceStart = now()
      }
    }
    const result = sim.result()
    post({ type: 'done', id: req.id, result }, transferables(result))
  } catch (e) {
    const message =
      e instanceof ModelError || e instanceof SimulationError || e instanceof Error ? e.message : String(e)
    post({ type: 'error', id: req.id, message })
  }
}

function outcomeTransferables(outcome: ReforecastOutcome): Transferable[] {
  return outcome.runs.flatMap((r) => transferables(r.result))
}

/**
 * 재예측을 실행해 결과를 `post`로 보낸다(E5). 기준선을 보고일까지 한 번 실행하고 κ마다 이어서 실행하므로 한 번의 일반 실행보다
 * 약간 길 뿐이어서 중간에 양보하지 않는다. 오류는 `error` 메시지로 알린다.
 */
export function executeReforecast(req: ReforecastRequest, deps: Pick<ExecuteDeps, 'post'>): void {
  try {
    const adapter = reforecastAdapters[req.modelId]
    if (!adapter) throw new Error(`이 모델은 재예측을 지원하지 않습니다: ${req.modelId}`)
    const outcome = reforecast(getCompiledModel(req.modelId), {
      adapter,
      params: req.overrides,
      options: req.options ?? {},
      observed: req.observed,
      kappas: req.kappas,
      ...(req.constants ? { constants: req.constants } : {}),
      ...(req.changes ? { changes: req.changes } : {})
    })
    deps.post({ type: 'reforecastDone', id: req.id, outcome }, outcomeTransferables(outcome))
  } catch (e) {
    const message = e instanceof ReforecastError || e instanceof ModelError || e instanceof SimulationError || e instanceof Error ? e.message : String(e)
    deps.post({ type: 'error', id: req.id, message })
  }
}

function mcTransferables(r: McResult): Transferable[] {
  const buffers: ArrayBufferLike[] = [...r.inputs.map((a) => a.buffer), ...r.kpis.map((a) => a.buffer), r.status.buffer]
  if (r.band) buffers.push(r.band.time.buffer, r.band.values.buffer)
  return buffers as Transferable[]
}

/** 진행 메시지 간격(ms)과 중간 결과(snapshot)를 붙이는 간격(ms). */
const MC_PROGRESS_MS = 60
const MC_SNAPSHOT_MS = 400

/**
 * Monte Carlo를 실행한다(설계 06의 4.2). 반복을 하나씩 진행하다가 **12ms가 지나면 이벤트 루프에 양보**해 취소 메시지를
 * 처리하고, 진행을 알린다(중간 결과는 가끔만). 취소하면 끝난 반복의 결과를 `canceled: true`로 보낸다. 입력이 잘못되었거나 지원하지
 * 않는 모델이면 `error`로 알린다.
 */
export async function executeMonteCarlo(req: McRequest, deps: ExecuteDeps): Promise<void> {
  const { post, isCancelled, yieldToEventLoop, now } = deps
  try {
    const entry = getEntry(req.modelId)
    const runner = new McRunner({
      model: getCompiledModel(req.modelId),
      baseParams: req.overrides,
      options: req.options,
      inputs: req.inputs,
      n: req.n,
      seed: req.seed,
      kpis: entry.kpiSpecs,
      band: req.band ?? null
    })
    post({ type: 'mcProgress', id: req.id, completed: 0, total: req.n })
    let sliceStart = now()
    let lastProgress = sliceStart
    let lastSnapshot = sliceStart
    while (!runner.done && !isCancelled()) {
      runner.step(1)
      const t = now()
      if (t - sliceStart > SLICE_MS) {
        if (t - lastProgress >= MC_PROGRESS_MS) {
          const withSnapshot = t - lastSnapshot >= MC_SNAPSHOT_MS
          post({ type: 'mcProgress', id: req.id, completed: runner.completed, total: req.n, ...(withSnapshot ? { snapshot: runner.result() } : {}) })
          lastProgress = t
          if (withSnapshot) lastSnapshot = t
        }
        await yieldToEventLoop()
        sliceStart = now()
      }
    }
    const result = runner.result()
    post({ type: 'mcDone', id: req.id, result, canceled: !runner.done }, mcTransferables(result))
  } catch (e) {
    const message = e instanceof McError || e instanceof ModelError || e instanceof SimulationError || e instanceof Error ? e.message : String(e)
    post({ type: 'error', id: req.id, message })
  }
}
