import type { ModelDef } from '@spd/sd-engine'
import type { ModelDoc } from '../modelDoc'
import { deriveConnectors, type Connector, type ConnectorKind } from './connectors'
import type { VarKind } from './commands'

/**
 * 다이어그램의 좌표 계산(설계 08의 9.1). React Flow든 다른 캔버스든 **좌표·연결 파생·접기는 순수 함수**로 분리해 시험한다. 자동 배치는 단순한 층
 * 배치다: 흐름 방향을 왼쪽에서 오른쪽으로(되먹임 간선은 뒤로 돌려 무시), 한 칸(열, 행)에 노드 하나라서 **노드가 겹치지 않고** 같은 입력은 같은
 * 배치가 나온다.
 */

export type DiagramNodeKind = VarKind | 'cloud-source' | 'cloud-sink' | 'sector'

export const NODE_SIZE: Record<DiagramNodeKind, { w: number; h: number }> = {
  constant: { w: 130, h: 34 },
  level: { w: 150, h: 56 },
  rate: { w: 130, h: 44 },
  auxiliary: { w: 130, h: 44 },
  'cloud-source': { w: 44, h: 34 },
  'cloud-sink': { w: 44, h: 34 },
  sector: { w: 190, h: 72 }
}

export const COL_W = 230
export const ROW_H = 96

export interface DiagramNode {
  /** 변수 이름, `cloud:src:<Rate>`, `cloud:sink:<Rate>`, `sector:<id>` */
  id: string
  kind: DiagramNodeKind
  label: string
  x: number
  y: number
  w: number
  h: number
  /** 속한 섹터 id(변수만) */
  sector?: string
  /** 접힌 섹터의 요약 노드일 때: 안에 든 변수 수 */
  count?: number
}

export interface DiagramEdge {
  id: string
  from: string
  to: string
  kind: ConnectorKind
  sense?: 'in' | 'out'
  /** 접힌 섹터 때문에 여러 선을 하나로 합친 개수(1이면 원래 선) */
  count: number
}

export interface SectorBox {
  id: string
  name: string
  color: string
  x: number
  y: number
  w: number
  h: number
  members: number
  collapsed: boolean
}

export interface Diagram {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  /** 펼쳐진 섹터의 배경 상자(접힌 섹터는 `nodes`의 요약 노드로 나온다) */
  sectors: SectorBox[]
}

export const SECTOR_COLORS = ['#2563eb', '#b45309', '#0f766e', '#9333ea', '#be185d', '#4d7c0f', '#0369a1', '#a16207']
export const sectorColor = (index: number, wanted?: string): string => wanted ?? (SECTOR_COLORS[index % SECTOR_COLORS.length] as string)

const cloudSrc = (rate: string) => `cloud:src:${rate}`
const cloudSink = (rate: string) => `cloud:sink:${rate}`
const sectorId = (id: string) => `sector:${id}`

interface Raw {
  names: string[]
  kinds: Map<string, DiagramNodeKind>
  edges: Connector[]
}

/** 변수 노드와 구름(원천·싱크)을 더한 그래프. 구름은 Level과 연결되지 않은 쪽의 Rate에 붙인다. */
function rawGraph(def: ModelDef, connectors: Connector[]): Raw {
  const names: string[] = [...Object.keys(def.constants), ...Object.keys(def.levels), ...Object.keys(def.rates), ...Object.keys(def.auxiliaries)]
  const kinds = new Map<string, DiagramNodeKind>()
  for (const n of Object.keys(def.constants)) kinds.set(n, 'constant')
  for (const n of Object.keys(def.levels)) kinds.set(n, 'level')
  for (const n of Object.keys(def.rates)) kinds.set(n, 'rate')
  for (const n of Object.keys(def.auxiliaries)) kinds.set(n, 'auxiliary')
  const edges = [...connectors]
  const hasOutflowTo = new Set(connectors.filter((c) => c.kind === 'flow' && c.sense === 'in').map((c) => c.from)) // Rate가 어떤 Level로 들어간다
  const hasInflowFrom = new Set(connectors.filter((c) => c.kind === 'flow' && c.sense === 'out').map((c) => c.to)) // Rate가 어떤 Level에서 나온다
  for (const rate of Object.keys(def.rates)) {
    const anyFlow = hasOutflowTo.has(rate) || hasInflowFrom.has(rate)
    if (!anyFlow) continue // 흐름에 쓰이지 않는 Rate에는 구름을 붙이지 않는다
    if (!hasInflowFrom.has(rate)) {
      names.push(cloudSrc(rate))
      kinds.set(cloudSrc(rate), 'cloud-source')
      edges.push({ from: cloudSrc(rate), to: rate, kind: 'flow', sense: 'out' })
    }
    if (!hasOutflowTo.has(rate)) {
      names.push(cloudSink(rate))
      kinds.set(cloudSink(rate), 'cloud-sink')
      edges.push({ from: rate, to: cloudSink(rate), kind: 'flow', sense: 'in' })
    }
  }
  return { names, kinds, edges }
}

/**
 * 일반 그래프의 층 배치(한 칸에 노드 하나): 간선 방향을 왼쪽에서 오른쪽으로 하고(되먹임 간선은 뒤로 돌려 무시) 같은 입력이면 같은 배치다.
 * 다이어그램의 자동 배치와 인과 루프 화면이 함께 쓴다. `sectorOf`는 같은 섹터를 한 덩어리로 정렬하는 순위(작을수록 앞).
 */
export function layeredLayout(names: string[], edges: { from: string; to: string }[], sectorOf: (n: string) => number = () => 0): Map<string, { x: number; y: number }> {
  const order = new Map(names.map((n, i) => [n, i]))
  // 되먹임 간선 제거: 정의 순서로 깊이 우선 탐색하며 스택에 있는 노드로 돌아가는 간선을 뺀다
  const out = new Map<string, string[]>(names.map((n) => [n, []]))
  for (const e of edges) if (order.has(e.from) && order.has(e.to) && e.from !== e.to) out.get(e.from)?.push(e.to)
  const state = new Map<string, 0 | 1 | 2>()
  const dag = new Map<string, string[]>(names.map((n) => [n, []]))
  const visit = (n: string): void => {
    state.set(n, 1)
    for (const m of out.get(n) ?? []) {
      if (state.get(m) === 1) continue // 되먹임
      dag.get(n)?.push(m)
      if (!state.has(m)) visit(m)
    }
    state.set(n, 2)
  }
  for (const n of names) if (!state.has(n)) visit(n)

  // 최장 경로 층. 들어오는 간선이 없는 노드(상수 등)는 쓰는 쪽 바로 앞 층으로 당긴다
  const preds = new Map<string, string[]>(names.map((n) => [n, []]))
  for (const [n, ms] of dag) for (const m of ms) preds.get(m)?.push(n)
  const layer = new Map<string, number>()
  const depth = (n: string): number => {
    const known = layer.get(n)
    if (known !== undefined) return known
    layer.set(n, 0) // 순환 방지(되먹임은 이미 뺐다)
    const ps = preds.get(n) ?? []
    const d = ps.length === 0 ? 0 : Math.max(...ps.map(depth)) + 1
    layer.set(n, d)
    return d
  }
  for (const n of names) depth(n)
  for (const n of names) {
    if ((preds.get(n) ?? []).length === 0 && (dag.get(n) ?? []).length > 0) {
      const next = Math.min(...(dag.get(n) as string[]).map((m) => layer.get(m) as number))
      layer.set(n, Math.max(0, next - 1))
    }
  }

  // 층마다 행 배정: 섹터 → 앞 층 이웃 행의 평균 → 정의 순서
  const byLayer = new Map<number, string[]>()
  for (const n of names) byLayer.set(layer.get(n) as number, [...(byLayer.get(layer.get(n) as number) ?? []), n])
  const row = new Map<string, number>()
  const pos = new Map<string, { x: number; y: number }>()
  for (const L of [...byLayer.keys()].sort((a, b) => a - b)) {
    const members = byLayer.get(L) as string[]
    const bary = (n: string): number => {
      const rows = (preds.get(n) ?? []).filter((p) => row.has(p)).map((p) => row.get(p) as number)
      return rows.length === 0 ? Number.MAX_SAFE_INTEGER : rows.reduce((a, b) => a + b, 0) / rows.length
    }
    const sorted = [...members].sort((a, b) => sectorOf(a) - sectorOf(b) || bary(a) - bary(b) || (order.get(a) as number) - (order.get(b) as number))
    sorted.forEach((n, i) => {
      row.set(n, i)
      pos.set(n, { x: L * COL_W, y: i * ROW_H })
    })
  }
  return pos
}

/** 한 칸에 노드 하나인 자동 배치. 변수·구름 노드의 좌상단 좌표를 돌려준다. */
export function autoPositions(def: ModelDef, sectors: { id: string; members: string[] }[] = []): Map<string, { x: number; y: number }> {
  const g = rawGraph(def, deriveConnectors(def))
  const sectorIndex = new Map<string, number>()
  sectors.forEach((s, i) => s.members.forEach((m) => sectorIndex.set(m, i)))
  // 구름은 그 Rate와 같은 섹터로 본다
  const sectorOf = (n: string): number => {
    const m = /^cloud:(?:src|sink):(.*)$/.exec(n)
    return sectorIndex.get(m ? (m[1] as string) : n) ?? 999
  }
  return layeredLayout(g.names, g.edges, sectorOf)
}

/**
 * 모델 문서에서 그릴 그림을 만든다. 저장된 위치(`view.positions`)가 있으면 그대로, 없는 노드는 자동 배치 위치를 쓴다. **접힌 섹터는 요약 노드 하나**로
 * 바뀌고 밖과의 연결만 남는다(합친 선의 개수 표시, 같은 섹터 안의 선은 사라진다). 순수 함수이며 입력이 같으면 같은 그림이다.
 */
export function buildDiagram(doc: ModelDoc): Diagram {
  const def = doc.def
  const sectors = doc.view.sectors
  const g = rawGraph(def, deriveConnectors(def))
  const auto = autoPositions(def, sectors)
  const sectorOfVar = new Map<string, string>()
  for (const s of sectors) for (const m of s.members) if (g.kinds.has(m) && !sectorOfVar.has(m)) sectorOfVar.set(m, s.id)
  const owner = (id: string): string | undefined => {
    const m = /^cloud:(?:src|sink):(.*)$/.exec(id)
    return sectorOfVar.get(m ? (m[1] as string) : id)
  }

  const nodes: DiagramNode[] = g.names.map((id) => {
    const kind = g.kinds.get(id) as DiagramNodeKind
    const size = NODE_SIZE[kind]
    const saved = doc.view.positions[id]
    const p = saved ?? (auto.get(id) as { x: number; y: number })
    const sector = owner(id)
    return { id, kind, label: kind === 'cloud-source' ? '원천' : kind === 'cloud-sink' ? '싱크' : id, x: p.x, y: p.y, w: size.w, h: size.h, ...(sector ? { sector } : {}) }
  })

  const collapsed = new Set(sectors.filter((s) => s.collapsed === true).map((s) => s.id))
  const boxes: SectorBox[] = []
  const visible: DiagramNode[] = []
  const hidden = new Map<string, string>() // 숨겨진 노드 → 요약 노드 id
  sectors.forEach((s, index) => {
    const inside = nodes.filter((n) => n.sector === s.id)
    if (inside.length === 0) return
    const minX = Math.min(...inside.map((n) => n.x))
    const minY = Math.min(...inside.map((n) => n.y))
    const maxX = Math.max(...inside.map((n) => n.x + n.w))
    const maxY = Math.max(...inside.map((n) => n.y + n.h))
    const color = sectorColor(index, s.color)
    if (collapsed.has(s.id)) {
      const size = NODE_SIZE.sector
      visible.push({ id: sectorId(s.id), kind: 'sector', label: s.name, x: Math.round((minX + maxX) / 2 - size.w / 2), y: Math.round((minY + maxY) / 2 - size.h / 2), w: size.w, h: size.h, count: inside.filter((n) => n.kind !== 'cloud-source' && n.kind !== 'cloud-sink').length, sector: s.id })
      for (const n of inside) hidden.set(n.id, sectorId(s.id))
      boxes.push({ id: s.id, name: s.name, color, x: minX, y: minY, w: maxX - minX, h: maxY - minY, members: inside.length, collapsed: true })
    } else {
      const pad = 20
      boxes.push({ id: s.id, name: s.name, color, x: minX - pad, y: minY - pad - 22, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 + 22, members: inside.length, collapsed: false })
    }
  })
  for (const n of nodes) if (!hidden.has(n.id)) visible.push(n)

  const merged = new Map<string, DiagramEdge>()
  for (const e of g.edges) {
    const from = hidden.get(e.from) ?? e.from
    const to = hidden.get(e.to) ?? e.to
    if (from === to) continue
    const key = `${e.kind}:${from}>${to}`
    const prev = merged.get(key)
    if (prev) prev.count++
    else merged.set(key, { id: key, from, to, kind: e.kind, ...(e.sense ? { sense: e.sense } : {}), count: 1 })
  }
  return { nodes: visible, edges: [...merged.values()], sectors: boxes.filter((b) => !b.collapsed) }
}

/** 섹터 사이의 연결 요약(설계 08의 10.3, 책 2.6.1.1의 주요 흐름 체인과 섹터 식별): 어느 섹터가 어느 섹터에 정보·물질을 주는지. */
export interface SectorLink {
  from: string
  to: string
  fromName: string
  toName: string
  count: number
  /** 연결된 변수 쌍(앞 몇 개) */
  examples: string[]
}

export const NO_SECTOR = ''

export function sectorSummary(doc: ModelDoc): SectorLink[] {
  const names = new Map<string, string>([[NO_SECTOR, '(섹터 없음)'], ...doc.view.sectors.map((s) => [s.id, s.name] as [string, string])])
  const of = new Map<string, string>()
  for (const s of doc.view.sectors) for (const m of s.members) if (!of.has(m)) of.set(m, s.id)
  const links = new Map<string, SectorLink>()
  for (const c of deriveConnectors(doc.def)) {
    const a = of.get(c.from) ?? NO_SECTOR
    const b = of.get(c.to) ?? NO_SECTOR
    if (a === b) continue
    const key = `${a}>${b}`
    const l = links.get(key) ?? { from: a, to: b, fromName: names.get(a) as string, toName: names.get(b) as string, count: 0, examples: [] }
    l.count++
    if (l.examples.length < 4) l.examples.push(`${c.from} → ${c.to}`)
    links.set(key, l)
  }
  return [...links.values()].sort((x, y) => x.fromName.localeCompare(y.fromName, 'ko') || x.toName.localeCompare(y.toName, 'ko'))
}
