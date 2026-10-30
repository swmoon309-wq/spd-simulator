import { THEMES, type Theme } from '../../../shared/settings'

/** 화면이 어둡게 보여야 하는지. `system`이면 운영체제 설정을 따른다. */
export function resolveDark(theme: Theme, systemDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemDark)
}

/**
 * 테마를 문서에 적용한다. `system`은 표시를 지워 CSS의 운영체제 설정(prefers-color-scheme)을 따르게 하고,
 * 밝게·어둡게는 `data-theme`로 고정한다.
 */
export function applyTheme(theme: Theme, root: { dataset: Record<string, string | undefined> } = document.documentElement): void {
  if (theme === 'system') delete root.dataset['theme']
  else root.dataset['theme'] = theme
}

const CACHE_KEY = 'spd.theme'

/** 마지막으로 쓴 테마. 앱이 설정을 읽어 오기 전에 화면이 깜빡이지 않게 미리 적용하는 데 쓴다. */
export function loadCachedTheme(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Theme | null {
  try {
    const v = storage?.getItem(CACHE_KEY)
    return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : null
  } catch {
    return null
  }
}

export function cacheTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(CACHE_KEY, theme)
  } catch {
    // 저장소를 쓸 수 없어도(비공개 창 등) 설정 자체에는 영향이 없다.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}
