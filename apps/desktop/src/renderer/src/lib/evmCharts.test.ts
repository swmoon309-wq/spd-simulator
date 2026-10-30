import { describe, expect, it } from 'vitest'
import { evmSeries, forecastAt, validateActuals, type ActualRow, type Baseline, type Revision } from '@spd/analysis'
import { buildEvmCharts, describeChart } from './evmCharts'

const base: Baseline = {
  credits: [{ variable: 'dev', weight: 1 }],
  totalTasks: 100,
  bac: 1000,
  plannedCompletion: 100,
  series: { time: Array.from({ length: 101 }, (_, t) => t), progress: Array.from({ length: 101 }, (_, t) => t / 100), effort: Array.from({ length: 101 }, (_, t) => t * 10) }
}
const rows: ActualRow[] = [{ day: 20, cum: { dev: 16 }, effort: 200 }, { day: 40, cum: { dev: 32 }, effort: 400 }]
const points = evmSeries(base, rows, validateActuals(rows, base.credits, 100), 3)

describe('buildEvmCharts', () => {
  it('차트 세 장: 값, 편차(0선), 지수(1.0선)', () => {
    const c = buildEvmCharts(base, points, 40)
    expect(c.map((x) => x.id)).toEqual(['value', 'variance', 'index'])
    expect(c[1]!.marks.some((m) => m.axis === 'y' && m.value === 0)).toBe(true)
    expect(c[2]!.marks.some((m) => m.axis === 'y' && m.value === 1)).toBe(true)
    expect(c[0]!.marks.some((m) => m.axis === 'y' && m.value === 1000)).toBe(true)
  })
  it('예측이 없으면 예측 선이 없다', () => {
    const c = buildEvmCharts(base, points, 40, null)
    expect(c[0]!.lines.some((l) => l.forecast)).toBe(false)
  })
  it('예측이 있으면 EV는 BAC까지, AC는 EAC까지 이어 그리고 예상 완료일선을 긋는다', () => {
    const f = forecastAt(base, points, 1, 3)
    const c = buildEvmCharts(base, points, 40, f)
    const ev = c[0]!.lines.find((l) => l.name === 'EV 예측')!
    const ac = c[0]!.lines.find((l) => l.name === 'AC 예측')!
    expect(ev.data[0]).toEqual([40, points[1]!.ev])
    expect(ev.data[1]![1]).toBe(1000)
    expect(ac.data[1]![1]).toBeCloseTo(f.cumulative.eac as number, 6)
    expect(ev.data[1]![0]).toBeCloseTo(f.cumulative.completionDay as number, 6)
    expect(c[0]!.marks.some((m) => m.axis === 'x' && m.label.startsWith('예상 완료'))).toBe(true)
  })
  it('PV 곡선은 예상 완료일까지 이어진다(BAC로 평평)', () => {
    const f = forecastAt(base, points, 1, 3)
    const pv = buildEvmCharts(base, points, 40, f)[0]!.lines[0]!.data
    expect(pv[pv.length - 1]![0]).toBeGreaterThanOrEqual(f.cumulative.completionDay as number)
    expect(pv[pv.length - 1]![1]).toBe(1000)
  })
  it('설명 문장에 선 이름과 마지막 값이 있다', () => {
    expect(describeChart(buildEvmCharts(base, points, 40)[2]!)).toContain('CPI(누적) 0.8(40일)')
  })

  const rev: Revision = {
    number: 1, revisedAt: '2026-01-01T00:00:00.000Z', day: 40, reason: 'x', action: null, kappa: 0.8,
    before: { plannedCompletion: 100, bac: 1000 }, after: { plannedCompletion: 130, bac: 1250 }, ev0: 320, ac0: 400,
    baseline: { bac: 1250, plannedCompletion: 130, series: { time: [40, 70, 100, 130], progress: [0.32, 0.55, 0.8, 1], effort: [320, 590, 890, 1250] } }
  }
  it('개정이 있으면 개정 PV 곡선(개정 시점부터)과 개정 세로선을 더하고 원 PV는 남긴다', () => {
    const c = buildEvmCharts(base, points, 40, null, null, [rev])[0]!
    const pv = c.lines.find((l) => l.name === 'PV(개정 1)')!
    expect(pv.data[0]![0]).toBe(40)
    expect(pv.data[0]![1]).toBeCloseTo(320, 6) // 개정 시점에서 EV로 시작
    expect(pv.data.at(-1)![1]).toBeCloseTo(1250, 6)
    expect(c.lines[0]!.name).toBe('PV(계획)')
    expect(c.marks.some((m) => m.axis === 'x' && m.value === 40 && m.label.startsWith('개정 1'))).toBe(true)
  })
  it('원 기준선 보기에서는 개정 곡선과 세로선을 숨긴다', () => {
    const c = buildEvmCharts(base, points, 40, null, null, [rev], true)[0]!
    expect(c.lines.some((l) => l.name.startsWith('PV(개정'))).toBe(false)
    expect(c.marks.some((m) => m.label.startsWith('개정'))).toBe(false)
  })
  it('차트 x축은 개정 계획 완료일까지 이어진다', () => {
    const pv = buildEvmCharts(base, points, 40, null, null, [rev])[0]!.lines[0]!.data
    expect(pv.at(-1)![0]).toBeGreaterThanOrEqual(130)
  })
})
