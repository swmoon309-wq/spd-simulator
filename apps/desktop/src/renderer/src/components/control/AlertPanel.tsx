import { useState } from 'react'
import { cloneEvmSettings, DEFAULT_EVM_SETTINGS, validateEvmSettings, type AlertEvent, type EvmSettings } from '@spd/analysis'
import { useAppStore } from '../../stores/appStore'

const LEVEL_TEXT = { warn: '▲ 주의', critical: '■ 위험' } as const

/** 경고 목록: 발생한 보고일과 이유. 최근 보고일이 위로 온다. */
export function AlertList({ events }: { events: AlertEvent[] }) {
  if (events.length === 0) return <p className="muted">경고가 없습니다.</p>
  const sorted = [...events].sort((a, b) => b.day - a.day || (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
  return (
    <ul className="alert-list" aria-label="경고 목록">
      {sorted.map((e, i) => (
        <li key={i} className={`alert-${e.level}`}>
          <strong>{e.day}일</strong> <span>{LEVEL_TEXT[e.level]}</span> {e.message}
        </li>
      ))}
    </ul>
  )
}

/** 경고 임계값과 구간 수를 바꾼다. 올바른 값은 바로 저장하고 잘못된 값은 이유만 보인다. */
export function AlertSettingsForm() {
  const evm = useAppStore((s) => s.evm)
  const setEvm = useAppStore((s) => s.setEvmSettings)
  const [draft, setDraft] = useState<EvmSettings>(() => cloneEvmSettings(evm))
  const problem = validateEvmSettings(draft)

  const change = (f: (d: EvmSettings) => void) => {
    const next = cloneEvmSettings(draft)
    f(next)
    setDraft(next)
    if (validateEvmSettings(next) === null) setEvm(next)
  }
  const num = (id: string, label: string, value: number, set: (d: EvmSettings, v: number) => void, step: string) => (
    <div className="field" key={id}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" step={step} value={Number.isFinite(value) ? value : ''} onChange={(e) => change((d) => set(d, e.target.valueAsNumber))} />
    </div>
  )

  return (
    <details className="alert-settings">
      <summary>경고 설정</summary>
      <div className="alert-settings-grid">
        {num('evm-warn', '주의 임계값(CPI·SPI)', draft.alerts.warn, (d, v) => (d.alerts.warn = v), '0.01')}
        {num('evm-critical', '위험 임계값(CPI·SPI)', draft.alerts.critical, (d, v) => (d.alerts.critical = v), '0.01')}
        {num('evm-trend', '연속 하락 횟수', draft.alerts.trend, (d, v) => (d.alerts.trend = v), '1')}
        {num('evm-early-progress', '조기 경고 진척률(0~1)', draft.alerts.early.progress, (d, v) => (d.alerts.early.progress = v), '0.01')}
        {num('evm-early-cpi', '조기 경고 CPI', draft.alerts.early.cpi, (d, v) => (d.alerts.early.cpi = v), '0.01')}
        {num('evm-k', '최근 구간 수', draft.k, (d, v) => (d.k = v), '1')}
      </div>
      {problem && (
        <div className="field-error" role="alert">
          {problem}
        </div>
      )}
      <button type="button" onClick={() => (setDraft(cloneEvmSettings(DEFAULT_EVM_SETTINGS)), setEvm(cloneEvmSettings(DEFAULT_EVM_SETTINGS)))}>
        기본값으로
      </button>
    </details>
  )
}
