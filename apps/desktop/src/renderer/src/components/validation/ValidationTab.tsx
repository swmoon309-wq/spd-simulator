import { useState } from 'react'
import { BASE_ID } from '../../lib/scenarioRunner'
import { useAppStore } from '../../stores/appStore'
import { DataComparePanel } from './DataComparePanel'
import { CalibrateTab } from './CalibrateTab'
import { ExtremesTab } from './ExtremesTab'
import { StructureTab } from './StructureTab'

const TABS = [
  ['data', '데이터 비교'],
  ['extremes', '극단·교란 시험'],
  ['structure', '구조 점검'],
  ['calibrate', '보정']
] as const
type Sub = (typeof TABS)[number][0]

/**
 * 모델 검증(설계 07). 검증은 증명이 아니라 신뢰를 쌓는 활동이다. 모든 하위 탭이 같은 **대상**(기준 또는 시나리오)의 유효 파라미터와
 * 실험 탭의 실행 설정으로 시뮬레이션한다.
 */
export function ValidationTab() {
  const scenarios = useAppStore((s) => s.scenarios)
  const targetId = useAppStore((s) => s.validation.targetScenarioId)
  const setTarget = useAppStore((s) => s.setValidationTarget)
  const [sub, setSub] = useState<Sub>('data')
  const rows = [{ id: BASE_ID, name: '기준' }, ...scenarios.map((s) => ({ id: s.id, name: s.name }))]

  return (
    <div className="validation-root">
      <div className="row wrap risk-subhead validation-head">
        <div className="tabs risk-subtabs" role="tablist" aria-label="검증 보기">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`val-tab-${id}`} aria-selected={sub === id} aria-controls="val-panel" className={`tab${sub === id ? ' active' : ''}`} onClick={() => setSub(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="risk-field">
          <span>대상</span>
          <select aria-label="검증 대상" value={rows.some((r) => r.id === targetId) ? targetId : BASE_ID} onChange={(e) => setTarget(e.target.value)}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="tabpanel" id="val-panel" aria-labelledby={`val-tab-${sub}`} className="validation-panel">
        {sub === 'data' ? <DataComparePanel /> : sub === 'extremes' ? <ExtremesTab /> : sub === 'structure' ? <StructureTab /> : <CalibrateTab />}
      </div>
    </div>
  )
}
