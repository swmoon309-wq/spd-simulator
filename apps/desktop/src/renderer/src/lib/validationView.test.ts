import { describe, expect, it } from 'vitest'
import { lastOf, valueAt } from '@spd/analysis'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { getEntry } from '../catalog'
import { defaultParams } from './params'
import type { Dataset } from './validation'
import { evaluateDataset, fmt, statusText, STATUS_MARK } from './validationView'

const entry = getEntry('brooks')
const params = defaultParams(entry)
const run = (overrides: Record<string, number> = {}): RunResult => runModel(compileModel(brooksModel), { overrides })

/** 결과에서 주 단위로 뽑은 관측 열 */
const weekly = (r: RunResult, variable: string, scale = 1): [number, number][] => {
  const out: [number, number][] = []
  for (let w = 1; w * 7 <= 200; w++) out.push([w, valueAt(r, variable, w * 7) / scale])
  return out
}
const dataset = (columns: Dataset['columns'], patch: Partial<Dataset> = {}): Dataset => ({ id: 'd1', name: 'A', fileName: 'a.csv', timeUnit: 'week', offsetDay: 0, actualCompletionDay: null, columns, ...patch })

describe('데이터셋 비교', () => {
  const base = run()

  it('같은 실행에서 뽑은 관측은 모든 열이 완전 일치한다', () => {
    const d = dataset([
      { name: 'p', variable: 'total_personnel', scale: 1, points: weekly(base, 'total_personnel') },
      { name: 'e', variable: 'cum_effort', scale: 1, points: weekly(base, 'cum_effort') }
    ])
    const r = evaluateDataset(entry, base, d, {}, params)
    expect(r.columns).toHaveLength(2)
    for (const c of r.columns) {
      expect(c.metrics.rmse).toBeCloseTo(0, 8)
      expect(c.metrics.nse).toBeCloseTo(1, 8)
      expect(c.residuals.every(([, v]) => Math.abs(v) < 1e-8)).toBe(true)
    }
    expect(r.overall.j).toBeCloseTo(0, 12)
    expect(r.overall).toMatchObject({ used: 2, skipped: 0 })
    expect(r.unmapped).toBe(0)
    expect(r.completion).toBeNull()
  })

  it('연결하지 않은 열은 비교하지 않고 센다', () => {
    const d = dataset([
      { name: 'p', variable: 'total_personnel', scale: 1, points: weekly(base, 'total_personnel') },
      { name: '메모', variable: null, scale: 1, points: [[1, 1]] }
    ])
    const r = evaluateDataset(entry, base, d, {}, params)
    expect(r.columns.map((c) => c.index)).toEqual([0])
    expect(r.unmapped).toBe(1)
  })

  it('값 배율을 반영한다(관측을 1000으로 나눠 가져와 배율 1000이면 완전 일치)', () => {
    const d = dataset([{ name: 'e', variable: 'cum_effort', scale: 1000, points: weekly(base, 'cum_effort', 1000) }])
    expect(evaluateDataset(entry, base, d, {}, params).columns[0]!.metrics.rmse).toBeCloseTo(0, 6)
    const wrong = dataset([{ name: 'e', variable: 'cum_effort', scale: 1, points: weekly(base, 'cum_effort', 1000) }])
    expect(evaluateDataset(entry, base, wrong, {}, params).columns[0]!.metrics.nrmse).toBeGreaterThan(0.5)
  })

  it('시간 이동을 반영한다(데이터가 10일 늦게 시작하면 이동 −10으로 맞는다)', () => {
    const shifted: [number, number][] = []
    for (let d = 20; d <= 150; d += 10) shifted.push([d + 10, valueAt(base, 'cum_effort', d)])
    const d = dataset([{ name: 'e', variable: 'cum_effort', scale: 1, points: shifted }], { timeUnit: 'day', offsetDay: -10 })
    expect(evaluateDataset(entry, base, d, {}, params).columns[0]!.metrics.rmse).toBeCloseTo(0, 9)
    const wrong = dataset([{ name: 'e', variable: 'cum_effort', scale: 1, points: shifted }], { timeUnit: 'day', offsetDay: 0 })
    expect(evaluateDataset(entry, base, wrong, {}, params).columns[0]!.metrics.rmse).toBeGreaterThan(1)
  })

  it('인력을 더 투입한 실행을 실제로 보면 편향이 있고, 사용자가 정한 기준만 안/밖을 낸다', () => {
    const actual = run({ extra_people: 10 })
    const d = dataset([{ name: 'p', variable: 'total_personnel', scale: 1, points: weekly(actual, 'total_personnel') }])
    const none = evaluateDataset(entry, base, d, {}, params).columns[0]!
    expect(none.status).toEqual({}) // 기준이 없으면 아무 판정도 하지 않는다
    expect(none.metrics.me).toBeLessThan(0)
    const tol = evaluateDataset(entry, base, d, { nrmse: 1e-6, nse: -100 }, params).columns[0]!
    expect(tol.status).toEqual({ nrmse: 'out', nse: 'in' })
    expect(none.residuals).toHaveLength(none.aligned.time.length)
    expect(none.residuals[0]![1]).toBeCloseTo(none.aligned.simulated[0]! - none.aligned.observed[0]!, 12)
  })

  it('시뮬레이션 범위 밖 점은 빼고 개수를 남긴다', () => {
    const d = dataset([{ name: 'p', variable: 'total_personnel', scale: 1, points: [[1, 10], [9999, 5]] }])
    const c = evaluateDataset(entry, base, d, {}, params).columns[0]!
    expect(c.aligned.outOfRange).toBe(1)
    expect(c.metrics.n).toBe(1)
  })

  it('실제 완료일이 있으면 완료 시점 오차를 낸다', () => {
    const sim = lastOf(base, 'completion_time')
    const d = dataset([{ name: 'p', variable: 'total_personnel', scale: 1, points: weekly(base, 'total_personnel') }], { actualCompletionDay: sim + 20 })
    const r = evaluateDataset(entry, base, d, {}, params)
    expect(r.completion!.simulated).toBeCloseTo(sim, 9)
    expect(r.completion!.days).toBeCloseTo(-20, 9)
    expect(r.completion!.percent!).toBeLessThan(0)
  })

  it('시뮬레이션이 끝나지 않았으면 완료 시점 오차는 계산하지 않는다', () => {
    const short = runModel(compileModel(brooksModel), { end: 30 })
    const d = dataset([], { actualCompletionDay: 300 })
    expect(evaluateDataset(entry, short, d, {}, params).completion).toMatchObject({ days: null, percent: null, simulated: null, actual: 300 })
  })
})

describe('표시 도우미', () => {
  it('알 수 없는 값은 "–"', () => {
    expect(fmt(1.23456)).toBe('1.23')
    expect(fmt(1.23456, 4)).toBe('1.2346')
    expect(fmt(NaN)).toBe('–')
  })
  it('기준 상태 문구', () => {
    expect(statusText({}, (k) => k)).toBe('')
    expect(statusText({ nrmse: 'in', mre: 'out' }, (k) => k.toUpperCase())).toBe(`NRMSE ${STATUS_MARK.in} · MRE ${STATUS_MARK.out}`)
  })
})
