import { getEntry } from '../catalog'
import { useAppStore } from '../stores/appStore'

/** 가져온 기준 행동 목록: 표시 여부, 연결할 모델 변수, 삭제. */
export function ReferencePanel() {
  const modelId = useAppStore((s) => s.modelId)
  const references = useAppStore((s) => s.references)
  const toggle = useAppStore((s) => s.toggleReference)
  const setVariable = useAppStore((s) => s.setReferenceVariable)
  const remove = useAppStore((s) => s.removeReference)
  const clear = useAppStore((s) => s.clearReferences)
  const entry = getEntry(modelId)

  if (references.length === 0) return null
  return (
    <section className="run-table" aria-label="기준 행동 목록">
      <div className="run-table-head">
        <h2>기준 행동 (가져온 데이터)</h2>
        <button type="button" className="link" onClick={clear}>
          모두 지우기
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">표시</th>
            <th scope="col">파일 · 열</th>
            <th scope="col">연결할 변수</th>
            <th scope="col" className="num">
              점
            </th>
            <th scope="col">
              <span className="sr-only">삭제</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {references.map((r) => {
            const label = `${r.fileName} ${r.column}`
            return (
              <tr key={r.id} className={r.visible ? '' : 'dim'}>
                <td>
                  <input type="checkbox" checked={r.visible} onChange={() => toggle(r.id)} aria-label={`${label} 표시`} />
                </td>
                <td>
                  <span className="muted">{r.fileName} · </span>
                  {r.column}
                </td>
                <td>
                  <select
                    value={r.variable ?? ''}
                    onChange={(e) => setVariable(r.id, e.target.value === '' ? null : e.target.value)}
                    aria-label={`${label} 연결할 변수`}
                  >
                    <option value="">연결 안 함</option>
                    {entry.variables.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.label} ({v.unit})
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">{r.points.length.toLocaleString('ko-KR')}</td>
                <td>
                  <button type="button" className="link" onClick={() => remove(r.id)} aria-label={`${label} 삭제`}>
                    삭제
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
