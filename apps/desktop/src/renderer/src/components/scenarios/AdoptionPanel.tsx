import { useEffect, useState } from 'react'
import { getEntry } from '../../catalog'
import { adoptionStatus, adoptionSummary, BASE_SCENARIO_ID, PLAN_CSV_SCENARIO_ID } from '../../lib/adoption'
import { useAppStore } from '../../stores/appStore'

/** 채택 계획 목록·비교 표에서 쓰는 표시. 색에 기대지 않도록 ★과 글자를 함께 쓴다. */
export const ADOPTED_MARK = '★'

/** 채택 계획의 어긋남을 계산하는 훅(채택이 없으면 null). */
export function useAdoptionStatus() {
  const adopted = useAppStore((s) => s.adopted)
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const settings = useAppStore((s) => s.runSettings)
  const scenarios = useAppStore((s) => s.scenarios)
  if (!adopted) return null
  return adoptionStatus(adopted, { modelId, params, settings, scenarios }, getEntry(modelId))
}

/**
 * 선택한 행(기준 또는 시나리오)의 채택 조작. 채택 중이면 해제·현재 값으로 다시 채택을, 아니면 채택을 보인다.
 * 이전 채택이 다른 행에 있으면 바꾸기 전에 확인한다.
 */
export function AdoptionPanel({ scenarioId }: { scenarioId: string }) {
  const adopted = useAppStore((s) => s.adopted)
  const adopt = useAppStore((s) => s.adoptScenario)
  const release = useAppStore((s) => s.releaseAdoption)
  const status = useAdoptionStatus()
  const revisionCount = useAppStore((s) => s.revisions.length)
  const [message, setMessage] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'replace' | 'readopt' | 'release' | null>(null)

  useEffect(() => {
    setMessage(null)
    setConfirm(null)
  }, [scenarioId])

  const mine = adopted?.scenarioId === scenarioId
  const doAdopt = () => {
    setConfirm(null)
    setMessage(adopt(scenarioId))
  }

  return (
    <section className="adoption" aria-label="채택 계획">
      <h3>채택 계획</h3>
      {mine && adopted ? (
        <>
          <p>
            <strong>
              {ADOPTED_MARK} 채택됨
            </strong>{' '}
            <span className="muted">{adoptionSummary(adopted)}</span>
          </p>
          <p className="muted">채택 시각 {new Date(adopted.adoptedAt).toLocaleString('ko-KR')} · 이후 값을 고쳐도 기준선은 바뀌지 않습니다.</p>
          {status && status.changes.length > 0 && (
            <div className="drift" role="status">
              <strong>채택 이후 수정됨</strong>
              <ul>
                {status.changes.map((c) => (
                  <li key={c.key}>
                    {c.label}: {c.adopted} → {c.current}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="row wrap actions">
            {confirm === 'readopt' ? (
              <span className="confirm" role="alert">
                기준선 개정 이력 {revisionCount}건이 지워지고 현재 값으로 새 기준선을 만듭니다.
                <button type="button" className="danger" onClick={doAdopt}>
                  다시 채택
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => (revisionCount > 0 ? setConfirm('readopt') : doAdopt())}>
                현재 값으로 다시 채택
              </button>
            )}
            {confirm === 'release' ? (
              <span className="confirm" role="alert">
                채택을 해제할까요? 기준선이 사라집니다.{revisionCount > 0 && ` 개정 이력 ${revisionCount}건도 지워집니다.`}
                <button type="button" className="danger" onClick={() => (release(), setConfirm(null))}>
                  해제
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className="danger-outline" onClick={() => setConfirm('release')}>
                채택 해제
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="muted">채택하면 이 시나리오의 결과가 통제(Earned Value)의 계획 기준선으로 저장됩니다. 최신 결과가 필요합니다.</p>
          <div className="row wrap actions">
            {confirm === 'replace' && adopted ? (
              <span className="confirm" role="alert">
                “{adopted.scenarioName}” 채택이 해제되고 이 시나리오로 바뀝니다.{revisionCount > 0 && ` 기준선 개정 이력 ${revisionCount}건도 지워집니다.`}
                <button type="button" className="danger" onClick={doAdopt}>
                  바꾸기
                </button>
                <button type="button" onClick={() => setConfirm(null)}>
                  취소
                </button>
              </span>
            ) : (
              <button type="button" className="primary" onClick={() => (adopted ? setConfirm('replace') : doAdopt())}>
                {ADOPTED_MARK} 채택
              </button>
            )}
          </div>
        </>
      )}
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
    </section>
  )
}

/** 시나리오 탭 위쪽의 채택 요약. 채택이 없으면 아무것도 그리지 않는다. */
export function AdoptionBanner() {
  const adopted = useAppStore((s) => s.adopted)
  const setActive = useAppStore((s) => s.setActiveScenario)
  const status = useAdoptionStatus()
  if (!adopted) return null
  const id = adopted.scenarioId
  const drifted = status !== null && status.changes.length > 0
  return (
    <div className={`adoption-banner${drifted ? ' drifted' : ''}`} role="status">
      <span>
        <strong>
          {ADOPTED_MARK} 채택 계획: {adopted.scenarioName}
        </strong>{' '}
        <span className="muted">{adoptionSummary(adopted)}</span>
        {status && !status.linked && <span> · 채택한 시나리오를 찾을 수 없음</span>}
        {drifted && <strong> · 채택 이후 수정됨 ({status.changes.length}개 항목)</strong>}
      </span>
      {id !== PLAN_CSV_SCENARIO_ID && (
        <button type="button" className="link" onClick={() => setActive(id === BASE_SCENARIO_ID ? null : id)}>
          보기
        </button>
      )}
    </div>
  )
}
