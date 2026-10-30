import { useState } from 'react'
import { CHECKLIST_GROUP_LABEL, CHECKLIST_ITEMS, CHECKLIST_STATUS_LABEL, CHECKLIST_STATUS_MARK, checklistCounts, entryFor, MAX_CHECKLIST_NOTE, type ChecklistGroup, type ChecklistStatus } from '@spd/analysis'
import { useAppStore } from '../../stores/appStore'

const STATUSES: ChecklistStatus[] = ['unchecked', 'ok', 'problem']
const GROUPS: ChecklistGroup[] = ['suitability', 'reality', 'utility']

/** 수동 체크리스트(책 표 2-4~2-6): 항목마다 미확인/확인/문제 있음과 메모를 기록한다. */
export function ChecklistPanel() {
  const entries = useAppStore((s) => s.validation.checklist)
  const setEntry = useAppStore((s) => s.setChecklistEntry)
  const [message, setMessage] = useState<string | null>(null)
  const counts = checklistCounts(entries)

  return (
    <section className="validation-section" aria-label="수동 체크리스트">
      <h2>수동 체크리스트</h2>
      <p className="muted">
        책 2.8.1의 검증 시험(표 2-4~2-6)을 이 앱에서 확인할 수 있는 형태로 풀어 쓴 목록입니다. 시험 하나로는 모델을 검증할 수 없고 여러 시험을 함께 봐야 하므로, 빠뜨린 시험이 없는지 점검하는 용도입니다. 합격을 판정하지 않으며, 내용은 프로젝트에 저장됩니다.
      </p>
      <p role="status">
        <strong>✓ 확인 {counts.ok}</strong> · <strong>▲ 문제 있음 {counts.problem}</strong> · ○ 미확인 {counts.unchecked} (전체 {CHECKLIST_ITEMS.length})
      </p>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
      {GROUPS.map((g) => (
        <fieldset key={g} className="checklist-group">
          <legend>{CHECKLIST_GROUP_LABEL[g]}</legend>
          {CHECKLIST_ITEMS.filter((i) => i.group === g).map((item) => {
            const e = entryFor(entries, item.id)
            return (
              <div key={item.id} className={`checklist-item ${e.status}`}>
                <div className="checklist-title">
                  <strong>
                    {CHECKLIST_STATUS_MARK[e.status]} {item.title}
                  </strong>
                  <span className="muted"> ({item.focus === 'structure' ? '구조' : '행동'})</span>
                </div>
                <div className="muted">{item.criterion}</div>
                <div className="muted">방법: {item.help}</div>
                <div className="row wrap">
                  <div role="radiogroup" aria-label={`${item.title} 상태`} className="row">
                    {STATUSES.map((st) => (
                      <label key={st} className="risk-check">
                        <input type="radio" name={`ck-${item.id}`} checked={e.status === st} onChange={() => setMessage(setEntry(item.id, { status: st }))} />
                        {CHECKLIST_STATUS_LABEL[st]}
                      </label>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="checklist-note"
                    aria-label={`${item.title} 메모`}
                    placeholder="메모"
                    maxLength={MAX_CHECKLIST_NOTE}
                    value={e.note}
                    onChange={(ev) => setMessage(setEntry(item.id, { note: ev.target.value }))}
                  />
                </div>
              </div>
            )
          })}
        </fieldset>
      ))}
    </section>
  )
}
