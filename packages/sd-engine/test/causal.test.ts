import { describe, expect, it } from 'vitest'
import { analyzeCausality, findLoops, type CausalLink, type ModelDef } from '../src'

const base = (over: Partial<ModelDef> = {}): ModelDef => ({
  meta: { id: 'm', name: 'm', version: 1, timeUnit: 'day' },
  time: { start: 0, end: 40, dt: 0.5 },
  constants: { k: { value: 0.1 } },
  levels: {},
  rates: {},
  auxiliaries: {},
  tables: {},
  outputs: [],
  ...over
})
const link = (a: ReturnType<typeof analyzeCausality>, from: string, to: string) => a.links.find((l) => l.from === from && l.to === to)
const loopKey = (l: { nodes: string[] }) => [...l.nodes].sort().join(',')

describe('링크 극성 (책 2.5.2.1 Step 3)', () => {
  it('배출 과정: 흐름은 Level을 줄이고(−) Level은 흐름을 키우는(+) 균형 고리', () => {
    const a = analyzeCausality(base({ levels: { stock: { init: '100', inflows: [], outflows: ['drain'] } }, rates: { drain: { expr: 'stock * k' } } }))
    expect(link(a, 'stock', 'drain')).toMatchObject({ polarity: '+', kind: 'info', delayed: false })
    expect(link(a, 'drain', 'stock')).toMatchObject({ polarity: '-', kind: 'flow', sense: 'out' })
    expect(link(a, 'k', 'drain')).toMatchObject({ polarity: '+' })
    expect(a.loops).toHaveLength(1)
    expect(a.loops[0]).toMatchObject({ type: 'B', length: 2, delayed: false })
    expect(a.loops[0]?.nodes.sort()).toEqual(['drain', 'stock'])
  })

  it('복리 과정: 양의 되먹임(강화 고리 R)', () => {
    const a = analyzeCausality(base({ levels: { stock: { init: '10', inflows: ['growth'], outflows: [] } }, rates: { growth: { expr: 'stock * k' } } }))
    expect(link(a, 'growth', 'stock')).toMatchObject({ polarity: '+', sense: 'in' })
    expect(a.loops).toHaveLength(1)
    expect(a.loops[0]?.type).toBe('R')
  })

  it('목표 추구(조정 과정): Level이 늘면 간격이 줄어 유입이 줄어드는(−) 균형 고리', () => {
    const a = analyzeCausality(base({ constants: { goal: { value: 100 }, k: { value: 0.1 } }, levels: { stock: { init: '0', inflows: ['adj'], outflows: [] } }, rates: { adj: { expr: '(goal - stock) * k' } } }))
    expect(link(a, 'stock', 'adj')).toMatchObject({ polarity: '-' })
    expect(link(a, 'goal', 'adj')).toMatchObject({ polarity: '+' })
    expect(a.loops.map((l) => l.type)).toEqual(['B'])
  })

  it('지연을 거치는 링크는 극성을 얻고 delayed로 표시한다(루프에도 표시)', () => {
    const a = analyzeCausality(
      base({ time: { start: 0, end: 60, dt: 0.5 }, constants: { goal: { value: 50 }, k: { value: 0.2 }, tau: { value: 5 } }, levels: { stock: { init: '0', inflows: ['adj'], outflows: [] } }, rates: { adj: { expr: '(goal - perceived) * k' } }, auxiliaries: { perceived: { expr: 'SMOOTH(stock, tau)' } } })
    )
    expect(link(a, 'stock', 'perceived')).toMatchObject({ polarity: '+', delayed: true })
    expect(link(a, 'perceived', 'adj')).toMatchObject({ polarity: '-', delayed: false })
    // 지연시간 자체의 영향은 지연을 통과시켜 평가하므로 링크로 보이지 않는다(한계)
    expect(link(a, 'tau', 'perceived')).toBeUndefined()
    expect(a.hidden).toBeGreaterThan(0)
    const loop = a.loops.find((l) => l.nodes.includes('perceived'))!
    expect(loop).toMatchObject({ type: 'B', delayed: true, length: 3 })
  })

  it('방향이 시점마다 바뀌면 ? (비단조): 극성 불명 루프', () => {
    const a = analyzeCausality(base({ time: { start: 0, end: 40, dt: 0.5 }, constants: { k: { value: 1 } }, levels: { stock: { init: '0', inflows: ['g'], outflows: [] } }, rates: { g: { expr: 'k' } }, auxiliaries: { hump: { expr: 'stock * (20 - stock)' } } }))
    const l = link(a, 'stock', 'hump')!
    expect(l.polarity).toBe('?')
    expect(l.positive).toBeGreaterThan(0)
    expect(l.negative).toBeGreaterThan(0)
    // ?가 든 순환은 극성 불명
    const b = analyzeCausality(base({ levels: { stock: { init: '1', inflows: ['g'], outflows: [] } }, rates: { g: { expr: 'hump * 0.01' } }, auxiliaries: { hump: { expr: 'stock * (3 - stock)' } }, time: { start: 0, end: 60, dt: 0.5 } }))
    expect(b.loops.map((x) => x.type)).toContain('?')
  })

  it('모든 시점에서 변화가 없는 링크는 표시하지 않는다(센 개수만 알린다)', () => {
    const a = analyzeCausality(base({ levels: { stock: { init: '1', inflows: ['g'], outflows: [] } }, rates: { g: { expr: 'k' } }, auxiliaries: { never: { expr: 'IF(stock > 1000000, 1, 0)' }, zero: { expr: 'stock * 0 + k' } } }))
    expect(link(a, 'stock', 'never')).toBeUndefined()
    expect(link(a, 'stock', 'zero')).toBeUndefined()
    expect(a.hidden).toBe(2)
    expect(link(a, 'k', 'zero')).toMatchObject({ polarity: '+' })
  })

  it('값이 0인 입력도 작은 절대값으로 흔들어 극성을 본다. 상수 덮어쓰기를 따른다', () => {
    const a = analyzeCausality(base({ constants: { x0: { value: 0 }, k: { value: 1 } }, auxiliaries: { y: { expr: 'x0 * k' } } }))
    expect(link(a, 'x0', 'y')).toMatchObject({ polarity: '+' })
    const neg = analyzeCausality(base({ constants: { x0: { value: 0 }, k: { value: 1 } }, auxiliaries: { y: { expr: 'x0 * k' } } }), { overrides: { k: -2 } })
    expect(link(neg, 'x0', 'y')).toMatchObject({ polarity: '-' }) // 같은 구조라도 기준 실행의 입력이 극성을 정한다
  })

  it('난수 함수가 있어도 같은 난수열로 평가해 극성이 안정적이고 결정적이다', () => {
    const def = base({ constants: { k: { value: 2 } }, auxiliaries: { noisy: { expr: 'k * 3 + RANDOM_UNIFORM(0, 1)' } } })
    expect(link(analyzeCausality(def), 'k', 'noisy')).toMatchObject({ polarity: '+' })
    expect(JSON.stringify(analyzeCausality(def))).toBe(JSON.stringify(analyzeCausality(def)))
  })

  it('시간·상수만 쓰는 수식, Level 초기값 참조는 링크가 아니다', () => {
    const a = analyzeCausality(base({ constants: { k: { value: 3 }, start: { value: 5 } }, levels: { stock: { init: 'start', inflows: ['g'], outflows: [] } }, rates: { g: { expr: 'STEP(k, 5) + TIME * 0' } } }))
    expect(link(a, 'start', 'stock')).toBeUndefined()
    expect(link(a, 'k', 'g')).toMatchObject({ polarity: '+' })
  })

  it('컴파일되지 않는 모델은 예외를 던진다', () => {
    expect(() => analyzeCausality(base({ auxiliaries: { a: { expr: 'nothing' } } }))).toThrow()
  })
})

describe('루프 탐색', () => {
  it('여러 루프를 짧은 것부터 찾고 극성은 링크 극성의 곱이다', () => {
    // 인원 Level이 이탈(균형)·채용(강화) 두 흐름을 가진 모델
    const a = analyzeCausality(
      base({
        constants: { quit: { value: 0.02 }, hire: { value: 0.05 } },
        levels: { staff: { init: '10', inflows: ['hiring'], outflows: ['quitting'] } },
        rates: { hiring: { expr: 'staff * hire' }, quitting: { expr: 'staff * quit' } }
      })
    )
    expect(a.loops.map((l) => [l.type, l.length]).sort()).toEqual([['B', 2], ['R', 2]])
    expect(a.loops.map((l) => l.id)).toEqual([1, 2])
    expect(a.loops.find((l) => l.type === 'R')?.nodes).toContain('hiring')
    expect(a.truncated).toBe(false)
    // 각 루프의 links 번호가 nodes 순서의 링크를 가리킨다
    for (const l of a.loops) l.links.forEach((k, i) => expect([a.links[k]!.from, a.links[k]!.to]).toEqual([l.nodes[i], l.nodes[(i + 1) % l.nodes.length]]))
  })

  it('긴 순환 하나를 정확히 한 번만 찾는다(시작 지점이 달라도 중복 없음)', () => {
    const links: CausalLink[] = ['a', 'b', 'c', 'd'].map((n, i, all) => ({ from: n, to: all[(i + 1) % all.length] as string, polarity: '+', delayed: false, kind: 'info', positive: 1, negative: 0 }))
    const { loops, truncated } = findLoops(links)
    expect(loops).toHaveLength(1)
    expect(loops[0]).toMatchObject({ type: 'R', length: 4 })
    expect(truncated).toBe(false)
  })

  it('음의 링크 개수의 홀짝으로 B/R, ?가 있으면 ?', () => {
    const mk = (pols: ('+' | '-' | '?')[]): CausalLink[] => pols.map((p, i) => ({ from: `n${i}`, to: `n${(i + 1) % pols.length}`, polarity: p, delayed: false, kind: 'info', positive: 1, negative: 0 }))
    expect(findLoops(mk(['-', '+', '+'])).loops[0]?.type).toBe('B')
    expect(findLoops(mk(['-', '-', '+'])).loops[0]?.type).toBe('R')
    expect(findLoops(mk(['-', '-', '-'])).loops[0]?.type).toBe('B')
    expect(findLoops(mk(['+', '?', '+'])).loops[0]?.type).toBe('?')
  })

  it('순환이 없으면 루프가 없다', () => {
    const a = analyzeCausality(base({ constants: { k: { value: 1 } }, auxiliaries: { a: { expr: 'k * 2' }, b: { expr: 'a + 1' } } }))
    expect(a.loops).toEqual([])
    expect(a.truncated).toBe(false)
  })

  it('상한을 넘으면 truncated로 알리고 짧은 순환이 남는다', () => {
    // 모든 Level이 서로의 합을 흐름으로 받는 모델: 순환이 아주 많다
    const n = 6
    const names = Array.from({ length: n }, (_, i) => `l${i}`)
    const def = base({
      levels: Object.fromEntries(names.map((l, i) => [l, { init: '1', inflows: [`r${i}`], outflows: [] }])),
      rates: Object.fromEntries(names.map((_, i) => [`r${i}`, { expr: `0.01 * (${names.filter((x) => x !== `l${i}`).join(' + ')})` }])),
      time: { start: 0, end: 5, dt: 0.5 }
    })
    const full = analyzeCausality(def, { maxLoops: 100000 })
    expect(full.loops.length).toBeGreaterThan(50)
    const capped = analyzeCausality(def, { maxLoops: 10 })
    expect(capped.loops).toHaveLength(10)
    expect(capped.truncated).toBe(true)
    expect(Math.max(...capped.loops.map((l) => l.length))).toBeLessThanOrEqual(Math.min(...full.loops.slice(10).map((l) => l.length)))
    expect(new Set(capped.loops.map(loopKey)).size).toBeGreaterThan(0)
  })

  it('결정적이다(같은 모델은 같은 링크·루프 순서)', () => {
    const def = base({ levels: { stock: { init: '10', inflows: ['g'], outflows: ['d'] } }, rates: { g: { expr: 'stock * 0.1' }, d: { expr: 'stock * 0.2' } } })
    expect(JSON.stringify(analyzeCausality(def))).toBe(JSON.stringify(analyzeCausality(JSON.parse(JSON.stringify(def)) as ModelDef)))
  })
})
