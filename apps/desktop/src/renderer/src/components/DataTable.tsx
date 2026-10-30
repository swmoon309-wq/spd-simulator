import { useState } from 'react'
import { getEntry } from '../catalog'
import { buildDataTable, formatCell, TABLE_STEPS, type TableStep } from '../lib/dataTable'
import { useAppStore } from '../stores/appStore'

/** 실행 결과의 시점별 값 표(RES-02). 실행·변수·시간 간격을 골라 본다. 전체 변수·전체 시점은 실행 표의 CSV로 저장한다. */
export function DataTable() {
  const modelId = useAppStore((s) => s.modelId)
  const runs = useAppStore((s) => s.runs)
  const chartVariable = useAppStore((s) => s.chartVariable)
  const [runId, setRunId] = useState<number | null>(null)
  const [step, setStep] = useState<TableStep>(7)
  const [picked, setPicked] = useState<string[] | null>(null)
  const entry = getEntry(modelId)

  if (runs.length === 0) return null
  const run = runs.find((r) => r.id === runId) ?? (runs[runs.length - 1] as (typeof runs)[number])
  // 고르지 않았으면 그래프에 보이는 변수 하나로 시작한다.
  const names = (picked ?? [chartVariable]).filter((n) => entry.variables.some((v) => v.name === n))
  const view = buildDataTable(run.result, entry.variables.filter((v) => names.includes(v.name)), step)
  const toggle = (name: string) => setPicked(names.includes(name) ? names.filter((n) => n !== name) : [...names, name])

  return (
    <details className="data-table">
      <summary>데이터 표</summary>
      <div className="data-table-controls">
        <label>
          실행{' '}
          <select value={run.id} onChange={(e) => setRunId(Number(e.target.value))} aria-label="표로 볼 실행">
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          간격{' '}
          <select value={step} onChange={(e) => setStep(Number(e.target.value) as TableStep)} aria-label="표의 시간 간격">
            {TABLE_STEPS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">값은 그 시각의 값입니다(평균이 아님).</span>
      </div>
      <fieldset className="data-table-vars">
        <legend>변수</legend>
        {entry.variables.map((v) => (
          <label key={v.name} className="check">
            <input type="checkbox" checked={names.includes(v.name)} onChange={() => toggle(v.name)} />
            {v.label}
          </label>
        ))}
        <button type="button" className="link" onClick={() => setPicked(entry.variables.map((v) => v.name))}>
          모두
        </button>
        <button type="button" className="link" onClick={() => setPicked([])}>
          해제
        </button>
      </fieldset>
      {view.columns.length === 0 ? (
        <p className="muted">표시할 변수를 고르세요.</p>
      ) : (
        <>
          <div className="data-table-scroll">
            <table aria-label="시점별 값">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    시간(일)
                  </th>
                  {view.columns.map((c) => (
                    <th key={c.name} scope="col" className="num">
                      {c.label}
                      {c.unit ? ` (${c.unit})` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <tr key={r.time}>
                    <td className="num">{formatCell(r.time)}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="num">
                        {formatCell(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted data-table-count">
            {view.total > view.rows.length ? `${view.total}행 중 처음 ${view.rows.length}행만 표시합니다. 간격을 늘리거나 CSV로 저장하세요.` : `${view.total}행`}
          </p>
        </>
      )}
    </details>
  )
}
