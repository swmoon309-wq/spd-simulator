import '@xyflow/react/dist/style.css'
import { useMemo, useState } from 'react'
import { Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import type { Loop } from '@spd/sd-engine'
import type { ModelDoc } from '../../lib/modelDoc'
import { analyzeDoc, causalGraph, describeLoop, filterLoops, LOOP_TYPE_LABEL, loopNames, POLARITY_MARK, type LoopFilter } from '../../lib/modelEdit/cldView'
import { KIND_LABEL, type VarKind } from '../../lib/modelEdit/commands'

type CNode = Node<{ label: string; kind: VarKind; dim: boolean; hot: boolean }, 'cn'>

function CausalNode({ data }: NodeProps<CNode>) {
  return (
    <div className={`dg-node dg-${data.kind}${data.hot ? ' selected' : ''}${data.dim ? ' cld-dim' : ''}`} role="group" aria-label={`${data.label} (${KIND_LABEL[data.kind]})`}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="dg-label">{data.label}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

type CEdgeData = { polarity: '+' | '-' | '?'; delayed: boolean; hot: boolean; dim: boolean }
function CausalEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<Edge<CEdgeData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const d = data as CEdgeData
  const color = d.polarity === '+' ? '#0a7d4b' : d.polarity === '-' ? '#b3261e' : '#b45309'
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: d.hot ? 3.2 : 1.5, opacity: d.dim ? 0.18 : 1, strokeDasharray: d.delayed ? '6 4' : undefined }} />
      <EdgeLabelRenderer>
        <div className={`dg-edge-label cld-sign${d.dim ? ' cld-dim' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, color }}>
          {POLARITY_MARK[d.polarity]}
          {d.delayed ? ' //' : ''}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

const nodeTypes = { cn: CausalNode }
const edgeTypes = { cl: CausalEdge }

/**
 * 인과 루프 화면(EDT-06, 설계 08의 10.2): 수식에서 **분석해** 만든 읽기 전용 뷰다(사용자가 그리지 않는다). 링크는 `+`(같은 방향)·`−`(반대 방향)·`?`(시점에 따라
 * 달라짐)로 표시하고 지연을 거치는 링크는 `//`, 루프는 링크 극성의 곱으로 강화(R)·균형(B)·극성 불명으로 나눈다. 극성은 기준 실행 근방에서의 수치적
 * 판단이라 모델 전체에서 성립한다는 보장이 없고 개념 모델의 CLD와 다르다는 한계를 화면에 적는다.
 */
export function CausalView({ doc, onSelect }: { doc: ModelDoc; onSelect(name: string): void }) {
  const result = useMemo(() => analyzeDoc(doc), [doc.def]) // eslint-disable-line react-hooks/exhaustive-deps
  const [filter, setFilter] = useState<LoopFilter>('all')
  const [picked, setPicked] = useState<number | null>(null)

  if (!result.ok) return <p className="notice error" role="alert">{result.message}</p>
  const analysis = result.analysis
  const names = loopNames(analysis.loops)
  const loops = filterLoops(analysis.loops, filter)
  const loop: Loop | undefined = analysis.loops.find((l) => l.id === picked)
  const hotNodes = new Set(loop?.nodes ?? [])
  const hotLinks = new Set(loop?.links ?? [])
  const graph = causalGraph(doc, analysis)
  const nodes: CNode[] = graph.nodes.map((n) => ({ id: n.id, type: 'cn', position: { x: n.x, y: n.y }, data: { label: n.id, kind: n.kind, dim: loop !== undefined && !hotNodes.has(n.id), hot: hotNodes.has(n.id) }, style: { width: n.kind === 'level' ? 150 : 130, height: n.kind === 'level' ? 56 : 44 }, draggable: false, connectable: false }))
  const edges: Edge[] = graph.edges.map((e) => ({
    id: `${e.id}#${e.index}`,
    source: e.from,
    target: e.to,
    type: 'cl',
    ariaLabel: `${e.from} → ${e.to} (${POLARITY_MARK[e.polarity]}${e.delayed ? ', 지연' : ''})`,
    data: { polarity: e.polarity, delayed: e.delayed, hot: hotLinks.has(e.index), dim: loop !== undefined && !hotLinks.has(e.index) },
    markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 }
  }))
  const count = (t: Loop['type']) => analysis.loops.filter((l) => l.type === t).length

  return (
    <section className="causal" aria-label="인과 루프">
      <p className="notice warning" role="note">
        <span className="notice-body">
          이 뷰는 모델의 수식에서 <strong>분석한</strong> 읽기 전용 그림입니다. 링크의 극성은 기준 실행(지금 상수 값)의 {analysis.samples}개 시점에서 입력을 ±1% 바꿔 출력이 같은 방향(+)·반대 방향(−)으로 움직이는지 본 <strong>수치적 판단</strong>이고(시점에 따라 달라지면 ?), 모델 전체에서 성립한다는 보장이 없습니다. 개념 모델의 인과 루프 다이어그램과 다릅니다. 지연 함수는 입력을 그대로 통과시켜 평가하므로 지연시간 자체의 영향은 링크로 나타나지 않습니다.
        </span>
      </p>
      <p className="muted">
        링크 {analysis.links.length}개(변화가 없어 표시하지 않은 것 {analysis.hidden}개) · 루프 {analysis.loops.length}개: 균형 {count('B')} · 강화 {count('R')} · 극성 불명 {count('?')}
        {analysis.truncated ? ' — 루프가 더 있지만 상한(200개)에서 멈췄습니다. 짧은 루프부터 보입니다.' : ''}
      </p>
      <div className="causal-layout">
        <div className="causal-loops">
          <div role="group" aria-label="루프 종류" className="subtabs">
            {(['all', 'B', 'R', '?'] as const).map((f) => (
              <button key={f} type="button" className={`subtab${filter === f ? ' active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'all' ? '모두' : f === 'B' ? '균형' : f === 'R' ? '강화' : '불명'}
              </button>
            ))}
          </div>
          {loops.length === 0 ? (
            <p className="muted">이 종류의 루프가 없습니다.</p>
          ) : (
            <ul className="loop-list">
              {loops.map((l) => (
                <li key={l.id}>
                  <button type="button" className={`var-item${picked === l.id ? ' selected' : ''}`} aria-pressed={picked === l.id} onClick={() => setPicked(picked === l.id ? null : l.id)}>
                    <strong className={`loop-${l.type === '?' ? 'u' : l.type.toLowerCase()}`}>{names.get(l.id)}</strong>
                    <span className="muted">
                      {LOOP_TYPE_LABEL[l.type]} · 길이 {l.length}
                      {l.delayed ? ' · 지연 있음' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loop && (
            <div className="loop-detail">
              <h4>
                {names.get(loop.id)} — {LOOP_TYPE_LABEL[loop.type]}
              </h4>
              <p className="mono" style={{ fontSize: 12 }}>
                {describeLoop(loop, analysis.links)}
              </p>
              <p className="muted">
                {loop.type === 'B' ? '음의 링크가 홀수 개라 균형(목표를 향해 되돌리는) 고리입니다.' : loop.type === 'R' ? '음의 링크가 짝수 개라 강화(스스로 키우는) 고리입니다.' : '극성이 시점에 따라 달라지는 링크가 있어 루프 종류를 정할 수 없습니다.'}
              </p>
              <ul className="sector-members">
                {loop.nodes.map((n) => (
                  <li key={n}>
                    <button type="button" className="link" onClick={() => onSelect(n)}>
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="causal-graph">
          <div className="diagram-wrap" aria-label="인과 링크 그림">
            <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} nodesFocusable edgesFocusable fitView minZoom={0.1} maxZoom={2} deleteKeyCode={null} proOptions={{ hideAttribution: true }}>
              <Background gap={24} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable ariaLabel="인과 링크 미니맵" />
            </ReactFlow>
          </div>
          <details>
            <summary>링크 표({analysis.links.length}개, 그림과 같은 값)</summary>
            <table className="var-table">
              <caption className="sr-only">인과 링크와 극성</caption>
              <thead>
                <tr>
                  <th scope="col">원인</th>
                  <th scope="col">결과</th>
                  <th scope="col">극성</th>
                  <th scope="col">근거</th>
                </tr>
              </thead>
              <tbody>
                {analysis.links.map((l, i) => (
                  <tr key={i} className={hotLinks.has(i) ? 'selected' : ''}>
                    <td>{l.from}</td>
                    <td>{l.to}</td>
                    <td>
                      {POLARITY_MARK[l.polarity]}
                      {l.delayed ? ' // (지연)' : ''}
                    </td>
                    <td className="muted">{l.kind === 'flow' ? (l.sense === 'in' ? 'Level의 유입' : 'Level의 유출') : `양 ${l.positive}회·음 ${l.negative}회(${analysis.samples}개 시점)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      </div>
    </section>
  )
}
