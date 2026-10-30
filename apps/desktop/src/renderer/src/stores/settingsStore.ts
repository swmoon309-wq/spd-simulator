import { create } from 'zustand'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, type Settings } from '../../../shared/settings'
import { applyTheme, cacheTheme, loadCachedTheme } from '../lib/theme'

interface SettingsState {
  settings: Settings
  /** 저장된 설정을 읽어 왔다(그 전에는 기본값 또는 마지막으로 쓴 테마) */
  ready: boolean
  /** 앱을 시작할 때 한 번 부른다. 데스크톱 앱이면 저장된 설정을, 브라우저(개발용)이면 마지막으로 쓴 테마를 쓴다. */
  init(): Promise<void>
  /** 설정을 바꾸고 화면에 바로 적용한 뒤 저장한다. 올바르지 않은 값은 무시한다. */
  update(patch: Partial<Settings>): Promise<void>
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: { ...DEFAULT_SETTINGS, theme: loadCachedTheme() ?? DEFAULT_SETTINGS.theme },
  ready: false,

  async init() {
    const spd = window.spd
    let settings = get().settings
    if (spd) {
      try {
        settings = sanitizeSettings(await spd.settings.get())
      } catch {
        // 읽지 못하면 지금 값을 그대로 쓴다.
      }
    }
    applyTheme(settings.theme)
    cacheTheme(settings.theme)
    set({ settings, ready: true })
  },

  async update(patch) {
    const next = mergeSettings(get().settings, patch)
    applyTheme(next.theme)
    cacheTheme(next.theme)
    set({ settings: next })
    try {
      const saved = await window.spd?.settings.set(patch)
      // 저장된 값이 올바르지 않게 돌아와도(있을 수 없는 일이지만) 화면의 설정을 그대로 둔다.
      if (saved) set({ settings: mergeSettings(get().settings, saved) })
    } catch {
      // 저장하지 못해도 이번 실행에서는 바뀐 설정을 쓴다.
    }
  }
}))
