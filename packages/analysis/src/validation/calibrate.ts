import { ModelError, Simulation, SimulationError, type CompiledModel, type RunResult } from '@spd/sd-engine'
import { uniformFor } from '../risk/sampling'
import { valueAt } from '../scenario/kpi'
import { alignColumn, type AlignOptions, type ObservedColumn } from './align'

/**
 * 파라미터 보정(설계 07의 5장, VAL-05): 선택한 파라미터 θ(최대 5개)를 관측에 맞춰 목적함수
 * `J(θ) = Σ_열 w_c · NRMSE_c²`(NRMSE = RMSE / mean|O|)를 줄인다. 모델이 블랙박스이므로 도함수 없는 **유계 Nelder–Mead**를 **다중 시작**
 * (현재 값 + 시드로 뽑은 라틴 하이퍼큐브 4개)으로 돌리고, **식별 가능성 진단**과 **시간 분할 검증**을 함께 낸다.
 *
 * 보정이 "맞는 값"을 준다고 약속하지 않는다. 점이 적고 파라미터가 많으면 해가 유일하지 않다 — 그래서 진단이 기본 기능이다.
 */

export const MAX_CALIB_PARAMS = 5
export const DEFAULT_STARTS = 5
export const EVALS_PER_PARAM = 200
/** 시간 분할 검증을 기본으로 켜는 최소 관측 점 수와 보정에 쓰는 앞 부분의 비율. */
export const SPLIT_MIN_POINTS = 15
export const DEFAULT_SPLIT_FRACTION = 0.7

/** 종료 판정: 단체 꼭짓점들의 목적함수 차이가 이 값보다 작은 반복이 연속 3번이면 멈춘다. */
const TOLERANCE = 1e-6
/** 허용 범위의 이 비율 안이면 "경계에 붙었다". */
const BOUNDARY_FRACTION = 1e-3
/** 평탄 판정: ±10% 움직였을 때 J의 증가가 J의 1% 미만. */
const FLAT_STEP = 0.1
const FLAT_RELATIVE = 0.01
const FLAT_ABSOLUTE = 1e-8
/** 비유일성 판정: J가 최선의 5% 이내인 시작점들에서 어떤 파라미터가 범위의 10% 넘게 다르다. */
const SIMILAR_J = 1.05
/** 최적화 해상도(종료 판정 1e-6)보다 작은 목적함수 차이는 구별할 수 없으므로 "비슷함"으로 본다. */
const SIMILAR_ABSOLUTE = 1e-5
const SPREAD = 0.1
/** 과적합 판정: 검증 구간의 J가 보정 구간의 J의 이 배수를 넘는다. */
const OVERFIT_RATIO = 2
const OVERFIT_MIN = 1e-4

export interface CalibParam {
  name: string
  /** 허용 범위(폼의 범위 또는 사용자가 좁힌 범위) */
  min: number
  max: number
  integer?: boolean
}

export interface CalibColumn extends ObservedColumn {
  /** 열의 가중치(기본 1/쓰는 열 수). 쓰는 열끼리 합이 1이 되게 다시 맞춘다 */
  weight?: number
  /** 화면에 보일 이름(없으면 변수 이름) */
  label?: string
}

export interface CalibInput {
  model: CompiledModel
  /** 대상 시나리오의 유효 파라미터(상수 덮어쓰기). 보정할 파라미터의 시작값도 여기서 읽는다 */
  base: Record<string, number>
  options: { end?: number; dt?: number; seed?: number }
  params: CalibParam[]
  columns: CalibColumn[]
  align?: AlignOptions
  /** 시간 분할 검증. `true`면 관측이 충분할 때 기본 비율(70%), 숫자면 그 비율, `false`면 쓰지 않는다. 기본 `true` */
  split?: boolean | number
  /** 시작점을 뽑는 시드(같은 입력이면 같은 결과) */
  seed?: number
  starts?: number
  evalsPerParam?: number
}

export class CalibrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalibrationError'
  }
}

export interface CalibStart {
  index: number
  /** 시작 값과 끝 값(파라미터 순서) */
  theta0: number[]
  theta: number[]
  /** 보정 구간의 목적함수 */
  j: number
  evaluations: number
  /** 허용 오차로 멈췄는가(아니면 평가 횟수 상한) */
  converged: boolean
}

export interface CalibColumnFit {
  variable: string
  label: string
  /** 보정 구간의 점 수와 검증 구간의 점 수 */
  n: number
  nVal: number
  /** 보정 전(시작 값)·후의 정규화 RMSE. 보정 구간 */
  nrmseBefore: number | null
  nrmseAfter: number | null
  /** 검증 구간(시간 분할을 쓸 때만) */
  nrmseValBefore: number | null
  nrmseValAfter: number | null
  weight: number
}

export type DiagnosticKind = 'boundary' | 'flat' | 'nonunique' | 'scarce' | 'overfit' | 'noimprove' | 'failed' | 'excluded'

export interface CalibDiagnostic {
  kind: DiagnosticKind
  severity: 'warn' | 'info'
  /** 관련된 파라미터 이름(없으면 빈 목록) */
  params: string[]
  /** 사용자에게 보일 한국어 문구 */
  message: string
}

export interface CalibrationResult {
  names: string[]
  initial: number[]
  best: number[]
  /** 전체 보정 구간의 목적함수: 시작 값일 때와 보정한 값일 때 */
  jBefore: number
  jAfter: number
  /** 검증 구간의 목적함수(시간 분할을 쓸 때만) */
  jValBefore: number | null
  jValAfter: number | null
  split: { fraction: number; cutoffTime: number; nCal: number; nVal: number } | null
  starts: CalibStart[]
  evaluations: number
  columns: CalibColumnFit[]
  diagnostics: CalibDiagnostic[]
  canceled: boolean
}

export interface CalibProgress {
  /** 지금 시작점 번호(0부터)와 전체 */
  start: number
  starts: number
  /** 지금까지의 전체 평가 횟수와 상한(근사) */
  evaluations: number
  maxEvaluations: number
  /** 지금까지의 최선의 목적함수 */
  best: number
}

// ---------- 준비: 관측 정렬과 분할 ----------

interface PreparedColumn {
  variable: string
  label: string
  weight: number
  cal: { t: number[]; o: number[] }
  val: { t: number[]; o: number[] }
}

interface Prepared {
  columns: PreparedColumn[]
  split: CalibrationResult['split']
  excluded: string[]
  nCal: number
}

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length

function prepare(input: CalibInput, baseline: RunResult): Prepared {
  const aligned = input.columns.map((c) => ({ col: c, a: alignColumn(baseline, c, input.align ?? {}) }))
  const allTimes = [...new Set(aligned.flatMap(({ a }) => a.time))].sort((x, y) => x - y)
  const total = aligned.reduce((s, { a }) => s + a.time.length, 0)
  const wantSplit = input.split === undefined || input.split === true || typeof input.split === 'number'
  const fraction = typeof input.split === 'number' ? input.split : DEFAULT_SPLIT_FRACTION
  let cutoff = Infinity
  let split: Prepared['split'] = null
  if (wantSplit && total >= SPLIT_MIN_POINTS && allTimes.length >= 2 && fraction > 0 && fraction < 1) {
    cutoff = allTimes[Math.max(0, Math.min(allTimes.length - 2, Math.ceil(fraction * allTimes.length) - 1))] as number
  }
  const excluded: string[] = []
  let nCal = 0
  let nVal = 0
  const columns: PreparedColumn[] = []
  for (const { col, a } of aligned) {
    const cal = { t: [] as number[], o: [] as number[] }
    const val = { t: [] as number[], o: [] as number[] }
    a.time.forEach((t, i) => {
      const bucket = t <= cutoff ? cal : val
      bucket.t.push(t)
      bucket.o.push(a.observed[i] as number)
    })
    const label = col.label ?? col.variable
    if (cal.t.length === 0 || mean(cal.o.map(Math.abs)) === 0) {
      excluded.push(`${label}: ${cal.t.length === 0 ? '보정에 쓸 관측 점이 없습니다' : '관측의 평균 크기가 0이라 정규화 RMSE를 정할 수 없습니다'}`)
      continue
    }
    nCal += cal.t.length
    nVal += val.t.length
    columns.push({ variable: col.variable, label, weight: col.weight ?? 1, cal, val })
  }
  if (columns.length === 0) throw new CalibrationError('보정에 쓸 관측이 없습니다(시뮬레이션 범위 안의 점이 있고 평균 크기가 0이 아닌 열이 필요합니다).')
  const wsum = columns.reduce((s, c) => s + c.weight, 0)
  if (!(wsum > 0)) throw new CalibrationError('열의 가중치의 합이 0보다 커야 합니다.')
  for (const c of columns) c.weight /= wsum
  if (Number.isFinite(cutoff)) split = { fraction, cutoffTime: cutoff, nCal, nVal }
  return { columns, split, excluded, nCal }
}

// ---------- 목적함수 ----------

interface Evaluator {
  /** x ∈ [0,1]^k → 값(θ). 정수 파라미터도 탐색 중에는 연속 값으로 둔다(반올림하면 목적함수가 계단식이 되어 Nelder–Mead가 평탄 구간에서 멈춘다) */
  toTheta(x: number[]): number[]
  /** 정수 파라미터를 가까운 정수(내림·올림 조합 중 J가 가장 작은 것)로 맞춘다. 정수 파라미터가 없으면 그대로 */
  snap(theta: number[]): { theta: number[]; j: number }
  /** 보정 구간 J와 열별 NRMSE. 시뮬레이션이 오류로 멈추면 J = Infinity */
  cal(theta: number[]): { j: number; nrmse: (number | null)[] }
  val(theta: number[]): { j: number; nrmse: (number | null)[] } | null
  evaluations: number
}

function makeEvaluator(input: CalibInput, prep: Prepared): Evaluator {
  const { params, model, base, options } = input
  const run = (theta: number[]): RunResult | null => {
    const overrides = { ...base }
    params.forEach((p, i) => (overrides[p.name] = theta[i] as number))
    try {
      return new Simulation(model, { overrides, ...options }).run()
    } catch (e) {
      if (e instanceof SimulationError || e instanceof ModelError) return null
      throw e
    }
  }
  const score = (result: RunResult | null, pick: (c: PreparedColumn) => PreparedColumn['cal']) => {
    if (!result) return { j: Infinity, nrmse: prep.columns.map(() => null) }
    let j = 0
    let used = 0
    const nrmse = prep.columns.map((c) => {
      const d = pick(c)
      if (d.t.length === 0) return null
      const denom = mean(d.o.map(Math.abs))
      if (denom === 0) return null
      const mse = mean(d.t.map((t, i) => (valueAt(result, c.variable, t) - (d.o[i] as number)) ** 2))
      const v = Math.sqrt(mse) / denom
      return Number.isFinite(v) ? v : null
    })
    prep.columns.forEach((c, i) => {
      const v = nrmse[i]
      if (v !== null && v !== undefined) {
        j += c.weight * v * v
        used += c.weight
      }
    })
    return { j: used > 0 ? j / used : Infinity, nrmse }
  }
  const self: Evaluator = {
    evaluations: 0,
    toTheta: (x) => params.map((p, i) => p.min + Math.min(1, Math.max(0, x[i] as number)) * (p.max - p.min)),
    snap: (theta) => {
      const options = params.map((p, i) => {
        const v = theta[i] as number
        if (!p.integer) return [v]
        const lo = Math.max(Math.ceil(p.min), Math.floor(v))
        const hi = Math.min(Math.floor(p.max), Math.ceil(v))
        return lo === hi ? [lo] : [lo, hi]
      })
      let best: { theta: number[]; j: number } | null = null
      const walk = (i: number, acc: number[]) => {
        if (i === options.length) {
          const j = self.cal(acc).j
          if (best === null || j < best.j) best = { theta: acc.slice(), j }
          return
        }
        for (const v of options[i] as number[]) walk(i + 1, [...acc, v])
      }
      if (options.every((o) => o.length === 1)) return { theta: options.map((o) => o[0] as number), j: self.cal(options.map((o) => o[0] as number)).j }
      walk(0, [])
      return best as unknown as { theta: number[]; j: number }
    },
    cal: (theta) => {
      self.evaluations++
      return score(run(theta), (c) => c.cal)
    },
    val: (theta) => {
      if (!prep.split) return null
      return score(run(theta), (c) => c.val)
    }
  }
  return self
}

// ---------- Nelder–Mead(유계: [0,1]^k로 사영) ----------

function* nelderMead(k: number, x0: number[], evalJ: (x: number[]) => number, maxEvals: number): Generator<number, { x: number[]; j: number; evaluations: number; converged: boolean }> {
  const clamp = (x: number[]) => x.map((v) => Math.min(1, Math.max(0, v)))
  let evals = 0
  const f = (x: number[]): number => {
    evals++
    return evalJ(x)
  }
  const pts: { x: number[]; f: number }[] = []
  const first = clamp(x0)
  pts.push({ x: first, f: f(first) })
  yield evals
  for (let i = 0; i < k; i++) {
    const x = first.slice()
    x[i] = (x[i] as number) + 0.1 <= 1 ? (x[i] as number) + 0.1 : (x[i] as number) - 0.1
    pts.push({ x: clamp(x), f: f(clamp(x)) })
    yield evals
  }
  let still = 0
  let converged = false
  while (evals < maxEvals) {
    pts.sort((a, b) => a.f - b.f)
    const best = pts[0] as { x: number[]; f: number }
    const worst = pts[k] as { x: number[]; f: number }
    const second = pts[k - 1] as { x: number[]; f: number }
    // 단체의 크기가 매우 작아지면 끝
    let diameter = 0
    for (let i = 1; i <= k; i++) for (let d = 0; d < k; d++) diameter = Math.max(diameter, Math.abs(((pts[i] as { x: number[] }).x[d] as number) - (best.x[d] as number)))
    if (diameter < 1e-7) {
      converged = true
      break
    }
    // 수렴 판정: 단체의 모든 꼭짓점에서 목적함수 값의 차이가 허용 오차보다 작은 반복이 연속 3번이면 멈춘다. "최선의 값이 개선되지 않음"으로
    // 판정하면 Nelder–Mead가 반사·수축을 하는 동안 흔한 정체를 수렴으로 오판해 일찍 멈춘다.
    const spread = worst.f - best.f
    still = Number.isFinite(spread) && spread < TOLERANCE ? still + 1 : 0
    if (still >= 3) {
      converged = true
      break
    }
    const centroid = Array.from({ length: k }, (_, d) => pts.slice(0, k).reduce((s, p) => s + (p.x[d] as number), 0) / k)
    const along = (t: number) => clamp(centroid.map((c, d) => c + t * (c - (worst.x[d] as number))))
    const reflect = along(1)
    const fr = f(reflect)
    yield evals
    if (fr < best.f) {
      const expand = along(2)
      const fe = f(expand)
      yield evals
      pts[k] = fe < fr ? { x: expand, f: fe } : { x: reflect, f: fr }
    } else if (fr < second.f) {
      pts[k] = { x: reflect, f: fr }
    } else {
      const contract = fr < worst.f ? along(0.5) : along(-0.5)
      const fc = f(contract)
      yield evals
      if (fc < Math.min(fr, worst.f)) pts[k] = { x: contract, f: fc }
      else {
        for (let i = 1; i <= k; i++) {
          const x = clamp((best.x).map((b, d) => b + 0.5 * (((pts[i] as { x: number[] }).x[d] as number) - b)))
          pts[i] = { x, f: f(x) }
          yield evals
        }
      }
    }
  }
  pts.sort((a, b) => a.f - b.f)
  return { x: (pts[0] as { x: number[] }).x, j: (pts[0] as { f: number }).f, evaluations: evals, converged }
}

// ---------- 시작점 ----------

/** 시작점 `starts`개: 현재 값과, 시드로 뽑은 라틴 하이퍼큐브 표본(`starts − 1`개). 정규화 좌표 [0,1]^k. */
export function startPoints(x0: number[], starts: number, seed: number): number[][] {
  const k = x0.length
  const m = starts - 1
  const out: number[][] = [x0.slice()]
  if (m <= 0) return out
  // 파라미터마다 구간 번호의 순열을 시드로 섞는다(라틴 하이퍼큐브)
  const perms = Array.from({ length: k }, (_, d) => {
    const idx = Array.from({ length: m }, (_, i) => i)
    for (let i = m - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(uniformFor(seed, 1000 + d * 100 + i, 'lhs-shuffle') * (i + 1)))
      ;[idx[i], idx[j]] = [idx[j] as number, idx[i] as number]
    }
    return idx
  })
  for (let s = 0; s < m; s++) out.push(Array.from({ length: k }, (_, d) => ((perms[d] as number[])[s] as number + uniformFor(seed, s, `lhs-${d}`)) / m))
  return out
}

// ---------- 본체 ----------

/**
 * 보정을 한 평가씩 진행하는 생성기. UI는 `next()`를 시간 예산 안에서 반복 호출하며 진행 막대와 취소를 처리한다. `canceled()`가 true를 돌려주면
 * 그때까지의 최선으로 결과를 만든다. 결과는 같은 입력(시드 포함)이면 항상 같다.
 */
export function* calibrationSteps(input: CalibInput, canceled: () => boolean = () => false): Generator<CalibProgress, CalibrationResult> {
  const { params } = input
  if (params.length === 0) throw new CalibrationError('보정할 파라미터를 하나 이상 고르세요.')
  if (params.length > MAX_CALIB_PARAMS) throw new CalibrationError(`보정할 파라미터는 최대 ${MAX_CALIB_PARAMS}개입니다(더 많으면 해가 유일하지 않습니다).`)
  for (const p of params) {
    if (!(Number.isFinite(p.min) && Number.isFinite(p.max) && p.max > p.min)) throw new CalibrationError(`'${p.name}'의 범위는 최솟값 < 최댓값인 유한한 수여야 합니다.`)
    if (!(p.name in input.base)) throw new CalibrationError(`'${p.name}'은(는) 이 모델의 상수가 아닙니다.`)
  }
  if (new Set(params.map((p) => p.name)).size !== params.length) throw new CalibrationError('같은 파라미터를 두 번 고를 수 없습니다.')
  if (input.columns.length === 0) throw new CalibrationError('비교할 열을 하나 이상 고르세요.')

  const baseline = new Simulation(input.model, { overrides: input.base, ...input.options }).run()
  const prep = prepare(input, baseline)
  const ev = makeEvaluator(input, prep)
  const k = params.length
  const norm = (p: CalibParam, v: number) => Math.min(1, Math.max(0, (v - p.min) / (p.max - p.min)))
  const initial = params.map((p) => Math.min(p.max, Math.max(p.min, input.base[p.name] as number)))
  const x0 = params.map((p, i) => norm(p, initial[i] as number))
  const starts = Math.max(1, input.starts ?? DEFAULT_STARTS)
  const maxEvals = k * (input.evalsPerParam ?? EVALS_PER_PARAM)
  const points = startPoints(x0, starts, input.seed ?? 1)
  const thetaInitial = ev.snap(initial).theta
  const before = ev.cal(thetaInitial)
  ev.evaluations = 0

  const results: CalibStart[] = []
  let bestJ = before.j
  let wasCanceled = false
  const maxTotal = starts * maxEvals
  for (let s = 0; s < points.length; s++) {
    if (canceled()) {
      wasCanceled = true
      break
    }
    const gen = nelderMead(k, points[s] as number[], (x) => ev.cal(ev.toTheta(x)).j, maxEvals)
    let step = gen.next()
    let latest = { x: points[s] as number[], j: Infinity, evaluations: 0, converged: false }
    while (!step.done) {
      yield { start: s, starts: points.length, evaluations: ev.evaluations, maxEvaluations: maxTotal, best: bestJ }
      if (canceled()) {
        wasCanceled = true
        break
      }
      step = gen.next()
    }
    if (step.done) latest = step.value
    else {
      // 취소: 이 시작점의 지금까지 최선은 알 수 없으므로(생성기 내부) 버린다
      break
    }
    const snapped = ev.snap(ev.toTheta(latest.x))
    results.push({ index: s, theta0: ev.toTheta(points[s] as number[]), theta: snapped.theta, j: snapped.j, evaluations: latest.evaluations, converged: latest.converged })
    if (snapped.j < bestJ) bestJ = snapped.j
  }

  // 최선의 시작점(없으면 시작 값 그대로)
  const bestStart = results.reduce<CalibStart | null>((b, r) => (b === null || r.j < b.j ? r : b), null)
  const useBest = bestStart !== null && bestStart.j < before.j
  const best = useBest ? (bestStart as CalibStart).theta : thetaInitial
  const after = useBest ? ev.cal(best) : before
  const valBefore = ev.val(thetaInitial)
  const valAfter = ev.val(best)

  const columns: CalibColumnFit[] = prep.columns.map((c, i) => ({
    variable: c.variable,
    label: c.label,
    n: c.cal.t.length,
    nVal: c.val.t.length,
    nrmseBefore: before.nrmse[i] ?? null,
    nrmseAfter: after.nrmse[i] ?? null,
    nrmseValBefore: valBefore?.nrmse[i] ?? null,
    nrmseValAfter: valAfter?.nrmse[i] ?? null,
    weight: c.weight
  }))

  const diagnostics: CalibDiagnostic[] = []
  for (const e of prep.excluded) diagnostics.push({ kind: 'excluded', severity: 'info', params: [], message: `쓰지 않은 열 — ${e}` })
  if (!useBest) diagnostics.push({ kind: 'noimprove', severity: 'info', params: [], message: '보정으로 목적함수가 줄지 않아 시작 값을 그대로 둡니다. 범위를 넓히거나 다른 파라미터를 골라 보세요.' })
  if (wasCanceled) diagnostics.push({ kind: 'noimprove', severity: 'info', params: [], message: '취소되어 그때까지 끝난 시작점 중 최선의 결과입니다. 진단은 불완전할 수 있습니다.' })
  if (prep.nCal < params.length * 3) {
    diagnostics.push({ kind: 'scarce', severity: 'warn', params: params.map((p) => p.name), message: `관측 점이 ${prep.nCal}개로 파라미터 수(${params.length}) × 3 = ${params.length * 3}보다 적어 과적합하기 쉽습니다.` })
  }
  // 경계에 붙었는가: 보정으로 값이 움직였을 때만 의미가 있다(시작 값이 경계인 것은 사용자가 정한 것이다).
  if (useBest) {
    params.forEach((p, i) => {
      const t = best[i] as number
      const edge = (p.max - p.min) * BOUNDARY_FRACTION
      if (t <= p.min + edge || t >= p.max - edge) {
        diagnostics.push({ kind: 'boundary', severity: 'warn', params: [p.name], message: `'${p.name}'이(가) 허용 범위의 ${t <= p.min + edge ? '아래' : '위'} 끝(${t})에 붙었습니다. 범위가 좁거나 모델이 이 데이터를 설명하지 못합니다.` })
      }
    })
  }
  // 아래 진단은 개선 여부와 무관하다. 시작 값에서 이미 목적함수가 0이어도 "정해지지 않는 파라미터"를 알려 준다.
  {
    // 평탄: 보정한 값에서 각 파라미터를 ±10% 움직여도 J가 거의 늘지 않으면 이 데이터로는 정해지지 않는 파라미터
    params.forEach((p, i) => {
      const v = best[i] as number
      const step = Math.abs(v) > 1e-12 ? Math.abs(v) * FLAT_STEP : (p.max - p.min) * FLAT_STEP
      const probe = (d: number) => {
        const t = best.slice()
        t[i] = Math.min(p.max, Math.max(p.min, v + d))
        if (p.integer) t[i] = Math.round(t[i] as number)
        return ev.cal(t).j
      }
      const worse = Math.max(probe(step), probe(-step)) - after.j
      if (worse < Math.max(FLAT_RELATIVE * after.j, FLAT_ABSOLUTE)) {
        diagnostics.push({ kind: 'flat', severity: 'warn', params: [p.name], message: `'${p.name}'을(를) ±10% 움직여도 목적함수가 거의 변하지 않습니다. 이 데이터로는 정해지지 않는 파라미터입니다.` })
      }
    })
    // 비유일성: 목적함수가 비슷한 시작점들이 서로 다른 파라미터 값에 도달하면 서로 보완하는 파라미터(해가 유일하지 않음)
    const similar = bestStart ? results.filter((r) => r.j <= bestStart.j * SIMILAR_J + SIMILAR_ABSOLUTE) : []
    if (similar.length >= 2) {
      const spread = params.filter((p, i) => {
        const vals = similar.map((r) => r.theta[i] as number)
        return (Math.max(...vals) - Math.min(...vals)) / (p.max - p.min) > SPREAD
      })
      if (spread.length > 0) {
        diagnostics.push({
          kind: 'nonunique',
          severity: 'warn',
          params: spread.map((p) => p.name),
          message: `목적함수가 비슷한 시작점 ${similar.length}개가 '${spread.map((p) => p.name).join("', '")}'에서 서로 다른 값에 도달했습니다. 해가 유일하지 않습니다(서로 보완하는 파라미터일 수 있습니다).`
        })
      }
    }
    if (prep.split && valAfter && valBefore) {
      const jc = after.j
      if (valAfter.j > OVERFIT_RATIO * jc && valAfter.j > OVERFIT_MIN) {
        diagnostics.push({ kind: 'overfit', severity: 'warn', params: [], message: `검증 구간의 목적함수(${valAfter.j.toPrecision(3)})가 보정 구간(${jc.toPrecision(3)})의 ${OVERFIT_RATIO}배를 넘습니다. 보정에 쓰지 않은 구간을 잘 설명하지 못하므로 과적합일 수 있습니다.` })
      }
    }
  }
  if (results.length > 0 && results.every((r) => !Number.isFinite(r.j))) diagnostics.push({ kind: 'failed', severity: 'warn', params: [], message: '모든 시작점에서 시뮬레이션이 오류로 멈췄습니다. 범위를 좁혀 보세요.' })

  return {
    names: params.map((p) => p.name),
    initial: thetaInitial,
    best,
    jBefore: before.j,
    jAfter: after.j,
    jValBefore: valBefore?.j ?? null,
    jValAfter: valAfter?.j ?? null,
    split: prep.split,
    starts: results,
    evaluations: ev.evaluations,
    columns,
    diagnostics,
    canceled: wasCanceled
  }
}

/** 생성기를 끝까지 돌려 결과를 돌려준다(시험·간단한 호출용). `shouldStop`이 true를 돌려주면 그때까지의 결과로 끝낸다. */
export function runCalibration(input: CalibInput, hooks: { onProgress?: (p: CalibProgress) => void; shouldStop?: () => boolean } = {}): CalibrationResult {
  const gen = calibrationSteps(input, hooks.shouldStop)
  for (;;) {
    const s = gen.next()
    if (s.done) return s.value
    hooks.onProgress?.(s.value)
  }
}
