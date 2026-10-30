import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings'
import { useSettingsStore } from './settingsStore'

/** 문서와 저장소의 가짜. 테마 적용(document)과 캐시(localStorage)를 본다. */
function fakeEnv() {
  const dataset: Record<string, string | undefined> = {}
  const storage = new Map<string, string>()
  vi.stubGlobal('document', { documentElement: { dataset } })
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) })
  return { dataset, storage }
}

function fakeSpd(initial: Settings) {
  let saved = initial
  const calls = { get: 0, set: [] as unknown[] }
  const spd = {
    settings: {
      get: async () => {
        calls.get++
        return saved
      },
      set: async (patch: Partial<Settings>) => {
        calls.set.push(patch)
        saved = { ...saved, ...patch }
        return saved
      }
    }
  }
  vi.stubGlobal('window', { spd })
  return calls
}

beforeEach(() => {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, ready: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('settingsStore', () => {
  it('시작하면 저장된 설정을 읽어 적용하고 캐시한다', async () => {
    const env = fakeEnv()
    const calls = fakeSpd({ theme: 'dark' })
    await useSettingsStore.getState().init()
    expect(calls.get).toBe(1)
    expect(useSettingsStore.getState()).toMatchObject({ settings: { theme: 'dark' }, ready: true })
    expect(env.dataset['theme']).toBe('dark')
    expect(env.storage.get('spd.theme')).toBe('dark')
  })

  it('system이면 표시를 지워 운영체제를 따르게 한다', async () => {
    const env = fakeEnv()
    env.dataset['theme'] = 'dark'
    fakeSpd({ theme: 'system' })
    await useSettingsStore.getState().init()
    expect('theme' in env.dataset).toBe(false)
  })

  it('바꾸면 바로 적용하고 저장한다', async () => {
    const env = fakeEnv()
    const calls = fakeSpd({ theme: 'system' })
    await useSettingsStore.getState().init()
    await useSettingsStore.getState().update({ theme: 'light' })
    expect(useSettingsStore.getState().settings.theme).toBe('light')
    expect(env.dataset['theme']).toBe('light')
    expect(calls.set).toEqual([{ theme: 'light' }])
  })

  it('올바르지 않은 값은 무시한다', async () => {
    const env = fakeEnv()
    fakeSpd({ theme: 'dark' })
    await useSettingsStore.getState().init()
    await useSettingsStore.getState().update({ theme: 'neon' as never })
    expect(useSettingsStore.getState().settings.theme).toBe('dark')
    expect(env.dataset['theme']).toBe('dark')
  })

  it('저장에 실패해도 화면에는 적용된다', async () => {
    const env = fakeEnv()
    vi.stubGlobal('window', {
      spd: {
        settings: {
          get: async () => ({ theme: 'system' }),
          set: async () => {
            throw new Error('디스크 오류')
          }
        }
      }
    })
    await useSettingsStore.getState().init()
    await expect(useSettingsStore.getState().update({ theme: 'dark' })).resolves.toBeUndefined()
    expect(useSettingsStore.getState().settings.theme).toBe('dark')
    expect(env.dataset['theme']).toBe('dark')
  })

  it('브라우저(개발용)에서는 저장 없이 적용하고 캐시만 한다', async () => {
    const env = fakeEnv()
    vi.stubGlobal('window', {})
    await useSettingsStore.getState().init()
    await useSettingsStore.getState().update({ theme: 'dark' })
    expect(env.dataset['theme']).toBe('dark')
    expect(env.storage.get('spd.theme')).toBe('dark')
  })

  it('설정을 읽지 못해도 앱은 시작한다', async () => {
    fakeEnv()
    vi.stubGlobal('window', {
      spd: {
        settings: {
          get: async () => {
            throw new Error('읽기 오류')
          }
        }
      }
    })
    await useSettingsStore.getState().init()
    expect(useSettingsStore.getState().ready).toBe(true)
  })
})
