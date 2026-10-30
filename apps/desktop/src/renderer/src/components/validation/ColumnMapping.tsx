import { useState } from 'react'
import { getEntry } from '../../catalog'
import { useAppStore } from '../../stores/appStore'
import type { Dataset } from '../../lib/validation'
import type { DatasetEval } from '../../lib/validationView'
import { DraftNumber } from '../DraftNumber'

/** 열을 모델 변수에 연결하고 값 배율(단위 변환)을 정한다. 연결하지 않은 열은 비교하지 않는다. */
export function ColumnMapping({ dataset, evaluation }: { dataset: Dataset; evaluation: DatasetEval | null }) {
  const modelId = useAppStore((s) => s.modelId)
  const setColumn = useAppStore((s) => s.setDatasetColumn)
  const [message, setMessage] = useState<string | null>(null)
  const entry = getEntry(modelId)

  return (
    <section aria-label="열 연결">
      <h2>열 → 모델 변수</h2>
      <div className="table-scroll">
        <table className="risk-stats">
          <thead>
            <tr>
              <th scope="col">열</th>
              <th scope="col" className="num">점</th>
              <th scope="col">연결할 변수</th>
              <th scope="col">값 배율</th>
              <th scope="col">비교에서 뺀 점</th>
            </tr>
          </thead>
          <tbody>
            {dataset.columns.map((c, i) => {
              const ev = evaluation?.columns.find((e) => e.index === i)
              const skipped = ev ? ev.aligned.outOfRange + ev.aligned.invalid : null
              return (
                <tr key={`${i}-${c.name}`}>
                  <th scope="row">{c.name}</th>
                  <td className="num">{c.points.length}</td>
                  <td>
                    <select
                      aria-label={`${c.name} 연결 변수`}
                      value={c.variable ?? ''}
                      onChange={(e) => setMessage(setColumn(dataset.id, i, { variable: e.target.value || null }))}
                    >
                      <option value="">(비교 안 함)</option>
                      {entry.variables.map((v) => (
                        <option key={v.name} value={v.name}>
                          {v.label} ({v.unit})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <DraftNumber id={`val-scale-${i}`} label={`${c.name} 값 배율`} value={c.scale} onValue={(v) => setMessage(setColumn(dataset.id, i, { scale: v }))} />
                  </td>
                  <td className="muted">
                    {skipped === null ? '–' : skipped === 0 ? '없음' : `${ev?.aligned.outOfRange ?? 0}개 범위 밖${ev && ev.aligned.invalid > 0 ? `, ${ev.aligned.invalid}개 무효` : ''}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted">값 배율은 관측 값에 곱합니다(예: 실제 데이터가 천 맨데이면 1000).</p>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
    </section>
  )
}
