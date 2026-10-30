import { useEffect, useState } from 'react'
import { getEntry, type ParamSpec } from '../catalog'
import { formatNumber, parseParam } from '../lib/params'
import { RUN_SETTING_FIELDS } from '../lib/runSettings'
import { useAppStore } from '../stores/appStore'
import { SizeConverter } from './SizeConverter'

export interface NumberFieldProps {
  id: string
  spec: ParamSpec
  label: string
  unit: string
  value: number
  /** 오류 상태를 저장하는 키 */
  errorKey: string
  onValue(value: number): void
  /**
   * 입력 오류를 전역 상태(실행 버튼 비활성화)에 알릴지. 기본 true.
   * 시나리오 편집처럼 실행과 무관한 입력은 false로 두고 오류를 필드 안에서만 보인다.
   */
  trackError?: boolean
  /** 기준이 되는 값. 현재 값과 다르면 "기준값"과 되돌리기 버튼을 보인다. */
  baseValue?: number
  onRevert?: () => void
}

export function NumberField({ id, spec, label, unit, value, errorKey, onValue, trackError = true, baseValue, onRevert }: NumberFieldProps) {
  const setParamError = useAppStore((s) => s.setParamError)
  const [text, setText] = useState(formatNumber(value))
  const [error, setError] = useState<string | null>(null)

  // 기본값 복원이나 프로젝트 열기처럼 바깥에서 값이 바뀌면 입력창도 맞춘다.
  // 입력 중이라 아직 값으로 확정되지 않은 글자는 건드리지 않는다.
  useEffect(() => {
    const parsed = parseParam(text, spec)
    if (!('value' in parsed) || parsed.value !== value) {
      setText(formatNumber(value))
      setError(null)
      if (trackError) setParamError(errorKey, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onChange = (next: string) => {
    setText(next)
    const parsed = parseParam(next, spec)
    if ('value' in parsed) {
      setError(null)
      if (trackError) setParamError(errorKey, null)
      onValue(parsed.value)
    } else {
      setError(parsed.error)
      if (trackError) setParamError(errorKey, parsed.error)
    }
  }

  const changed = baseValue !== undefined && value !== baseValue
  return (
    <div className={`field${changed ? ' changed' : ''}`}>
      <label htmlFor={id}>
        {label}
        {changed && <span className="changed-badge">변경됨</span>}
      </label>
      <div className="field-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="unit">{unit}</span>
      </div>
      {error && (
        <div id={`${id}-error`} className="field-error" role="alert">
          {error}
        </div>
      )}
      {changed && (
        <div className="field-base">
          기준값 {formatNumber(baseValue as number)}
          {unit}
          {onRevert && (
            <button type="button" className="link" onClick={onRevert} aria-label={`${label}을(를) 기준값으로 되돌리기`}>
              되돌리기
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function ParamForm() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const runSettings = useAppStore((s) => s.runSettings)
  const setParam = useAppStore((s) => s.setParam)
  const setRunSetting = useAppStore((s) => s.setRunSetting)
  const resetParams = useAppStore((s) => s.resetParams)
  const entry = getEntry(modelId)

  return (
    <div className="param-form">
      {entry.groups.map((g) => (
        <fieldset key={g.title}>
          <legend>{g.title}</legend>
          {g.params.map((spec) => {
            const c = entry.def.constants[spec.name]
            return (
              <div key={spec.name}>
                <NumberField
                  id={`param-${spec.name}`}
                  spec={spec}
                  label={c?.label ?? spec.name}
                  unit={c?.unit ?? ''}
                  value={params[spec.name] as number}
                  errorKey={spec.name}
                  onValue={(v) => setParam(spec.name, v)}
                />
                {entry.size?.param === spec.name && <SizeConverter entry={entry} />}
              </div>
            )
          })}
        </fieldset>
      ))}
      <fieldset>
        <legend>실행 설정</legend>
        {RUN_SETTING_FIELDS.map((f) => (
          <NumberField
            key={f.key}
            id={`run-${f.key}`}
            spec={f.spec}
            label={f.label}
            unit={f.unit}
            value={runSettings[f.key]}
            errorKey={`run:${f.key}`}
            onValue={(v) => setRunSetting(f.key, v)}
          />
        ))}
      </fieldset>
      <button type="button" className="link" onClick={resetParams}>
        기본값으로 되돌리기
      </button>
    </div>
  )
}
