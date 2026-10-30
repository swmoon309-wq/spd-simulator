import type { ModelDoc } from '../../lib/modelDoc'
import type { Analysis } from '../../lib/modelEdit/analysis'
import { KIND_LABEL } from '../../lib/modelEdit/commands'
import { CommitInput } from './CommitInput'

/**
 * 변수를 행으로 한 표(설계 08의 9장): 이름·종류·단위·값(수식)을 한눈에 보고 빠르게 고친다. 값 칸은 상수는 숫자, Level은 초기값 수식, Rate·Auxiliary는
 * 수식이다. 입력은 Enter나 포커스를 잃을 때 반영된다. 이름과 흐름 같은 나머지는 오른쪽 속성 칸에서 고친다.
 */
export function VariableTable({ doc, analysis, selected, onSelect, onField }: { doc: ModelDoc; analysis: Analysis; selected: string | null; onSelect(name: string): void; onField(name: string, field: 'unit' | 'value' | 'expr' | 'init', text: string): string | null }) {
  const d = doc.def
  const valueOf = (name: string, kind: string): { field: 'value' | 'expr' | 'init'; text: string } => {
    if (kind === 'constant') return { field: 'value', text: String(d.constants[name]?.value ?? '') }
    if (kind === 'level') return { field: 'init', text: d.levels[name]?.init ?? '' }
    return { field: 'expr', text: (kind === 'rate' ? d.rates[name]?.expr : d.auxiliaries[name]?.expr) ?? '' }
  }
  const unitOf = (name: string, kind: string): string => (kind === 'constant' ? d.constants[name]?.unit : kind === 'level' ? d.levels[name]?.unit : kind === 'rate' ? d.rates[name]?.unit : d.auxiliaries[name]?.unit) ?? ''
  return (
    <div className="var-table-wrap">
      <table className="var-table">
        <caption className="sr-only">변수 표</caption>
        <thead>
          <tr>
            <th scope="col">이름</th>
            <th scope="col">종류</th>
            <th scope="col">단위</th>
            <th scope="col">값·수식</th>
            <th scope="col">흐름</th>
            <th scope="col">문제</th>
          </tr>
        </thead>
        <tbody>
          {analysis.variables.map((v) => {
            const val = valueOf(v.name, v.kind)
            const issues = analysis.byVariable.get(v.name) ?? []
            const err = issues.filter((i) => i.severity === 'error').length
            const level = d.levels[v.name]
            return (
              <tr key={v.name} className={selected === v.name ? 'selected' : ''}>
                <th scope="row">
                  <button type="button" className="link" aria-pressed={selected === v.name} onClick={() => onSelect(v.name)}>
                    {v.name}
                  </button>
                </th>
                <td>{KIND_LABEL[v.kind]}</td>
                <td>
                  <CommitInput label={`${v.name} 단위`} value={unitOf(v.name, v.kind)} onCommit={(t) => onField(v.name, 'unit', t)} className="narrow" />
                </td>
                <td>
                  <CommitInput label={`${v.name} ${v.kind === 'constant' ? '값' : v.kind === 'level' ? '초기값' : '수식'}`} value={val.text} onCommit={(t) => onField(v.name, val.field, t)} mono />
                </td>
                <td className="muted">{level ? `+${level.inflows.join(', ') || '–'} / −${level.outflows.join(', ') || '–'}` : ''}</td>
                <td>{issues.length > 0 ? <span className={err > 0 ? 'bad' : 'warn'}>{err > 0 ? `✖ ${err}` : `⚠ ${issues.length}`}</span> : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
