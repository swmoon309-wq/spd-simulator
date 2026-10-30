/**
 * 편집기 자체 이력(설계 08의 9장): 명령 단위 스냅샷, 최대 200단계. 프로젝트 입력의 실행 취소(COM-02)와는 별개다. 순수 함수로 두어
 * 시험할 수 있다. 같은 `key`의 편집이 `COALESCE_MS` 안에 이어지면(글자를 치는 중) 한 단계로 합친다.
 */
export const MAX_EDIT_HISTORY = 200
export const COALESCE_MS = 1000

export interface HistoryEntry<T> {
  label: string
  doc: T
}

export interface EditHistory<T> {
  present: T
  past: HistoryEntry<T>[]
  future: HistoryEntry<T>[]
  /** 마지막 편집의 합치기 키와 시각 */
  last: { key: string; at: number } | null
  /** 되돌리거나 다시 하면 이 이름의 편집을 되돌린다/다시 한다 */
  label: string | null
}

export const newHistory = <T>(doc: T): EditHistory<T> => ({ present: doc, past: [], future: [], last: null, label: null })

/** 편집 하나를 기록한다. 같은 문서면 아무것도 하지 않는다(참조가 같을 때). */
export function commit<T>(h: EditHistory<T>, next: T, label: string, at: number, key?: string): EditHistory<T> {
  if (next === h.present) return h
  const coalesce = key !== undefined && h.last !== null && h.last.key === key && at - h.last.at < COALESCE_MS && h.past.length > 0
  const past = coalesce ? h.past : [...h.past, { label, doc: h.present }].slice(-MAX_EDIT_HISTORY)
  return { present: next, past, future: [], last: key !== undefined ? { key, at } : null, label: coalesce ? (h.label ?? label) : label }
}

export function canUndo<T>(h: EditHistory<T>): boolean {
  return h.past.length > 0
}
export function canRedo<T>(h: EditHistory<T>): boolean {
  return h.future.length > 0
}

export function undo<T>(h: EditHistory<T>): EditHistory<T> {
  const prev = h.past[h.past.length - 1]
  if (!prev) return h
  return { present: prev.doc, past: h.past.slice(0, -1), future: [{ label: prev.label, doc: h.present }, ...h.future], last: null, label: h.past[h.past.length - 2]?.label ?? null }
}

export function redo<T>(h: EditHistory<T>): EditHistory<T> {
  const next = h.future[0]
  if (!next) return h
  return { present: next.doc, past: [...h.past, { label: next.label, doc: h.present }], future: h.future.slice(1), last: null, label: next.label }
}

/** 되돌리기 버튼에 쓸 이름(없으면 null). */
export const undoLabel = <T>(h: EditHistory<T>): string | null => h.past[h.past.length - 1]?.label ?? null
export const redoLabel = <T>(h: EditHistory<T>): string | null => h.future[0]?.label ?? null
