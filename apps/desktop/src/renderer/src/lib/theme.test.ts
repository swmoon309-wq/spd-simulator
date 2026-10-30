import { describe, expect, it } from 'vitest'
import { applyTheme, cacheTheme, loadCachedTheme, resolveDark } from './theme'

describe('resolveDark', () => {
  it('system은 운영체제를 따르고 밝게·어둡게는 고정이다', () => {
    expect(resolveDark('system', true)).toBe(true)
    expect(resolveDark('system', false)).toBe(false)
    expect(resolveDark('dark', false)).toBe(true)
    expect(resolveDark('light', true)).toBe(false)
  })
})

describe('applyTheme', () => {
  it('밝게·어둡게는 data-theme로 고정하고 system은 표시를 지운다', () => {
    const root = { dataset: {} as Record<string, string | undefined> }
    applyTheme('dark', root)
    expect(root.dataset['theme']).toBe('dark')
    applyTheme('light', root)
    expect(root.dataset['theme']).toBe('light')
    applyTheme('system', root)
    expect('theme' in root.dataset).toBe(false)
  })
})

describe('테마 캐시', () => {
  const memory = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
  }

  it('저장한 테마를 돌려주고, 없거나 올바르지 않으면 null', () => {
    const s = memory()
    expect(loadCachedTheme(s)).toBeNull()
    cacheTheme('dark', s)
    expect(loadCachedTheme(s)).toBe('dark')
    s.setItem('spd.theme', 'neon')
    expect(loadCachedTheme(s)).toBeNull()
  })

  it('저장소를 쓸 수 없어도 던지지 않는다', () => {
    const broken = {
      getItem: () => {
        throw new Error('차단됨')
      },
      setItem: () => {
        throw new Error('차단됨')
      }
    }
    expect(loadCachedTheme(broken)).toBeNull()
    expect(() => cacheTheme('dark', broken)).not.toThrow()
    expect(loadCachedTheme(undefined)).toBeNull()
  })
})
