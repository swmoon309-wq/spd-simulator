import { Simulation, type CompiledModel, type RunResult } from '@spd/sd-engine'
import type { ConstantChange } from './actions'

/** 생산성 보정 계수 κ의 허용 범위(설계 05의 7.2). 벗어나면 이 범위로 제한하고 알린다. */
export const KAPPA_MIN = 0.3
export const KAPPA_MAX = 3

export function clampKappa(k: number): { kappa: number; clamped: boolean } {
  const kappa = Math.min(KAPPA_MAX, Math.max(KAPPA_MIN, k))
  return { kappa, clamped: kappa !== k }
}

/** 실적에서 읽은 관측값. 재예측이 모델 상태를 덮어쓰는 데 쓴다. */
export interface ObservedState {
  /** 보고일 */
  day: number
  /** 단계별 누적 완료 태스크(키는 모델의 진척 인정 변수) */
  cum: Record<string, number>
  /** 누적 투입 공수(맨데이) */
  effort: number
  /** 투입 인원. 없으면 인원은 기준선 값을 그대로 쓴다. */
  headcount?: number
}

/** 덮어쓸 Level 하나. `kind`는 화면의 가정 목록에 쓴다. */
export interface LevelOverwrite {
  name: string
  value: number
  /** observed: 실적 값 그대로, derived: 실적에서 계산(기준선의 비율 등을 섞음) */
  kind: 'observed' | 'derived'
  note: string
}

export interface PlanContext {
  observed: ObservedState
  /** 기준선을 보고일까지 실행한 상태의 값(상수 포함) */
  baseline(name: string): number
}

/** 모델마다 다른 재예측 규칙. 어느 Level을 실적으로 덮고 κ를 어느 상수에 곱하는지 정한다. */
export interface ReforecastAdapter {
  modelId: string
  /** κ를 곱하는 상수(현재 값 × κ) */
  kappaConstant: string
  overwrites(ctx: PlanContext): LevelOverwrite[]
}

const finite = (x: number): number => (Number.isFinite(x) ? x : 0)

/**
 * 통합 프로젝트 모델. 실적으로 관측하는 것: 개발·QA·시험 완료 태스크, 누적 공수, 인원. 나머지(오류 재고, 소진, 인식 규모,
 * 업무 비율 평활 상태 등)는 기준선 값을 그대로 쓴다(관측 불가 → 추정).
 * 설계 05의 7.2는 QA 대기 3단을 "균등 분배"로 두었으나, 구현은 **기준선의 3단 비율을 유지**한다(기준선 합이 0이면 균등).
 * 실적이 기준선 자신일 때 재예측이 기준선과 같아지도록(자기 일관성) 하기 위해서다.
 */
export const integratedReforecast: ReforecastAdapter = {
  modelId: 'integrated-project',
  kappaConstant: 'prod_calibration',
  overwrites({ observed, baseline }) {
    const total = baseline('total_tasks')
    const dev = Math.min(total, Math.max(0, observed.cum['prod_tasks_developed'] ?? 0))
    const qa = Math.min(dev, Math.max(0, observed.cum['prod_tasks_qaed'] ?? 0))
    const test = Math.min(qa, Math.max(0, observed.cum['prod_tasks_tested'] ?? 0))
    const out: LevelOverwrite[] = [
      { name: 'prod_tasks_developed', value: dev, kind: 'observed', note: '개발 완료 태스크(총 태스크를 넘지 않게)' },
      { name: 'prod_tasks_qaed', value: qa, kind: 'observed', note: 'QA 완료 태스크(개발 완료를 넘지 않게)' },
      { name: 'prod_tasks_tested', value: test, kind: 'observed', note: '시험 완료 태스크(QA 완료를 넘지 않게)' }
    ]
    // QA 대기(개발 − QA 완료)를 기준선의 3단 비율로 나눈다.
    const waiting = dev - qa
    const stages = ['prod_qa_s1', 'prod_qa_s2', 'prod_qa_s3']
    const base = stages.map((s) => baseline(s))
    const sum = base[0]! + base[1]! + base[2]!
    stages.forEach((s, i) => out.push({ name: s, value: sum > 0 ? (waiting * base[i]!) / sum : waiting / 3, kind: 'derived', note: 'QA 대기(개발 − QA 완료)를 기준선의 3단 비율로 분배' }))

    out.push({ name: 'ctl_cum_md', value: Math.max(0, observed.effort), kind: 'observed', note: '누적 투입 공수' })
    // 개발·시험 투입 공수는 직접 관측하지 않는다. 총 공수가 기준선 대비 달라진 비율로 기준선 값을 늘리거나 줄인다.
    const baseEffort = baseline('ctl_cum_md')
    if (baseEffort > 0) {
      const ratio = Math.max(0, observed.effort) / baseEffort
      for (const n of ['prod_cum_md_dev', 'prod_cum_md_test']) out.push({ name: n, value: baseline(n) * ratio, kind: 'derived', note: '기준선 값 × (실적 누적 공수 / 기준선 누적 공수)' })
    }
    if (observed.headcount !== undefined) {
      const hn = baseline('hr_new')
      const hp = baseline('hr_pros')
      const head = Math.max(0, observed.headcount)
      const share = hn + hp > 0 ? hn / (hn + hp) : 0
      out.push({ name: 'hr_new', value: head * share, kind: 'derived', note: '실적 인원 × 기준선의 신입 비율' })
      out.push({ name: 'hr_pros', value: head * (1 - share), kind: 'derived', note: '실적 인원 × 기준선의 숙련 비율' })
    }
    return out.map((o) => ({ ...o, value: finite(o.value) }))
  }
}

/** Brooks 모델: 개발 완료 규모, 남은 요구사항, 누적 공수, 인원. κ는 공칭 생산성에 곱한다(설계 05의 7.3). */
export const brooksReforecast: ReforecastAdapter = {
  modelId: 'brooks',
  kappaConstant: 'nominal_productivity',
  overwrites({ observed, baseline }) {
    const total = baseline('initial_requirements')
    const dev = Math.min(total, Math.max(0, observed.cum['developed_software'] ?? 0))
    const out: LevelOverwrite[] = [
      { name: 'developed_software', value: dev, kind: 'observed', note: '개발 완료 규모(초기 요구사항을 넘지 않게)' },
      { name: 'requirements', value: total - dev, kind: 'derived', note: '남은 요구사항 = 초기 요구사항 − 개발 완료' },
      { name: 'cum_effort', value: Math.max(0, observed.effort), kind: 'observed', note: '누적 투입 공수' }
    ]
    if (observed.headcount !== undefined) {
      const hn = baseline('new_personnel')
      const he = baseline('experienced_personnel')
      const head = Math.max(0, observed.headcount)
      const share = hn + he > 0 ? hn / (hn + he) : 0
      out.push({ name: 'new_personnel', value: head * share, kind: 'derived', note: '실적 인원 × 기준선의 신입 비율' })
      out.push({ name: 'experienced_personnel', value: head * (1 - share), kind: 'derived', note: '실적 인원 × 기준선의 숙련 비율' })
    }
    return out.map((o) => ({ ...o, value: finite(o.value) }))
  }
}

/** AI 보조 확장도 Level이 같아 같은 어댑터를 쓴다(설계 10, P0는 새 Level이 없다). */
export const integratedAiReforecast: ReforecastAdapter = { ...integratedReforecast, modelId: 'integrated-project-ai' }

export const reforecastAdapters: Record<string, ReforecastAdapter> = {
  [integratedReforecast.modelId]: integratedReforecast,
  [integratedAiReforecast.modelId]: integratedAiReforecast,
  [brooksReforecast.modelId]: brooksReforecast
}

export interface ReforecastInput {
  adapter: ReforecastAdapter
  /** 기준선(채택 시나리오)의 상수 덮어쓰기 */
  params: Record<string, number>
  options: { end?: number; dt?: number; seed?: number }
  observed: ObservedState
  /** 시험할 κ들(이름과 값). 같은 스냅샷에서 각각 이어 실행한다. */
  kappas: { name: string; kappa: number }[]
  /** 이어 실행 시작에서 추가로 바꿀 상수 */
  constants?: Record<string, number>
  /** 시각별 상수 변경(시정 조치 시험, 설계 05의 8장). 보고일 이하의 변경은 시작할 때 적용한다. */
  changes?: ConstantChange[]
}

export interface ReforecastRun {
  name: string
  /** 요청한 값 */
  requested: number
  /** 실제로 쓴 값(범위로 제한한 뒤) */
  kappa: number
  clamped: boolean
  /** 보고일부터 종료 시각까지의 결과 */
  result: RunResult
}

export interface ReforecastOutcome {
  /** 실제로 이어 실행을 시작한 시각(보고일을 dt 격자에 맞춘 값) */
  atDay: number
  /** 덮어쓴 Level과 기준선 값 */
  overwrites: (LevelOverwrite & { baseline: number })[]
  /** 덮어쓰지 않아 기준선 값을 그대로 쓴 Level */
  estimatedLevels: string[]
  runs: ReforecastRun[]
}

export class ReforecastError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReforecastError'
  }
}

/**
 * 시뮬레이션 기반 재예측(설계 05의 7.2).
 *  1. 기준선을 보고일까지 실행해 상태를 스냅샷한다.
 *  2. 관측 가능한 Level을 실적으로 덮어쓴다. 관측 불가 Level은 기준선 값을 쓴다(추정).
 *  3. 생산성 상수에 κ를 곱한다.
 *  4. 보고일부터 종료 시각까지 이어서 실행한다. κ마다 같은 스냅샷에서 한 번씩 실행해 범위를 낸다.
 */
export function reforecast(model: CompiledModel, input: ReforecastInput): ReforecastOutcome {
  const { adapter, params, options, observed } = input
  if (model.def.meta.id !== adapter.modelId) throw new ReforecastError(`모델(${model.def.meta.id})과 어댑터(${adapter.modelId})가 다릅니다`)
  if (!Number.isFinite(observed.day) || observed.day <= 0) throw new ReforecastError('보고일이 0보다 커야 재예측할 수 있습니다')
  if (input.kappas.length === 0) throw new ReforecastError('시험할 보정 계수가 없습니다')

  const sim = new Simulation(model, { overrides: params, ...options })
  const step = Math.round((observed.day - sim.start) / sim.dt)
  if (step < 1) throw new ReforecastError('보고일이 너무 이릅니다')
  if (step >= sim.totalSteps) throw new ReforecastError('보고일이 종료 시각 이후여서 이어서 실행할 구간이 없습니다')
  sim.advance(step)
  const snapshot = sim.snapshot()
  const at = (name: string) => sim.valueOf(name)

  const plan = adapter.overwrites({ observed, baseline: at })
  const overwrites = plan.map((o) => ({ ...o, baseline: at(o.name) }))
  const overwritten = new Set(plan.map((o) => o.name))
  const estimatedLevels = [...model.levels.map((l) => l.name)].filter((n) => !overwritten.has(n))
  const baseKappaValue = at(adapter.kappaConstant)

  const runs: ReforecastRun[] = input.kappas.map(({ name, kappa }) => {
    if (!Number.isFinite(kappa)) throw new ReforecastError(`보정 계수 '${name}'이(가) 유한한 수가 아닙니다`)
    const { kappa: used, clamped } = clampKappa(kappa)
    const fork = Simulation.fork(model, snapshot, { overrides: { ...params, ...input.constants }, ...options })
    for (const o of plan) fork.setLevel(o.name, o.value)
    fork.setConstant(adapter.kappaConstant, baseKappaValue * used)
    // 시각별 변경: 그 시각까지 진행한 뒤 상수를 바꾸고 이어서 간다.
    const timed = [...(input.changes ?? [])].sort((a, b) => a.day - b.day)
    for (const c of timed) {
      const at = Math.round((c.day - fork.start) / fork.dt)
      if (at > fork.currentStep) fork.advance(at - fork.currentStep)
      if (fork.done) break
      fork.setConstant(c.name, c.value)
    }
    return { name, requested: kappa, kappa: used, clamped, result: fork.run() }
  })
  return { atDay: sim.time, overwrites, estimatedLevels, runs }
}
