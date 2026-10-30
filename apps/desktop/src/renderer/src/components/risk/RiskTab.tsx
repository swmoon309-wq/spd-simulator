import { useState } from 'react'
import { getEntry } from '../../catalog'
import { useAppStore } from '../../stores/appStore'
import { ComparePanel } from './ComparePanel'
import { ConvergencePanel } from './ConvergencePanel'
import { InputList } from './InputList'
import { RiskResults } from './RiskResults'
import { RiskRunBar } from './RiskRunBar'
import { SensitivityPanel } from './SensitivityPanel'
import { TargetPanel } from './TargetPanel'

const TABS = [
  ['distribution', '분포'],
  ['target', '목표'],
  ['sensitivity', '민감도'],
  ['convergence', '수렴'],
  ['compare', '비교']
] as const
type ResultTab = (typeof TABS)[number][0]

export function RiskTab() {
  const modelId = useAppStore((s) => s.modelId)
  const entry = getEntry(modelId)
  const [tab, setTab] = useState<ResultTab>('distribution')
  const [kpiId, setKpiId] = useState('completionDay')
  const kpi = entry.kpiSpecs.some((k) => k.id === kpiId) ? kpiId : (entry.kpiSpecs[0]?.id ?? kpiId)

  return (
    <div className="app-body">
      <aside className="panel side" aria-label="불확실한 입력">
        <InputList />
      </aside>
      <main className="panel main">
        <RiskRunBar />
        <div className="row wrap risk-subhead">
          <div className="tabs risk-subtabs" role="tablist" aria-label="결과 보기">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`risk-tab-${id}`} aria-selected={tab === id} aria-controls="risk-panel" className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <label className="risk-field">
            <span>지표</span>
            <select value={kpi} onChange={(e) => setKpiId(e.target.value)}>
              {entry.kpiSpecs.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                  {k.unit ? ` (${k.unit})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div role="tabpanel" id="risk-panel" aria-labelledby={`risk-tab-${tab}`}>
          {tab === 'distribution' ? (
            <RiskResults kpiId={kpi} />
          ) : tab === 'target' ? (
            <TargetPanel kpiId={kpi} />
          ) : tab === 'sensitivity' ? (
            <SensitivityPanel kpiId={kpi} />
          ) : tab === 'convergence' ? (
            <ConvergencePanel kpiId={kpi} />
          ) : (
            <ComparePanel kpiId={kpi} />
          )}
        </div>
      </main>
    </div>
  )
}
