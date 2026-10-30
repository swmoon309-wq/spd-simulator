import { defaultRange, runOat, runSweep, type OatParam, type OatResult, type SensitivityBase, type SweepResult } from '@spd/analysis'
import type { CompiledModel } from '@spd/sd-engine'
import type { ModelEntry } from '../catalog'
import { paramSpecs } from './params'
import { buildInputSpecs, type RiskInput } from './risk'
import type { RunSettings } from './runSettings'

const sortedParams = (p: Record<string, number>) => Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** 민감도 결과의 식별 키. 반복 수·시드는 영향이 없다(실행은 결정적). */
export function oatKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, inputs: RiskInput[]): string {
  return JSON.stringify(['oat', entry.id, entry.def.meta.version, sortedParams(base), run.end, run.dt, run.seed, inputs])
}

export interface SweepRequest {
  name: string
  min: number
  max: number
  k: number
}

export function sweepKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, req: SweepRequest): string {
  return JSON.stringify(['sweep', entry.id, entry.def.meta.version, sortedParams(base), run.end, run.dt, run.seed, req])
}

/** 토네이도의 낮은/높은 값: 입력 분포의 P10/P90(설계 06의 6.1). */
export function oatParams(entry: ModelEntry, inputs: RiskInput[]): OatParam[] {
  return buildInputSpecs(entry, inputs).map((spec) => {
    const [low, high] = defaultRange(spec)
    return { name: spec.name, low, high }
  })
}

export function sensitivityBase(model: CompiledModel, entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>): SensitivityBase {
  return { model, baseParams: base, options: { end: run.end, dt: run.dt, seed: run.seed }, kpis: entry.kpiSpecs }
}

export function computeOat(model: CompiledModel, entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, inputs: RiskInput[]): OatResult {
  return runOat(sensitivityBase(model, entry, base, run), oatParams(entry, inputs))
}

/** 스윕의 기본 범위: 입력 분포가 있으면 P10~P90, 없으면 현재 값의 0.5~1.5배를 허용 범위 안으로. */
export function sweepDefaults(entry: ModelEntry, base: Record<string, number>, inputs: RiskInput[], name: string): { min: number; max: number } | null {
  const spec = paramSpecs(entry).find((s) => s.name === name)
  if (!spec) return null
  const input = inputs.find((i) => i.name === name)
  const round = (x: number) => (spec.integer ? Math.round(x) : Number(x.toPrecision(6)))
  if (input) {
    const inputSpec = buildInputSpecs(entry, [input])[0]
    if (inputSpec) {
      const [lo, hi] = defaultRange(inputSpec)
      return { min: round(lo), max: round(hi) }
    }
  }
  const v = base[name] ?? 0
  let min = Math.max(spec.min, round(v * 0.5))
  let max = Math.min(spec.max, round(v * 1.5))
  if (!(max > min)) {
    min = spec.min
    max = spec.max
  }
  return { min, max }
}

/** 스윕 요청 검사. 문제가 없으면 null. */
export function sweepProblem(entry: ModelEntry, req: SweepRequest): string | null {
  const spec = paramSpecs(entry).find((s) => s.name === req.name)
  if (!spec) return `'${req.name}'은(는) 이 모델의 입력 항목이 아닙니다.`
  if (!Number.isFinite(req.min) || !Number.isFinite(req.max)) return '범위는 유한한 수여야 합니다.'
  if (!(req.max > req.min)) return '최댓값이 최솟값보다 커야 합니다.'
  if (req.min < spec.min || req.max > spec.max) return `허용 범위 ${spec.min} ~ ${spec.max} 안이어야 합니다.`
  if (!Number.isFinite(req.k)) return '수준 수는 숫자여야 합니다.'
  return null
}

export function computeSweep(model: CompiledModel, entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, req: SweepRequest): SweepResult {
  const spec = paramSpecs(entry).find((s) => s.name === req.name)
  return runSweep(sensitivityBase(model, entry, base, run), { name: req.name, min: req.min, max: req.max, ...(spec?.integer ? { integer: true } : {}) }, req.k)
}
