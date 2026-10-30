import { useState } from 'react'
import { getEntry } from '../../catalog'
import { MAX_RISK_INPUTS } from '../../lib/risk'
import { paramSpecs } from '../../lib/params'
import { useAppStore } from '../../stores/appStore'
import { DistributionEditor } from './DistributionEditor'

/** 불확실한 입력 목록: 파라미터를 골라 더하고, 분포를 고친다. 실행 중에는 바꿀 수 없다. */
export function InputList() {
  const modelId = useAppStore((s) => s.modelId)
  const inputs = useAppStore((s) => s.risk.inputs)
  const running = useAppStore((s) => s.riskRun?.status === 'running')
  const addRiskInput = useAppStore((s) => s.addRiskInput)
  const updateRiskInput = useAppStore((s) => s.updateRiskInput)
  const removeRiskInput = useAppStore((s) => s.removeRiskInput)
  const [pick, setPick] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const entry = getEntry(modelId)
  const specs = paramSpecs(entry)
  const free = specs.filter((s) => !inputs.some((i) => i.name === s.name))
  const full = inputs.length >= MAX_RISK_INPUTS

  const add = () => {
    const name = pick || (free[0]?.name ?? '')
    if (!name) return
    const err = addRiskInput(name)
    setMessage(err)
    if (!err) setPick('')
  }

  return (
    <section aria-label="불확실한 입력">
      <h2>불확실한 입력</h2>
      <p className="muted">값을 모르는 파라미터에 분포를 줍니다. 분포는 <strong>가정</strong>이며, 결과 확률은 이 가정에서 나온 값입니다.</p>
      {inputs.length === 0 ? (
        <p className="muted">아직 없습니다. 아래에서 파라미터를 더하세요. 기본값은 삼각 분포(0.8배 / 1배 / 1.3배)입니다.</p>
      ) : (
        <ul className="risk-inputs">
          {inputs.map((i) => {
            const spec = specs.find((s) => s.name === i.name)
            return spec ? <DistributionEditor key={i.name} entry={entry} spec={spec} dist={i.dist} disabled={running} onChange={(d) => updateRiskInput(i.name, d)} onRemove={() => removeRiskInput(i.name)} /> : null
          })}
        </ul>
      )}
      <div className="row wrap">
        <label className="sr-only" htmlFor="risk-add">
          더할 파라미터
        </label>
        <select id="risk-add" value={pick} disabled={running || full || free.length === 0} onChange={(e) => setPick(e.target.value)}>
          <option value="">파라미터 선택…</option>
          {free.map((s) => (
            <option key={s.name} value={s.name}>
              {entry.def.constants[s.name]?.label ?? s.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={running || full || !pick} onClick={add} title={full ? `최대 ${MAX_RISK_INPUTS}개입니다` : undefined}>
          + 추가
        </button>
      </div>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
    </section>
  )
}
