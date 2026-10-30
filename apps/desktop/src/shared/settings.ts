/** 사용자 설정(COM-03). 프로젝트 파일이 아니라 사용자별로 앱 데이터 폴더에 둔다. */
export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export interface Settings {
  /** `system`은 운영체제의 밝기 설정을 따른다 */
  theme: Theme
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system' }

export const THEME_LABELS: Record<Theme, string> = {
  system: '시스템 설정 따르기',
  light: '밝게',
  dark: '어둡게'
}

/**
 * 읽은 값을 설정으로 만든다. 모르는 키는 버리고, 없거나 올바르지 않은 값은 기본값을 쓴다
 * (오래된·손상된 파일이나 다른 버전의 설정으로 앱이 멈추지 않게 한다).
 */
export function sanitizeSettings(raw: unknown): Settings {
  const obj = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  return { theme: THEMES.includes(obj['theme'] as Theme) ? (obj['theme'] as Theme) : DEFAULT_SETTINGS.theme }
}

/** 저장된 설정에 일부 값을 덮어쓴다. 올바르지 않은 값은 무시한다(기존 값을 유지). */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const obj = typeof patch === 'object' && patch !== null && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {}
  const theme = THEMES.includes(obj['theme'] as Theme) ? (obj['theme'] as Theme) : current.theme
  return { theme }
}
