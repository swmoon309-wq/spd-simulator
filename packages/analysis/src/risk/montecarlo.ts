import { Simulation, SimulationError, type CompiledModel } from '@spd/sd-engine'
import { computeKpis, valueAt, type KpiSpec } from '../scenario/kpi'
import { modelSeedFor, sampleRow, validateInputs, type InputSpec } from './sampling'
import { finiteSorted, histogram, meanCI, percentileSorted, summarize, wilson, type Histogram, type Interval, type Summary } from './stats'

export const DEFAULT_ITERATIONS = 500
export const MAX_ITERATIONS = 5000
/** 분포를 그리기에 거친 반복 수(이보다 적으면 경고) */
export const COARSE_ITERATIONS = 100

export class McError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McError'
  }
}

export interface McInput {
  model: CompiledModel
  /** 대상 시나리오의 유효 파라미터(상수 덮어쓰기). 불확실한 입력은 그 위에 표본으로 덮는다. */
  baseParams: Record<string, number>
  /** 실행 설정(종료 시각, dt) */
  options: { end?: number; dt?: number }
  inputs: InputSpec[]
  n: number
  seed: number
  kpis: KpiSpec[]
  /** 시계열 띠를 모을 변수(1일 간격). 없으면 모으지 않는다. */
  band?: { variable: string } | null
}

export interface McFailure {
  iteration: number
  message: string
  /** 그 반복의 입력 표본 */
  values: Record<string, number>
}

export interface McResult {
  seed: number
  /** 요청한 반복 수 */
  n: number
  /** 끝난 반복 수(취소하면 n보다 작다). 성공 + 실패 */
  completed: number
  inputNames: string[]
  /** 입력별 표본(길이 `completed`). 실패한 반복의 표본도 남긴다. */
  inputs: Float64Array[]
  kpiIds: string[]
  /** 지표별 값(길이 `completed`). 계산할 수 없는 값(미완료 등)과 실패한 반복은 NaN */
  kpis: Float64Array[]
  /** 0 = 성공, 1 = 실패 */
  status: Uint8Array
  failures: McFailure[]
  band: { variable: string; time: Float64Array; values: Float64Array } | null
}

/** 입력 검사. 문제가 없으면 null. */
export function validateMc(input: Pick<McInput, 'inputs' | 'n' | 'kpis' | 'baseParams' | 'model'>): string | null {
  if (!Number.isInteger(input.n) || input.n < 1 || input.n > MAX_ITERATIONS) return `반복 수는 1 ~ ${MAX_ITERATIONS}의 정수여야 합니다`
  if (input.inputs.length === 0) return '불확실한 입력이 하나 이상 필요합니다'
  const e = validateInputs(input.inputs)
  if (e) return e
  for (const s of input.inputs) {
    if (input.model.kindOf.get(s.name) !== 'constant') return `'${s.name}'은(는) 모델의 상수가 아닙니다`
  }
  if (input.kpis.length === 0) return '계산할 지표가 없습니다'
  return null
}

/**
 * Monte Carlo 실행기(설계 06의 4장). `step`으로 반복을 조금씩 진행해 Worker가 사이사이 취소·양보를 처리할 수 있다.
 * 반복 `i`의 표본은 (시드, 반복, 입력 이름)에서만 나오므로 반복 수를 늘려도 앞부분이 같고 취소해도 완전한 결과가 남는다.
 */
export class McRunner {
  private readonly input: McInput
  private i = 0
  private readonly inputs: Float64Array[]
  private readonly kpis: Float64Array[]
  private readonly status: Uint8Array
  private readonly failures: McFailure[] = []
  private readonly bandPoints: number
  private readonly bandValues: Float64Array | null
  private readonly bandTime: Float64Array | null
  private readonly start: number

  constructor(input: McInput) {
    const problem = validateMc(input)
    if (problem) throw new McError(problem)
    this.input = input
    const n = input.n
    this.inputs = input.inputs.map(() => new Float64Array(n))
    this.kpis = input.kpis.map(() => new Float64Array(n).fill(NaN))
    this.status = new Uint8Array(n)
    const def = input.model.def
    this.start = def.time.start
    const end = input.options.end ?? def.time.end
    this.bandPoints = Math.floor(end - this.start + 1e-9) + 1
    if (input.band) {
      if (!input.model.slotOf.has(input.band.variable)) throw new McError(`시계열 변수 '${input.band.variable}'이(가) 모델에 없습니다`)
      this.bandValues = new Float64Array(n * this.bandPoints).fill(NaN)
      this.bandTime = Float64Array.from({ length: this.bandPoints }, (_, k) => this.start + k)
    } else {
      this.bandValues = null
      this.bandTime = null
    }
  }

  get completed(): number {
    return this.i
  }

  get done(): boolean {
    return this.i >= this.input.n
  }

  /** 최대 `maxIterations`번 반복을 실행한다. 모두 끝났으면 true. */
  step(maxIterations: number): boolean {
    const { input } = this
    for (let k = 0; k < maxIterations && !this.done; k++) {
      const i = this.i
      const row = sampleRow(input.inputs, input.seed, i)
      input.inputs.forEach((s, j) => {
        ;(this.inputs[j] as Float64Array)[i] = row[s.name] as number
      })
      const params = { ...input.baseParams, ...row }
      try {
        const sim = new Simulation(input.model, { overrides: params, seed: modelSeedFor(input.seed, i), ...input.options })
        const result = sim.run()
        const values = computeKpis(input.kpis, result, params)
        input.kpis.forEach((spec, j) => {
          const v = values[spec.id]
          ;(this.kpis[j] as Float64Array)[i] = v === null || v === undefined ? NaN : v
        })
        if (input.band && this.bandValues) {
          for (let d = 0; d < this.bandPoints; d++) this.bandValues[i * this.bandPoints + d] = valueAt(result, input.band.variable, this.start + d)
        }
      } catch (e) {
        if (!(e instanceof SimulationError)) throw e
        this.status[i] = 1
        this.failures.push({ iteration: i, message: e.message, values: row })
      }
      this.i++
    }
    return this.done
  }

  /** 지금까지 끝난 반복의 결과(복사본). 취소한 뒤에도 쓸 수 있다. */
  result(): McResult {
    const c = this.i
    const { input } = this
    return {
      seed: input.seed,
      n: input.n,
      completed: c,
      inputNames: input.inputs.map((s) => s.name),
      inputs: this.inputs.map((a) => a.slice(0, c)),
      kpiIds: input.kpis.map((k) => k.id),
      kpis: this.kpis.map((a) => a.slice(0, c)),
      status: this.status.slice(0, c),
      failures: [...this.failures],
      band: input.band && this.bandValues && this.bandTime ? { variable: input.band.variable, time: this.bandTime, values: this.bandValues.slice(0, c * this.bandPoints) } : null
    }
  }
}

/** 끝까지 실행한다(동기). 큰 N은 Worker에서 `McRunner.step`으로 나눠 실행한다. */
export function runMonteCarlo(input: McInput, hooks: { onProgress?: (done: number, total: number) => void; shouldStop?: () => boolean } = {}): McResult {
  const runner = new McRunner(input)
  const chunk = Math.max(1, Math.floor(input.n / 100))
  while (!runner.done) {
    runner.step(chunk)
    hooks.onProgress?.(runner.completed, input.n)
    if (!runner.done && hooks.shouldStop?.()) break
  }
  return runner.result()
}

// ---------- 집계 ----------

function column(result: McResult, kpiId: string): Float64Array {
  const j = result.kpiIds.indexOf(kpiId)
  if (j < 0) throw new McError(`지표 '${kpiId}'이(가) 결과에 없습니다`)
  return result.kpis[j] as Float64Array
}

export function inputColumn(result: McResult, name: string): Float64Array {
  const j = result.inputNames.indexOf(name)
  if (j < 0) throw new McError(`입력 '${name}'이(가) 결과에 없습니다`)
  return result.inputs[j] as Float64Array
}

export interface KpiDistribution {
  kpiId: string
  /** 성공한 반복 수(실패 제외) */
  nOk: number
  /** 실패해 제외한 반복 수 */
  nFailed: number
  /** 성공했지만 지표를 계산할 수 없는 반복 수(예: 종료 시각 안에 끝나지 않음) */
  nUndefined: number
  /** 지표가 있는 반복의 요약 통계(분포는 "끝난 것만의 분포") */
  summary: Summary
  /** 정렬한 값 */
  sorted: Float64Array
  /** 지표를 계산할 수 없는 반복의 비율(성공한 반복 중) */
  undefinedRate: number
  /** 평균의 신뢰구간 */
  meanCI: Interval
}

/** 한 지표의 분포. 실패한 반복은 제외하고, 계산할 수 없는 반복은 분포에서 빼고 비율로 따로 센다. */
export function kpiDistribution(result: McResult, kpiId: string, level = 0.95): KpiDistribution {
  const col = column(result, kpiId)
  const vals: number[] = []
  let nOk = 0
  let nUndefined = 0
  for (let i = 0; i < result.completed; i++) {
    if (result.status[i] === 1) continue
    nOk++
    const v = col[i] as number
    if (Number.isFinite(v)) vals.push(v)
    else nUndefined++
  }
  const summary = summarize(vals)
  const ci = meanCI(summary.mean, summary.sd, summary.n, level)
  return {
    kpiId,
    nOk,
    nFailed: result.completed - nOk,
    nUndefined,
    summary,
    sorted: finiteSorted(vals),
    undefinedRate: nOk === 0 ? 0 : nUndefined / nOk,
    meanCI: { low: ci.low, high: ci.high }
  }
}

export function kpiHistogram(result: McResult, kpiId: string, bins?: number): Histogram {
  return histogram(kpiDistribution(result, kpiId).sorted, bins)
}

export interface McTarget {
  kpi: string
  op: '<=' | '>='
  value: number
}

export const targetMet = (t: McTarget, v: number): boolean => Number.isFinite(v) && (t.op === '<=' ? v <= t.value : v >= t.value)

export interface TargetProbability {
  /** 목표를 모두 만족한 반복 수 */
  met: number
  /** 분모: 성공한 반복 수(실패 제외). 지표를 계산할 수 없는 반복은 만족하지 못한 것으로 센다 */
  n: number
  p: number
  /** Wilson 구간 */
  low: number
  high: number
}

/** 목표(들)를 **모두** 만족할 확률. 목표가 둘 이상이면 동시 달성 확률이다(설계 06의 5.3). */
export function targetProbability(result: McResult, targets: McTarget[], level = 0.95): TargetProbability {
  const cols = targets.map((t) => column(result, t.kpi))
  let met = 0
  let n = 0
  for (let i = 0; i < result.completed; i++) {
    if (result.status[i] === 1) continue
    n++
    if (targets.every((t, j) => targetMet(t, (cols[j] as Float64Array)[i] as number))) met++
  }
  const w = wilson(met, n, level)
  return { met, n, p: w.p, low: w.low, high: w.high }
}

export interface Comparison {
  kpiId: string
  /** 둘 다 성공하고 지표가 있는 반복의 수 */
  pairs: number
  /** 지표가 한쪽에서만 있는 반복 수(예: 한 시나리오만 완료) */
  unpaired: number
  /** A < B인 반복의 비율(낮을수록 좋은 지표면 "A가 더 좋음") */
  probALess: number
  probTie: number
  /** 차이(B − A)의 평균과 신뢰구간 */
  meanDiff: number
  diffCI: Interval
  /** 중앙값 기준 우열과 반대 방향인 반복의 비율(순위가 뒤바뀌는 정도) */
  flipRate: number
}

/** 같은 표본으로 실행한 두 결과의 쌍별 비교(공통난수, 설계 06의 5.4). 표본이 다르면 오류. */
export function compareResults(a: McResult, b: McResult, kpiId: string, level = 0.95): Comparison {
  if (a.completed !== b.completed || a.seed !== b.seed || a.inputNames.join() !== b.inputNames.join()) {
    throw new McError('두 결과의 시드·반복 수·입력이 같아야 쌍별로 비교할 수 있습니다')
  }
  for (let j = 0; j < a.inputs.length; j++) {
    const x = a.inputs[j] as Float64Array
    const y = b.inputs[j] as Float64Array
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) throw new McError('두 결과의 입력 표본이 다릅니다(같은 분포·시드로 실행해야 합니다)')
  }
  const ca = column(a, kpiId)
  const cb = column(b, kpiId)
  const diffs: number[] = []
  let less = 0
  let tie = 0
  let unpaired = 0
  for (let i = 0; i < a.completed; i++) {
    if (a.status[i] === 1 || b.status[i] === 1) continue
    const x = ca[i] as number
    const y = cb[i] as number
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      if (Number.isFinite(x) !== Number.isFinite(y)) unpaired++
      continue
    }
    diffs.push(y - x)
    if (x < y) less++
    else if (x === y) tie++
  }
  const n = diffs.length
  const s = summarize(diffs)
  const ci = meanCI(s.mean, s.sd, n, level)
  const med = percentileSorted(finiteSorted(diffs), 0.5)
  const flips = diffs.filter((d) => (med > 0 && d < 0) || (med < 0 && d > 0)).length
  return {
    kpiId,
    pairs: n,
    unpaired,
    probALess: n === 0 ? NaN : less / n,
    probTie: n === 0 ? NaN : tie / n,
    meanDiff: s.mean,
    diffCI: { low: ci.low, high: ci.high },
    flipRate: n === 0 ? NaN : flips / n
  }
}

export interface BandPoint {
  time: number
  p10: number
  p50: number
  p90: number
}

/** 시계열 띠: 1일마다 성공한 반복의 P10·P50·P90. */
export function bandSummary(result: McResult): BandPoint[] {
  const band = result.band
  if (!band) return []
  const points = band.time.length
  const out: BandPoint[] = []
  for (let d = 0; d < points; d++) {
    const col: number[] = []
    for (let i = 0; i < result.completed; i++) {
      if (result.status[i] === 1) continue
      const v = band.values[i * points + d] as number
      if (Number.isFinite(v)) col.push(v)
    }
    const s = finiteSorted(col)
    out.push({ time: band.time[d] as number, p10: percentileSorted(s, 0.1), p50: percentileSorted(s, 0.5), p90: percentileSorted(s, 0.9) })
  }
  return out
}
