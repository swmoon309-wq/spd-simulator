import { analyzeCausality, ModelError, ExprError, type CausalAnalysis, type CausalLink, type Loop } from '@spd/sd-engine'
import type { ModelDoc } from '../modelDoc'
import { kindOf, type VarKind } from './commands'
import { layeredLayout } from './layout'

/**
 * 인과 루프 화면(EDT-06)에 쓰는 순수 함수: 분석 실행, 그림 데이터, 루프 이름·설명. 분석은 읽기 전용이며 모델을 바꾸지 않는다(설계 08의 10.2).
 */
export type CausalResult = { ok: true; analysis: CausalAnalysis } | { ok: false; message: string }

/** 기준 실행(상수의 현재 값)으로 모델의 인과 링크와 루프를 분석한다. 모델에 오류가 있어 컴파일되지 않으면 이유를 돌려준다. */
export function analyzeDoc(doc: ModelDoc, maxLoops = 200): CausalResult {
  try {
    const overrides = Object.fromEntries(Object.entries(doc.def.constants).map(([n, c]) => [n, c.value]))
    return { ok: true, analysis: analyzeCausality(doc.def, { overrides, maxLoops }) }
  } catch (e) {
    if (e instanceof ModelError || e instanceof ExprError || e instanceof Error) return { ok: false, message: `모델에 오류가 있어 분석할 수 없습니다: ${e.message}` }
    return { ok: false, message: '모델을 분석할 수 없습니다.' }
  }
}

export interface CausalNode {
  id: string
  kind: VarKind
  x: number
  y: number
}

export interface CausalEdge {
  id: string
  from: string
  to: string
  polarity: CausalLink['polarity']
  delayed: boolean
  kind: CausalLink['kind']
  /** `analysis.links`의 번호 */
  index: number
}

/** 링크에 나오는 변수와 선을 그림 데이터로 만든다(층 배치, 같은 입력이면 같은 배치). */
export function causalGraph(doc: ModelDoc, analysis: CausalAnalysis): { nodes: CausalNode[]; edges: CausalEdge[] } {
  const names = [...new Set(analysis.links.flatMap((l) => [l.from, l.to]))]
  const pos = layeredLayout(names, analysis.links)
  return {
    nodes: names.map((id) => ({ id, kind: (kindOf(doc.def, id) ?? 'auxiliary') as VarKind, x: (pos.get(id) as { x: number; y: number }).x, y: (pos.get(id) as { x: number; y: number }).y })),
    edges: analysis.links.map((l, index) => ({ id: `${l.from}>${l.to}`, from: l.from, to: l.to, polarity: l.polarity, delayed: l.delayed, kind: l.kind, index }))
  }
}

export const POLARITY_MARK: Record<CausalLink['polarity'], string> = { '+': '+', '-': '−', '?': '?' }
export const LOOP_TYPE_LABEL: Record<Loop['type'], string> = { R: '강화(R)', B: '균형(B)', '?': '극성 불명' }

/** 루프의 이름: 종류별 번호(`B1`, `R2`, 극성 불명은 `U1`). */
export function loopNames(loops: Loop[]): Map<number, string> {
  const counts: Record<string, number> = {}
  const out = new Map<number, string>()
  for (const l of loops) {
    const k = l.type === '?' ? 'U' : l.type
    counts[k] = (counts[k] ?? 0) + 1
    out.set(l.id, `${k}${counts[k]}`)
  }
  return out
}

/** `a —(+)→ b —(−)→ a`처럼 루프를 글로 풀어 쓴다(지연 링크는 `//`). */
export function describeLoop(loop: Loop, links: CausalLink[]): string {
  const parts = loop.links.map((k, i) => {
    const l = links[k] as CausalLink
    return `${loop.nodes[i]} —(${POLARITY_MARK[l.polarity]}${l.delayed ? ' //' : ''})→`
  })
  return `${parts.join(' ')} ${loop.nodes[0]}`
}

export type LoopFilter = 'all' | 'R' | 'B' | '?'

export const filterLoops = (loops: Loop[], f: LoopFilter): Loop[] => (f === 'all' ? loops : loops.filter((l) => l.type === f))
