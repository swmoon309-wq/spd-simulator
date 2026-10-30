import { createRuntime, type Runtime } from '../expr'
import { compileModel, type CompiledModel } from '../model/compile'
import { ModelError, SimulationError } from '../model/errors'
import type { ModelDef } from '../model/schema'
import type { RunOptions, RunResult } from '../result'
import { EulerIntegrator, type Derivative } from '../solver/integrator'

export interface Progress {
  time: number
  step: number
  totalSteps: number
  /** 0~1 */
  fraction: number
  /** 모델 `outputs`(또는 `progressVars`)의 현재 값 */
  values: Record<string, number>
}

/**
 * 어느 시점의 실행 상태 전체(변수 값, 지연·평활 함수 상태, 시각과 스텝, 난수 상태). 스텝 사이에서만 만들 수 있다.
 * `Simulation.fork`로 이어서 실행하면 원래 실행을 계속한 것과 비트 단위로 같은 결과가 나온다.
 */
export interface SimSnapshot {
  model: { id: string; version: number }
  dt: number
  start: number
  step: number
  time: number
  values: Float64Array
  state: Float64Array
  rngState: number
  /** 마지막 재평가를 시작할 때의 난수 상태. 값을 덮어쓴 뒤 같은 난수로 다시 계산하는 데 쓴다. */
  evalRngState: number
}

export interface RunHooks {
  onProgress?: (p: Progress) => void
  /** `run()`이 진행 콜백 간격마다 확인한다. true면 그때까지의 결과로 멈춘다. */
  shouldStop?: () => boolean
}

/**
 * 하나의 시뮬레이션 실행. `advance()`로 조금씩 진행할 수 있어 Worker가 청크 사이에서 UI 메시지를 처리하거나,
 * 일시정지·스텝 실행(SIM-05)을 만들 수 있다.
 *
 * 한 스텝의 순서: (1) 지연·평활 상태 갱신 (2) Level 적분 (3) 시각 전진 (4) 모든 변수 재평가 (5) 수치 검사·기록.
 * Level 적분은 이미 평가된 유입·유출을 쓰는 Euler 전용 도함수를 사용한다. 중간 시점 재평가가 필요한 적분기
 * (RK4)를 붙일 때는 이 도함수를 모델 재평가로 바꿔야 한다.
 */
export class Simulation {
  readonly model: CompiledModel
  readonly dt: number
  readonly start: number
  readonly totalSteps: number
  readonly seed: number
  readonly progressEvery: number

  private readonly overrides: Record<string, number>
  private readonly recordEvery: number
  private readonly recordNames: string[]
  private readonly recordSlots: number[]
  private readonly checkSlots: number[]
  private readonly progressNames: string[]
  private readonly integrator = new EulerIntegrator()
  private readonly levelState: Float64Array
  private readonly derivative: Derivative

  private rt!: Runtime
  private step = 0
  private recorded = 0
  private times!: Float64Array
  private data!: Float64Array[]
  private hooks: RunHooks = {}
  /** 이어 실행이면 시작 상태. `reset()`은 이 상태로 돌아간다. */
  private base: SimSnapshot | null = null
  private evalRng = 0

  constructor(model: CompiledModel, options: RunOptions = {}, from?: SimSnapshot) {
    this.model = model
    const { def } = model
    this.dt = options.dt ?? def.time.dt
    this.start = def.time.start
    const end = options.end ?? def.time.end
    if (!(this.dt > 0) || !Number.isFinite(this.dt)) throw new ModelError('option', `dt는 0보다 큰 수여야 합니다: ${this.dt}`)
    if (!Number.isFinite(end) || end <= this.start) throw new ModelError('option', `종료 시각(${end})은 시작 시각(${this.start})보다 커야 합니다`)
    this.totalSteps = Math.max(1, Math.round((end - this.start) / this.dt))
    this.seed = options.seed ?? 1
    this.recordEvery = Math.max(1, Math.floor(options.recordEvery ?? 1))
    this.progressEvery = Math.max(1, Math.floor(options.progressEvery ?? this.totalSteps / 100))

    this.overrides = options.overrides ?? {}
    for (const [name, value] of Object.entries(this.overrides)) {
      if (model.kindOf.get(name) !== 'constant') {
        throw new ModelError('option', `덮어쓸 수 있는 상수가 아닙니다: '${name}'`, { variable: name })
      }
      if (!Number.isFinite(value)) throw new ModelError('option', `상수 '${name}'의 값이 유한한 수가 아닙니다: ${value}`, { variable: name })
    }

    const nonConstants = model.names.filter((n) => model.kindOf.get(n) !== 'constant')
    this.recordNames = options.record ?? nonConstants
    for (const n of this.recordNames) {
      if (!model.slotOf.has(n)) throw new ModelError('option', `기록할 변수 '${n}'이(가) 정의되어 있지 않습니다`, { variable: n })
    }
    this.recordSlots = this.recordNames.map((n) => model.slotOf.get(n) as number)
    this.checkSlots = nonConstants.map((n) => model.slotOf.get(n) as number)
    this.progressNames = def.outputs

    this.levelState = new Float64Array(model.levels.length)
    this.derivative = (_t, _state, out) => {
      const v = this.rt.values
      for (let i = 0; i < model.levels.length; i++) {
        const l = model.levels[i] as CompiledModel['levels'][number]
        let d = 0
        for (const s of l.inflows) d += v[s] as number
        for (const s of l.outflows) d -= v[s] as number
        out[i] = d
      }
    }
    if (from) {
      this.checkSnapshot(from)
      this.base = cloneSnapshot(from)
    }
    this.reset()
  }

  /**
   * 스냅샷에서 이어 실행하는 실행을 만든다(설계 05의 7.3 E1). `dt`와 시작 시각, 모델이 스냅샷과 같아야 한다.
   * 결과는 스냅샷 시각부터 시작하고, `options.overrides`는 이어 실행하기 전에 상수를 바꾼다(E2의 `setConstant`와 같음).
   */
  static fork(model: CompiledModel, snapshot: SimSnapshot, options: RunOptions = {}): Simulation {
    return new Simulation(model, { dt: snapshot.dt, ...options }, snapshot)
  }

  /** 지금 상태를 복사해 둔다. 스텝 사이(`advance` 밖)에서 부른다. */
  snapshot(): SimSnapshot {
    const { def } = this.model
    return {
      model: { id: def.meta.id, version: def.meta.version },
      dt: this.dt,
      start: this.start,
      step: this.step,
      time: this.rt.time,
      values: this.rt.values.slice(),
      state: this.rt.state.slice(),
      rngState: this.rt.rng.state,
      evalRngState: this.evalRng
    }
  }

  private checkSnapshot(s: SimSnapshot): void {
    const { def } = this.model
    if (s.model.id !== def.meta.id || s.model.version !== def.meta.version) {
      throw new ModelError('option', `스냅샷의 모델(${s.model.id} v${s.model.version})이 실행할 모델(${def.meta.id} v${def.meta.version})과 다릅니다`)
    }
    if (s.dt !== this.dt) throw new ModelError('option', `스냅샷의 dt(${s.dt})와 실행의 dt(${this.dt})가 다릅니다`)
    if (s.start !== this.start) throw new ModelError('option', `스냅샷의 시작 시각(${s.start})이 모델의 시작 시각(${this.start})과 다릅니다`)
    if (s.values.length !== this.model.names.length || s.state.length !== this.model.store.stateSize) {
      throw new ModelError('option', '스냅샷의 크기가 모델과 맞지 않습니다')
    }
    if (!Number.isInteger(s.step) || s.step < 0 || s.step > this.totalSteps) {
      throw new ModelError('option', `스냅샷의 스텝(${s.step})이 이 실행의 범위(0~${this.totalSteps})를 벗어납니다`)
    }
  }

  /**
   * Level의 현재 값을 바꾼다(설계 05의 7.3 E2). 관측값으로 덮어쓸 때 쓴다. 이어 실행하기 전, 스텝 사이에서 부르며
   * 값에 종속된 모든 변수를 다시 계산한다. 이 시각에 이미 기록한 행도 새 값으로 고친다.
   */
  setLevel(name: string, value: number): void {
    if (this.model.kindOf.get(name) !== 'level') throw new ModelError('option', `Level이 아닙니다: '${name}'`, { variable: name })
    this.setValue(name, value, 'Level')
  }

  /** 상수의 값을 바꾼다(조치 시점에 정책 상수를 바꿀 때). 이 시각 이후의 계산에 쓰이며 `reset()`은 원래 값으로 되돌린다. */
  setConstant(name: string, value: number): void {
    if (this.model.kindOf.get(name) !== 'constant') throw new ModelError('option', `상수가 아닙니다: '${name}'`, { variable: name })
    this.setValue(name, value, '상수')
  }

  /**
   * 값을 덮어쓴 뒤 흐름을 다시 계산한다. 난수를 새로 뽑으면 이후 수열이 어긋나므로 마지막 계산이 쓴 난수로 되돌려 같은 값을
   * 다시 뽑고, 끝나면 난수 상태를 원래대로 둔다(값을 그대로 덮어쓰면 이어 실행이 원본과 비트 단위로 같다).
   */
  private reevaluate(): void {
    const after = this.rt.rng.state
    this.rt.rng.restore(this.evalRng)
    this.evaluate()
    this.rt.rng.restore(after)
  }

  private setValue(name: string, value: number, what: string): void {
    if (!Number.isFinite(value)) throw new ModelError('option', `${what} '${name}'의 값이 유한한 수가 아닙니다: ${value}`, { variable: name })
    this.rt.values[this.model.slotOf.get(name) as number] = value
    this.reevaluate()
    this.checkFinite()
    // 이 시각의 기록이 있으면 새 값으로 고친다(이어 실행의 첫 행 등).
    if (this.recorded > 0 && this.times[this.recorded - 1] === this.rt.time) {
      for (let i = 0; i < this.recordSlots.length; i++) (this.data[i] as Float64Array)[this.recorded - 1] = this.rt.values[this.recordSlots[i] as number] as number
    }
  }

  get time(): number {
    return this.rt.time
  }

  get currentStep(): number {
    return this.step
  }

  get done(): boolean {
    return this.step >= this.totalSteps
  }

  /** 변수의 현재 값. */
  valueOf(name: string): number {
    const slot = this.model.slotOf.get(name)
    if (slot === undefined) throw new ModelError('option', `정의되지 않은 변수 '${name}'`, { variable: name })
    return this.rt.values[slot] as number
  }

  /** 처음 상태로 되돌리고 시각 0의 값을 기록한다. 난수열도 시드부터 다시 시작한다. */
  reset(): void {
    if (this.base) return this.restore(this.base)
    const { model } = this
    this.rt = createRuntime({
      slots: model.names.length,
      store: model.store,
      dt: this.dt,
      time: this.start,
      seed: this.seed
    })
    const rt = this.rt
    for (const c of model.constants) rt.values[c.slot] = this.overrides[c.name] ?? c.value

    // 1) Level 초기값과 그에 필요한 변수. 지연·평활 함수는 입력을 그대로 돌려준다.
    rt.initializing = true
    for (const s of model.initPlan) rt.values[s.slot] = s.eval(rt)
    // 2) 지연·평활 체인이 있으면 입력이 전파되도록 (함수 개수 + 1)번 전체를 재평가한다.
    for (let i = 0; i < model.store.count + 1; i++) this.evaluate()
    // 3) 지연·평활 상태를 입력값으로 초기화(정상 상태)하고 정상 모드로 전환한다.
    model.store.initAll(rt)
    rt.initializing = false
    this.evaluate()
    this.checkFinite()

    this.step = 0
    this.recorded = 0
    const capacity = Math.floor(this.totalSteps / this.recordEvery) + 2
    this.times = new Float64Array(capacity)
    this.data = this.recordSlots.map(() => new Float64Array(capacity))
    this.record()
  }

  /** 스냅샷 상태에서 시작한다. 기록은 스냅샷 시각의 한 행부터 시작한다. */
  private restore(s: SimSnapshot): void {
    const { model } = this
    this.rt = createRuntime({ slots: model.names.length, store: model.store, dt: this.dt, time: s.time, seed: this.seed })
    this.rt.values.set(s.values)
    this.rt.state.set(s.state)
    this.rt.rng.restore(s.rngState)
    this.evalRng = s.evalRngState
    for (const c of model.constants) {
      const o = this.overrides[c.name]
      if (o !== undefined) this.rt.values[c.slot] = o
    }
    if (Object.keys(this.overrides).length > 0) this.reevaluate()
    this.checkFinite()
    this.step = s.step
    this.recorded = 0
    const capacity = Math.floor((this.totalSteps - s.step) / this.recordEvery) + 2
    this.times = new Float64Array(capacity)
    this.data = this.recordSlots.map(() => new Float64Array(capacity))
    this.record()
  }

  /** 최대 `maxSteps` 스텝 진행한다. 종료 시각에 도달했으면 true. */
  advance(maxSteps = Infinity, hooks: RunHooks = {}): boolean {
    this.hooks = hooks
    this.notifyProgress(this.step === 0 && this.recorded === 1)
    for (let n = 0; n < maxSteps && !this.done; n++) this.stepOnce()
    return this.done
  }

  /** 지금 상태의 진행 정보를 콜백으로 알린다(일시정지·스텝 사이에 화면을 갱신할 때). 진행 간격과 상관없이 항상 알린다. */
  reportProgress(hooks: RunHooks): void {
    this.hooks = hooks
    this.notifyProgress(true)
  }

  /** 종료 시각까지(또는 `shouldStop`이 true를 돌려줄 때까지) 실행하고 결과를 돌려준다. */
  run(hooks: RunHooks = {}): RunResult {
    while (!this.done) {
      this.advance(this.progressEvery, hooks)
      if (!this.done && hooks.shouldStop?.()) break
    }
    return this.result()
  }

  /** 지금까지 기록한 결과의 복사본. */
  result(): RunResult {
    const series: Record<string, Float64Array> = {}
    this.recordNames.forEach((n, i) => {
      series[n] = (this.data[i] as Float64Array).slice(0, this.recorded)
    })
    const { def } = this.model
    return {
      time: this.times.slice(0, this.recorded),
      series,
      meta: { model: def.meta.id, version: def.meta.version, dt: this.dt, seed: this.seed, completed: this.done }
    }
  }

  private stepOnce(): void {
    const { model, rt } = this
    model.store.updateAll(rt)

    const levels = model.levels
    for (let i = 0; i < levels.length; i++) this.levelState[i] = rt.values[(levels[i] as CompiledModel['levels'][number]).slot] as number
    this.integrator.step(this.derivative, rt.time, this.dt, this.levelState)
    for (let i = 0; i < levels.length; i++) rt.values[(levels[i] as CompiledModel['levels'][number]).slot] = this.levelState[i] as number

    this.step++
    rt.time = this.start + this.step * this.dt
    this.evaluate()
    this.checkFinite()
    if (this.step % this.recordEvery === 0 || this.done) this.record()
    this.notifyProgress(this.step % this.progressEvery === 0 || this.done)
  }

  private evaluate(): void {
    const { rt } = this
    this.evalRng = rt.rng.state
    for (const f of this.model.flows) rt.values[f.slot] = f.expr.eval(rt)
  }

  private checkFinite(): void {
    const v = this.rt.values
    for (const slot of this.checkSlots) {
      const x = v[slot] as number
      if (!Number.isFinite(x)) throw new SimulationError(this.model.names[slot] as string, this.rt.time, x)
    }
  }

  private record(): void {
    this.times[this.recorded] = this.rt.time
    for (let i = 0; i < this.recordSlots.length; i++) {
      ;(this.data[i] as Float64Array)[this.recorded] = this.rt.values[this.recordSlots[i] as number] as number
    }
    this.recorded++
  }

  private notifyProgress(due: boolean): void {
    const cb = this.hooks.onProgress
    if (!due || !cb) return
    const values: Record<string, number> = {}
    for (const n of this.progressNames) values[n] = this.valueOf(n)
    cb({ time: this.rt.time, step: this.step, totalSteps: this.totalSteps, fraction: this.step / this.totalSteps, values })
  }
}

function cloneSnapshot(s: SimSnapshot): SimSnapshot {
  return { ...s, model: { ...s.model }, values: s.values.slice(), state: s.state.slice() }
}

function isCompiled(m: ModelDef | CompiledModel): m is CompiledModel {
  return 'initPlan' in m
}

/** 모델을 컴파일하고(이미 컴파일된 모델이면 그대로) 끝까지 실행한다. */
export function runModel(model: ModelDef | CompiledModel, options: RunOptions = {}, hooks: RunHooks = {}): RunResult {
  return new Simulation(isCompiled(model) ? model : compileModel(model), options).run(hooks)
}
