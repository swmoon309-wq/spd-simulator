export type Params = Record<string, number>

/** 시나리오 개수 상한. 색(8색 팔레트)과 화면 밀도 때문에 정한 값이다. */
export const MAX_SCENARIOS = 12
export const MAX_SCENARIO_NAME = 60
export const MAX_SCENARIO_NOTE = 500

export interface Scenario {
  /** 프로젝트 안에서 유일하고 바뀌지 않는다(색 고정, 참조용) */
  id: string
  name: string
  note?: string
  /** 기본 설정과 달라지는 파라미터만 */
  overrides: Params
}

export interface ParamBound {
  name: string
  min: number
  max: number
  integer?: boolean
}

/** 유효 파라미터 = 기본 설정 + overrides. 기본 설정에 없는 이름은 무시한다. */
export function effectiveParams(base: Params, scenario: Pick<Scenario, 'overrides'>): Params {
  const out = { ...base }
  for (const [name, value] of Object.entries(scenario.overrides)) {
    if (name in base) out[name] = value
  }
  return out
}

export interface ParamDiff {
  name: string
  base: number
  value: number
}

/** 기본 설정과 값이 다른 항목. 기본 설정의 키 순서를 따른다. */
export function diffFromBase(base: Params, scenario: Pick<Scenario, 'overrides'>): ParamDiff[] {
  const diffs: ParamDiff[] = []
  for (const name of Object.keys(base)) {
    const value = scenario.overrides[name]
    if (value !== undefined && value !== base[name]) diffs.push({ name, base: base[name] as number, value })
  }
  return diffs
}

export interface SanitizeResult {
  overrides: Params
  warnings: string[]
}

/**
 * 저장할 overrides를 정리한다. 기본값과 같아진 항목은 조용히 빼고, 모르는 이름·허용 범위 밖·정수가
 * 아닌 값은 버리면서 경고한다. 결과는 기본 설정의 키 순서이다.
 */
export function sanitizeOverrides(base: Params, overrides: Params, bounds: ParamBound[]): SanitizeResult {
  const warnings: string[] = []
  const known = new Map(bounds.map((b) => [b.name, b]))
  const unknown = Object.keys(overrides).filter((name) => !known.has(name) || !(name in base))
  if (unknown.length > 0) warnings.push(`알 수 없는 항목 ${unknown.length}개를 버렸습니다: ${unknown.join(', ')}`)

  const out: Params = {}
  for (const name of Object.keys(base)) {
    const value = overrides[name]
    const bound = known.get(name)
    if (value === undefined || !bound) continue
    if (!Number.isFinite(value)) {
      warnings.push(`'${name}' 값이 유한한 수가 아니어서 버렸습니다.`)
    } else if (bound.integer && !Number.isInteger(value)) {
      warnings.push(`'${name}' 값 ${value}은(는) 정수가 아니어서 버렸습니다.`)
    } else if (value < bound.min || value > bound.max) {
      warnings.push(`'${name}' 값 ${value}이(가) 허용 범위(${bound.min} ~ ${bound.max})를 벗어나 버렸습니다.`)
    } else if (value !== base[name]) {
      out[name] = value
    }
  }
  return { overrides: out, warnings }
}

export function canAddScenario(count: number): boolean {
  return count < MAX_SCENARIOS
}

/** 이름 검사. 문제가 없으면 null. `selfId`는 이름을 바꾸는 시나리오 자신(중복 검사에서 제외). */
export function validateScenarioName(
  name: string,
  others: Pick<Scenario, 'id' | 'name'>[],
  selfId?: string
): string | null {
  const t = name.trim()
  if (t === '') return '이름을 입력하세요'
  if (t.length > MAX_SCENARIO_NAME) return `이름은 ${MAX_SCENARIO_NAME}자 이하여야 합니다`
  if (others.some((o) => o.id !== selfId && o.name === t)) return '같은 이름의 시나리오가 있습니다'
  return null
}

/**
 * 새 시나리오 id. 기존 `sN` 중 가장 큰 N보다 하나 큰 값이다(없으면 s1).
 * 이름과 달리 id는 바뀌지 않으며 색과 참조에 쓰이므로, 지운 번호를 가장 큰 번호가 아닌 한 다시 쓰지 않는다.
 */
export function nextScenarioId(existing: Pick<Scenario, 'id'>[]): string {
  let max = 0
  for (const s of existing) {
    const m = /^s(\d+)$/.exec(s.id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `s${max + 1}`
}

/** "시나리오 N" 중 쓰이지 않은 가장 작은 번호. */
export function nextScenarioName(existing: Pick<Scenario, 'name'>[]): string {
  const used = new Set(existing.map((s) => s.name))
  for (let n = 1; ; n++) {
    const name = `시나리오 ${n}`
    if (!used.has(name)) return name
  }
}

/** "원본 (복사)", 이미 있으면 "원본 (복사 2)"… 이름 길이 상한을 넘으면 원본 이름을 줄인다. */
export function copyScenarioName(original: string, existing: Pick<Scenario, 'name'>[]): string {
  const used = new Set(existing.map((s) => s.name))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (복사)' : ` (복사 ${n})`
    const room = MAX_SCENARIO_NAME - suffix.length
    const name = (original.length > room ? original.slice(0, room) : original) + suffix
    if (!used.has(name)) return name
  }
}
