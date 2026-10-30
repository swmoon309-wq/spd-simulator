import { DEFAULT_EVM_SETTINGS, type Scenario } from '@spd/analysis'
import type { ModelEntry, ParamSpec } from '../catalog'
import { defaultRunSettings, type RunSettings } from './runSettings'

export function paramSpecs(entry: ModelEntry): ParamSpec[] {
  return entry.groups.flatMap((g) => g.params)
}

export function defaultParams(entry: ModelEntry): Record<string, number> {
  const out: Record<string, number> = {}
  for (const spec of paramSpecs(entry)) out[spec.name] = (entry.def.constants[spec.name] as { value: number }).value
  return out
}

/** 입력 문자열을 검증해 숫자 또는 오류 메시지를 돌려준다. */
export function parseParam(text: string, spec: ParamSpec): { value: number } | { error: string } {
  const t = text.trim()
  if (t === '') return { error: '값을 입력하세요' }
  const value = Number(t)
  if (!Number.isFinite(value)) return { error: '숫자를 입력하세요' }
  if (spec.integer && !Number.isInteger(value)) return { error: '정수만 입력할 수 있습니다' }
  if (value < spec.min || value > spec.max) return { error: `${spec.min} ~ ${spec.max} 범위여야 합니다` }
  return { value }
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Number(value.toPrecision(6)))
}

/** 기본값과 다른 파라미터·실행 설정을 나열한 실행 이름. 모두 같으면 "기준". */
export function describeRun(entry: ModelEntry, params: Record<string, number>, run?: RunSettings): string {
  const defaults = defaultParams(entry)
  const parts: string[] = []
  for (const spec of paramSpecs(entry)) {
    const value = params[spec.name]
    if (value === undefined || value === defaults[spec.name]) continue
    const c = entry.def.constants[spec.name]
    // 비율·배수는 숫자만으로 충분하고, 복합 단위(태스크/일 등)는 이름이 길어지므로 붙이지 않는다.
    const unit = c?.unit && !c.unit.includes('/') && c.unit !== '배' && c.unit !== '비율' ? c.unit : ''
    parts.push(`${c?.label ?? spec.name} ${formatNumber(value)}${unit}`)
  }
  if (run) {
    const d = defaultRunSettings(entry)
    if (run.end !== d.end) parts.push(`종료 ${formatNumber(run.end)}일`)
    if (run.dt !== d.dt) parts.push(`dt ${formatNumber(run.dt)}일`)
    if (run.seed !== d.seed) parts.push(`시드 ${run.seed}`)
  }
  return parts.length === 0 ? '기준' : parts.join(' · ')
}

/**
 * 입력값이 같은지 판단하는 데 쓰는 직렬화(저장 여부 비교). 키 순서와 무관하게 항상 같은 문자열이다.
 * 시나리오(이름, 메모, overrides)와 채택 계획도 포함한다.
 */
export function snapshotOf(
  entry: ModelEntry,
  params: Record<string, number>,
  run: RunSettings,
  scenarios: Scenario[] = [],
  adopted: { scenarioId: string; adoptedAt: string; revision: number } | null = null,
  actuals: unknown[] = [],
  evm: unknown = DEFAULT_EVM_SETTINGS,
  revisions: { number: number; revisedAt: string }[] = [],
  /** 저장하는 위험 분석 설정(`riskToFile`의 결과). 결과는 저장하지 않으므로 넣지 않는다. */
  risk: unknown = null,
  /** 저장하는 모델 검증 설정(`validationToFile`의 결과) */
  validation: unknown = null,
  /** 프로젝트 설명 */
  description = '',
  /** 저장하는 보고서 설정(`reportsToFile`의 결과) */
  reports: unknown = null
): string {
  return JSON.stringify([
    paramSpecs(entry).map((s) => params[s.name]),
    [run.end, run.dt, run.seed],
    scenarios.map((sc) => [sc.id, sc.name, sc.note ?? '', Object.entries(sc.overrides).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]),
    // 채택 계획은 시점과 대상으로 식별한다(스냅샷 내용은 채택 시점에 고정되어 바뀌지 않는다).
    adopted ? [adopted.scenarioId, adopted.adoptedAt, adopted.revision] : null,
    actuals,
    evm,
    // 개정은 번호와 시각으로 식별한다(새 기준선 내용은 개정 시점에 고정되어 바뀌지 않는다).
    revisions.map((r) => [r.number, r.revisedAt]),
    risk,
    validation,
    description,
    reports
  ])
}
