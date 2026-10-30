import { useState } from 'react'
import type { ModelDoc } from '../../lib/modelDoc'
import type { Analysis } from '../../lib/modelEdit/analysis'
import { KIND_LABEL, kindOf, referencesTo, type FieldEdit } from '../../lib/modelEdit/commands'
import { CommitInput } from './CommitInput'
import { FormulaEditor } from './FormulaEditor'

export interface PropertiesProps {
  doc: ModelDoc
  analysis: Analysis
  name: string
  onRename(to: string): string | null
  onField(edit: FieldEdit, key?: string): string | null
  onChangeKind(to: 'rate' | 'auxiliary'): void
  onDelete(replaceWithZero: boolean): string | null
  /** 변수가 속한 섹터(id)와 전체 섹터, 섹터 바꾸기 */
  sector: string | null
  sectors: { id: string; name: string }[]
  onAssignSector(sector: string | null): void
}

/** 선택한 변수의 모든 필드(설계 08의 9장 "속성"): 이름 바꾸기(참조 갱신), 단위, 값·수식, 유입·유출, 참조 목록, 삭제. */
export function Properties({ doc, analysis, name, onRename, onField, onChangeKind, onDelete, sector, sectors, onAssignSector }: PropertiesProps) {
  const k = kindOf(doc.def, name)
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null)
  if (!k) return <p className="muted">선택한 변수가 없습니다.</p>
  const d = doc.def
  const issues = analysis.byVariable.get(name) ?? []
  const forField = (field: string) => issues.filter((i) => i.field === field || (field === 'expr' && !i.field && i.range))
  const refs = referencesTo(doc, name)
  const unit = (k === 'constant' ? d.constants[name]?.unit : k === 'level' ? d.levels[name]?.unit : k === 'rate' ? d.rates[name]?.unit : d.auxiliaries[name]?.unit) ?? ''
  const startValue = analysis.start?.[name]
  const preview = (source: string) => {
    if (!analysis.start) return null
    const used = [...new Set(source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])].filter((n) => n in (analysis.start as Record<string, number>) && n !== name)
    return { own: startValue ?? null, refs: used.map((n) => [n, (analysis.start as Record<string, number>)[n] as number] as [string, number]) }
  }
  const flowChoices = [...Object.keys(d.rates), ...Object.keys(d.auxiliaries)]
  const level = d.levels[name]
  const toggle = (list: 'inflows' | 'outflows', flow: string, on: boolean) => {
    const cur = (level as NonNullable<typeof level>)[list]
    onField({ field: list, value: on ? [...cur, flow] : cur.filter((f) => f !== flow) })
  }

  return (
    <section className="props" aria-label={`${name} 속성`}>
      <h3>
        {name} <span className="muted">({KIND_LABEL[k]})</span>
      </h3>
      <div className="field-row">
        <label htmlFor="p-name">이름</label>
        <CommitInput id="p-name" label="변수 이름" value={name} onCommit={onRename} mono />
      </div>
      {(k === 'rate' || k === 'auxiliary') && (
        <div className="field-row">
          <label htmlFor="p-kind">종류</label>
          <select id="p-kind" value={k} onChange={(e) => onChangeKind(e.target.value as 'rate' | 'auxiliary')}>
            <option value="rate">Rate</option>
            <option value="auxiliary">Auxiliary</option>
          </select>
        </div>
      )}
      <div className="field-row">
        <label htmlFor="p-sector">섹터</label>
        <select id="p-sector" value={sector ?? ''} onChange={(e) => onAssignSector(e.target.value === '' ? null : e.target.value)}>
          <option value="">(없음)</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="p-unit">단위</label>
        <CommitInput id="p-unit" label="단위" value={unit} onCommit={(t) => onField({ field: 'unit', value: t })} />
      </div>
      {forField('unit').map((i, n) => (
        <p key={n} className={i.severity === 'error' ? 'field-error' : 'muted'} role={i.severity === 'error' ? 'alert' : undefined}>
          <span aria-hidden="true">{i.severity === 'error' ? '✖' : i.severity === 'warning' ? '⚠' : 'ⓘ'}</span> {i.message}
          {i.suggestion && (
            <button type="button" className="link" onClick={() => onField({ field: 'unit', value: i.suggestion as string })}>
              이 단위로 정하기({i.suggestion})
            </button>
          )}
        </p>
      ))}
      {k === 'constant' && (
        <>
          <div className="field-row">
            <label htmlFor="p-value">값</label>
            <CommitInput id="p-value" label="값" value={String(d.constants[name]?.value ?? '')} onCommit={(t) => (t.trim() === '' || !Number.isFinite(Number(t)) ? '숫자를 입력하세요.' : onField({ field: 'value', value: Number(t) }))} mono />
          </div>
          <div className="field-row">
            <label htmlFor="p-label">이름표</label>
            <CommitInput id="p-label" label="이름표(입력 화면에 보이는 이름)" value={d.constants[name]?.label ?? ''} onCommit={(t) => onField({ field: 'label', value: t })} placeholder="(선택)" />
          </div>
        </>
      )}
      {(k === 'rate' || k === 'auxiliary') && (
        <div className="field-block">
          <label htmlFor="p-expr">수식</label>
          <FormulaEditor id="p-expr" label={`${name} 수식`} value={(k === 'rate' ? d.rates[name]?.expr : d.auxiliaries[name]?.expr) ?? ''} onChange={(t) => onField({ field: 'expr', value: t }, `expr:${name}`)} issues={forField('expr')} kindOf={analysis.kindOf} variables={analysis.variables} preview={preview((k === 'rate' ? d.rates[name]?.expr : d.auxiliaries[name]?.expr) ?? '')} />
        </div>
      )}
      {k === 'level' && level && (
        <>
          <div className="field-block">
            <label htmlFor="p-init">초기값 수식</label>
            <FormulaEditor id="p-init" label={`${name} 초기값`} value={level.init} onChange={(t) => onField({ field: 'init', value: t }, `init:${name}`)} issues={forField('init')} kindOf={analysis.kindOf} variables={analysis.variables} preview={preview(level.init)} />
          </div>
          {(['inflows', 'outflows'] as const).map((list) => (
            <fieldset key={list} className="flow-set">
              <legend>{list === 'inflows' ? '유입(Level을 늘리는 흐름)' : '유출(Level을 줄이는 흐름)'}</legend>
              {flowChoices.length === 0 && <span className="muted">Rate나 Auxiliary를 먼저 더하세요.</span>}
              {flowChoices.map((f) => (
                <label key={f} className="check">
                  <input type="checkbox" checked={level[list].includes(f)} onChange={(e) => toggle(list, f, e.target.checked)} /> {f}
                </label>
              ))}
              {forField(list).map((i, n) => (
                <p key={n} className={i.severity === 'error' ? 'field-error' : 'muted'} role={i.severity === 'error' ? 'alert' : undefined}>
                  {i.message}
                </p>
              ))}
            </fieldset>
          ))}
        </>
      )}
      {issues.filter((i) => !i.range && !i.field).length > 0 && (
        <ul className="formula-issues" aria-label="이 변수의 문제">
          {issues.filter((i) => !i.range && !i.field).map((i, n) => (
            <li key={n} className={i.severity}>
              <span aria-hidden="true">{i.severity === 'error' ? '✖' : i.severity === 'warning' ? '⚠' : 'ⓘ'}</span> {i.message}
            </li>
          ))}
        </ul>
      )}
      {k !== 'level' && k !== 'rate' && k !== 'auxiliary' && startValue !== undefined && <p className="muted">시각 0의 값: {String(Number(startValue.toPrecision(6)))}</p>}
      <div className="refs">
        <h4>이 변수를 쓰는 곳 ({refs.length})</h4>
        {refs.length === 0 ? <p className="muted">쓰는 곳이 없습니다.</p> : <ul>{refs.map((r, i) => <li key={i}>{r.where}</li>)}</ul>}
      </div>
      <div className="props-actions">
        <button
          type="button"
          className="danger"
          onClick={() => {
            const problem = onDelete(false)
            setDeleteProblem(problem)
          }}
        >
          삭제
        </button>
        {deleteProblem && (
          <div role="alert" className="field-error">
            {deleteProblem}
            <div>
              <button type="button" onClick={() => setDeleteProblem(onDelete(true))}>
                참조를 0으로 바꾸고 지우기
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
