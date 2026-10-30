import { useState } from 'react'
import type { Analysis } from '../../lib/modelEdit/analysis'
import { KIND_LABEL, type VarKind } from '../../lib/modelEdit/commands'

const ORDER: VarKind[] = ['constant', 'level', 'rate', 'auxiliary']
const MARK: Record<VarKind, string> = { constant: 'C', level: 'L', rate: 'R', auxiliary: 'A' }

/**
 * 변수 목록(설계 08의 9장): 종류별 묶음, 검색, 문제 표시, 변수 추가. 캔버스를 쓰지 못하는 사용자의 주 경로이므로 모든 항목이 버튼이고 키보드로
 * 탐색한다(M3 다이어그램이 생겨도 이 목록에서 하는 편집은 그대로 가능하다).
 */
export function VariableList({ analysis, selected, onSelect, onAdd }: { analysis: Analysis; selected: string | null; onSelect(name: string): void; onAdd(kind: VarKind): void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  return (
    <section className="var-list" aria-label="변수 목록">
      <input type="search" aria-label="변수 검색" placeholder="변수 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="var-add" role="group" aria-label="변수 추가">
        {ORDER.map((k) => (
          <button key={k} type="button" onClick={() => onAdd(k)} title={`${KIND_LABEL[k]} 추가`}>
            + {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {ORDER.map((kind) => {
        const items = analysis.variables.filter((v) => v.kind === kind && (q === '' || v.name.toLowerCase().includes(q)))
        if (items.length === 0) return null
        return (
          <div key={kind} role="group" aria-label={KIND_LABEL[kind]}>
            <h3>
              {KIND_LABEL[kind]} <span className="muted">({items.length})</span>
            </h3>
            <ul>
              {items.map((v) => {
                const issues = analysis.byVariable.get(v.name) ?? []
                const err = issues.some((i) => i.severity === 'error')
                return (
                  <li key={v.name}>
                    <button type="button" className={`var-item${selected === v.name ? ' selected' : ''}`} aria-pressed={selected === v.name} onClick={() => onSelect(v.name)}>
                      <span className={`var-kind kind-${kind}`} aria-hidden="true">
                        {MARK[kind]}
                      </span>
                      <span className="var-name">{v.name}</span>
                      {issues.length > 0 && (
                        <span className={err ? 'bad' : 'warn'} role="img" aria-label={`${err ? '오류' : '경고'} ${issues.length}건`}>
                          {err ? '✖' : '⚠'}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
      {analysis.variables.length === 0 && <p className="muted">변수가 없습니다. 위 버튼으로 더하세요.</p>}
    </section>
  )
}
