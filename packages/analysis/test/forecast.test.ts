import { describe, expect, it } from 'vitest'
import { earnedSchedule, evmSeries, forecastAt, rangeOf, validateActuals, type ActualRow, type Baseline } from '../src'

const DEV = [{ variable: 'dev', weight: 1 }]
/** 100일, 선형: 진척 t/100, 공수 10t, BAC 1000 */
const linear = (): Baseline => ({
  credits: DEV,
  totalTasks: 100,
  bac: 1000,
  plannedCompletion: 100,
  series: {
    time: Array.from({ length: 101 }, (_, t) => t),
    progress: Array.from({ length: 101 }, (_, t) => t / 100),
    effort: Array.from({ length: 101 }, (_, t) => t * 10)
  }
})
const series = (b: Baseline, rows: ActualRow[], k = 3) => evmSeries(b, rows, validateActuals(rows, b.credits, b.totalTasks), k)
/** 진척 속도 `speed`(계획 대비), 공수는 진척당 `costFactor`배로 쓰는 실적 */
const actual = (speed: number, costFactor: number, days: number[]): ActualRow[] =>
  days.map((d) => ({ day: d, cum: { dev: 100 * (d / 100) * speed }, effort: 10 * d * speed * costFactor }))

describe('earnedSchedule', () => {
  const b = linear()
  it('PV 곡선의 역함수다: ES(PV(t)) = t', () => {
    for (const t of [0, 3.5, 20, 50, 77.7, 99]) expect(earnedSchedule(b, 10 * t)).toBeCloseTo(t, 9)
  })
  it('0 이하는 0, BAC 이상은 계획 완료일', () => {
    expect(earnedSchedule(b, 0)).toBe(0)
    expect(earnedSchedule(b, -5)).toBe(0)
    expect(earnedSchedule(b, 1000)).toBe(100)
    expect(earnedSchedule(b, 1500)).toBe(100)
  })
  it('평탄한 구간(공수가 늘지 않는 기간)에서는 처음 도달한 시각', () => {
    const flat: Baseline = { ...b, bac: 100, plannedCompletion: 5, series: { time: [0, 1, 2, 3, 4, 5], progress: [0, 0.2, 0.2, 0.2, 0.6, 1], effort: [0, 20, 20, 20, 60, 100] } }
    expect(earnedSchedule(flat, 20)).toBe(1)
    expect(earnedSchedule(flat, 40)).toBeCloseTo(3.5, 9)
  })
  it('단조: EV가 늘면 ES도 줄지 않는다', () => {
    let prev = -1
    for (let ev = 0; ev <= 1100; ev += 13) {
      const v = earnedSchedule(b, ev)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })
})

describe('비용 예측(EAC, ETC, VAC)', () => {
  it('CPI가 상수이면 EAC는 실제 최종 비용과 같다', () => {
    const b = linear()
    // 계획 속도, 진척당 공수 1.25배 → CPI 0.8, 최종 비용 1250
    const pts = series(b, actual(1, 1.25, [20, 40, 60]))
    for (let i = 0; i < pts.length; i++) {
      const f = forecastAt(b, pts, i, 3)
      expect(pts[i]!.cpi).toBeCloseTo(0.8, 9)
      expect(f.state).toBe('forecast')
      expect(f.cumulative.eac).toBeCloseTo(1250, 6)
      expect(f.recent.eac).toBeCloseTo(1250, 6)
    }
  })
  it('ETC = EAC − AC, VAC = BAC − EAC', () => {
    const b = linear()
    const pts = series(b, actual(1, 1.25, [40]))
    const f = forecastAt(b, pts, 0, 3)
    expect(f.cumulative.etc).toBeCloseTo(1250 - 500, 6)
    expect(f.cumulative.vac).toBeCloseTo(-250, 6)
  })
  it('계획대로(CPI = 1)면 EAC = BAC, VAC = 0', () => {
    const b = linear()
    const f = forecastAt(b, series(b, actual(1, 1, [50])), 0, 3)
    expect(f.cumulative.eac).toBeCloseTo(1000, 6)
    expect(f.cumulative.vac).toBeCloseTo(0, 6)
  })
})

describe('일정 예측(획득 일정)', () => {
  it('속도가 계획의 80%로 일정하면 예상 완료일은 계획 / 0.8 = 125일(두 가정 모두)', () => {
    const b = linear()
    const pts = series(b, actual(0.8, 1, [10, 30, 50, 70]))
    for (let i = 0; i < pts.length; i++) {
      const f = forecastAt(b, pts, i, 3)
      expect(f.es).toBeCloseTo(0.8 * pts[i]!.day, 6)
      expect(f.cumulative.completionDay).toBeCloseTo(125, 6)
      expect(f.recent.completionDay).toBeCloseTo(125, 6)
      expect(f.cumulative.delayDays).toBeCloseTo(25, 6)
    }
  })
  it('계획대로면 예상 완료일은 계획 완료일, 지연 0', () => {
    const b = linear()
    const f = forecastAt(b, series(b, actual(1, 1, [35])), 0, 3)
    expect(f.cumulative.completionDay).toBeCloseTo(100, 6)
    expect(f.cumulative.delayDays).toBeCloseTo(0, 6)
  })
  it('쉬운 일 먼저(초반 빠르고 이후 느림)면 최근 구간 값이 누적 값보다 비관적이다', () => {
    const b = linear()
    const rows: ActualRow[] = []
    let done = 0
    for (let w = 1; w <= 10; w++) {
      done += Math.max(1, 14 - w) // 주당 완료량이 줄어듦 (계획은 주 7)
      rows.push({ day: w * 7, cum: { dev: done }, effort: w * 70 })
    }
    const pts = series(b, rows)
    const f = forecastAt(b, pts, pts.length - 1, 3)
    expect(f.recent.completionDay!).toBeGreaterThan(f.cumulative.completionDay!)
    const r = rangeOf(f.cumulative.completionDay, f.recent.completionDay)!
    expect(r.high).toBe(f.recent.completionDay)
    expect(r.low).toBe(f.cumulative.completionDay)
  })
  it('출발점부터 센다: 보고가 k개 미만이면 최근 구간 = 누적', () => {
    const b = linear()
    const pts = series(b, actual(0.9, 1, [14, 28]))
    const f = forecastAt(b, pts, 1, 3)
    expect(f.recent.completionDay).toBeCloseTo(f.cumulative.completionDay!, 6)
  })
})

describe('산출 불가와 완료', () => {
  const b = linear()
  it('AC = 0이면 비용은 불가이고 이유를 알린다(일정은 계산)', () => {
    const f = forecastAt(b, series(b, [{ day: 10, cum: { dev: 5 }, effort: 0 }]), 0, 3)
    expect(f.cumulative.eac).toBeNull()
    expect(f.reasons.some((r) => r.includes('AC'))).toBe(true)
    expect(f.cumulative.completionDay).not.toBeNull()
    expect(f.state).toBe('forecast')
  })
  it('EV = 0, AC > 0이면 불가(둘 다)', () => {
    const f = forecastAt(b, series(b, [{ day: 10, cum: { dev: 0 }, effort: 30 }]), 0, 3)
    expect(f.state).toBe('unavailable')
    expect(f.cumulative.eac).toBeNull()
    expect(f.cumulative.completionDay).toBeNull()
    expect(f.reasons.length).toBeGreaterThanOrEqual(2)
  })
  it('보고일 0은 일정 불가', () => {
    const f = forecastAt(b, series(b, [{ day: 0, cum: { dev: 0 }, effort: 0 }]), 0, 3)
    expect(f.state).toBe('unavailable')
    expect(f.reasons.some((r) => r.includes('보고일이 0'))).toBe(true)
  })
  it('EV ≥ BAC이면 예측 대신 실제 완료일과 최종 비용(처음 완료한 보고일)', () => {
    const rows: ActualRow[] = [
      { day: 60, cum: { dev: 60 }, effort: 700 },
      { day: 110, cum: { dev: 100 }, effort: 1300 },
      { day: 120, cum: { dev: 100 }, effort: 1400 }
    ]
    const pts = series(b, rows)
    expect(forecastAt(b, pts, 0, 3).state).toBe('forecast')
    const f1 = forecastAt(b, pts, 1, 3)
    expect(f1.state).toBe('complete')
    expect(f1.complete).toEqual({ day: 110, cost: 1300 })
    // 나중 보고일을 골라도 처음 완료한 날과 그때의 비용을 쓴다
    expect(forecastAt(b, pts, 2, 3).complete).toEqual({ day: 110, cost: 1300 })
  })
  it('범위가 늘어(EV > BAC) 완료 조건에 해당하면 완료로 본다', () => {
    const f = forecastAt(b, series(b, [{ day: 90, cum: { dev: 130 }, effort: 1500 }]), 0, 3)
    expect(f.state).toBe('complete')
  })
})

describe('rangeOf', () => {
  it('둘 다 있으면 낙관·비관, 하나면 같은 값, 없으면 null', () => {
    expect(rangeOf(3, 5)).toEqual({ low: 3, high: 5 })
    expect(rangeOf(5, 3)).toEqual({ low: 3, high: 5 })
    expect(rangeOf(4, null)).toEqual({ low: 4, high: 4 })
    expect(rangeOf(null, null)).toBeNull()
  })
})
