import { ChecklistPanel } from './ChecklistPanel'
import { RecordPanel } from './RecordPanel'
import { StructurePanel } from './StructurePanel'

/** 구조 점검(VAL-04)·수동 체크리스트·검증 기록(VAL-07). */
export function StructureTab() {
  return (
    <div className="app-body single">
      <main className="panel main">
        <StructurePanel />
        <ChecklistPanel />
        <RecordPanel />
      </main>
    </div>
  )
}
