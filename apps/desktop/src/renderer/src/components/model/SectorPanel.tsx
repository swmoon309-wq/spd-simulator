import { useState } from 'react'
import type { ModelDoc } from '../../lib/modelDoc'
import { sectorSummary } from '../../lib/modelEdit/layout'
import { sectorColor } from '../../lib/modelEdit/layout'
import { CommitInput } from './CommitInput'

export interface SectorPanelProps {
  doc: ModelDoc
  selected: string | null
  /** 섹터를 만든다(이름이 비면 자동). `members`를 주면 그 변수들을 넣는다. 거절되면 이유 */
  onAdd(name: string, members?: string[]): string | null
  onRename(id: string, name: string): string | null
  onColor(id: string, color: string | null): void
  onDelete(id: string): void
  onToggle(id: string): void
  /** 변수를 섹터에 넣거나(id) 뺀다(null) */
  onAssign(variable: string, sector: string | null): void
  onSelect(name: string): void
}

/**
 * 섹터 패널(EDT-07, 설계 08의 10.3): 섹터 만들기·이름·색·접기·지우기, 변수 넣고 빼기, 섹터 사이 연결 요약. 섹터는 계산에 영향이 없고 변수는 섹터 하나에만
 * 속한다. 다이어그램에서 하는 일은 모두 여기서도 할 수 있다.
 */
export function SectorPanel({ doc, selected, onAdd, onRename, onColor, onDelete, onToggle, onAssign, onSelect }: SectorPanelProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const summary = sectorSummary(doc)
  const sectors = doc.view.sectors
  const unassigned = [...Object.keys(doc.def.constants), ...Object.keys(doc.def.levels), ...Object.keys(doc.def.rates), ...Object.keys(doc.def.auxiliaries)].filter((v) => !sectors.some((s) => s.members.includes(v)))
  return (
    <section className="sector-panel" aria-label="섹터">
      <p className="muted">섹터는 변수를 의미 있는 묶음(인력, 생산, 통제 …)으로 나눕니다. 계산에는 영향이 없고, 다이어그램에서 묶어 접을 수 있습니다. 변수는 섹터 하나에만 속합니다.</p>
      <form
        className="field-row"
        onSubmit={(e) => {
          e.preventDefault()
          const err = onAdd(name)
          setError(err)
          if (!err) setName('')
        }}
      >
        <label htmlFor="sector-new">새 섹터</label>
        <input id="sector-new" type="text" value={name} placeholder="이름(비우면 자동)" onChange={(e) => setName(e.target.value)} maxLength={100} />
        <button type="submit">+ 섹터 추가</button>
        {selected && (
          <button type="button" className="link" title="고른 변수를 이 이름의 새 섹터로 묶습니다" onClick={() => setError(onAdd(name === '' ? `${selected}의 섹터` : name, [selected]))}>
            고른 변수({selected})로 새 섹터
          </button>
        )}
      </form>
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {sectors.length === 0 && <p className="muted">섹터가 없습니다.</p>}
      {sectors.map((s, i) => (
        <fieldset key={s.id} className="sector-item">
          <legend>
            <CommitInput label={`${s.name} 섹터 이름`} value={s.name} onCommit={(t) => onRename(s.id, t)} />
          </legend>
          <div className="field-row">
            <label>
              색 <input type="color" aria-label={`${s.name} 색`} value={sectorColor(i, s.color)} onChange={(e) => onColor(s.id, e.target.value)} />
            </label>
            <button type="button" onClick={() => onToggle(s.id)} aria-pressed={s.collapsed === true}>
              {s.collapsed ? '펼치기' : '접기'}
            </button>
            <button type="button" className="danger" onClick={() => onDelete(s.id)}>
              섹터 지우기(변수는 남습니다)
            </button>
            <span className="muted">변수 {s.members.length}개</span>
          </div>
          <ul className="sector-members">
            {s.members.map((m) => (
              <li key={m}>
                <button type="button" className="link" onClick={() => onSelect(m)}>
                  {m}
                </button>
                <button type="button" className="link" aria-label={`${m}을(를) ${s.name}에서 빼기`} onClick={() => onAssign(m, null)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <select aria-label={`${s.name}에 변수 넣기`} value="" onChange={(e) => e.target.value && onAssign(e.target.value, s.id)}>
            <option value="">변수 넣기…</option>
            {unassigned.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </fieldset>
      ))}
      <h4>섹터 사이 연결</h4>
      {summary.length === 0 ? (
        <p className="muted">섹터 사이를 잇는 연결이 없습니다.</p>
      ) : (
        <table className="var-table">
          <caption className="sr-only">섹터 사이 연결 요약</caption>
          <thead>
            <tr>
              <th scope="col">주는 섹터</th>
              <th scope="col">받는 섹터</th>
              <th scope="col">연결 수</th>
              <th scope="col">예</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={`${r.from}>${r.to}`}>
                <td>{r.fromName}</td>
                <td>{r.toName}</td>
                <td>{r.count}</td>
                <td className="muted">{r.examples.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
