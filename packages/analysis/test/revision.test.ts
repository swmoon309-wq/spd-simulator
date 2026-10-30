import { describe, expect, it } from 'vitest'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectModel } from '@spd/models'
import {
  baselineOfPoint,
  buildBaseline,
  buildRevisionBaseline,
  evAt,
  evmSeries,
  evmSeriesRevised,
  forecastAt,
  integratedReforecast,
  lastOf,
  pvAt,
  reforecast,
  revisedPvAt,
  revisionAsBaseline,
  revisionIndexFor,
  RevisionError,
  validateActuals,
  valueAt,
  type ActualRow,
  type Baseline,
  type EvmCredit,
  type Revision
} from '../src'

const model = compileModel(integratedProjectModel)
const credits: EvmCredit[] = [
  { variable: 'prod_tasks_developed', weight: 0.5 },
  { variable: 'prod_tasks_qaed', weight: 0.2 },
  { variable: 'prod_tasks_tested', weight: 0.3 }
]
const done = (r: RunResult): number | null => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null)
const planRun = runModel(model)
const plan = done(planRun) as number
const original: Baseline = buildBaseline(planRun, { credits, totalTasks: 400, effortVariable: 'ctl_cum_md', completion: plan })

/** "진짜 프로젝트"(숙련 생산성 0.7배)의 주간 실적 */
const truth = runModel(model, { overrides: { pro_prod: 0.7 } })
const report = (r: RunResult, day: number): ActualRow => ({
  day,
  cum: Object.fromEntries(credits.map((c) => [c.variable, valueAt(r, c.variable, day)])),
  effort: valueAt(r, 'ctl_cum_md', day),
  headcount: valueAt(r, 'hr_total', day)
})
const weekly = (r: RunResult, until: number) => Array.from({ length: Math.floor(until / 7) }, (_, i) => report(r, (i + 1) * 7))
const series = (b: Baseline, rows: ActualRow[], k = 3) => evmSeries(b, rows, validateActuals(rows, credits, 400), k)
const progressOf = (row: ActualRow) => credits.reduce((s, c) => s + c.weight * (row.cum[c.variable] ?? 0), 0) / 400

/** t_now에서 조치 없이 재예측하고(κ = 누적 CPI) 그 결과로 개정을 만든다 */
function revise(rows: ActualRow[], current: Baseline, tNow: number): { rev: Revision; tail: RunResult } {
  const last = rows[rows.length - 1] as ActualRow
  const p = series(current, rows).at(-1)!
  const out = reforecast(model, { adapter: integratedReforecast, params: {}, options: {}, observed: { day: tNow, cum: last.cum, effort: last.effort, headcount: last.headcount }, kappas: [{ name: 'k', kappa: p.cpi as number }] })
  const tail = out.runs[0]!.result
  const completion = done(tail)
  const built = buildRevisionBaseline({ current, tail, credits, totalTasks: 400, effortVariable: 'ctl_cum_md', completion, day: tNow, progress: progressOf(last) })
  const rev: Revision = {
    number: 1,
    revisedAt: '2026-10-22T00:00:00.000Z',
    day: tNow,
    reason: '시험',
    action: null,
    kappa: p.cpi as number,
    before: { plannedCompletion: current.plannedCompletion, bac: current.bac },
    after: { plannedCompletion: built.baseline.plannedCompletion, bac: built.baseline.bac },
    ev0: built.ev0,
    ac0: last.effort,
    baseline: built.baseline
  }
  return { rev, tail }
}

describe('buildRevisionBaseline', () => {
  const rows = weekly(truth, 98)
  const { rev, tail } = revise(rows, original, 98)
  const b = revisionAsBaseline(original, rev)

  it('BAC_rev = 후보의 완료 시점 누적 공수(= AC + 남은 예상 공수)', () => {
    expect(rev.baseline.bac).toBeCloseTo(valueAt(tail, 'ctl_cum_md', done(tail) as number), 4)
    expect(rev.after.bac).toBeGreaterThan(rev.ac0) // 남은 공수가 있다
  })
  it('개정 직후 PV = EV이고 계획 완료일은 후보의 완료일이다', () => {
    expect(pvAt(b, 98)).toBeCloseTo(rev.ev0, 6)
    expect(rev.baseline.series.time[0]).toBe(98)
    expect(rev.baseline.plannedCompletion).toBeCloseTo(done(tail) as number, 4)
    expect(rev.baseline.series.effort[0]).toBeCloseTo(rev.ev0, 6)
  })
  it('시계열이 단조(시각 증가, 진척·공수 비감소)이고 BAC에서 끝난다', () => {
    const s = rev.baseline.series
    for (let i = 1; i < s.time.length; i++) {
      expect(s.time[i]).toBeGreaterThan(s.time[i - 1] as number)
      expect(s.progress[i]).toBeGreaterThanOrEqual(s.progress[i - 1] as number)
      expect(s.effort[i]).toBeGreaterThanOrEqual(s.effort[i - 1] as number)
    }
    expect(s.effort.at(-1)).toBeCloseTo(rev.baseline.bac, 4)
  })
  it('원 기준선의 개정 직전 값(과거)은 그대로다', () => {
    expect(pvAt(original, 98)).toBeGreaterThan(0)
    expect(original.bac).toBeCloseTo(1224, 0)
  })
  it('개정 직후 SPI가 1에서 다시 시작한다(실적이 후보의 진행을 따를 때 계속 1)', () => {
    // 후보(재예측)의 결과를 실제 실적으로 삼아 개정 이후 보고일을 만든다
    const after: ActualRow[] = [105, 119, 140, 168, 196].map((d) => report(tail, d))
    const all = [...rows, ...after]
    const pts = evmSeriesRevised(original, [rev], all, validateActuals(all, credits, 400), 3)
    const post = pts.filter((p) => p.day > 98)
    expect(post.every((p) => p.revision === 1)).toBe(true)
    for (const p of post) expect(p.spi).toBeCloseTo(1, 3)
    expect(post.at(-1)!.ev).toBeGreaterThan(rev.ev0)
  })
  it('끝나지 않는 후보·총 공수가 EV 이하·진척이 없는 후보는 거절', () => {
    const base = { current: original, tail, credits, totalTasks: 400, effortVariable: 'ctl_cum_md', day: 98, progress: progressOf(rows.at(-1)!) }
    expect(() => buildRevisionBaseline({ ...base, completion: null })).toThrow(/끝나지 않는/)
    expect(() => buildRevisionBaseline({ ...base, completion: done(tail) as number, progress: 5 })).toThrow(RevisionError) // EV가 BAC 이상
    expect(() => buildRevisionBaseline({ ...base, completion: 98.0000001 })).toThrow(RevisionError)
  })
})

describe('개정을 반영한 지표 (evmSeriesRevised)', () => {
  const rows = weekly(truth, 98)
  const { rev, tail } = revise(rows, original, 98)
  const later: ActualRow[] = [105, 126, 147].map((d) => report(tail, d))
  const all = [...rows, ...later]
  const issues = validateActuals(all, credits, 400)
  const revised = evmSeriesRevised(original, [rev], all, issues, 3)

  it('개정 전 보고일(개정일 당일 포함)의 지표는 원 기준선과 같다(과거 불변)', () => {
    const before = series(original, rows)
    const same = revised.filter((p) => p.day <= 98)
    expect(same).toHaveLength(before.length)
    same.forEach((p, i) => {
      expect(p.revision).toBe(0)
      expect(p.cpi).toBeCloseTo(before[i]!.cpi as number, 12)
      expect(p.spi).toBeCloseTo(before[i]!.spi as number, 12)
      expect(p.cpiK).toBeCloseTo(before[i]!.cpiK as number, 12)
    })
  })
  it('개정 후 보고일은 개정 기준선으로, 인덱스는 원래 행 위치를 가리킨다', () => {
    const post = revised.filter((p) => p.day > 98)
    expect(post.map((p) => p.index)).toEqual([14, 15, 16])
    expect(post.every((p) => p.revision === 1)).toBe(true)
  })
  it('개정 후 구간 지수는 개정 시점에서 출발한다(첫 보고의 구간 SPI = 1)', () => {
    const first = revised.find((p) => p.day === 105)!
    expect(first.spiK).toBeCloseTo(1, 3)
  })
  it('"원 기준선 기준"으로 보면 누적 지연이 그대로 드러난다(SPI < 1)', () => {
    const orig = evmSeriesRevised(original, [rev], all, issues, 3, true)
    expect(orig.every((p) => p.revision === 0)).toBe(true)
    const last = orig.at(-1)!
    expect(last.spi!).toBeLessThan(0.99)
    expect(revised.at(-1)!.spi!).toBeGreaterThan(last.spi!)
  })
  it('개정이 없으면 evmSeries와 같다', () => {
    const plain = series(original, rows)
    const r = evmSeriesRevised(original, [], rows, validateActuals(rows, credits, 400), 3)
    expect(r.map((p) => p.cpi)).toEqual(plain.map((p) => p.cpi))
  })
  it('오류 행은 어느 기준선에서도 제외된다', () => {
    const bad = [...all]
    bad[15] = { ...bad[15]!, effort: -1 }
    const pts = evmSeriesRevised(original, [rev], bad, validateActuals(bad, credits, 400), 3)
    expect(pts.some((p) => p.index === 15)).toBe(false)
    expect(pts).toHaveLength(all.length - 1)
  })
  it('개정 기준선의 예측: 후보를 따르면 예상 완료일이 개정 계획과 같다', () => {
    const seg = revised.filter((p) => p.revision === 1)
    const b = baselineOfPoint(original, [rev], seg[0]!)
    const f = forecastAt(b, seg, seg.length - 1, 3)
    expect(f.state).toBe('forecast')
    expect(f.cumulative.completionDay).toBeCloseTo(rev.baseline.plannedCompletion, 0)
  })
})

describe('기준선 선택과 PV 이음', () => {
  const rows = weekly(truth, 98)
  const { rev } = revise(rows, original, 98)
  it('개정 당일은 이전 기준선, 이후는 개정 기준선', () => {
    expect(revisionIndexFor([rev], 98)).toBe(-1)
    expect(revisionIndexFor([rev], 98.01)).toBe(0)
    expect(revisionIndexFor([], 200)).toBe(-1)
  })
  it('개정이 둘이면 가장 최근 개정을 쓴다', () => {
    expect(revisionIndexFor([{ day: 50 }, { day: 100 }, { day: 150 }], 120)).toBe(1)
    expect(revisionIndexFor([{ day: 50 }, { day: 100 }, { day: 150 }], 151)).toBe(2)
  })
  it('revisedPvAt: 개정 전은 원 PV, 후는 개정 PV(개정 시점에서 EV로 이어짐)', () => {
    expect(revisedPvAt(original, [rev], 50)).toBeCloseTo(pvAt(original, 50), 12)
    expect(revisedPvAt(original, [rev], 98)).toBeCloseTo(pvAt(original, 98), 12)
    expect(revisedPvAt(original, [rev], 98.5)).toBeGreaterThanOrEqual(rev.ev0 - 1e-6)
    expect(revisedPvAt(original, [rev], 1000)).toBeCloseTo(rev.baseline.bac, 4)
  })
  it('두 번째 개정은 첫 개정 기준선에서 이어 만든다', () => {
    const first = revisionAsBaseline(original, rev)
    // 첫 개정 후의 실적(후보를 따르되 생산성이 더 낮음)으로 다시 개정
    const slow = runModel(model, { overrides: { pro_prod: 0.55 } })
    const rows2 = [...rows, ...[105, 112, 119, 126, 133, 140].map((d) => report(slow, d))]
    const last = rows2.at(-1)!
    const pts = evmSeriesRevised(original, [rev], rows2, validateActuals(rows2, credits, 400), 3)
    const p = pts.at(-1)!
    expect(p.revision).toBe(1)
    const out = reforecast(model, { adapter: integratedReforecast, params: {}, options: {}, observed: { day: 140, cum: last.cum, effort: last.effort, headcount: last.headcount }, kappas: [{ name: 'k', kappa: p.cpi as number }] })
    const tail = out.runs[0]!.result
    const second = buildRevisionBaseline({ current: first, tail, credits, totalTasks: 400, effortVariable: 'ctl_cum_md', completion: done(tail), day: 140, progress: progressOf(last) })
    expect(second.ev0).toBeCloseTo(evAt(first, progressOf(last)), 9)
    expect(second.baseline.series.time[0]).toBe(140)
  })
})
