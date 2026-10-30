import { useState } from 'react'
import { useAppStore } from '../../stores/appStore'

const day = (x: number) => `${Number(x.toFixed(1))}일`
const fmt = (x: number) => Math.round(x).toLocaleString('ko-KR')

/** 기준선 개정 이력(설계 05의 8.3). 원 기준선은 항상 남아 있고, 가장 최근 개정만 되돌릴 수 있다. */
export function RevisionHistory() {
  const revisions = useAppStore((s) => s.revisions)
  const adopted = useAppStore((s) => s.adopted)
  const undo = useAppStore((s) => s.undoLastRevision)
  const [confirm, setConfirm] = useState(false)
  if (!adopted || revisions.length === 0) return null
  return (
    <section className="revision-history" aria-label="개정 이력">
      <h2 className="section-title">기준선 개정 이력</h2>
      <table className="indicator-table">
        <thead>
          <tr>
            <th scope="col">번호</th>
            <th scope="col">개정일</th>
            <th scope="col">조치</th>
            <th scope="col">사유</th>
            <th scope="col" className="num">완료일(계획)</th>
            <th scope="col" className="num">BAC(맨데이)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">0</th>
            <td>채택</td>
            <td>–</td>
            <td>{adopted.scenarioName}</td>
            <td className="num">{day(adopted.plannedCompletion)}</td>
            <td className="num">{fmt(adopted.bac)}</td>
          </tr>
          {revisions.map((r) => (
            <tr key={r.number}>
              <th scope="row">{r.number}</th>
              <td>{day(r.day)}</td>
              <td>{r.action ? r.action.label : '조치 없음(재예측)'}</td>
              <td>{r.reason}</td>
              <td className="num">
                {day(r.before.plannedCompletion)} → <strong>{day(r.after.plannedCompletion)}</strong>
              </td>
              <td className="num">
                {fmt(r.before.bac)} → <strong>{fmt(r.after.bac)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row wrap actions">
        {confirm ? (
          <span className="confirm" role="alert">
            {revisions.length}번째 개정을 되돌릴까요? 그 전 기준선이 다시 쓰입니다.
            <button type="button" className="danger" onClick={() => (undo(), setConfirm(false))}>
              되돌리기
            </button>
            <button type="button" onClick={() => setConfirm(false)}>
              취소
            </button>
          </span>
        ) : (
          <button type="button" className="danger-outline" onClick={() => setConfirm(true)}>
            마지막 개정 되돌리기…
          </button>
        )}
      </div>
    </section>
  )
}
