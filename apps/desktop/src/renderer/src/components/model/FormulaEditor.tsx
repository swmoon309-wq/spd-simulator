import { useMemo, useRef, useState } from 'react'
import type { ModelIssue } from '../../lib/modelEdit/analysis'
import { applyCompletion, completionsAt, highlight, type Completion } from '../../lib/modelEdit/formula'
import type { VarKind } from '../../lib/modelEdit/commands'

export interface FormulaEditorProps {
  id: string
  label: string
  value: string
  onChange(text: string): void
  /** 이 수식에 걸린 문제(글자 범위가 있는 것) */
  issues: ModelIssue[]
  kindOf(name: string): VarKind | null
  variables: { name: string; kind: VarKind; unit?: string }[]
  /** 시각 0의 값 미리보기: 이 수식이 참조하는 변수 이름 → 값 */
  preview?: { own: number | null; refs: [string, number][] } | null
}

/**
 * 수식 편집기(설계 08의 6.2): 글 입력 위에 겹쳐 그린 구문 강조 층(변수 종류별 색, 함수, 숫자, 연산자), 위치가 있는 오류 밑줄과 메시지, 자동완성
 * (방향키·Enter/Tab·Esc, `aria-activedescendant`), 시각 0 값 미리보기. 별도 코드 편집 라이브러리는 쓰지 않는다(번들 크기·접근성).
 */
export function FormulaEditor({ id, label, value, onChange, issues, kindOf, variables, preview }: FormulaEditorProps) {
  const ta = useRef<HTMLTextAreaElement>(null)
  const hl = useRef<HTMLPreElement>(null)
  const [caret, setCaret] = useState(0)
  const [open, setOpen] = useState(true)
  const [active, setActive] = useState(0)
  const ranged = useMemo(() => issues.filter((i) => i.range && i.severity !== 'info') as { severity: 'error' | 'warning'; range?: [number, number] }[], [issues])
  const segments = useMemo(() => highlight(value, kindOf, ranged), [value, kindOf, ranged])
  const comp = useMemo(() => (open ? completionsAt(value, caret, variables) : null), [open, value, caret, variables])
  const listId = `${id}-list`

  const sync = () => {
    if (hl.current && ta.current) {
      hl.current.scrollTop = ta.current.scrollTop
      hl.current.scrollLeft = ta.current.scrollLeft
    }
  }
  const accept = (item: Completion) => {
    if (!comp) return
    const r = applyCompletion(value, comp, item)
    onChange(r.source)
    setActive(0)
    requestAnimationFrame(() => {
      ta.current?.focus()
      ta.current?.setSelectionRange(r.caret, r.caret)
      setCaret(r.caret)
    })
  }
  const goTo = (range: [number, number]) => {
    ta.current?.focus()
    ta.current?.setSelectionRange(range[0], range[1])
    setCaret(range[0])
  }

  return (
    <div className="formula">
      <div className="formula-box">
        <pre ref={hl} className="formula-hl" aria-hidden="true">
          {segments.map((s, i) => (
            <span key={i} className={`hl-${s.cls}${s.issue ? ` hl-${s.issue}` : ''}`}>
              {s.text}
            </span>
          ))}
          {'\n'}
        </pre>
        <textarea
          ref={ta}
          id={id}
          className="formula-input"
          aria-label={label}
          aria-invalid={issues.some((i) => i.severity === 'error')}
          aria-autocomplete="list"
          aria-controls={comp ? listId : undefined}
          aria-activedescendant={comp ? `${id}-opt-${active}` : undefined}
          spellCheck={false}
          rows={Math.min(8, Math.max(2, value.split('\n').length + 1))}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setCaret(e.target.selectionStart)
            setOpen(true)
            setActive(0)
          }}
          onScroll={sync}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!comp) return
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => (a + 1) % comp.items.length)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => (a - 1 + comp.items.length) % comp.items.length)
            } else if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              accept(comp.items[active] ?? comp.items[0]!)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setOpen(false)
            }
          }}
        />
      </div>
      {comp && (
        <ul id={listId} role="listbox" aria-label="자동완성 후보" className="formula-list">
          {comp.items.map((c, i) => (
            <li key={c.label} id={`${id}-opt-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), accept(c))}>
              <span className={`hl-${c.kind === 'function' ? 'fn' : `var-${c.kind}`}`}>{c.label}</span>
              <span className="muted"> {c.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <ul className="formula-issues" aria-label="이 수식의 문제">
          {issues.map((i, n) => (
            <li key={n} className={i.severity}>
              <span aria-hidden="true">{i.severity === 'error' ? '✖' : i.severity === 'warning' ? '⚠' : 'ⓘ'}</span> {i.message}
              {i.range && (
                <button type="button" className="link" onClick={() => goTo(i.range as [number, number])} aria-label={`위치 ${i.range[0] + 1}로 이동`}>
                  위치 {i.range[0] + 1}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <p className="muted formula-preview" aria-label="시각 0의 값">
          시각 0: {preview.own !== null ? <strong>{fmt(preview.own)}</strong> : '계산할 수 없음'}
          {preview.refs.length > 0 && <> · 참조: {preview.refs.map(([n, v]) => `${n} = ${fmt(v)}`).join(', ')}</>}
        </p>
      )}
    </div>
  )
}

const fmt = (v: number): string => (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v))
