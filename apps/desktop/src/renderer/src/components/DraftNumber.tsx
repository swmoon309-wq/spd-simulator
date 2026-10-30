import { useEffect, useState } from 'react'

/**
 * 숫자 입력. 입력 중에는 글자를 그대로 두고(지우고 다시 쓸 수 있다), 올바른 숫자가 되면 바로 `onValue`로 알린다.
 * 바깥에서 값이 바뀌면(예: 종류 변경) 입력창을 맞춘다.
 */
export function DraftNumber({ id, label, value, step, onValue }: { id: string; label: string; value: number; step?: number; onValue(v: number): void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => {
    if (text.trim() === '' || Number(text) !== value) setText(String(value))
    // 값이 바깥에서 바뀐 경우에만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const bad = text.trim() === '' || !Number.isFinite(Number(text))
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={`draft-number${bad ? ' invalid' : ''}`}
      aria-label={label}
      aria-invalid={bad}
      value={text}
      data-step={step}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onValue(n)
      }}
    />
  )
}
