import { describe, expect, it } from 'vitest'
import { kpiDistribution, runMonteCarlo, type DistSpec, type InputSpec } from '@spd/analysis'
import { compileModel } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { getEntry } from '../catalog'
import { adoptedTargets, autoBins, changeDistKind, compareSentence, compareView, convergenceView, defaultOp, distFields, distText, distributionView, oatBars, pct, requiredIterations, riskStatusText, targetView, tornadoDisagreement, withDistValue } from './riskView'

const bounds = { min: 0.1, max: 3 }

describe('분포 입력', () => {
  it('종류마다 입력칸이 정해져 있다', () => {
    expect(distFields('uniform').map((f) => f.key)).toEqual(['min', 'max'])
    expect(distFields('triangular').map((f) => f.key)).toEqual(['min', 'mode', 'max'])
    expect(distFields('pert').map((f) => f.key)).toEqual(['min', 'mode', 'max'])
    expect(distFields('normal').map((f) => f.key)).toEqual(['mean', 'sd'])
  })

  it('값 하나만 바꾼 새 분포를 만든다', () => {
    const d: DistSpec = { kind: 'triangular', min: 0.8, mode: 1, max: 1.3 }
    expect(withDistValue(d, 'max', 1.5)).toEqual({ kind: 'triangular', min: 0.8, mode: 1, max: 1.5 })
    expect(d.max).toBe(1.3)
  })

  it('종류를 바꿔도 범위가 이어지고 허용 범위를 넘지 않는다', () => {
    const tri: DistSpec = { kind: 'triangular', min: 0.8, mode: 1, max: 1.3 }
    expect(changeDistKind(tri, 'triangular', bounds)).toBe(tri)
    expect(changeDistKind(tri, 'pert', bounds)).toEqual({ kind: 'pert', min: 0.8, mode: 1, max: 1.3 })
    expect(changeDistKind(tri, 'uniform', bounds)).toEqual({ kind: 'uniform', min: 0.8, max: 1.3 })
    const n = changeDistKind(tri, 'normal', bounds)
    expect(n.kind).toBe('normal')
    if (n.kind === 'normal') {
      expect(n.mean).toBeCloseTo((0.8 + 1 + 1.3) / 3, 6) // 삼각 평균 (a+m+b)/3
      expect(n.sd).toBeCloseTo(0.125, 6) // (최대 − 최소)/4
    }
    const wide: DistSpec = { kind: 'normal', mean: 1, sd: 5 }
    expect(changeDistKind(wide, 'uniform', bounds)).toEqual({ kind: 'uniform', min: 0.1, max: 3 })
  })

  it('정수 파라미터는 반올림해 정수로 맞춘다', () => {
    const p = changeDistKind({ kind: 'normal', mean: 5.4, sd: 1.2 }, 'pert', { min: 1, max: 20 }, true)
    expect(p.kind === 'pert' && [p.min, p.mode, p.max].every(Number.isInteger)).toBe(true)
  })

  it('분포를 한 줄로 요약한다', () => {
    expect(distText({ kind: 'triangular', min: 0.8, mode: 1, max: 1.3 })).toBe('삼각 0.8 / 1 / 1.3')
    expect(distText({ kind: 'normal', mean: 10, sd: 2 })).toBe('정규 평균 10, 표준편차 2')
    expect(distText({ kind: 'uniform', min: 1, max: 2 })).toBe('균등 1 ~ 2')
  })
})

describe('분포 화면 자료', () => {
  const entry = getEntry('brooks')
  const specs: InputSpec[] = [{ name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.6, mode: 0.8, max: 1 }, min: 0.1, max: 3 }]
  const base = Object.fromEntries(Object.entries(brooksModel.constants).map(([k, c]) => [k, (c as { value: number }).value]))
  const result = runMonteCarlo({ model: compileModel(brooksModel), baseParams: base, options: {}, inputs: specs, n: 60, seed: 3, kpis: entry.kpiSpecs, band: { variable: entry.defaultVariable } })

  it('히스토그램 도수의 합은 지표가 있는 반복의 수이고 비율의 합은 1이다', () => {
    const v = distributionView(result, 'completionDay')
    const total = v.bars.reduce((a, b) => a + b.count, 0)
    expect(total).toBe(v.dist.summary.n)
    expect(v.bars.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1, 10)
    expect(v.bars[0]?.from).toBeLessThanOrEqual(v.dist.summary.min)
    expect(v.bars[v.bars.length - 1]?.to).toBeGreaterThanOrEqual(v.dist.summary.max)
  })

  it('구간 수를 지정하면 범위로 맞춰 반영한다', () => {
    const auto = distributionView(result, 'completionDay')
    expect(auto.bars.length).toBeGreaterThanOrEqual(2)
    const coarse = distributionView(result, 'completionDay', 3)
    expect(coarse.bars.length).toBeLessThan(auto.bars.length + 1)
    expect(distributionView(result, 'completionDay', 1000).bars.length).toBeLessThanOrEqual(200)
    expect(autoBins(60)).toBe(7)
    expect(autoBins(1_000_000)).toBe(21)
  })

  it('누적분포는 0 이상 1 이하로 늘어나고 끝이 1이다', () => {
    const v = distributionView(result, 'completionDay')
    expect(v.cdf.length).toBeGreaterThan(1)
    for (let i = 1; i < v.cdf.length; i++) {
      expect((v.cdf[i] as [number, number])[0]).toBeGreaterThanOrEqual((v.cdf[i - 1] as [number, number])[0])
      expect((v.cdf[i] as [number, number])[1]).toBeGreaterThan((v.cdf[i - 1] as [number, number])[1])
    }
    expect(v.cdf[v.cdf.length - 1]?.[1]).toBe(1)
  })

  it('P50·P80·P90은 오름차순이고 구간이 점을 감싼다', () => {
    const v = distributionView(result, 'completionDay')
    expect(v.quantiles.map((q) => q.label)).toEqual(['P50', 'P80', 'P90'])
    expect(v.quantiles[0]!.value).toBeLessThanOrEqual(v.quantiles[1]!.value)
    expect(v.quantiles[1]!.value).toBeLessThanOrEqual(v.quantiles[2]!.value)
    for (const q of v.quantiles) {
      expect(q.ci.low).toBeLessThanOrEqual(q.value)
      expect(q.ci.high).toBeGreaterThanOrEqual(q.value)
    }
  })

  it('점이 많으면 누적분포 점을 줄인다', () => {
    const big = runMonteCarlo({ model: compileModel(brooksModel), baseParams: base, options: {}, inputs: specs, n: 600, seed: 1, kpis: entry.kpiSpecs })
    const v = distributionView(big, 'completionDay')
    expect(v.cdf.length).toBeLessThanOrEqual(205)
    expect(v.cdf[v.cdf.length - 1]?.[1]).toBe(1)
  })
})

describe('상태 글', () => {
  it('상태별로 알맞은 글을 낸다', () => {
    expect(riskStatusText('idle', 0, 0, false)).toContain('아직')
    expect(riskStatusText('running', 12, 500, false)).toBe('실행 중 12/500회')
    expect(riskStatusText('canceled', 53, 500, false)).toContain('53/500')
    expect(riskStatusText('done', 500, 500, false)).toBe('500회 완료')
    expect(riskStatusText('done', 500, 500, true)).toContain('오래되었습니다')
    expect(riskStatusText('running', 1, 5, true)).not.toContain('오래')
  })
})

describe('목표·민감도·수렴·비교 화면 자료', () => {
  const entry = getEntry('brooks')
  const specs: InputSpec[] = [{ name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 }, min: 0.001, max: 10 }]
  const baseOf = (extra: number) => ({ ...Object.fromEntries(Object.entries(brooksModel.constants).map(([k, c]) => [k, (c as { value: number }).value])), extra_people: extra })
  const mc = (extra: number) => runMonteCarlo({ model: compileModel(brooksModel), baseParams: baseOf(extra), options: {}, inputs: specs, n: 80, seed: 5, kpis: entry.kpiSpecs })
  const a = mc(0)
  const b = mc(10)

  it('채택 계획이 있으면 완료일과 예산을 목표로 채운다', () => {
    expect(adoptedTargets(entry, null)).toEqual([])
    expect(adoptedTargets(entry, { plannedCompletion: 300, bac: 9000 })).toEqual([
      { kpi: 'completionDay', op: '<=', value: 300 },
      { kpi: 'totalEffort', op: '<=', value: 9000 }
    ])
    expect(defaultOp({ better: 'higher' })).toBe('>=')
    expect(defaultOp({ better: 'lower' })).toBe('<=')
    expect(defaultOp({ better: 'none' })).toBe('<=')
  })

  it('목표 확률: 경계는 0과 1, 동시 달성은 각 확률의 최소 이하', () => {
    const lo = targetView(a, [{ kpi: 'completionDay', op: '<=', value: -1 }])
    const hi = targetView(a, [{ kpi: 'completionDay', op: '<=', value: 1e9 }])
    expect(lo.rows[0]!.prob.p).toBe(0)
    expect(hi.rows[0]!.prob.p).toBe(1)
    expect(lo.joint).toBeNull()
    const d = kpiDistribution(a, 'completionDay')
    const mid = d.summary.percentiles['0.5'] as number
    const both = targetView(a, [
      { kpi: 'completionDay', op: '<=', value: mid },
      { kpi: 'totalEffort', op: '<=', value: (kpiDistribution(a, 'totalEffort').summary.percentiles['0.5'] as number) }
    ])
    expect(both.joint).not.toBeNull()
    expect(both.joint!.p).toBeLessThanOrEqual(Math.min(...both.rows.map((r) => r.prob.p)) + 1e-12)
    expect(pct(0.632)).toBe('63.2%')
    expect(pct(NaN)).toBe('–')
  })

  it('OAT 막대는 낮은 쪽부터 높은 쪽까지이고, 두 토네이도의 1위가 다르면 안내한다', () => {
    const e = [
      { name: 'x', low: 1, high: 2, kpiLow: 10, kpiHigh: 4, swing: 6 },
      { name: 'y', low: 1, high: 2, kpiLow: null, kpiHigh: 1, swing: null }
    ]
    const bars = oatBars(e, (n) => n.toUpperCase())
    expect(bars[0]).toMatchObject({ label: 'X', from: 4, swing: 6 })
    expect(bars[1]).toMatchObject({ from: null, swing: null })
    expect(tornadoDisagreement(e, [{ name: 'x', rho: 0.9 }], (n) => n)).toBeNull()
    expect(tornadoDisagreement(e, [{ name: 'z', rho: 0.9 }], (n) => n)).toMatch(/상호작용/)
    expect(tornadoDisagreement(e, [{ name: 'z', rho: NaN }], (n) => n)).toBeNull()
  })

  it('수렴: 마지막 점이 전체 통계이고 필요한 반복 수는 반폭에 반비례한다', () => {
    const v = convergenceView(a, 'completionDay')!
    const d = kpiDistribution(a, 'completionDay')
    const last = v.points[v.points.length - 1]!
    expect(last.n).toBe(d.summary.n)
    expect(last.mean).toBeCloseTo(d.summary.mean, 9)
    expect(requiredIterations(v, 0)).toBeNull()
    const need1 = requiredIterations(v, v.half)!
    const need2 = requiredIterations(v, v.half / 2)!
    expect(need2.needed).toBeGreaterThan(need1.needed * 3)
    expect(need1.enough).toBe(true)
    expect(need2.enough).toBe(false)
    expect(convergenceView(a, 'nope')).toBeNull()
  })

  it('시나리오 비교: 첫 시나리오를 A로 쌍별 비교하고, 추가 인원이 늘면 더 늦어진다', () => {
    const v = compareView([{ id: 'a', result: a }, { id: 'b', result: b }], 'completionDay')
    expect(v.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(v.pairs).toHaveLength(1)
    expect(v.pairs[0]!.cmp.pairs).toBe(80)
    expect(v.items[0]!.cdf[v.items[0]!.cdf.length - 1]![1]).toBe(1)
    const spec = entry.kpiSpecs[0]!
    expect(compareSentence(spec, '기준', '시나리오', v.pairs[0]!.cmp)).toMatch(/기준의 완료일이\(가\) 시나리오보다 낮을\(더 좋을\) 확률 \d+\.\d%/)
    expect(compareSentence({ label: '값', better: 'higher' }, 'A', 'B', v.pairs[0]!.cmp)).toMatch(/높을 확률/)
    expect(compareView([], 'completionDay').pairs).toEqual([])
  })
})
