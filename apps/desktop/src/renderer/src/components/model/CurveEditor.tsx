import { useRef, useState } from 'react'
import type { ModelDoc } from '../../lib/modelDoc'
import type { EditResult } from '../../lib/modelEdit/commands'
import { curveDomain, dragTarget, extensions, keyStep, makeScale, polyline } from '../../lib/modelEdit/curveView'
import { addTable, analyzeCurve, applyCurveShape, CURVE_SHAPES, deleteTable, findInlineGraphs, inlineToTables, insertTablePoint, removeTablePoint, renameTable, resampleTable, setTablePoint, setTableUnits, tableUsage } from '../../lib/modelEdit/tables'
import { CommitInput } from './CommitInput'

type Run = (label: string, command: (d: ModelDoc) => EditResult, key?: string) => string | null

const W = 520
const H = 280
const M = 34

/**
 * 그래프 함수 편집(EDT-04, 설계 08의 7장): 이름 있는 테이블의 점 표와 곡선 차트를 함께 보이고 한쪽을 고치면 다른 쪽이 바뀐다. 차트의 점은 끌거나 방향키로
 * 옮길 수 있고(값은 같은 표에도 있다 — 차트만 쓸 수 있는 편집은 없다), 범위 밖은 양 끝 값으로 고정된다(회색 연장선). 책 2.6.3의 권고(정규화, 기준점 1,
 * 단조)를 곡선 아래에 보인다. 인라인 GRAPH는 "테이블로 바꾸기"로 옮긴다.
 */
export function CurveEditor({ doc, selected, onSelect, run }: { doc: ModelDoc; selected: string | null; onSelect(name: string | null): void; run: Run }) {
  const names = Object.keys(doc.def.tables)
  const name = selected && selected in doc.def.tables ? selected : (names[0] ?? null)
  const inline = findInlineGraphs(doc.def)
  const [shape, setShape] = useState('linear-up')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const act = (e: string | null) => setError(e)

  return (
    <section className="curve-editor" aria-label="그래프 함수">
      <p className="muted">`GRAPH(x, 테이블이름)`이 쓰는 곡선입니다. 입력을 기준값에 대한 비로 정규화하고 기준점(x = 1)에서 1이 되게, 매끈한 단조 곡선으로 만드는 것을 책 2.6.3이 권합니다. 범위 밖의 입력은 양 끝 값으로 고정됩니다.</p>
      <div className="curve-layout">
        <div className="curve-list">
          <h4>테이블 ({names.length})</h4>
          <ul>
            {names.map((n) => (
              <li key={n}>
                <button type="button" className={`var-item${n === name ? ' selected' : ''}`} aria-pressed={n === name} onClick={() => onSelect(n)}>
                  <span className="var-name">{n}</span>
                  <span className="muted">{tableUsage(doc.def, n).length}곳</span>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="curve-add"
            onSubmit={(e) => {
              e.preventDefault()
              const err = run('테이블 추가', (d) => addTable(d, newName, shape))
              act(err)
              if (!err) setNewName('')
            }}
          >
            <input type="text" aria-label="새 테이블 이름" placeholder="이름(비우면 자동)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select aria-label="처음 곡선 모양" value={shape} onChange={(e) => setShape(e.target.value)}>
              {CURVE_SHAPES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button type="submit">+ 테이블</button>
          </form>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <h4>인라인 GRAPH ({inline.length})</h4>
          {inline.length === 0 ? (
            <p className="muted">테이블로 바꿀 인라인 GRAPH가 없습니다.</p>
          ) : (
            <>
              <p className="muted">`GRAPH(x, [x…], [y…])`는 표로 편집할 수 없습니다. 테이블로 바꾸면 값은 그대로이고 편집할 수 있습니다.</p>
              <ul className="inline-list">
                {[...new Set(inline.map((g) => g.variable))].map((v) => (
                  <li key={v}>
                    <code>{v}</code> ({inline.filter((g) => g.variable === v).length}곳){' '}
                    <button type="button" className="link" onClick={() => act(run('인라인 GRAPH를 테이블로', (d) => inlineToTables(d, v)))}>
                      표로 바꾸기
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => act(run('인라인 GRAPH를 모두 테이블로', (d) => inlineToTables(d)))}>
                모두 테이블로 바꾸기
              </button>
            </>
          )}
        </div>
        {name ? <TableEditor doc={doc} name={name} run={run} onSelect={onSelect} act={act} /> : <p className="muted">테이블이 없습니다. 왼쪽에서 더하세요.</p>}
      </div>
    </section>
  )
}

function TableEditor({ doc, name, run, onSelect, act }: { doc: ModelDoc; name: string; run: Run; onSelect(name: string | null): void; act(e: string | null): void }) {
  const t = doc.def.tables[name] as NonNullable<ModelDoc['def']['tables'][string]>
  const analysis = analyzeCurve(t)
  const used = tableUsage(doc.def, name)
  const [n, setN] = useState('11')
  const [curveShape, setCurveShape] = useState('s-up')
  const num = (text: string): number | null => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : null)
  const setPoint = (i: number, patch: { x?: number; y?: number }, key: string, sort = false) => run('곡선 점 수정', (d) => setTablePoint(d, name, i, patch, sort), key)

  return (
    <div className="curve-detail">
      <h3>{name}</h3>
      <div className="field-row">
        <label htmlFor="c-name">이름</label>
        <CommitInput id="c-name" label="테이블 이름" value={name} mono onCommit={(to) => run('테이블 이름 바꾸기', (d) => renameTable(d, name, to)) ?? onSelect(to)} />
        <span className="muted">쓰는 곳: {used.length === 0 ? '없음' : used.join(', ')}</span>
      </div>
      <div className="field-row">
        <label htmlFor="c-xu">입력 단위</label>
        <CommitInput id="c-xu" label="입력(x) 단위" className="narrow" value={t.xUnit ?? ''} placeholder="무차원" onCommit={(u) => run('테이블 단위', (d) => setTableUnits(d, name, { xUnit: u }))} />
        <label htmlFor="c-yu">출력 단위</label>
        <CommitInput id="c-yu" label="출력(y) 단위" className="narrow" value={t.yUnit ?? ''} placeholder="무차원" onCommit={(u) => run('테이블 단위', (d) => setTableUnits(d, name, { yUnit: u }))} />
      </div>

      <CurveChart doc={doc} name={name} run={run} />

      {analysis.advice.length > 0 && (
        <ul className="formula-issues" aria-label="곡선 권고">
          {analysis.advice.map((a, i) => (
            <li key={i} className={a.severity}>
              <span aria-hidden="true">{a.severity === 'warning' ? '⚠' : 'ⓘ'}</span> {a.message}
            </li>
          ))}
        </ul>
      )}

      <table className="var-table curve-points">
        <caption className="sr-only">곡선의 점 {t.x.length}개(차트와 같은 값)</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">x</th>
            <th scope="col">y</th>
            <th scope="col">
              <span className="sr-only">편집</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {t.x.map((x, i) => (
            <tr key={i}>
              <th scope="row">{i + 1}</th>
              <td>
                <CommitInput label={`${i + 1}번째 점의 x`} className="narrow" mono value={String(x)} onCommit={(s) => (num(s) === null ? '숫자를 입력하세요.' : (setPoint(i, { x: num(s) as number }, `pt:${name}:${i}:x`, true) ?? undefined))} />
              </td>
              <td>
                <CommitInput label={`${i + 1}번째 점의 y`} className="narrow" mono value={String(t.y[i])} onCommit={(s) => (num(s) === null ? '숫자를 입력하세요.' : (setPoint(i, { y: num(s) as number }, `pt:${name}:${i}:y`) ?? undefined))} />
              </td>
              <td>
                <button type="button" className="link" aria-label={`${i + 1}번째 점 뒤에 점 더하기`} onClick={() => act(run('곡선 점 더하기', (d) => insertTablePoint(d, name, i)))}>
                  + 뒤에 점
                </button>{' '}
                <button type="button" className="link" disabled={t.x.length <= 2} aria-label={`${i + 1}번째 점 지우기`} onClick={() => act(run('곡선 점 지우기', (d) => removeTablePoint(d, name, i)))}>
                  지우기
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="field-row">
        <label htmlFor="c-n">균등 분할</label>
        <input id="c-n" type="text" className="tiny" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} aria-label="균등 분할 점 개수" />
        <button type="button" onClick={() => act(run('곡선 균등 분할', (d) => resampleTable(d, name, Number(n))))}>
          점 {n}개로 나누기
        </button>
        <label htmlFor="c-shape">곡선 모양</label>
        <select id="c-shape" value={curveShape} onChange={(e) => setCurveShape(e.target.value)}>
          {CURVE_SHAPES.map((s) => (
            <option key={s.id} value={s.id} title={s.description}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => act(run('곡선 모양 적용', (d) => applyCurveShape(d, name, curveShape)))} title="점을 통째로 이 모양으로 바꿉니다(형태만이고 수치는 직접 조정하세요)">
          모양으로 바꾸기
        </button>
      </div>
      <div className="props-actions">
        <button
          type="button"
          className="danger"
          onClick={() => {
            const err = run('테이블 지우기', (d) => deleteTable(d, name))
            act(err)
            if (!err) onSelect(null)
          }}
        >
          테이블 지우기
        </button>
      </div>
    </div>
  )
}

/** 곡선 차트(SVG): 점을 끌거나 방향키로 옮긴다. 범위 밖 연장선은 회색, 기준선 x=1·y=1은 점선. */
function CurveChart({ doc, name, run }: { doc: ModelDoc; name: string; run: Run }) {
  const t = doc.def.tables[name] as NonNullable<ModelDoc['def']['tables'][string]>
  const d = curveDomain(t)
  const s = makeScale(d, W, H, M)
  const ext = extensions(t, d, s)
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const gap = (d.x1 - d.x0) / 1000

  const move = (i: number, x: number, y: number) => {
    const p = dragTarget(t, i, x, y, gap)
    void run('곡선 점 끌기', (doc2) => setTablePoint(doc2, name, i, p), `drag:${name}:${i}`)
  }
  const fromEvent = (e: React.PointerEvent): { x: number; y: number } => {
    const r = (svg.current as SVGSVGElement).getBoundingClientRect()
    return { x: s.ix(((e.clientX - r.left) / r.width) * W), y: s.iy(((e.clientY - r.top) / r.height) * H) }
  }
  const ticks = (lo: number, hi: number): number[] => {
    const span = hi - lo
    const raw = span / 5
    const mag = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) as number
    const out: number[] = []
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toPrecision(10)))
    return out
  }
  return (
    <svg
      ref={svg}
      className="curve-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={`${name} 곡선(점 ${t.x.length}개, 아래 표와 같은 값). 점을 끌거나 방향키로 옮길 수 있습니다.`}
      onPointerMove={(e) => {
        if (drag === null) return
        const p = fromEvent(e)
        move(drag, p.x, p.y)
      }}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      {ticks(d.x0, d.x1).map((v) => (
        <g key={`x${v}`}>
          <line x1={s.sx(v)} x2={s.sx(v)} y1={M} y2={H - M} className="grid" />
          <text x={s.sx(v)} y={H - M + 14} textAnchor="middle">
            {v}
          </text>
        </g>
      ))}
      {ticks(d.y0, d.y1).map((v) => (
        <g key={`y${v}`}>
          <line x1={M} x2={W - M} y1={s.sy(v)} y2={s.sy(v)} className="grid" />
          <text x={M - 4} y={s.sy(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {d.x0 < 1 && d.x1 > 1 && <line x1={s.sx(1)} x2={s.sx(1)} y1={M} y2={H - M} className="ref" />}
      {d.y0 < 1 && d.y1 > 1 && <line x1={M} x2={W - M} y1={s.sy(1)} y2={s.sy(1)} className="ref" />}
      <path d={ext.left} className="outside" />
      <path d={ext.right} className="outside" />
      <path d={polyline(t, s)} className="line" />
      {t.x.map((x, i) => (
        <circle
          key={i}
          cx={s.sx(x)}
          cy={s.sy(t.y[i] as number)}
          r={drag === i ? 7 : 5}
          className="pt"
          tabIndex={0}
          role="slider"
          aria-label={`${i + 1}번째 점`}
          aria-valuetext={`x ${x}, y ${t.y[i]}`}
          aria-valuenow={t.y[i] as number}
          onPointerDown={(e) => {
            ;(e.target as Element).setPointerCapture?.(e.pointerId)
            setDrag(i)
          }}
          onKeyDown={(e) => {
            const dx = keyStep(d, 'x', e.shiftKey)
            const dy = keyStep(d, 'y', e.shiftKey)
            const map: Record<string, [number, number]> = { ArrowLeft: [-dx, 0], ArrowRight: [dx, 0], ArrowUp: [0, dy], ArrowDown: [0, -dy] }
            const m = map[e.key]
            if (!m) return
            e.preventDefault()
            move(i, (x as number) + m[0], (t.y[i] as number) + m[1])
          }}
        >
          <title>{`${i + 1}번째 점: x ${x}, y ${t.y[i]}`}</title>
        </circle>
      ))}
    </svg>
  )
}
