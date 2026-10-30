import { useEffect, useState } from 'react'

/**
 * 글 입력: 입력 중에는 그대로 두고 **Enter나 포커스를 잃을 때** 바깥에 알린다(Esc는 되돌린다). 이름 바꾸기처럼 한 번에 하나씩 적용해야 하는
 * 값에 쓴다. `onCommit`이 이유(문자열)를 돌려주면 거절된 것이라 입력을 원래 값으로 되돌리고 이유를 보인다.
 */
export function CommitInput({ id, label, value, onCommit, className, mono, placeholder, disabled }: { id?: string; label: string; value: string; onCommit(text: string): string | null | void; className?: string; mono?: boolean; placeholder?: string; disabled?: boolean }) {
  const [text, setText] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    setText(value)
    setProblem(null)
  }, [value])
  const commit = () => {
    if (text === value) return
    const r = onCommit(text)
    if (typeof r === 'string') {
      setProblem(r)
      setText(value)
    } else setProblem(null)
  }
  return (
    <span className="commit-input">
      <input
        id={id}
        type="text"
        className={`${className ?? ''}${mono ? ' mono' : ''}`}
        aria-label={label}
        aria-invalid={problem !== null}
        aria-describedby={problem ? `${id ?? label}-err` : undefined}
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') {
            setText(value)
            setProblem(null)
          }
        }}
      />
      {problem && (
        <span role="alert" id={`${id ?? label}-err`} className="field-error">
          {problem}
        </span>
      )}
    </span>
  )
}
