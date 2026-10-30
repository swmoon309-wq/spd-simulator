import { createRuntime, type Runtime } from '../expr'
import { compileModel } from '../model/compile'
import type { ModelDef } from '../model/schema'
import { Rng } from '../rng'
import { runModel } from '../runner/simulation'

/**
 * 수식에서 분석한 인과 링크와 되먹임 루프(설계 08의 10.2, EDT-06). **읽기 전용 분석**이다(사용자가 그리지 않는다).
 *
 * - **링크 극성**(책 2.5.2.1 Step 3: 원인을 늘릴 때 결과가 같은 방향인가): 기준 실행의 여러 시점에서 입력 변수를 상대 ±1%(0이면 작은 절대값) 바꾸고
 *   출력 변수의 수식을 **다시 평가**해 부호를 본다. 모두 같은 부호면 `+`/`−`, 섞이면 `?`(비단조·상태 의존), 모든 시점에서 변화가 없으면 링크를 표시하지
 *   않는다. SMOOTH·DELAY는 입력을 그대로 통과시켜(초기화 모드) 평가하므로 지연을 거치는 링크도 극성을 얻고 `delayed`로 표시한다(`//`).
 * - **Level의 흐름**은 `Rate → Level`을 `+`(유입)·`−`(유출) 링크로 본다.
 * - **루프**는 링크 그래프의 단순 순환이다. **루프 극성 = 링크 극성의 곱**: 음의 링크가 홀수면 균형(B), 짝수면 강화(R), `?`가 있으면 극성 불명(책 Step 4).
 * - **한계**: 극성은 기준 실행 근방에서의 수치적 판단이라 모델 전체에서 성립한다는 보장이 없다. 개념 모델의 CLD와는 다르다.
 */
export type Polarity = '+' | '-' | '?'

export interface CausalLink {
  from: string
  to: string
  polarity: Polarity
  /** 지연 함수(SMOOTH·DELAY)를 거치는 링크 */
  delayed: boolean
  /** `info`: 수식 참조. `flow`: Level의 유입·유출(`Rate → Level`) */
  kind: 'info' | 'flow'
  sense?: 'in' | 'out'
  /** 양의 영향·음의 영향을 본 시점 수(`?` 판단의 근거) */
  positive: number
  negative: number
}

export interface Loop {
  /** 1부터, 짧은 순서 */
  id: number
  /** 루프를 이루는 변수(순환 순서, 처음 변수가 가장 앞 번호) */
  nodes: string[]
  /** `CausalAnalysis.links`의 번호(`nodes[i] → nodes[i+1]`) */
  links: number[]
  /** R 강화, B 균형, ? 극성 불명 */
  type: 'R' | 'B' | '?'
  length: number
  /** 지연 링크가 있는 루프 */
  delayed: boolean
}

export interface CausalAnalysis {
  links: CausalLink[]
  loops: Loop[]
  /** 루프가 더 있지만 상한 때문에 멈췄다 */
  truncated: boolean
  /** 모든 시점에서 변화가 없어 표시하지 않은 링크의 수 */
  hidden: number
  /** 평가한 시점 수 */
  samples: number
}

export interface CausalOptions {
  /** 상수 덮어쓰기(기준 실행의 입력) */
  overrides?: Record<string, number>
  /** 극성을 볼 시점 수(기본 10) */
  samples?: number
  /** 찾을 루프의 최대 개수(기본 200) */
  maxLoops?: number
  seed?: number
}

const REL = 0.01
const TINY = 1e-12

/** 모델 정의의 인과 링크와 루프를 분석한다. 모델이 컴파일되지 않으면 예외를 던진다. */
export function analyzeCausality(def: ModelDef, options: CausalOptions = {}): CausalAnalysis {
  const model = compileModel(def)
  const overrides = options.overrides ?? {}
  const seed = options.seed ?? 1
  const result = runModel(model, { overrides, seed })
  const n = result.time.length
  const wanted = Math.max(2, Math.min(options.samples ?? 10, n))
  const idx = [...new Set(Array.from({ length: wanted }, (_, i) => Math.round((i * (n - 1)) / (wanted - 1))))]

  const names = model.names
  const slotOf = model.slotOf
  const rt: Runtime = createRuntime({ slots: names.length, store: model.store, dt: result.meta.dt, seed })
  const constants = new Map(model.constants.map((c) => [c.name, overrides[c.name] ?? c.value]))
  const setState = (k: number) => {
    for (const name of names) {
      const slot = slotOf.get(name) as number
      const series = result.series[name]
      rt.values[slot] = series ? (series[k] as number) : (constants.get(name) as number)
    }
    rt.time = result.time[k] as number
    rt.initializing = true // SMOOTH·DELAY는 입력을 그대로 통과시킨다
  }
  const evalFlow = (flow: (typeof model.flows)[number], overrideSlot?: number, overrideValue?: number): number => {
    rt.rng = new Rng(seed) // 같은 난수열로 평가해 차이가 입력에서만 오게 한다
    const keep = overrideSlot === undefined ? 0 : (rt.values[overrideSlot] as number)
    if (overrideSlot !== undefined) rt.values[overrideSlot] = overrideValue as number
    const v = flow.expr.eval(rt)
    if (overrideSlot !== undefined) rt.values[overrideSlot] = keep
    return v
  }
  const scaleOf = (name: string): number => {
    const s = result.series[name]
    let m = 0
    if (s) for (const v of s) m = Math.max(m, Math.abs(v))
    else m = Math.abs(constants.get(name) ?? 0)
    return m > 0 ? m : 1
  }

  const links: CausalLink[] = []
  let hidden = 0
  // 수식 참조 링크: 입력 u → 출력 v(Rate·Auxiliary)
  for (const flow of model.flows) {
    const algebraic = new Set(flow.expr.algebraicDeps)
    const deps = [...new Set([...flow.expr.algebraicDeps, ...flow.expr.delayedDeps])].filter((d) => d !== flow.name)
    for (const u of deps) {
      const slot = slotOf.get(u) as number
      let pos = 0
      let neg = 0
      for (const k of idx) {
        setState(k)
        const base = rt.values[slot] as number
        const step = Math.abs(base) > 0 ? Math.abs(base) * REL : REL * scaleOf(u)
        const up = evalFlow(flow, slot, base + step)
        const down = evalFlow(flow, slot, base - step)
        const delta = up - down
        const tol = TINY + 1e-9 * Math.max(Math.abs(up), Math.abs(down))
        if (!Number.isFinite(delta) || Math.abs(delta) <= tol) continue
        if (delta > 0) pos++
        else neg++
      }
      if (pos === 0 && neg === 0) {
        hidden++
        continue
      }
      links.push({ from: u, to: flow.name, polarity: pos > 0 && neg > 0 ? '?' : pos > 0 ? '+' : '-', delayed: !algebraic.has(u), kind: 'info', positive: pos, negative: neg })
    }
  }
  // Level의 흐름: Rate → Level, 유입 +, 유출 −
  for (const level of Object.keys(def.levels)) {
    const l = def.levels[level] as { inflows: string[]; outflows: string[] }
    const seen = new Set<string>()
    for (const f of [...l.inflows, ...l.outflows]) {
      if (seen.has(f)) continue
      seen.add(f)
      const both = l.inflows.includes(f) && l.outflows.includes(f)
      const inflow = l.inflows.includes(f)
      links.push({ from: f, to: level, polarity: both ? '?' : inflow ? '+' : '-', delayed: false, kind: 'flow', sense: inflow ? 'in' : 'out', positive: inflow ? 1 : 0, negative: inflow ? 0 : 1 })
    }
  }

  const { loops, truncated } = findLoops(links, options.maxLoops ?? 200)
  return { links, loops, truncated, hidden, samples: idx.length }
}

/** 링크 그래프의 단순 순환을 짧은 것부터 최대 `max`개 찾는다. 상한에 걸리면 `truncated`. */
export function findLoops(links: CausalLink[], max = 200): { loops: Loop[]; truncated: boolean } {
  const nodes = [...new Set(links.flatMap((l) => [l.from, l.to]))]
  const index = new Map(nodes.map((n, i) => [n, i]))
  const adj: { to: number; link: number }[][] = nodes.map(() => [])
  links.forEach((l, i) => adj[index.get(l.from) as number]?.push({ to: index.get(l.to) as number, link: i }))

  // 강한 연결 요소(Tarjan, 반복형): 순환은 한 요소 안에서만 생긴다
  const comp = new Array<number>(nodes.length).fill(-1)
  const low = new Array<number>(nodes.length).fill(0)
  const num = new Array<number>(nodes.length).fill(-1)
  const onStack = new Array<boolean>(nodes.length).fill(false)
  const stack: number[] = []
  let counter = 0
  let comps = 0
  for (let root = 0; root < nodes.length; root++) {
    if (num[root] !== -1) continue
    const work: { v: number; i: number }[] = [{ v: root, i: 0 }]
    num[root] = low[root] = counter++
    stack.push(root)
    onStack[root] = true
    while (work.length > 0) {
      const top = work[work.length - 1] as { v: number; i: number }
      const edges = adj[top.v] as { to: number; link: number }[]
      if (top.i < edges.length) {
        const w = (edges[top.i++] as { to: number }).to
        if (num[w] === -1) {
          num[w] = low[w] = counter++
          stack.push(w)
          onStack[w] = true
          work.push({ v: w, i: 0 })
        } else if (onStack[w]) low[top.v] = Math.min(low[top.v] as number, num[w] as number)
      } else {
        work.pop()
        const parent = work[work.length - 1]
        if (parent) low[parent.v] = Math.min(low[parent.v] as number, low[top.v] as number)
        if (low[top.v] === num[top.v]) {
          for (;;) {
            const w = stack.pop() as number
            onStack[w] = false
            comp[w] = comps
            if (w === top.v) break
          }
          comps++
        }
      }
    }
  }

  const found: { nodes: number[]; links: number[] }[] = []
  let truncated = false
  const CAP_STEPS = 600_000
  let steps = 0
  // 길이를 늘려 가며(반복 심화) 찾는다: 상한에 걸려도 남는 것이 가장 짧은 순환이다. 시작 노드 s에서 번호가 s보다 큰 노드만 지나 s로 돌아온다(각 순환을 한 번만 찾는다).
  const compSize = new Map<number, number>()
  for (const c of comp) compSize.set(c, (compSize.get(c) ?? 0) + 1)
  const longest = Math.max(0, ...compSize.values())
  const enough = () => found.length > max
  search: for (let L = 2; L <= longest; L++) {
    for (let s = 0; s < nodes.length; s++) {
      if ((compSize.get(comp[s] as number) as number) < L) continue
      const path: number[] = [s]
      const pathLinks: number[] = []
      const onPath = new Set<number>([s])
      const dfs = (v: number): boolean => {
        for (const e of adj[v] as { to: number; link: number }[]) {
          if (comp[e.to] !== comp[s]) continue
          if (++steps > CAP_STEPS) {
            truncated = true
            return false
          }
          if (e.to === s) {
            if (path.length === L) {
              found.push({ nodes: [...path], links: [...pathLinks, e.link] })
              if (enough()) return false
            }
          } else if (e.to > s && !onPath.has(e.to) && path.length < L) {
            onPath.add(e.to)
            path.push(e.to)
            pathLinks.push(e.link)
            const ok = dfs(e.to)
            path.pop()
            pathLinks.pop()
            onPath.delete(e.to)
            if (!ok) return false
          }
        }
        return true
      }
      if (!dfs(s)) break search
    }
  }
  if (enough()) truncated = true
  found.sort((x, y) => x.nodes.length - y.nodes.length || x.nodes.join('\u0000').localeCompare(y.nodes.join('\u0000')))
  const loops = found.slice(0, max).map((c, i): Loop => {
    const ls = c.links.map((k) => links[k] as CausalLink)
    const type: Loop['type'] = ls.some((l) => l.polarity === '?') ? '?' : ls.filter((l) => l.polarity === '-').length % 2 === 1 ? 'B' : 'R'
    return { id: i + 1, nodes: c.nodes.map((k) => nodes[k] as string), links: c.links, type, length: c.nodes.length, delayed: ls.some((l) => l.delayed) }
  })
  return { loops, truncated }
}
