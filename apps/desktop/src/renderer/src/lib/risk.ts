import { DEFAULT_ITERATIONS, effectiveParams, MAX_ITERATIONS, validateInput, type DistSpec, type InputSpec, type McTarget, type Scenario } from '@spd/analysis'
import type { RiskFile } from '../../../shared/projectFile'
import type { ModelEntry } from '../catalog'
import { BASE_ID } from './scenarioRunner'
import { paramSpecs } from './params'
import type { RunSettings } from './runSettings'

export const MIN_RISK_ITERATIONS = 20
export const MAX_RISK_INPUTS = 12
export const MAX_RISK_SEED = 2147483647
/** 시나리오 간 비교(설계 06의 5.4)에 고를 수 있는 시나리오(기준 포함) 수 */
export const MAX_COMPARE = 3
export const MIN_COMPARE = 2

/** 불확실한 입력 하나: 파라미터 이름과 분포. 허용 범위는 카탈로그에서 가져온다. */
export interface RiskInput {
  name: string
  dist: DistSpec
}

/** 위험 분석(Monte Carlo) 설정(설계 06의 8장). 결과는 저장하지 않는다. */
export interface RiskSettings {
  /** 대상: `BASE_ID`(기준) 또는 시나리오 id */
  scenarioId: string
  n: number
  seed: number
  inputs: RiskInput[]
  targets: McTarget[]
  /** 시계열 띠를 모을 변수. 없으면 모으지 않는다. */
  bandVariable: string | null
  /** 시나리오 간 비교에 고른 대상(기준은 `BASE_ID`). 실행 결과의 키에는 넣지 않는다. */
  compareIds: string[]
}

export function defaultRiskSettings(): RiskSettings {
  return { scenarioId: BASE_ID, n: DEFAULT_ITERATIONS, seed: 1, inputs: [], targets: [], bandVariable: null, compareIds: [] }
}

/** 대상 시나리오의 유효 파라미터. 시나리오가 없으면 null. */
export function riskBaseParams(params: Record<string, number>, scenarios: Scenario[], scenarioId: string): Record<string, number> | null {
  if (scenarioId === BASE_ID) return { ...params }
  const sc = scenarios.find((s) => s.id === scenarioId)
  return sc ? effectiveParams(params, sc) : null
}

/** 입력 목록을 분석 계층의 `InputSpec`으로 바꾼다(허용 범위·정수 여부는 카탈로그에서). 폼에 없는 파라미터는 건너뛴다. */
export function buildInputSpecs(entry: ModelEntry, inputs: RiskInput[]): InputSpec[] {
  const specs = paramSpecs(entry)
  return inputs.flatMap((i) => {
    const sp = specs.find((s) => s.name === i.name)
    return sp ? [{ name: i.name, dist: i.dist, min: sp.min, max: sp.max, ...(sp.integer ? { integer: true } : {}) }] : []
  })
}

/** 실행 전 검사. 모두 한국어 문장이고 비어 있으면 실행할 수 있다. */
export function riskProblems(entry: ModelEntry, settings: RiskSettings, params: Record<string, number>, scenarios: Scenario[]): string[] {
  const out: string[] = []
  if (riskBaseParams(params, scenarios, settings.scenarioId) === null) out.push('대상 시나리오를 찾을 수 없습니다.')
  if (!Number.isInteger(settings.n) || settings.n < MIN_RISK_ITERATIONS || settings.n > MAX_ITERATIONS) {
    out.push(`반복 수는 ${MIN_RISK_ITERATIONS} ~ ${MAX_ITERATIONS}의 정수여야 합니다.`)
  }
  if (!Number.isInteger(settings.seed) || settings.seed < 0 || settings.seed > MAX_RISK_SEED) out.push(`시드는 0 ~ ${MAX_RISK_SEED}의 정수여야 합니다.`)
  if (settings.inputs.length === 0) out.push('불확실한 입력을 하나 이상 추가하세요.')
  const specs = paramSpecs(entry)
  const seen = new Set<string>()
  for (const i of settings.inputs) {
    const sp = specs.find((s) => s.name === i.name)
    const label = entry.def.constants[i.name]?.label ?? i.name
    if (!sp) {
      out.push(`'${i.name}'은(는) 이 모델의 입력 항목이 아닙니다.`)
      continue
    }
    if (seen.has(i.name)) out.push(`'${label}'이(가) 겹칩니다.`)
    seen.add(i.name)
    const e = validateInput({ name: i.name, dist: i.dist, min: sp.min, max: sp.max, ...(sp.integer ? { integer: true } : {}) })
    if (e) out.push(`${label}: ${e}`)
  }
  if (settings.bandVariable !== null && !entry.variables.some((v) => v.name === settings.bandVariable)) out.push(`시계열 변수 '${settings.bandVariable}'이(가) 이 모델에 없습니다.`)
  for (const t of settings.targets) {
    if (!entry.kpiSpecs.some((k) => k.id === t.kpi)) out.push(`목표의 지표 '${t.kpi}'이(가) 이 모델에 없습니다.`)
    if (!Number.isFinite(t.value)) out.push('목표 값은 유한한 수여야 합니다.')
  }
  return out
}

/**
 * 결과를 만든 입력의 식별 키. 모델·버전, 대상의 유효 파라미터, 종료 시각·dt, 반복 수·시드, 입력 분포, 시계열 변수가 같으면 같은
 * 결과가 나온다(재현성). 목표는 결과를 다시 계산하지 않고 해석만 바꾸므로 키에 넣지 않는다.
 */
export function riskKey(entry: ModelEntry, baseParams: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt'>, settings: RiskSettings): string {
  const sorted = Object.fromEntries(Object.entries(baseParams).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  return JSON.stringify([entry.id, entry.def.meta.version, sorted, run.end, run.dt, settings.n, settings.seed, settings.inputs, settings.bandVariable])
}

/** 비교 결과의 식별 키: 대상 시나리오별 `riskKey`를 순서대로 묶는다. 하나라도 바뀌면 오래됨. */
export function compareKey(entry: ModelEntry, bases: Record<string, number>[], run: Pick<RunSettings, 'end' | 'dt'>, settings: RiskSettings): string {
  return JSON.stringify(bases.map((b) => riskKey(entry, b, run, settings)))
}

/** 시나리오 간 비교를 시작하기 전 검사. 모두 한국어 문장이고 비어 있으면 실행할 수 있다. */
export function compareProblems(entry: ModelEntry, settings: RiskSettings, params: Record<string, number>, scenarios: Scenario[]): string[] {
  const ids = settings.compareIds
  const out: string[] = []
  if (ids.length < MIN_COMPARE) out.push(`비교할 시나리오를 ${MIN_COMPARE}개 이상 고르세요.`)
  if (ids.length > MAX_COMPARE) out.push(`비교는 최대 ${MAX_COMPARE}개입니다.`)
  for (const id of ids) if (riskBaseParams(params, scenarios, id) === null) out.push('고른 시나리오를 찾을 수 없습니다. 다시 고르세요.')
  // 입력·반복 수·시드의 문제는 대상과 무관하므로 첫 대상으로 한 번만 검사한다.
  if (out.length === 0) out.push(...riskProblems(entry, { ...settings, scenarioId: ids[0] as string }, params, scenarios))
  return out
}

/** 저장하는 설정. 처음 값과 같으면(아무것도 설정하지 않았으면) null. 저장 여부 비교(`snapshotOf`)와 파일 모두 이 형태를 쓴다. */
export function riskToFile(settings: RiskSettings): RiskFile | null {
  if (JSON.stringify(settings) === JSON.stringify(defaultRiskSettings())) return null
  return {
    scenarioId: settings.scenarioId,
    n: settings.n,
    seed: settings.seed,
    inputs: settings.inputs.map((i) => ({ name: i.name, dist: structuredClone(i.dist) })),
    targets: settings.targets.map((t) => ({ ...t })),
    bandVariable: settings.bandVariable,
    compareIds: [...settings.compareIds]
  }
}

/**
 * 파일의 위험 분석 설정을 앱 설정으로 바꾼다. 모델에 없는 입력·잘못된 분포·없는 지표나 시나리오는 버리거나 처음 값으로
 * 돌리고 경고한다(2차의 시나리오 정리와 같은 방식). `scenarioIds`는 열린 프로젝트의 시나리오 id.
 */
export function sanitizeRisk(entry: ModelEntry, file: RiskFile | null, scenarioIds: string[]): { settings: RiskSettings; warnings: string[] } {
  const settings = defaultRiskSettings()
  const warnings: string[] = []
  if (!file) return { settings, warnings }
  const exists = (id: string) => id === BASE_ID || scenarioIds.includes(id)
  const specs = paramSpecs(entry)

  if (exists(file.scenarioId)) settings.scenarioId = file.scenarioId
  else warnings.push(`위험 분석의 대상 시나리오 '${file.scenarioId}'를 찾을 수 없어 기준으로 돌렸습니다.`)

  if (Number.isInteger(file.n) && file.n >= MIN_RISK_ITERATIONS && file.n <= MAX_ITERATIONS) settings.n = file.n
  else warnings.push(`위험 분석의 반복 수 ${file.n}을(를) 쓸 수 없어 ${settings.n}회로 돌렸습니다.`)
  if (Number.isInteger(file.seed) && file.seed >= 0 && file.seed <= MAX_RISK_SEED) settings.seed = file.seed
  else warnings.push(`위험 분석의 시드 ${file.seed}을(를) 쓸 수 없어 ${settings.seed}(으)로 돌렸습니다.`)

  const seen = new Set<string>()
  for (const i of file.inputs) {
    const sp = specs.find((s) => s.name === i.name)
    const label = entry.def.constants[i.name]?.label ?? i.name
    if (!sp) warnings.push(`위험 분석의 입력 '${i.name}'은(는) 이 모델의 입력 항목이 아니어서 버렸습니다.`)
    else if (seen.has(i.name)) warnings.push(`위험 분석의 입력 '${label}'이(가) 겹쳐 뒤의 것을 버렸습니다.`)
    else {
      const err = validateInput({ name: i.name, dist: i.dist, min: sp.min, max: sp.max, ...(sp.integer ? { integer: true } : {}) })
      if (err) warnings.push(`위험 분석의 입력 '${label}'을(를) 버렸습니다: ${err}`)
      else if (settings.inputs.length >= MAX_RISK_INPUTS) warnings.push(`위험 분석의 입력은 최대 ${MAX_RISK_INPUTS}개라 '${label}'을(를) 버렸습니다.`)
      else {
        seen.add(i.name)
        settings.inputs.push({ name: i.name, dist: structuredClone(i.dist) })
      }
    }
  }

  for (const t of file.targets) {
    if (entry.kpiSpecs.some((k) => k.id === t.kpi)) settings.targets.push({ ...t })
    else warnings.push(`위험 분석의 목표 지표 '${t.kpi}'이(가) 이 모델에 없어 버렸습니다.`)
  }

  if (file.bandVariable === null || entry.variables.some((v) => v.name === file.bandVariable)) settings.bandVariable = file.bandVariable
  else warnings.push(`위험 분석의 시간 변화 변수 '${file.bandVariable}'이(가) 이 모델에 없어 지웠습니다.`)

  const keep = file.compareIds.filter((id, idx) => exists(id) && file.compareIds.indexOf(id) === idx)
  if (keep.length < file.compareIds.length) warnings.push('위험 분석의 비교 대상 중 찾을 수 없는 시나리오를 뺐습니다.')
  settings.compareIds = keep.slice(0, MAX_COMPARE)
  return { settings, warnings }
}
