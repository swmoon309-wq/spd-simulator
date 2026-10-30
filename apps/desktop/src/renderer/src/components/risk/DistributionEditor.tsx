import { DIST_KINDS, DIST_LABEL, validateInput, type DistSpec } from '@spd/analysis'
import type { ModelEntry, ParamSpec } from '../../catalog'
import { DraftNumber } from '../DraftNumber'
import { changeDistKind, distFields, distText, distValue, withDistValue, type DistKind } from '../../lib/riskView'

/** 불확실한 입력 하나: 분포 종류와 값. 값이 올바르지 않으면 바로 아래에 이유를 보인다. */
export function DistributionEditor({
  entry,
  spec,
  dist,
  disabled,
  onChange,
  onRemove
}: {
  entry: ModelEntry
  spec: ParamSpec
  dist: DistSpec
  disabled: boolean
  onChange(dist: DistSpec): void
  onRemove(): void
}) {
  const c = entry.def.constants[spec.name]
  const label = c?.label ?? spec.name
  const error = validateInput({ name: spec.name, dist, min: spec.min, max: spec.max, ...(spec.integer ? { integer: true } : {}) })
  const id = `risk-in-${spec.name}`
  return (
    <li className="risk-input" aria-label={`${label}: ${distText(dist)}`}>
      <div className="risk-input-head">
        <strong>{label}</strong>
        {c?.unit && <span className="muted">({c.unit})</span>}
        <button type="button" className="link" disabled={disabled} onClick={onRemove} aria-label={`${label} 입력 빼기`}>
          빼기
        </button>
      </div>
      <div className="row wrap">
        <label className="sr-only" htmlFor={`${id}-kind`}>
          {label} 분포 종류
        </label>
        <select id={`${id}-kind`} value={dist.kind} disabled={disabled} onChange={(e) => onChange(changeDistKind(dist, e.target.value as DistKind, { min: spec.min, max: spec.max }, spec.integer === true))}>
          {DIST_KINDS.map((k) => (
            <option key={k} value={k}>
              {DIST_LABEL[k]}
            </option>
          ))}
        </select>
        {distFields(dist.kind).map((f) => (
          <label key={f.key} className="risk-field">
            <span>{f.label}</span>
            <DraftNumber id={`${id}-${f.key}`} label={`${label} ${f.label}`} value={distValue(dist, f.key)} onValue={(v) => onChange(withDistValue(dist, f.key, v))} />
          </label>
        ))}
      </div>
      <div className="muted">
        허용 범위 {spec.min} ~ {spec.max}
        {spec.integer ? ' (정수)' : ''}
      </div>
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
    </li>
  )
}
