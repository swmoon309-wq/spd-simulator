import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, THEMES } from './settings'

describe('sanitizeSettings', () => {
  it('올바른 값은 그대로 쓴다', () => {
    for (const theme of THEMES) expect(sanitizeSettings({ theme })).toEqual({ theme })
  })

  it('없거나 올바르지 않으면 기본값을 쓰고 모르는 키는 버린다', () => {
    for (const bad of [undefined, null, 3, 'dark', [], {}, { theme: 'blue' }, { theme: 5 }, { other: 1 }]) expect(sanitizeSettings(bad)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ theme: 'dark', language: 'en', evil: '<script>' })).toEqual({ theme: 'dark' })
  })
})

describe('mergeSettings', () => {
  it('바꾸려는 값만 바꾼다', () => {
    expect(mergeSettings({ theme: 'light' }, { theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(mergeSettings({ theme: 'light' }, {})).toEqual({ theme: 'light' })
  })

  it('올바르지 않은 값은 무시하고 기존 값을 유지한다', () => {
    expect(mergeSettings({ theme: 'light' }, { theme: 'purple' })).toEqual({ theme: 'light' })
    expect(mergeSettings({ theme: 'light' }, null)).toEqual({ theme: 'light' })
    expect(mergeSettings({ theme: 'light' }, 'dark')).toEqual({ theme: 'light' })
  })
})
