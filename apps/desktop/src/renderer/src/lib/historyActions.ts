import { redoEdit, undoEdit } from '../stores/history'
import { useAppStore } from '../stores/appStore'

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'number', 'email', 'url', 'tel', 'password'])

/** 글자를 입력하는 칸에 초점이 있는지(그때의 실행 취소는 칸 안의 글자 편집이다). */
export function isTextEditing(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

/**
 * 실행 취소/다시 실행 명령(메뉴·단축키·버튼). 글자 입력 칸에 초점이 있고 칸 안에 되돌릴 글자 편집이 있으면 그것을 되돌린다.
 * 그 밖에는 프로젝트 입력의 편집을 되돌리고 무엇을 했는지 짧게 알린다.
 */
export function performHistory(kind: 'undo' | 'redo'): void {
  if (typeof document !== 'undefined' && isTextEditing(document.activeElement) && document.execCommand(kind)) return
  const r = kind === 'undo' ? undoEdit() : redoEdit()
  const { setNotice } = useAppStore.getState()
  setNotice({ kind: 'info', text: r.ok ? `${kind === 'undo' ? '되돌렸습니다' : '다시 실행했습니다'}: ${r.label}` : r.message })
}
