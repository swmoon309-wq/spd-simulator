import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, COALESCE_MS, MAX_EDIT_HISTORY, newHistory, redo, redoLabel, undo, undoLabel } from './history'

describe('편집기 이력', () => {
  it('편집을 기록하고 되돌리고 다시 한다', () => {
    let h = newHistory({ n: 0 })
    expect(canUndo(h)).toBe(false)
    h = commit(h, { n: 1 }, '더하기', 0)
    h = commit(h, { n: 2 }, '고치기', 10)
    expect(h.present).toEqual({ n: 2 })
    expect(undoLabel(h)).toBe('고치기')
    h = undo(h)
    expect(h.present).toEqual({ n: 1 })
    expect(redoLabel(h)).toBe('고치기')
    expect(canRedo(h)).toBe(true)
    h = undo(h)
    expect(h.present).toEqual({ n: 0 })
    expect(canUndo(h)).toBe(false)
    h = redo(redo(h))
    expect(h.present).toEqual({ n: 2 })
    expect(canRedo(h)).toBe(false)
  })

  it('새 편집을 하면 다시 하기 목록이 비워진다', () => {
    let h = commit(commit(newHistory(0), 1, 'a', 0), 2, 'b', 1)
    h = undo(h)
    h = commit(h, 9, 'c', 2)
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe(9)
  })

  it('같은 문서(같은 참조)는 기록하지 않는다', () => {
    const doc = { n: 1 }
    const h = commit(newHistory(doc), doc, 'x', 0)
    expect(h.past).toHaveLength(0)
  })

  it('같은 키의 편집이 1초 안에 이어지면 한 단계로 합친다(처음 상태로 한 번에 되돌린다)', () => {
    let h = newHistory('')
    for (const [i, ch] of ['a', 'ab', 'abc'].entries()) h = commit(h, ch, '수식 입력', i * 100, 'expr:r')
    expect(h.past).toHaveLength(1)
    expect(undo(h).present).toBe('')
    // 1초가 지나면 새 단계
    h = commit(h, 'abcd', '수식 입력', 100 + COALESCE_MS + 200, 'expr:r')
    expect(h.past).toHaveLength(2)
    // 다른 키면 합치지 않는다
    h = commit(h, 'abcde', '수식 입력', 100 + COALESCE_MS + 250, 'expr:other')
    expect(h.past).toHaveLength(3)
    // 키가 없으면 합치지 않는다
    h = commit(h, 'x', '삭제', 100 + COALESCE_MS + 260)
    expect(h.past).toHaveLength(4)
  })

  it('최대 200단계까지만 둔다', () => {
    let h = newHistory(0)
    for (let i = 1; i <= MAX_EDIT_HISTORY + 20; i++) h = commit(h, i, 'e', i)
    expect(h.past).toHaveLength(MAX_EDIT_HISTORY)
    for (let i = 0; i < MAX_EDIT_HISTORY; i++) h = undo(h)
    expect(h.present).toBe(20) // 가장 오래된 20단계는 잊었다(0~19로는 돌아갈 수 없다)
    expect(canUndo(h)).toBe(false)
  })

  it('되돌릴 것이 없으면 그대로다', () => {
    const h = newHistory(1)
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })
})
