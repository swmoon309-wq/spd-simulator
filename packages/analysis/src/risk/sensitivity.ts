import { Simulation, SimulationError, type CompiledModel } from '@spd/sd-engine'
import { computeKpis, type KpiSpec, type KpiValues } from '../scenario/kpi'
import { inputColumn, type McResult } from './montecarlo'
import { spearman } from './stats'

export const MIN_SWEEP_LEVELS = 3
export const MAX_SWEEP_LEVELS = 21
export const DEFAULT_SWEEP_LEVELS = 9

export interface SensitivityBase {
  model: CompiledModel
  /** 대상 시나리오의 유효 파라미터 */
  baseParams: Record<string, number>
  options: { end?: number; dt?: number; seed?: number }
  kpis: KpiSpec[]
}

/** 한 번 실행해 지표를 낸다. 수치 오류(`SimulationError`)면 null과 메시지. */
function evaluate(base: SensitivityBase, overrides: Record<string, number>): { kpis: KpiValues | null; error: string | null } {
  const params = { ...base.baseParams, ...overrides }
  try {
    const result = new Simulation(base.model, { overrides: params, ...base.options }).run()
    return { kpis: computeKpis(base.kpis, result, params), error: null }
  } catch (e) {
    if (e instanceof SimulationError) return { kpis: null, error: e.message }
    throw e
  }
}

/** `min`~`max`를 `k`개 수준으로 나눈다. 정수 파라미터는 반올림해 겹치는 수준을 합친다. */
export function sweepLevels(min: number, max: number, k: number, integer = false): number[] {
  const count = Math.min(MAX_SWEEP_LEVELS, Math.max(MIN_SWEEP_LEVELS, Math.round(k)))
  const raw = Array.from({ length: count }, (_, i) => (count === 1 ? min : min + ((max - min) * i) / (count - 1)))
  const levels = integer ? raw.map((x) => Math.round(x)) : raw
  return [...new Set(levels)]
}

export interface SweepParam {
  name: string
  min: number
  max: number
  integer?: boolean
}

export interface SweepResult {
  name: string
  levels: number[]
  /** 지표별, 수준별 값. 계산할 수 없거나 실패한 수준은 null */
  values: Record<string, (number | null)[]>
  /** 수준별 오류 메시지(없으면 null) */
  errors: (string | null)[]
}

/** 단일 파라미터 스윕: 한 파라미터를 `k`개 수준으로 바꾸며 지표 곡선을 낸다(설계 06의 6.1). */
export function runSweep(base: SensitivityBase, param: SweepParam, k = DEFAULT_SWEEP_LEVELS): SweepResult {
  const levels = sweepLevels(param.min, param.max, k, param.integer)
  const values: Record<string, (number | null)[]> = Object.fromEntries(base.kpis.map((s) => [s.id, [] as (number | null)[]]))
  const errors: (string | null)[] = []
  for (const level of levels) {
    const r = evaluate(base, { [param.name]: level })
    errors.push(r.error)
    for (const s of base.kpis) (values[s.id] as (number | null)[]).push(r.kpis ? (r.kpis[s.id] ?? null) : null)
  }
  return { name: param.name, levels, values, errors }
}

export interface OatParam {
  name: string
  low: number
  high: number
}

export interface TornadoEntry {
  name: string
  low: number
  high: number
  /** 낮은/높은 값에서의 지표(계산할 수 없으면 null) */
  kpiLow: number | null
  kpiHigh: number | null
  /** `|kpiHigh − kpiLow|`. 한쪽이 null이면 null */
  swing: number | null
}

export interface OatResult {
  /** 기준(모든 파라미터가 대상 시나리오의 값)의 지표 */
  base: KpiValues | null
  /** 지표별 토네이도(변화 폭이 큰 순서, 폭을 모르는 항목은 뒤) */
  entries: Record<string, TornadoEntry[]>
  errors: { name: string; at: 'low' | 'high'; message: string }[]
}

/** 폭이 큰 순서로 정렬한다. 폭을 모르는(null) 항목은 뒤에 둔다. */
export function sortTornado<T extends { swing: number | null }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.swing === null && b.swing === null) return 0
    if (a.swing === null) return 1
    if (b.swing === null) return -1
    return b.swing - a.swing
  })
}

/**
 * 한 번에 하나씩(OAT) 토네이도: 파라미터마다 낮은 값·높은 값으로 바꿔(나머지는 기준) 지표의 변화 폭을 낸다. 실행은 파라미터 수 × 2
 * + 1회. 상호작용은 보지 못한다(설계 06의 6.1).
 */
export function runOat(base: SensitivityBase, params: OatParam[]): OatResult {
  const baseRun = evaluate(base, {})
  const errors: OatResult['errors'] = []
  const rows = params.map((p) => {
    const lo = evaluate(base, { [p.name]: p.low })
    const hi = evaluate(base, { [p.name]: p.high })
    if (lo.error) errors.push({ name: p.name, at: 'low', message: lo.error })
    if (hi.error) errors.push({ name: p.name, at: 'high', message: hi.error })
    return { p, lo: lo.kpis, hi: hi.kpis }
  })
  const entries: Record<string, TornadoEntry[]> = {}
  for (const spec of base.kpis) {
    const list: TornadoEntry[] = rows.map(({ p, lo, hi }) => {
      const kl = lo ? (lo[spec.id] ?? null) : null
      const kh = hi ? (hi[spec.id] ?? null) : null
      return { name: p.name, low: p.low, high: p.high, kpiLow: kl, kpiHigh: kh, swing: kl !== null && kh !== null ? Math.abs(kh - kl) : null }
    })
    entries[spec.id] = sortTornado(list)
  }
  return { base: baseRun.kpis, entries, errors }
}

export interface RankEntry {
  name: string
  /** 입력과 지표의 스피어만 순위상관(−1 ~ 1). 계산할 수 없으면 NaN */
  rho: number
}

/**
 * Monte Carlo 결과의 입력·지표 순위상관 토네이도(설계 06의 6.2). 추가 실행 없이 파라미터가 동시에 흔들릴 때의 기여를 본다.
 * 실패한 반복과 지표가 없는 반복은 제외한다. 상관의 절댓값이 큰 순서.
 */
export function rankTornado(result: McResult, kpiId: string): RankEntry[] {
  const j = result.kpiIds.indexOf(kpiId)
  if (j < 0) return []
  const y: number[] = []
  const idx: number[] = []
  for (let i = 0; i < result.completed; i++) {
    if (result.status[i] === 1) continue
    const v = (result.kpis[j] as Float64Array)[i] as number
    if (Number.isFinite(v)) {
      y.push(v)
      idx.push(i)
    }
  }
  const out: RankEntry[] = result.inputNames.map((name) => {
    const col = inputColumn(result, name)
    return { name, rho: spearman(idx.map((i) => col[i] as number), y) }
  })
  return out.sort((a, b) => (Number.isNaN(a.rho) ? 1 : Number.isNaN(b.rho) ? -1 : Math.abs(b.rho) - Math.abs(a.rho)))
}
