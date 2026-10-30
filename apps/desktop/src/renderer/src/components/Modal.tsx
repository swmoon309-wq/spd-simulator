import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * 대화상자. 바깥을 누르거나 Esc를 누르면 닫히고, 열리면 안쪽으로 초점이 옮겨졌다가 닫힐 때 원래 자리로 돌아온다.
 * Tab 키는 대화상자 안에서만 돈다.
 */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const titleId = useId()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => [...(box.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])].filter((el) => !el.hasAttribute('disabled'))
    focusables()[0]?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        const els = focusables()
        if (els.length === 0) return
        const first = els[0] as HTMLElement
        const last = els[els.length - 1] as HTMLElement
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
    // 열릴 때 한 번만 설정한다(onClose는 닫기 동작이라 바뀌어도 같은 일을 한다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="link" onClick={onClose} aria-label="닫기">
            닫기
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
