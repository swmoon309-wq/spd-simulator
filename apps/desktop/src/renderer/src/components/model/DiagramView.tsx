import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo } from 'react'
import { Background, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, MiniMap, Position, ReactFlow, useEdgesState, useNodesState, type Connection, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react'
import type { ModelDoc } from '../../lib/modelDoc'
import type { Analysis } from '../../lib/modelEdit/analysis'
import { KIND_LABEL, type VarKind } from '../../lib/modelEdit/commands'
import { buildDiagram, type Diagram, type DiagramEdge, type DiagramNode } from '../../lib/modelEdit/layout'

/**
 * 모델 다이어그램(EDT-01, 설계 08의 9.1, D1: React Flow). 표기는 책 2.6.1의 기본 표기를 따른다: Level 사각형, Rate 밸브(나비 모양), 원천·싱크 구름,
 * Auxiliary 원, 상수 작은 마름모, 정보선은 가는 화살표, 지연 정보선은 `//`, 흐름선은 굵은 선. **연결선은 수식에서 파생**하며 선을 그리는 것은 수식을 고치는
 * 편집 보조다. 이 캔버스에서만 할 수 있는 편집은 없다(표·목록·속성에서 같은 일을 할 수 있다). 노드는 키보드로 초점을 옮겨 선택한다.
 */

type VarNodeData = { label: string; kind: DiagramNode['kind']; unit?: string; count?: number; hasError: boolean; hasWarning: boolean; sectorColor?: string }
type VarNode = Node<VarNodeData, 'var'>
type BoxNode = Node<{ name: string; color: string; members: number }, 'box'>

const MARK: Record<string, string> = { level: 'L', rate: 'R', auxiliary: 'A', constant: 'C' }

function VarNodeView({ data, selected }: NodeProps<VarNode>) {
  const kind = data.kind
  const cls = `dg-node dg-${kind}${selected ? ' selected' : ''}${data.hasError ? ' has-error' : data.hasWarning ? ' has-warning' : ''}`
  const kindName = kind === 'cloud-source' ? '원천' : kind === 'cloud-sink' ? '싱크' : kind === 'sector' ? '섹터' : KIND_LABEL[kind as VarKind]
  return (
    <div className={cls} role="group" aria-label={`${data.label} (${kindName})${data.count !== undefined ? ` 변수 ${data.count}개` : ''}${data.hasError ? ' 오류 있음' : ''}`} style={data.sectorColor ? { borderColor: data.sectorColor } : undefined}>
      <Handle type="target" position={Position.Left} />
      {kind === 'cloud-source' || kind === 'cloud-sink' ? (
        <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true">
          <path d="M12 26a8 8 0 0 1 0-14 10 10 0 0 1 19-2 9 9 0 0 1 3 17z" fill="var(--panel)" stroke="var(--muted)" strokeWidth="1.5" />
        </svg>
      ) : kind === 'rate' ? (
        <div className="dg-valve">
          <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true">
            <path d="M1 1 L13 10 L1 19 Z M25 1 L13 10 L25 19 Z" fill="currentColor" />
          </svg>
          <span>{data.label}</span>
        </div>
      ) : kind === 'sector' ? (
        <div className="dg-sector-summary">
          <strong>{data.label}</strong>
          <span className="muted">변수 {data.count}개 (접힘)</span>
        </div>
      ) : (
        <span className="dg-label">
          {kind !== 'level' && <span className="dg-mark">{MARK[kind]}</span>}
          {data.label}
          {data.unit && kind === 'level' && <span className="muted"> [{data.unit}]</span>}
        </span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

function BoxNodeView({ data }: NodeProps<BoxNode>) {
  return (
    <div className="dg-box" style={{ borderColor: data.color, background: `color-mix(in srgb, ${data.color} 7%, transparent)` }} aria-hidden="true">
      <span style={{ color: data.color }}>{data.name}</span>
    </div>
  )
}

type DgEdgeData = { kind: DiagramEdge['kind']; count: number }
function DgEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<Edge<DgEdgeData>>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const kind = data?.kind ?? 'info'
  const style: React.CSSProperties =
    kind === 'flow'
      ? { stroke: selected ? 'var(--accent)' : 'var(--text)', strokeWidth: 4, opacity: 0.85 }
      : kind === 'delayed'
        ? { stroke: selected ? 'var(--accent)' : 'var(--muted)', strokeWidth: 1.5, strokeDasharray: '6 4' }
        : kind === 'init'
          ? { stroke: selected ? 'var(--accent)' : 'var(--border)', strokeWidth: 1.2, strokeDasharray: '2 4' }
          : { stroke: selected ? 'var(--accent)' : 'var(--muted)', strokeWidth: 1.5 }
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={14} />
      {(kind === 'delayed' || (data?.count ?? 1) > 1) && (
        <EdgeLabelRenderer>
          <div className="dg-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {kind === 'delayed' ? '//' : ''}
            {(data?.count ?? 1) > 1 ? ` ×${data?.count}` : ''}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { var: VarNodeView, box: BoxNodeView }
const edgeTypes = { dg: DgEdge }

const EDGE_LABEL: Record<DiagramEdge['kind'], string> = { info: '정보', delayed: '지연 정보', init: '초기값', flow: '흐름' }

/** 한 연결선의 사람이 읽는 설명(접근성 이름, 선택 안내). */
export function describeEdge(e: Pick<DiagramEdge, 'from' | 'to' | 'kind' | 'sense' | 'count'>): string {
  const base = `${e.from} → ${e.to} (${EDGE_LABEL[e.kind]}${e.kind === 'flow' ? (e.sense === 'out' ? ', 유출' : ', 유입') : ''})`
  return e.count > 1 ? `${base} ×${e.count}` : base
}

export interface DiagramViewProps {
  doc: ModelDoc
  analysis: Analysis
  selected: string | null
  selectedEdge: string | null
  onSelect(name: string | null): void
  onSelectEdge(id: string | null): void
  /** 노드를 끌어 놓았다(변수의 새 위치) */
  onMoved(positions: Record<string, { x: number; y: number }>): void
  /** `from`에서 `to`로 선을 그렸다 */
  onConnect(from: string, to: string): void
  onAutoLayout(): void
  onToggleSector(id: string): void
}

export function DiagramView({ doc, analysis, selected, selectedEdge, onSelect, onSelectEdge, onMoved, onConnect, onAutoLayout, onToggleSector }: DiagramViewProps) {
  const diagram: Diagram = useMemo(() => buildDiagram(doc), [doc])
  const flow = useMemo(() => toFlow(diagram, doc, analysis, selected, selectedEdge), [diagram, doc, analysis, selected, selectedEdge])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(flow.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges)
  useEffect(() => setNodes(flow.nodes), [flow.nodes, setNodes])
  useEffect(() => setEdges(flow.edges), [flow.edges, setEdges])

  const onConnectCb = useCallback((c: Connection) => c.source && c.target && onConnect(c.source, c.target), [onConnect])

  return (
    <div className="diagram-wrap" aria-label="모델 다이어그램">
      <div className="diagram-toolbar">
        <button type="button" onClick={onAutoLayout} title="저장된 위치를 지우고 흐름 방향으로 다시 배치합니다">
          자동 배치
        </button>
        <span className="muted">
          표기: ▭ Level · ⋈ Rate(밸브) · ○ Auxiliary · ◇ 상수 · ☁ 원천/싱크 · 굵은 선 흐름 · 가는 화살표 정보 · 점선 // 지연. 노드를 끌어 위치를 바꾸고, 노드 끝점을 끌어 다른 노드에 놓으면 수식에 연결을 만듭니다. 같은 편집을 표·속성에서도 할 수 있습니다.
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectCb}
        onNodeClick={(_, n) => {
          if (n.type === 'var') {
            const id = n.id
            if (id.startsWith('sector:')) onToggleSector(id.slice(7))
            else if (!id.startsWith('cloud:')) onSelect(id)
          }
          onSelectEdge(null)
        }}
        onEdgeClick={(_, e) => {
          onSelectEdge(e.id)
          onSelect(null)
        }}
        onPaneClick={() => {
          onSelect(null)
          onSelectEdge(null)
        }}
        onNodeDragStop={(_, __, dragged) => {
          const moved: Record<string, { x: number; y: number }> = {}
          for (const n of dragged) if (n.type === 'var' && !n.id.startsWith('cloud:') && !n.id.startsWith('sector:')) moved[n.id] = { x: n.position.x, y: n.position.y }
          if (Object.keys(moved).length > 0) onMoved(moved)
        }}
        nodesFocusable
        edgesFocusable
        fitView
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable ariaLabel="모델 전체 미니맵" />
      </ReactFlow>
    </div>
  )
}

/** 순수 그림(`Diagram`)을 React Flow의 노드·선으로 바꾼다. */
function toFlow(diagram: Diagram, doc: ModelDoc, analysis: Analysis, selected: string | null, selectedEdge: string | null): { nodes: Node[]; edges: Edge[] } {
  const colorOf = new Map(diagram.sectors.map((s) => [s.id, s.color]))
  const unitOf = (name: string): string | undefined => doc.def.levels[name]?.unit
  const boxes: BoxNode[] = diagram.sectors.map((s) => ({ id: `box:${s.id}`, type: 'box', position: { x: s.x, y: s.y }, data: { name: s.name, color: s.color, members: s.members }, style: { width: s.w, height: s.h }, draggable: false, selectable: false, focusable: false, zIndex: -1 }))
  const vars: VarNode[] = diagram.nodes.map((n) => {
    const issues = analysis.byVariable.get(n.id) ?? []
    return {
      id: n.id,
      type: 'var',
      position: { x: n.x, y: n.y },
      selected: selected === n.id,
      data: { label: n.label, kind: n.kind, ...(unitOf(n.id) ? { unit: unitOf(n.id) as string } : {}), ...(n.count !== undefined ? { count: n.count } : {}), hasError: issues.some((i) => i.severity === 'error'), hasWarning: issues.some((i) => i.severity === 'warning'), ...(n.sector && colorOf.get(n.sector) ? { sectorColor: colorOf.get(n.sector) as string } : {}) },
      draggable: !n.id.startsWith('cloud:') && !n.id.startsWith('sector:'),
      style: { width: n.w, height: n.h }
    }
  })
  const edges: Edge[] = diagram.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: 'dg',
    selected: selectedEdge === e.id,
    ariaLabel: describeEdge(e),
    data: { kind: e.kind, count: e.count },
    markerEnd: { type: MarkerType.ArrowClosed, width: e.kind === 'flow' ? 14 : 10, height: e.kind === 'flow' ? 14 : 10 }
  }))
  return { nodes: [...boxes, ...vars], edges }
}
