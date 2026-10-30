import { ModelError, Simulation, type CompiledModel, type RunResult } from '@spd/sd-engine'
import type { ConstantChange } from '../evm/actions'

/**
 * 교란 시험(설계 07의 4.2, VAL-06): 책 2.7.2의 이상화된 시험 입력(스텝·펄스·램프)을 **상수에** 걸어 반응을 본다. 외부 신호를
 * Rate에 직접 넣는 것은 지원하지 않는다(모델 편집기, 4차). 입력은 시각별 상수 변경(`setConstant`)으로 만든다.
 */

export type PerturbKind = 'step' | 'pulse' | 'ramp'

export const PERTURB_LABEL: Record<PerturbKind, string> = { step: '스텝', pulse: '펄스', ramp: '램프' }

/** 램프의 계단 수(변경 K + 1개). */
export const RAMP_STEPS = 10

export interface PerturbSpec {
  kind: PerturbKind
  /** 건드릴 상수 */
  name: string
  /** `absolute`면 `amount`가 상수의 새 값, `percent`면 현재 값 대비 증감(%) */
  mode: 'absolute' | 'percent'
  amount: number
  /** 시작 시각(일) */
  day: number
  /** 펄스·램프의 폭(일). 스텝에는 쓰지 않는다 */
  width: number
}

/** 실행 조건의 시각 범위. */
export interface PerturbRange {
  start: number
  end: number
}

/** 시험 입력의 검사. 문제가 없으면 null. `base`는 상수의 현재(대상 시나리오의) 값. */
export function perturbProblem(spec: PerturbSpec, base: number | undefined, range: PerturbRange): string | null {
  if (base === undefined) return `'${spec.name}'은(는) 이 모델의 상수가 아닙니다.`
  if (!Number.isFinite(spec.amount)) return '크기는 유한한 수여야 합니다.'
  if (!Number.isFinite(spec.day) || spec.day < range.start || spec.day >= range.end) return `시작 시각은 ${range.start} 이상 ${range.end} 미만이어야 합니다.`
  if (spec.kind !== 'step' && !(Number.isFinite(spec.width) && spec.width > 0)) return '폭은 0보다 큰 수여야 합니다.'
  return null
}

/** 시험 입력이 가리키는 새 값. */
export const targetValue = (spec: PerturbSpec, base: number): number => (spec.mode === 'percent' ? base * (1 + spec.amount / 100) : spec.amount)

/**
 * 시험 입력을 시각별 상수 변경 목록으로 바꾼다(시각 오름차순). 스텝은 시각부터 새 값(1개), 펄스는 `[day, day + width)` 동안만 새 값이고
 * 이후 원래 값(2개), 램프는 `day`에서 `day + width`까지 원래 값에서 새 값으로 `RAMP_STEPS`단의 계단으로 오르고 이후 새 값을 유지한다(K + 1개).
 */
export function perturbChanges(spec: PerturbSpec, base: number): ConstantChange[] {
  const v = targetValue(spec, base)
  switch (spec.kind) {
    case 'step':
      return [{ day: spec.day, name: spec.name, value: v }]
    case 'pulse':
      return [{ day: spec.day, name: spec.name, value: v }, { day: spec.day + spec.width, name: spec.name, value: base }]
    case 'ramp':
      return Array.from({ length: RAMP_STEPS + 1 }, (_, j) => ({ day: spec.day + (spec.width * j) / RAMP_STEPS, name: spec.name, value: base + ((v - base) * j) / RAMP_STEPS }))
  }
}

/**
 * 시각별 상수 변경을 적용하며 끝까지 실행한다. 변경 시각의 스텝까지 진행한 뒤 상수를 바꾸므로 그 스텝부터 새 값이 쓰인다.
 * 시작 시각 이하의 변경은 시작할 때 적용한다. 변경이 없으면 보통의 실행과 비트 단위로 같다.
 */
export function runWithChanges(model: CompiledModel, params: Record<string, number>, options: { end?: number; dt?: number; seed?: number }, changes: ConstantChange[]): RunResult {
  const sim = new Simulation(model, { overrides: params, ...options })
  for (const c of [...changes].sort((a, b) => a.day - b.day)) {
    const at = Math.round((c.day - sim.start) / sim.dt)
    if (at > sim.currentStep) sim.advance(at - sim.currentStep)
    if (sim.done) break
    sim.setConstant(c.name, c.value)
  }
  return sim.run()
}

export interface ResponseSummary {
  variable: string
  /** 반응이 전혀 없는가(모든 시점에서 편차 0) */
  noEffect: boolean
  /** 최대 |편차|와 그 부호 있는 값, 그 시각 */
  maxDeviation: number
  signedAtMax: number
  timeOfMax: number
  /** 최대 편차 시점의 기준 값 대비 비율(기준이 0에 가까우면 null) */
  relativeAtMax: number | null
  /** 최대 편차 이후 |편차|가 최대의 5% 이하로 줄어드는 첫 시각. 줄어들지 않으면 null("복귀 안 함") */
  returnTime: number | null
  /** 마지막 시점의 편차 */
  finalDeviation: number
  /** 교란 실행에서 이 변수가 음수가 되었는가(Level 등) */
  goesNegative: boolean
}

export const RETURN_FRACTION = 0.05

/**
 * 기준 실행과 교란 실행의 반응 요약. 같은 시각 눈금(같은 dt·종료)의 실행이어야 한다. 복귀는 "편차가 최대의 5% 이하로 줄어드는
 * 시각"으로 보므로 누적량처럼 영구히 달라진 변수는 "복귀 안 함"이 된다.
 */
export function summarizeResponse(base: RunResult, perturbed: RunResult, variable: string): ResponseSummary {
  const b = base.series[variable]
  const p = perturbed.series[variable]
  if (!b || !p) throw new ModelError('option', `결과에 변수 '${variable}'이(가) 없습니다`, { variable })
  if (b.length !== p.length) throw new ModelError('option', '기준과 교란 실행의 시각 눈금이 달라 비교할 수 없습니다')
  let maxAbs = 0
  let at = 0
  let negative = false
  for (let i = 0; i < b.length; i++) {
    const d = Math.abs((p[i] as number) - (b[i] as number))
    if (d > maxAbs) {
      maxAbs = d
      at = i
    }
    if ((p[i] as number) < -1e-9) negative = true
  }
  const final = (p[p.length - 1] as number) - (b[b.length - 1] as number)
  if (maxAbs === 0) return { variable, noEffect: true, maxDeviation: 0, signedAtMax: 0, timeOfMax: base.time[0] as number, relativeAtMax: null, returnTime: null, finalDeviation: final, goesNegative: negative }
  let returnTime: number | null = null
  for (let i = at + 1; i < b.length; i++) {
    if (Math.abs((p[i] as number) - (b[i] as number)) <= RETURN_FRACTION * maxAbs) {
      returnTime = base.time[i] as number
      break
    }
  }
  const baseAtMax = b[at] as number
  return {
    variable,
    noEffect: false,
    maxDeviation: maxAbs,
    signedAtMax: (p[at] as number) - baseAtMax,
    timeOfMax: base.time[at] as number,
    relativeAtMax: Math.abs(baseAtMax) > 1e-9 ? ((p[at] as number) - baseAtMax) / Math.abs(baseAtMax) : null,
    returnTime,
    finalDeviation: final,
    goesNegative: negative
  }
}

// ---------- Level 변화 점검(정상 상태 점검 대신, 책 2.7.1) ----------

export interface LevelChange {
  name: string
  start: number
  end: number
  change: number
  /** 시작 값 대비 비율(시작이 0에 가까우면 null) */
  relative: number | null
  /** 움직였는가(변화가 허용 오차보다 큼) */
  moves: boolean
}

export const DEFAULT_LEVEL_CHECK_DAYS = 40

/**
 * 짧은 구간(기본 40일)을 실행해 시작 대비 변한 Level을 변화량 순으로 낸다. 모델마다 정상 상태를 만드는 중립 입력이 달라 정상 상태인지
 * 자동으로 판정하지 않는다 — "어느 Level이 움직이는가"를 보여 주어 사람이 범인을 찾게 한다(책 2.7.1).
 */
export function levelChanges(model: CompiledModel, params: Record<string, number>, options: { dt?: number; seed?: number }, days = DEFAULT_LEVEL_CHECK_DAYS): LevelChange[] {
  const end = model.def.time.start + days
  const result = new Simulation(model, { overrides: params, ...options, end }).run()
  const rows: LevelChange[] = []
  for (const name of Object.keys(model.def.levels)) {
    const s = result.series[name] as Float64Array
    const start = s[0] as number
    const last = s[s.length - 1] as number
    const change = last - start
    rows.push({ name, start, end: last, change, relative: Math.abs(start) > 1e-9 ? change / Math.abs(start) : null, moves: Math.abs(change) > 1e-9 * Math.max(1, Math.abs(start)) })
  }
  return rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
}
