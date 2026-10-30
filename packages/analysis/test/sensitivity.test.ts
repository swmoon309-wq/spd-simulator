import { describe, expect, it } from 'vitest'
import { compileModel, parseModelDef, runModel } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import {
  computeKpis,
  defaultRange,
  lastOf,
  rankTornado,
  runMonteCarlo,
  runOat,
  runSweep,
  sortTornado,
  sweepLevels,
  valueAt,
  type InputSpec,
  type KpiSpec,
  type SensitivityBase
} from '../src'

const brooks = compileModel(brooksModel)
const completion: KpiSpec = {
  id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1,
  compute: (r) => (lastOf(r, 'requirements') <= 1e-6 ? lastOf(r, 'completion_time') : null)
}
const effort: KpiSpec = {
  id: 'totalEffort', label: '총 공수', unit: '맨데이', better: 'lower', group: 'cost', decimals: 0,
  compute: (r) => (lastOf(r, 'requirements') <= 1e-6 ? valueAt(r, 'cum_effort', lastOf(r, 'completion_time')) : null)
}
const base = (over: Partial<SensitivityBase> = {}): SensitivityBase => ({ model: brooks, baseParams: {}, options: {}, kpis: [completion, effort], ...over })
const det = (overrides: Record<string, number>) => computeKpis([completion, effort], runModel(brooks, { overrides }), overrides)

describe('sweepLevels', () => {
  it('양 끝을 포함해 균등하게 나눈다', () => {
    expect(sweepLevels(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })
  it('정수 파라미터는 반올림해 겹치는 수준을 합친다', () => {
    expect(sweepLevels(0, 8, 9, true)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(sweepLevels(0, 5, 21, true)).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('수준 수는 3 ~ 21로 제한한다', () => {
    expect(sweepLevels(0, 1, 1)).toHaveLength(3)
    expect(sweepLevels(0, 1, 100)).toHaveLength(21)
  })
})

describe('단일 파라미터 스윕', () => {
  const sweep = runSweep(base(), { name: 'nominal_productivity', min: 0.08, max: 0.16 }, 9)
  it('수준마다 결정적 실행과 같은 지표', () => {
    expect(sweep.levels).toHaveLength(9)
    sweep.levels.forEach((x, i) => expect(sweep.values['completionDay']![i]).toBe(det({ nominal_productivity: x })['completionDay']))
  })
  it('생산성이 높을수록 일찍 끝나고 공수는 줄어든다(곡선이 단조)', () => {
    const v = sweep.values['completionDay'] as number[]
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThanOrEqual(v[i - 1] as number)
    expect(v[0]).toBeGreaterThan(v[8] as number)
  })
  it('종료 시각 안에 끝나지 않는 수준은 null', () => {
    const s = runSweep(base({ options: { end: 260 } }), { name: 'nominal_productivity', min: 0.05, max: 0.16 }, 5)
    const v = s.values['completionDay'] as (number | null)[]
    expect(v[0]).toBeNull()
    expect(v[4]).not.toBeNull()
  })
  it('정수 파라미터는 정수 수준만', () => {
    const s = runSweep(base(), { name: 'initial_experienced', min: 10, max: 14, integer: true }, 9)
    expect(s.levels).toEqual([10, 11, 12, 13, 14])
  })
  it('수치 오류가 나는 수준은 null과 메시지(나머지는 계속)', () => {
    const flaky = parseModelDef({
      meta: { id: 'f', name: 'f', version: 1, timeUnit: 'day' }, time: { start: 0, end: 2, dt: 0.5 }, constants: { a: { value: 1 } },
      levels: { x: { init: '1', inflows: ['g'], outflows: [] } }, rates: { g: { expr: 'SQRT(a - 0.5)' } }, auxiliaries: {}, tables: {}, outputs: []
    })
    const k: KpiSpec = { id: 'x', label: 'x', unit: '', better: 'none', group: 'risk', decimals: 1, compute: (r) => lastOf(r, 'x') }
    const s = runSweep({ model: compileModel(flaky), baseParams: {}, options: {}, kpis: [k] }, { name: 'a', min: 0, max: 1 }, 5)
    expect(s.errors.filter((e) => e !== null).length).toBeGreaterThan(0)
    expect(s.values['x']![0]).toBeNull()
    expect(s.values['x']![4]).not.toBeNull()
  })
})

describe('OAT 토네이도', () => {
  const params = [
    { name: 'nominal_productivity', low: 0.08, high: 0.13 },
    { name: 'initial_experienced', low: 15, high: 25 },
    { name: 'hire_day', low: 50, high: 300 }, // 인력을 추가하지 않으면 영향 없음
    { name: 'assimilation_time', low: 5, high: 90 } // 신입이 없으면 영향 없음
  ]
  const oat = runOat(base(), params)
  it('기준 지표는 결정적 실행과 같다', () => {
    expect(oat.base).toEqual(det({}))
  })
  it('낮은/높은 값의 지표와 폭을 낸다', () => {
    const e = oat.entries['completionDay']!.find((x) => x.name === 'nominal_productivity')!
    expect(e.kpiLow).toBe(det({ nominal_productivity: 0.08 })['completionDay'])
    expect(e.kpiHigh).toBe(det({ nominal_productivity: 0.13 })['completionDay'])
    expect(e.swing).toBeCloseTo(Math.abs((e.kpiHigh as number) - (e.kpiLow as number)), 12)
  })
  it('폭이 큰 순서로 정렬되고 영향 없는 파라미터의 폭은 0이다', () => {
    const list = oat.entries['completionDay']!
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.swing).toBeGreaterThanOrEqual(list[i]!.swing as number)
    expect(list.slice(-2).map((x) => x.swing)).toEqual([0, 0])
    expect(list.slice(-2).map((x) => x.name).sort()).toEqual(['assimilation_time', 'hire_day'])
  })
  it('지표마다 토네이도가 따로 있다', () => {
    expect(Object.keys(oat.entries).sort()).toEqual(['completionDay', 'totalEffort'])
    expect(oat.entries['totalEffort']!.length).toBe(4)
  })
  it('한쪽이 계산되지 않으면(미완료) 폭은 null이고 맨 뒤로 간다', () => {
    const r = runOat(base({ options: { end: 270 } }), [
      { name: 'hire_day', low: 50, high: 300 },
      { name: 'nominal_productivity', low: 0.07, high: 0.13 } // 낮은 값은 270일 안에 못 끝남
    ])
    const list = r.entries['completionDay']!
    expect(list[list.length - 1]!.name).toBe('nominal_productivity')
    expect(list[list.length - 1]!.swing).toBeNull()
  })
  it('sortTornado: null은 뒤, 안정 정렬', () => {
    const s = sortTornado([{ swing: null, id: 'a' }, { swing: 1, id: 'b' }, { swing: 3, id: 'c' }, { swing: 1, id: 'd' }])
    expect(s.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a'])
  })
})

describe('Monte Carlo 순위상관 토네이도', () => {
  const prod: InputSpec = { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 }, min: 0.001, max: 10 }
  const staff: InputSpec = { name: 'initial_experienced', dist: { kind: 'uniform', min: 15, max: 25 }, min: 0, max: 200, integer: true }
  const idle: InputSpec = { name: 'hire_day', dist: { kind: 'uniform', min: 50, max: 300 }, min: 0, max: 400 }
  const r = runMonteCarlo({ model: brooks, baseParams: {}, options: {}, inputs: [idle, staff, prod], n: 600, seed: 11, kpis: [completion, effort] })
  const rank = rankTornado(r, 'completionDay')
  it('영향이 큰 입력이 앞에 오고 부호가 맞다(생산성·인원이 높을수록 일찍 끝남 → 음의 상관)', () => {
    expect(rank.slice(0, 2).map((x) => x.name).sort()).toEqual(['initial_experienced', 'nominal_productivity'])
    for (const e of rank.slice(0, 2)) expect(e.rho).toBeLessThan(-0.4)
  })
  it('영향 없는 입력의 상관은 거의 0이고 맨 뒤', () => {
    expect(rank[2]!.name).toBe('hire_day')
    expect(Math.abs(rank[2]!.rho)).toBeLessThan(0.12)
  })
  it('생산성만 있는 단조 관계는 ρ = −1', () => {
    const only = runMonteCarlo({ model: brooks, baseParams: {}, options: {}, inputs: [prod], n: 200, seed: 1, kpis: [completion] })
    expect(rankTornado(only, 'completionDay')[0]!.rho).toBeCloseTo(-1, 6)
  })
  it('OAT(분포의 P10·P90)와 순위상관의 순서가 단조·독립 입력에서 일치한다', () => {
    const oat = runOat(
      base(),
      [prod, staff, idle].map((s) => {
        const [low, high] = defaultRange(s)
        return { name: s.name, low, high }
      })
    )
    expect(oat.entries['completionDay']!.map((e) => e.name)).toEqual(rank.map((x) => x.name))
  })
  it('실패한 반복·지표 없는 반복은 제외하고, 없는 지표는 빈 목록', () => {
    expect(rankTornado(r, 'nope')).toEqual([])
    const short = runMonteCarlo({ model: brooks, baseParams: {}, options: { end: 100 }, inputs: [prod], n: 20, seed: 1, kpis: [completion] })
    expect(rankTornado(short, 'completionDay')[0]!.rho).toBeNaN()
  })
})
