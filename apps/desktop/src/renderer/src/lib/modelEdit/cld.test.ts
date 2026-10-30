import { describe, expect, it } from 'vitest'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { setField, type EditResult } from './commands'
import { analyzeDoc, causalGraph, describeLoop, filterLoops, loopNames, POLARITY_MARK } from './cldView'
import { COL_W, ROW_H } from './layout'

const NOW = new Date('2026-10-23T00:00:00.000Z')
const docOf = (id: string): ModelDoc => {
  const v = validateModelDoc(docFromBuiltin(catalog.find((m) => m.id === id)!, { now: NOW, random: () => 0.3 }))
  if (!v.ok) throw new Error(v.message)
  return v.doc
}
const must = (r: EditResult): ModelDoc => {
  if (!r.ok) throw new Error(r.message)
  return r.doc
}
const ok = (d: ModelDoc, max?: number) => {
  const r = analyzeDoc(d, max)
  if (!r.ok) throw new Error(r.message)
  return r.analysis
}
const BUILTIN = catalog.filter((m) => m.category !== 'user').map((m) => [m.id] as const)

describe('인과 루프: 내장 모델 (M5 수용 기준)', () => {
  it('Brooks: 균형 고리 — 남은 요구사항 → 개발률 → 남은 요구사항, 신입 → 동화율 → 신입', () => {
    const a = ok(docOf('brooks'))
    expect(a.truncated).toBe(false)
    expect(a.loops.map((l) => l.type)).toEqual(['B', 'B'])
    const req = a.loops.find((l) => l.nodes.includes('requirements'))!
    expect(req.nodes.sort()).toEqual(['requirements', 'software_development_rate'])
    const links = a.links
    const pol = (from: string, to: string) => links.find((l) => l.from === from && l.to === to)?.polarity
    expect(pol('requirements', 'software_development_rate')).toBe('+') // 남은 일이 많을수록 개발률(최대 수용량 안에서) 큼
    expect(pol('software_development_rate', 'requirements')).toBe('-') // 개발하면 남은 일이 줄어든다
    expect(a.loops.find((l) => l.nodes.includes('assimilation_rate'))?.nodes.sort()).toEqual(['assimilation_rate', 'new_personnel'])
    // 책이 말한 Brooks 효과의 인과 링크: 신입이 늘면 훈련에 필요한 숙련 인원이 늘어 생산 능력이 준다
    expect(pol('new_personnel', 'experienced_needed_for_training')).toBe('+')
    expect(pol('experienced_needed_for_training', 'productive_capacity')).toBe('-')
    expect(pol('total_personnel', 'communication_overhead')).toBe('+')
    expect(pol('communication_overhead', 'potential_development_rate')).toBe('-') // 의사소통 오버헤드가 생산성을 깎는다
  })

  it('통합 프로젝트: 일정 압박이 든 균형 고리(지연 포함)와 강화 고리를 찾는다', () => {
    const a = ok(docOf('integrated-project'), 600)
    const sp = a.loops.filter((l) => l.nodes.includes('ctl_sched_pressure'))
    expect(sp.length).toBeGreaterThan(5)
    expect(sp.some((l) => l.type === 'B')).toBe(true)
    expect(sp.some((l) => l.type === 'R')).toBe(true)
    expect(sp.some((l) => l.type === 'B' && l.delayed)).toBe(true) // 인식 지연(SMOOTH)을 거치는 균형 고리
    expect(a.truncated).toBe(true) // 순환이 아주 많아 상한에서 멈춘다
  })

  it.each(BUILTIN)('내장 %s: 분석이 끝나고 링크의 끝점·루프 번호가 서로 맞다', (id) => {
    const doc = docOf(id)
    const a = ok(doc)
    expect(a.links.length).toBeGreaterThan(5)
    for (const l of a.links) {
      expect(kindOfName(doc, l.from), l.from).toBe(true)
      expect(kindOfName(doc, l.to), l.to).toBe(true)
      expect(['+', '-', '?']).toContain(l.polarity)
    }
    for (const lp of a.loops) lp.links.forEach((k, i) => expect([a.links[k]!.from, a.links[k]!.to]).toEqual([lp.nodes[i], lp.nodes[(i + 1) % lp.nodes.length]]))
    expect(a.loops.map((l) => l.length)).toEqual([...a.loops.map((l) => l.length)].sort((x, y) => x - y)) // 짧은 순서
  })

  it.each(BUILTIN)('내장 %s: 같은 모델은 같은 분석 결과다(결정적)', (id) => {
    const doc = docOf(id)
    expect(JSON.stringify(ok(doc))).toBe(JSON.stringify(ok(JSON.parse(JSON.stringify(doc)) as ModelDoc)))
  })

  it('분석은 읽기 전용이다: 모델 문서가 바뀌지 않는다', () => {
    const doc = docOf('brooks')
    const before = JSON.stringify(doc)
    ok(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

function kindOfName(doc: ModelDoc, n: string): boolean {
  return n in doc.def.constants || n in doc.def.levels || n in doc.def.rates || n in doc.def.auxiliaries
}

describe('인과 루프 화면 데이터', () => {
  it('링크에 나오는 변수만 그리고 층 배치는 겹치지 않는다', () => {
    const doc = docOf('brooks')
    const a = ok(doc)
    const g = causalGraph(doc, a)
    const ends = new Set(a.links.flatMap((l) => [l.from, l.to]))
    expect(g.nodes.map((n) => n.id).sort()).toEqual([...ends].sort())
    expect(g.edges).toHaveLength(a.links.length)
    const cells = new Set(g.nodes.map((n) => `${n.x},${n.y}`))
    expect(cells.size).toBe(g.nodes.length)
    for (const n of g.nodes) {
      expect(n.x % COL_W).toBe(0)
      expect(n.y % ROW_H).toBe(0)
    }
    expect(g.nodes.find((n) => n.id === 'requirements')?.kind).toBe('level')
    expect(g.nodes.find((n) => n.id === 'software_development_rate')?.kind).toBe('rate')
  })

  it('루프 이름은 종류별 번호이고 글로 풀어 쓴다(극성·지연 표시)', () => {
    const a = ok(docOf('brooks'))
    const names = loopNames(a.loops)
    expect([...names.values()]).toEqual(['B1', 'B2'])
    const text = describeLoop(a.loops.find((l) => l.nodes.includes('requirements'))!, a.links)
    expect(text).toMatch(/^(requirements —\(\+\)→ software_development_rate —\(−\)→ requirements|software_development_rate —\(−\)→ requirements —\(\+\)→ software_development_rate)$/)
    const integrated = ok(docOf('integrated-project'), 300)
    const delayed = integrated.loops.find((l) => l.delayed)!
    expect(describeLoop(delayed, integrated.links)).toContain('//')
    const mixed = loopNames(integrated.loops)
    expect(mixed.get(integrated.loops.find((l) => l.type === 'R')!.id)).toMatch(/^R\d+$/)
    expect(POLARITY_MARK['-']).toBe('−')
  })

  it('종류별로 거른다', () => {
    const a = ok(docOf('integrated-project'), 300)
    const all = a.loops.length
    expect(filterLoops(a.loops, 'all')).toHaveLength(all)
    expect(filterLoops(a.loops, 'B').every((l) => l.type === 'B')).toBe(true)
    expect(filterLoops(a.loops, 'R').length + filterLoops(a.loops, 'B').length + filterLoops(a.loops, '?').length).toBe(all)
  })

  it('수식을 고치면 분석이 따라간다(루프가 생기고 사라진다)', () => {
    const doc = docOf('brooks')
    const cut = must(setField(doc, 'software_development_rate', { field: 'expr', value: 'potential_development_rate' })) // requirements를 더 이상 읽지 않는다
    const a = ok(cut)
    expect(a.loops.some((l) => l.nodes.includes('requirements'))).toBe(false)
    expect(a.loops.map((l) => l.type)).toEqual(['B'])
  })

  it('컴파일되지 않는 모델은 이유를 돌려준다', () => {
    const bad = must(setField(docOf('brooks'), 'software_development_rate', { field: 'expr', value: 'nothing_here' }))
    const r = analyzeDoc(bad)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/오류가 있어 분석할 수 없습니다/)
  })
})
