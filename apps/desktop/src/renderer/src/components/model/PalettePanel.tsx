import { useMemo, useState } from 'react'
import type { ModelDoc } from '../../lib/modelDoc'
import { KIND_LABEL, variableNames, kindOf, type EditResult } from '../../lib/modelEdit/commands'
import { allTemplates, insertTemplate, TEMPLATE_GROUP_LABEL, type Template, type TemplateGroup } from '../../lib/modelEdit/templates'

type Run = (label: string, command: (d: ModelDoc) => EditResult) => string | null

/**
 * 구조 팔레트(EDT-05, 설계 08의 10.1): 책 3.3의 일반 흐름 과정 9종, 3.4의 기반 구조 일부, 라이브러리 모델을 접두사를 붙여 현재 모델에 삽입한다.
 * 입력 포트는 기존 변수에 연결할 수 있고, 삽입 전에 이름 충돌을 미리 알리며, 삽입 직후 구조 오류·단위 오류 수를 알린다.
 */
export function PalettePanel({ doc, run }: { doc: ModelDoc; run: Run }) {
  const templates = useMemo(allTemplates, [])
  const [id, setId] = useState(templates[0]?.id ?? '')
  const t = templates.find((x) => x.id === id) as Template
  const [prefix, setPrefix] = useState(t.prefix)
  const [asSector, setAsSector] = useState(true)
  const [connections, setConnections] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const groups = (Object.keys(TEMPLATE_GROUP_LABEL) as TemplateGroup[]).map((g) => ({ g, items: templates.filter((x) => x.group === g) })).filter((x) => x.items.length > 0)
  const pick = (next: Template) => {
    setId(next.id)
    setPrefix(next.prefix)
    setConnections({})
    setMessage(null)
  }
  const options = { prefix, connections: Object.fromEntries(Object.entries(connections).filter(([, v]) => v !== '')), asSector }
  const preview = useMemo(() => insertTemplate(doc, t, options), [doc, t, prefix, connections, asSector]) // eslint-disable-line react-hooks/exhaustive-deps
  const e = t.elements
  const counts = { constants: Object.keys(e.constants).length, levels: Object.keys(e.levels).length, rates: Object.keys(e.rates).length, auxiliaries: Object.keys(e.auxiliaries).length, tables: Object.keys(e.tables).length }
  const existing = variableNames(doc.def)

  return (
    <section className="palette" aria-label="구조 팔레트">
      <div className="palette-layout">
        <nav className="palette-list" aria-label="템플릿 목록">
          {groups.map(({ g, items }) => (
            <div key={g} role="group" aria-label={TEMPLATE_GROUP_LABEL[g]}>
              <h4>{TEMPLATE_GROUP_LABEL[g]}</h4>
              <ul>
                {items.map((x) => (
                  <li key={x.id}>
                    <button type="button" className={`var-item${x.id === id ? ' selected' : ''}`} aria-pressed={x.id === id} onClick={() => pick(x)}>
                      <span className="var-name">{x.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="palette-detail">
          <h3>{t.title}</h3>
          <p className="muted">{t.source}</p>
          <p>{t.description}</p>
          <p className="muted">
            상수 {counts.constants} · Level {counts.levels} · Rate {counts.rates} · Auxiliary {counts.auxiliaries}
            {counts.tables > 0 ? ` · 테이블 ${counts.tables}` : ''}
            {(e.invariants?.length ?? 0) > 0 ? ` · 불변식 ${e.invariants?.length}` : ''}
          </p>
          <div className="field-row">
            <label htmlFor="pal-prefix">접두사</label>
            <input id="pal-prefix" type="text" className="mono" value={prefix} onChange={(ev) => setPrefix(ev.target.value)} aria-invalid={!preview.ok} />
            <label className="check">
              <input type="checkbox" checked={asSector} onChange={(ev) => setAsSector(ev.target.checked)} /> 삽입한 변수를 섹터로 묶기
            </label>
          </div>
          {t.ports.filter((p) => p.role === 'input').length > 0 && (
            <fieldset className="flow-set">
              <legend>입력 포트(기존 변수에 연결하면 그 변수를 대신 씁니다)</legend>
              {t.ports
                .filter((p) => p.role === 'input')
                .map((p) => (
                  <div key={p.name} className="field-row">
                    <label htmlFor={`port-${p.name}`}>
                      <code>{p.name}</code>
                    </label>
                    <select id={`port-${p.name}`} value={connections[p.name] ?? ''} onChange={(ev) => setConnections({ ...connections, [p.name]: ev.target.value })}>
                      <option value="">새로 만들기(기본값)</option>
                      {existing.map((v) => (
                        <option key={v} value={v}>
                          {v} ({KIND_LABEL[kindOf(doc.def, v) as 'constant']})
                        </option>
                      ))}
                    </select>
                    <span className="muted">{p.hint}</span>
                  </div>
                ))}
            </fieldset>
          )}
          {t.ports.filter((p) => p.role === 'output').length > 0 && (
            <p className="muted">
              출력 포트: {t.ports.filter((p) => p.role === 'output').map((p) => `${prefix}${p.name}(${p.hint})`).join(', ')} — 삽입한 뒤 다른 수식이 이 변수를 쓰게 하면 연결됩니다.
            </p>
          )}
          {!preview.ok ? (
            <p role="alert" className="field-error">
              {preview.message}
            </p>
          ) : (
            <p className="muted">삽입하면 변수 {preview.inserted.length}개가 더해집니다. 시간 설정은 지금 모델의 것을 유지합니다.</p>
          )}
          <div className="props-actions">
            <button
              type="button"
              className="primary"
              disabled={!preview.ok}
              onClick={() => {
                const err = run('구조 삽입', (d) => insertTemplate(d, t, options))
                setMessage(err ? { ok: false, text: err } : { ok: true, text: preview.ok ? preview.note : '' })
              }}
            >
              삽입
            </button>
          </div>
          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={message.ok ? 'muted' : 'field-error'}>
              {message.text}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
