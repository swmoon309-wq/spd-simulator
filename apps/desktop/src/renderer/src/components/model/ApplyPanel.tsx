import { useState } from 'react'
import type { ApplyOutcome } from '../../stores/editorStore'
import type { GateResult, GateStatus } from '../../lib/modelEdit/apply'

const MARK: Record<GateStatus, string> = { pass: '✓', fail: '✖', info: 'ⓘ', skipped: '–' }
const WORD: Record<GateStatus, string> = { pass: '통과', fail: '실패', info: '확인', skipped: '건너뜀' }

/**
 * 적용 게이트의 결과(설계 08의 8.1). 막는 단계(구조 오류·앱 연결·시험 실행)가 모두 통과하면 적용할 수 있다. 단위 검사와 구조 점검은 막지 않고 결과를
 * 보인다. 적용하면 버전이 오르고 앱에 올라가며 내 모델 목록에 저장된다.
 */
export function ApplyPanel({ gate, outcome, busy, onApply, onClose, onStartProject, startable }: { gate: GateResult; outcome: ApplyOutcome | null; busy: boolean; onApply(confirmUnitErrors: boolean): void; onClose(): void; onStartProject(): void; startable: boolean }) {
  const [confirmUnits, setConfirmUnits] = useState(false)
  const needConfirm = gate.unitErrors > 0
  return (
    <section className="apply-panel" aria-label="적용 확인">
      <header>
        <h3>적용 확인</h3>
        <button type="button" className="link" onClick={onClose}>
          닫기
        </button>
      </header>
      <ol className="gate-steps">
        {gate.steps.map((s) => (
          <li key={s.id} className={`gate-${s.status}`}>
            <strong>
              <span aria-hidden="true">{MARK[s.status]}</span> {s.label}
            </strong>{' '}
            <span className="muted">
              {WORD[s.status]}
              {s.blocking ? ' · 적용을 막는 검사' : ' · 막지 않음'}
            </span>
            {s.details.length > 0 && (
              <ul>
                {s.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {gate.structure && <p className="muted">구조 점검이 놓치는 것(확인하지 못한 것)은 모델 검증 탭의 구조 점검에서 볼 수 있습니다. 점검을 통과해도 모델이 맞다는 증명은 아닙니다.</p>}
      {needConfirm && gate.canApply && (
        <label className="check">
          <input type="checkbox" checked={confirmUnits} onChange={(e) => setConfirmUnits(e.target.checked)} /> 단위 오류 {gate.unitErrors}건이 있다는 것을 확인했고 그래도 적용합니다(모델은 "단위 오류"로 표시됩니다)
        </label>
      )}
      <div className="apply-actions">
        <button type="button" className="primary" disabled={!gate.canApply || busy || (needConfirm && !confirmUnits)} onClick={() => onApply(confirmUnits)}>
          {busy ? '적용하는 중…' : '적용'}
        </button>
        {!gate.canApply && <span className="bad">적용을 막는 문제가 있습니다. 문제 패널을 보고 고치세요.</span>}
      </div>
      {outcome && outcome.ok && (
        <div role="status" className="apply-result">
          <p>
            적용했습니다 — {outcome.entry.title} 버전 {outcome.entry.def.meta.version}.{outcome.projectUpdated ? ' 열려 있는 프로젝트에 반영했습니다(저장해야 파일에 담깁니다).' : ''}
          </p>
          {outcome.warnings.map((w, i) => (
            <p key={i} className="warn">
              {w}
            </p>
          ))}
          {startable && (
            <button type="button" onClick={onStartProject}>
              이 모델로 새 프로젝트 시작
            </button>
          )}
        </div>
      )}
      {outcome && !outcome.ok && (
        <p role="alert" className="bad">
          {outcome.message}
        </p>
      )}
    </section>
  )
}
