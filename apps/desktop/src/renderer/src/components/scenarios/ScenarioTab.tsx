import { useEffect, useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { AdoptionBanner } from './AdoptionPanel'
import { ScenarioComparison } from './ScenarioComparison'
import { ScenarioDetail } from './ScenarioDetail'
import { ScenarioList } from './ScenarioList'
import { ScenarioParamEditor } from './ScenarioParamEditor'
import { ScenarioRunPanel } from './ScenarioRunPanel'

export function ScenarioTab() {
  const activeId = useAppStore((s) => s.activeScenarioId)
  const exists = useAppStore((s) => s.scenarios.some((x) => x.id === s.activeScenarioId))
  const [editing, setEditing] = useState(false)

  // 다른 시나리오를 고르거나 선택이 없어지면 편집을 닫는다.
  useEffect(() => setEditing(false), [activeId])

  return (
    <div className="app-body">
      <aside className="panel side" aria-label="시나리오">
        <p className="desc">
          정책 대안을 시나리오로 만듭니다. 시나리오는 <strong>기본 설정에서 달라지는 값만</strong> 저장합니다.
        </p>
        <ScenarioList />
        <ScenarioDetail editing={editing && exists} onEdit={setEditing} />
      </aside>
      <main className="panel main">
        <AdoptionBanner />
        <ScenarioRunPanel />
        {editing && exists && activeId ? (
          <ScenarioParamEditor scenarioId={activeId} onClose={() => setEditing(false)} />
        ) : (
          <ScenarioComparison />
        )}
      </main>
    </div>
  )
}
