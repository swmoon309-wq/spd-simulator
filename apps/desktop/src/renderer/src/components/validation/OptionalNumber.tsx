import { useEffect, useState } from 'react'

/**
 * 비워 둘 수 있는 숫자 입력. 비우면 `null`(없음), 올바른 숫자면 `onValue(숫자)`. 올바르지 않은 글자는 입력창에만 두고 알리지 않는다.
 * 바깥에서 값이 바뀌면(예: 데이터셋을 바꿈) 입력창을 맞춘다.
 */
export function OptionalNumber({ id, label, value, onValue }: { id: string; label: string; value: number | null; onValue(v: number | null): void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => {
    const current = text.trim() === '' ? null : Number(text)
    if (current !== value) setText(value === null ? '' : String(value))
    // 값이 바깥에서 바뀐 경우에만 맞춘다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const bad = text.trim() !== '' && !Number.isFinite(Number(text))
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      className={`draft-number${bad ? ' invalid' : ''}`}
      aria-label={label}
      aria-invalid={bad}
      placeholder="없음"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        if (e.target.value.trim() === '') onValue(null)
        else if (Number.isFinite(Number(e.target.value))) onValue(Number(e.target.value))
      }}
    />
  )
}
