import { useState } from 'react'
import { MAX_ACTUAL_NOTE, MAX_ACTUAL_ROWS, type RowIssues } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { useAppStore } from '../../stores/appStore'

/** 숫자 입력 한 칸. 비우면 `onEmpty`로 처리하고, 숫자가 아닌 입력은 무시한다. */
function NumCell({ value, label, step, onChange, onEmpty }: { value: number | undefined; label: string; step?: number; onChange(v: number): void; onEmpty?: () => void }) {
  return (
    <input
      type="number"
      className="cell-num"
      aria-label={label}
      step={step ?? 'any'}
      value={value === undefined ? '' : value}
      onChange={(e) => {
        if (e.target.value === '') return onEmpty?.()
        const n = e.target.valueAsNumber
        if (Number.isFinite(n)) onChange(n)
      }}
    />
  )
}

/** 실적 입력 표. 값은 모두 누적이다. 오류가 있는 행은 이유를 보이고 계산에서 빠진다. */
export function ActualsTable({ issues }: { issues: RowIssues[] }) {
  const modelId = useAppStore((s) => s.modelId)
  const actuals = useAppStore((s) => s.actuals)
  const add = useAppStore((s) => s.addActual)
  const update = useAppStore((s) => s.updateActual)
  const remove = useAppStore((s) => s.removeActual)
  const clear = useAppStore((s) => s.clearActuals)
  const credits = getEntry(modelId).evm?.credits ?? []
  const full = actuals.length >= MAX_ACTUAL_ROWS

  return (
    <section aria-label="실적 입력">
      <div className="row wrap">
        <h2 className="section-title">실적 입력</h2>
        <span className="muted">값은 보고일까지의 <strong>누적</strong>입니다. 공수 단위는 맨데이.</span>
        <span className="muted count" aria-live="polite">
          {actuals.length}/{MAX_ACTUAL_ROWS}
        </span>
      </div>

      {actuals.length === 0 ? (
        <p className="muted">아직 실적이 없습니다. “+ 보고 추가”로 보고일마다 한 줄씩 입력하세요.</p>
      ) : (
        <div className="table-scroll">
          <table className="actuals-table">
            <thead>
              <tr>
                <th scope="col" className="num">
                  #
                </th>
                <th scope="col">보고일(일)</th>
                {credits.map((c) => (
                  <th scope="col" key={c.variable}>
                    {c.label}
                    <div className="muted note">누적 태스크 · 인정 {Math.round(c.weight * 100)}%</div>
                  </th>
                ))}
                <th scope="col">누적 공수(맨데이)</th>
                <th scope="col">투입 인원(선택)</th>
                <th scope="col">누적 결함(선택)</th>
                <th scope="col">메모</th>
                <th scope="col">상태</th>
                <th scope="col">
                  <span className="sr-only">삭제</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {actuals.map((row, i) => {
                const n = i + 1
                const is = issues[i] ?? { errors: [], warnings: [] }
                return (
                  <tr key={i} className={is.errors.length > 0 ? 'row-error' : undefined}>
                    <td className="num">{n}</td>
                    <td>
                      <NumCell value={row.day} label={`${n}번째 보고 보고일`} onChange={(v) => update(i, { day: v })} />
                    </td>
                    {credits.map((c) => (
                      <td key={c.variable}>
                        <NumCell value={row.cum[c.variable] ?? 0} label={`${n}번째 보고 ${c.label}`} onChange={(v) => update(i, { cum: { [c.variable]: v } })} onEmpty={() => update(i, { cum: { [c.variable]: 0 } })} />
                      </td>
                    ))}
                    <td>
                      <NumCell value={row.effort} label={`${n}번째 보고 누적 공수`} onChange={(v) => update(i, { effort: v })} onEmpty={() => update(i, { effort: 0 })} />
                    </td>
                    <td>
                      <NumCell value={row.headcount} label={`${n}번째 보고 투입 인원`} onChange={(v) => update(i, { headcount: v })} onEmpty={() => update(i, { headcount: undefined })} />
                    </td>
                    <td>
                      <NumCell value={row.defects} label={`${n}번째 보고 누적 결함`} onChange={(v) => update(i, { defects: v })} onEmpty={() => update(i, { defects: undefined })} />
                    </td>
                    <td>
                      <input type="text" className="cell-note" aria-label={`${n}번째 보고 메모`} maxLength={MAX_ACTUAL_NOTE + 20} value={row.note ?? ''} onChange={(e) => update(i, { note: e.target.value })} />
                    </td>
                    <td className="row-status">
                      {is.errors.length === 0 && is.warnings.length === 0 && <span className="muted">정상</span>}
                      {is.errors.length > 0 && (
                        <ul className="issue-list error" role="alert">
                          {is.errors.map((m) => (
                            <li key={m}>오류: {m}</li>
                          ))}
                          <li>이 행은 계산에서 제외됩니다</li>
                        </ul>
                      )}
                      {is.warnings.length > 0 && (
                        <ul className="issue-list warning">
                          {is.warnings.map((m) => (
                            <li key={m}>경고: {m}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => remove(i)} aria-label={`${n}번째 보고 삭제`}>
                        삭제
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="row wrap actions">
        <button type="button" className="primary" onClick={() => add()} disabled={full} title={full ? `보고는 최대 ${MAX_ACTUAL_ROWS}건입니다` : undefined}>
          + 보고 추가
        </button>
        <ClearButton disabled={actuals.length === 0} onClear={clear} />
      </div>
    </section>
  )
}

function ClearButton({ disabled, onClear }: { disabled: boolean; onClear(): void }) {
  const [confirm, setConfirm] = useState(false)
  return confirm ? (
    <span className="confirm" role="alert">
      실적을 모두 지울까요?
      <button type="button" className="danger" onClick={() => (onClear(), setConfirm(false))}>
        모두 지우기
      </button>
      <button type="button" onClick={() => setConfirm(false)}>
        취소
      </button>
    </span>
  ) : (
    <button type="button" className="danger-outline" disabled={disabled} onClick={() => setConfirm(true)}>
      모두 지우기…
    </button>
  )
}
