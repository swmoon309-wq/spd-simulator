import type { ModelEntry, ParamSpec } from '../catalog'

export interface RunSettings {
  end: number
  dt: number
  seed: number
}

export interface RunSettingField {
  key: keyof RunSettings
  label: string
  unit: string
  spec: ParamSpec
}

/** 한 번 실행의 최대 스텝 수. 넘으면 화면과 메모리를 위해 거부한다. */
export const MAX_STEPS = 100_000

export const RUN_SETTING_FIELDS: RunSettingField[] = [
  { key: 'end', label: '종료 시각', unit: '일', spec: { name: 'end', min: 1, max: 5000, step: 10 } },
  { key: 'dt', label: '적분 간격(dt)', unit: '일', spec: { name: 'dt', min: 0.01, max: 5, step: 0.05 } },
  { key: 'seed', label: '난수 시드', unit: '', spec: { name: 'seed', min: 0, max: 2147483647, step: 1, integer: true } }
]

export function defaultRunSettings(entry: ModelEntry): RunSettings {
  return { end: entry.def.time.end, dt: entry.def.time.dt, seed: 1 }
}

/** 항목 하나가 아니라 조합이 문제인 경우(스텝 수 초과 등)의 오류 메시지. */
export function checkRunSettings(s: RunSettings): string | null {
  const steps = Math.round(s.end / s.dt)
  if (steps > MAX_STEPS) {
    return `스텝 수가 너무 많습니다(${steps.toLocaleString('ko-KR')}). 종료 시각을 줄이거나 dt를 키우세요. 최대 ${MAX_STEPS.toLocaleString('ko-KR')}스텝입니다.`
  }
  return null
}

/** 스텝 실행 한 번이 나아가는 길이(일). 화면의 "스텝" 버튼은 이만큼 진행한다. */
export const STEP_DAYS = 1

/** `STEP_DAYS`에 해당하는 적분 스텝 수(dt가 1일보다 크면 한 스텝). */
export function stepsPerStepDays(dt: number): number {
  return Math.max(1, Math.round(STEP_DAYS / dt))
}
