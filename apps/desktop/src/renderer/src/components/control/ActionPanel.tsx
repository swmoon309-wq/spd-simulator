import { useMemo, useState } from 'react'
import { actionsFor, getAction, MAX_CANDIDATES, MAX_REVISION_REASON, validateAction, type ActionKind } from '@spd/analysis'
import { getEntry } from '../../catalog'
import type { Adopted } from '../../lib/adoption'
import { buildActionComparison } from '../../lib/actionCompare'
import { reforecastUnsupported } from '../../lib/control'
import { formatDelta, formatValue } from '../../lib/scenarioCompare'
import { useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'

const day = (x: number) => `${Number(x.toFixed(1))}일`

/**
 * 시정 조치 시험(설계 05의 8.2)과 계획 개정(8.3). 보고일 상태에서 "조치 없음"과 후보들을 같은 생산성 보정 계수로 이어 실행해
 * 완료일·공수·결함·소진을 비교하고, 후보 하나를 골라 사유와 함께 기준선을 개정한다.
 */
export function ActionPanel({ adopted, reportDay, reportActualDay, disabledReason }: { adopted: Adopted; reportDay: number; reportActualDay: number; disabledReason: string | null }) {
  const modelId = useAppStore((s) => s.modelId)
  const candidates = useAppStore((s) => s.candidates)
  const run = useAppStore((s) => s.actionRun)
  const add = useAppStore((s) => s.addCandidate)
  const update = useAppStore((s) => s.updateCandidate)
  const remove = useAppStore((s) => s.removeCandidate)
  const runActions = useAppStore((s) => s.runActions)
  const reviseWith = useAppStore((s) => s.reviseWith)
  const revisionCount = useAppStore((s) => s.revisions.length)
  const entry = getEntry(modelId)
  const unsupported = reforecastUnsupported(modelId, entry.title)
  const kinds = actionsFor(modelId)
  const [newKind, setNewKind] = useState<ActionKind>(kinds[0]?.kind ?? 'staffing')
  const [message, setMessage] = useState<string | null>(null)
  const [revising, setRevising] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [reviseError, setReviseError] = useState<string | null>(null)
  const running = run?.status === 'running'
  const stale = run?.status === 'done' && run.day !== reportDay
  const comparison = useMemo(() => (run?.status === 'done' ? buildActionComparison(entry, run, adopted.params) : null), [run, entry, adopted.params])
  const ctx = { modelId, atDay: reportActualDay, end: adopted.run.end }

  const confirmRevise = () => {
    if (!revising) return
    const err = reviseWith(revising, reason)
    setReviseError(err)
    if (!err) {
      setRevising(null)
      setReason('')
    }
  }

  if (unsupported) {
    return (
      <section className="actions-panel" aria-label="시정 조치 시험">
        <h2 className="section-title">시정 조치 시험</h2>
        <p className="muted">{unsupported}</p>
      </section>
    )
  }

  return (
    <section className="actions-panel" aria-label="시정 조치 시험">
      <h2 className="section-title">
        시정 조치 시험 <span className="muted">(보고 기준일 {day(reportDay)} · 추정)</span>
      </h2>
      <p className="muted">
        후보를 추가하고 실행하면 "조치 없음"과 같은 생산성 보정 계수로 이어 실행한 결과를 나란히 비교합니다. 범위 축소는 모델 수식 변경이 필요해 지원하지 않습니다.
      </p>

      {candidates.length === 0 && <p className="muted">후보가 없습니다. 아래에서 조치를 골라 추가하세요.</p>}
      <ol className="candidate-list">
        {candidates.map((c, i) => {
          const def = getAction(c.input.kind)
          const problem = validateAction(c.input, ctx)
          return (
            <li key={c.id} className="candidate">
              <div className="row wrap">
                <strong>후보 {i + 1}</strong>
                <select aria-label={`후보 ${i + 1} 조치 종류`} value={c.input.kind} onChange={(e) => update(c.id, { kind: e.target.value as ActionKind })}>
                  {kinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
                {def.fields.map((f) => (
                  <label key={f.key} className="inline-field">
                    {f.label}
                    <DraftNumber id={`cand-${c.id}-${f.key}`} label={`후보 ${i + 1} ${f.label}`} value={c.input.values[f.key] ?? 0} onValue={(v) => update(c.id, { values: { [f.key]: v } })} />
                    <span className="muted">{f.unit}</span>
                  </label>
                ))}
                <label className="inline-field">
                  시작일
                  <DraftNumber id={`cand-${c.id}-day`} label={`후보 ${i + 1} 시작일`} value={c.input.day} onValue={(v) => update(c.id, { day: v })} />
                  <span className="muted">일</span>
                </label>
                <button type="button" className="link" onClick={() => remove(c.id)} aria-label={`후보 ${i + 1} 삭제`}>
                  삭제
                </button>
              </div>
              <div className="muted">{def.description}</div>
              {problem && (
                <div className="field-error" role="alert">
                  {problem}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      <div className="row wrap actions">
        <select aria-label="추가할 조치" value={newKind} onChange={(e) => setNewKind(e.target.value as ActionKind)}>
          {kinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => add(newKind, reportActualDay)} disabled={candidates.length >= MAX_CANDIDATES} title={candidates.length >= MAX_CANDIDATES ? `후보는 최대 ${MAX_CANDIDATES}개입니다` : undefined}>
          + 후보 추가
        </button>
        <span className="muted count">
          {candidates.length}/{MAX_CANDIDATES}
        </span>
        <button
          type="button"
          className="primary"
          disabled={running || disabledReason !== null || candidates.length === 0}
          title={disabledReason ?? undefined}
          onClick={() => {
            setMessage(null)
            setRevising(null)
            void runActions(reportDay).then(setMessage)
          }}
        >
          {running ? '실행 중…' : '후보 실행'}
        </button>
      </div>
      {disabledReason && <p className="muted">{disabledReason}</p>}
      {message && !running && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
      {run?.status === 'error' && !message && (
        <div className="field-error" role="alert">
          {run.error}
        </div>
      )}
      {stale && <p className="muted">보고 기준일이 바뀌어 이전 비교는 {day(run.day)} 기준입니다. 다시 실행하세요.</p>}

      {comparison && run && !stale && (
        <div className="table-scroll">
          <table className="compare-table action-table">
            <caption className="muted">
              비교 결과(추정) — 모든 열에 같은 생산성 보정 계수 κ = {run.kappa.toFixed(2)}(누적과 최근 구간 CPI의 평균)를 썼습니다.
            </caption>
            <thead>
              <tr>
                <th scope="col" className="sticky">
                  지표
                </th>
                {comparison.columns.map((c) => (
                  <th scope="col" key={c.id} className="num">
                    <div className="col-head">{c.label}</div>
                    <button type="button" className="link" onClick={() => (setRevising(c.id), setReason(''), setReviseError(null))} aria-label={`${c.label}(으)로 기준선 개정`}>
                      개정 채택…
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.spec.id}>
                  <th scope="row" className="sticky">
                    {row.label}
                  </th>
                  {comparison.columns.map((c) => {
                    const cell = row.cells[c.id]
                    const delta = cell?.delta ? formatDelta(row.spec, cell.delta) : null
                    return (
                      <td key={c.id} className="num">
                        <div className={c.id === 'none' ? 'strong' : ''}>{formatValue(row.spec, cell?.value ?? null)}</div>
                        {c.id !== 'none' && delta && cell?.delta && (
                          <div className={`delta ${cell.delta.verdict === 'better' ? 'better' : cell.delta.verdict === 'worse' ? 'worse' : 'neutral'}`} title={delta.percent ? `조치 없음 대비 ${delta.percent}` : undefined}>
                            <span aria-hidden="true">{delta.arrow} </span>
                            {delta.text}
                            {delta.verdict && <span className="verdict"> {delta.verdict}</span>}
                            <span className="sr-only">{`, 조치 없음보다 ${delta.arrow === '▲' ? '큼' : delta.arrow === '▼' ? '작음' : '같음'}`}</span>
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revising && comparison && (
        <div className="revise-form" role="group" aria-label="기준선 개정">
          <p>
            <strong>{comparison.columns.find((c) => c.id === revising)?.label}</strong>(으)로 기준선을 개정합니다. 과거 기준선은 보존되고, 이 보고일({day(reportDay)}) 이후부터 새 계획을 씁니다. 개정 직후 SPI는 1에서 다시 시작합니다.
          </p>
          <label htmlFor="revise-reason">개정 사유(필수)</label>
          <textarea id="revise-reason" rows={2} maxLength={MAX_REVISION_REASON} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="muted count">
            {reason.length}/{MAX_REVISION_REASON} · 개정 {revisionCount + 1}번째
          </div>
          {reviseError && (
            <div className="field-error" role="alert">
              {reviseError}
            </div>
          )}
          <div className="row wrap">
            <button type="button" className="primary" onClick={confirmRevise}>
              개정 확정
            </button>
            <button type="button" onClick={() => setRevising(null)}>
              취소
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
