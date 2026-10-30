import { describe, expect, it } from 'vitest'
import { APP_TABS } from './menuCommands'
import { acceleratorFor, formatAccelerator, SHORTCUT_LABELS } from './shortcuts'

describe('acceleratorFor', () => {
  it('화면 이동은 Cmd/Ctrl+1~8 이다', () => {
    expect(APP_TABS.map((t) => acceleratorFor(`tab:${t}`, true))).toEqual(['CmdOrCtrl+1', 'CmdOrCtrl+2', 'CmdOrCtrl+3', 'CmdOrCtrl+4', 'CmdOrCtrl+5', 'CmdOrCtrl+6', 'CmdOrCtrl+7', 'CmdOrCtrl+8'])
  })

  it('다시 실행은 플랫폼마다 다르다', () => {
    expect(acceleratorFor('redo', true)).toBe('Shift+CmdOrCtrl+Z')
    expect(acceleratorFor('redo', false)).toBe('CmdOrCtrl+Y')
  })

  it('정해지지 않은 명령은 없다', () => {
    expect(acceleratorFor('cancel', true)).toBeUndefined()
    expect(acceleratorFor('tab:없음', true)).toBeUndefined()
  })

  it('단축키 표의 명령이 서로 겹치지 않는다(같은 키를 두 명령에 쓰지 않는다)', () => {
    for (const isMac of [true, false]) {
      const keys = SHORTCUT_LABELS.map(([c]) => acceleratorFor(c, isMac)).filter(Boolean)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('표의 모든 명령에 단축키가 있다', () => {
    for (const [command] of SHORTCUT_LABELS) expect(acceleratorFor(command, true), command).toBeDefined()
  })
})

describe('formatAccelerator', () => {
  it('macOS는 기호, 그 밖에는 Ctrl+ 형식', () => {
    expect(formatAccelerator('Shift+CmdOrCtrl+S', true)).toBe('⇧⌘S')
    expect(formatAccelerator('Shift+CmdOrCtrl+S', false)).toBe('Ctrl+Shift+S')
    expect(formatAccelerator('CmdOrCtrl+Enter', true)).toBe('⌘↩')
    expect(formatAccelerator('CmdOrCtrl+Enter', false)).toBe('Ctrl+Enter')
    expect(formatAccelerator('F1', true)).toBe('F1')
    expect(formatAccelerator('CmdOrCtrl+,', false)).toBe('Ctrl+,')
  })
})
