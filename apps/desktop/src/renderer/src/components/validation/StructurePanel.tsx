import { useState } from 'react'
import { countStatuses, type StructureStatus } from '@spd/analysis'
import { selectStructureStale, useAppStore } from '../../stores/appStore'

const MARK: Record<StructureStatus, { mark: string; label: string }> = {
  pass: { mark: '✓', label: '통과' },
  warn: { mark: '▲', label: '주의' },
  fail: { mark: '✗', label: '실패' },
  info: { mark: 'ⓘ', label: '정보' }
}

/** 구조 점검 S1~S6(VAL-04): 무엇을 확인했고 무엇은 확인하지 못했는지를 함께 보인다. */
export function StructurePanel() {
  const run = useAppStore((s) => s.validationStructure)
  const stale = useAppStore(selectStructureStale)
  const runStructure = useAppStore((s) => s.runStructure)
  const [message, setMessage] = useState<string | null>(null)
  const findings = run?.report.findings ?? []
  const counts = countStatuses(findings)

  return (
    <section className="validation-section" aria-label="구조 점검">
      <h2>구조 점검</h2>
      <p className="muted">
        모델 정의와 대상 시나리오의 실행에서 <strong>기계적으로 확인할 수 있는 구조의 문제</strong>를 찾습니다. 점검마다 확인한 것과 <strong>확인하지 못한 것</strong>을 함께 적습니다. 통과해도 모델이 현실에 맞다는 뜻은 아닙니다.
      </p>
      <div className="row wrap">
        <button type="button" className="primary" onClick={() => setMessage(runStructure())}>
          {run ? '다시 점검' : '구조 점검 실행'}
        </button>
        {run && stale && <span className="field-error">입력이 바뀌어 결과가 오래되었습니다. 다시 점검하세요.</span>}
      </div>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
      {run && (
        <div className={stale ? 'stale' : undefined}>
          <p role="status">
            {(['pass', 'warn', 'fail', 'info'] as StructureStatus[]).map((s) => (
              <span key={s} className="extreme-legend">
                <strong>
                  {MARK[s].mark} {MARK[s].label} {counts[s]}
                </strong>
              </span>
            ))}
          </p>
          {run.report.runError && (
            <div className="field-error" role="alert">
              대상 시나리오 실행이 중단되었습니다: {run.report.runError}
            </div>
          )}
          {/* 통과한 점검도 펼쳐 둔다: "확인하지 못한 것"이 기본으로 보여야 통과를 과신하지 않는다. */}
          <div className="structure-cards">
            {findings.map((f) => (
              <details key={f.id} className={`structure-card ${f.status}`} open>
                <summary>
                  <strong>
                    {MARK[f.status].mark} {f.id} {f.title}
                  </strong>
                  <span className="muted"> — {MARK[f.status].label}. {f.summary}</span>
                </summary>
                {f.items.length > 0 && (
                  <ul>
                    {f.items.map((i, k) => (
                      <li key={k}>{i}</li>
                    ))}
                  </ul>
                )}
                <p className="muted">
                  <strong>확인한 것</strong> {f.checked}
                </p>
                <div className="muted">
                  <strong>확인하지 못한 것</strong>
                  <ul>
                    {f.notChecked.map((n, k) => (
                      <li key={k}>{n}</li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
