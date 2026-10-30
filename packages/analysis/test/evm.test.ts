import { describe, expect, it } from 'vitest'
import { compileModel, runModel } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '@spd/models'
import {
  buildBaseline,
  evmSeries,
  indicators,
  isWorsening,
  MAX_ACTUAL_ROWS,
  progressFromCum,
  ratio,
  validateActuals,
  valueAt,
  windowIndices,
  type ActualRow,
  type Baseline,
  type EvmCredit
} from '../src'

const DEV: EvmCredit[] = [{ variable: 'dev', weight: 1 }]
const THREE: EvmCredit[] = [
  { variable: 'dev', weight: 0.5 },
  { variable: 'qa', weight: 0.2 },
  { variable: 'test', weight: 0.3 }
]

/** 책 시험 1단계의 계획: 100 FP, 0.1 FP/맨데이, 10명 → 100일, 1,000 맨데이(p.452). 선형 곡선. */
const linearBaseline = (n = 100, days = 100, staff = 10): Baseline => ({
  credits: DEV,
  totalTasks: n,
  bac: staff * days,
  plannedCompletion: days,
  series: {
    time: Array.from({ length: days + 1 }, (_, t) => t),
    progress: Array.from({ length: days + 1 }, (_, t) => t / days),
    effort: Array.from({ length: days + 1 }, (_, t) => t * staff)
  }
})
/** 생산성 p(태스크/맨데이), 인원 s로 일하는 실적을 주 단위로 만든다 */
const work = (p: number, s: number, days = 100, step = 7): ActualRow[] => {
  const rows: ActualRow[] = []
  for (let d = step; d <= days; d += step) rows.push({ day: d, cum: { dev: p * s * d }, effort: s * d })
  return rows
}
const run = (b: Baseline, rows: ActualRow[], k?: number) => evmSeries(b, rows, validateActuals(rows, b.credits, b.totalTasks), k)

describe('ratio / indicators', () => {
  it('분모가 0이면 null이다(0이나 무한대가 아니다)', () => {
    expect(ratio(5, 0)).toBeNull()
    expect(ratio(0, 0)).toBeNull()
    expect(ratio(6, 3)).toBe(2)
    expect(ratio(0, 4)).toBe(0)
  })
  it('CV·SV·CPI·SPI', () => {
    const i = indicators(100, 80, 120)
    expect(i.cv).toBe(-40)
    expect(i.sv).toBe(-20)
    expect(i.cpi).toBeCloseTo(80 / 120)
    expect(i.spi).toBeCloseTo(0.8)
  })
  it('AC=0이면 CPI, PV=0이면 SPI가 계산 불가이고 EV=0, AC>0이면 CPI는 0이다', () => {
    expect(indicators(10, 5, 0).cpi).toBeNull()
    expect(indicators(0, 5, 5).spi).toBeNull()
    expect(indicators(10, 0, 5).cpi).toBe(0)
    expect(indicators(10, 0, 5).spi).toBe(0)
  })
})

describe('책 시험 1단계: 실적 = 계획', () => {
  it('모든 보고일에서 CPI = SPI = 1, CV = SV = 0', () => {
    const b = linearBaseline()
    const pts = run(b, work(0.1 * 1, 10)) // 계획: 0.1 FP/맨데이 × 10명 = 1 FP/일
    expect(pts).toHaveLength(14)
    for (const p of pts) {
      expect(p.cpi).toBeCloseTo(1, 9)
      expect(p.spi).toBeCloseTo(1, 9)
      expect(p.cv).toBeCloseTo(0, 6)
      expect(p.sv).toBeCloseTo(0, 6)
      expect(p.cpiK).toBeCloseTo(1, 9)
    }
  })
  it('계획 기간(100일)에 완료하고 비용은 BAC와 같다', () => {
    const b = linearBaseline()
    const rows: ActualRow[] = [{ day: 100, cum: { dev: 100 }, effort: 1000 }]
    const [p] = run(b, rows)
    expect(p?.progress).toBeCloseTo(1)
    expect(p?.ev).toBeCloseTo(b.bac)
    expect(p?.ac).toBe(b.bac)
  })
})

describe('책 표 6.18 매트릭스: 생산성·인원 9조합', () => {
  // 계획: 생산성 1, 인원 10. 실적의 CPI = 생산성 비, SPI = 생산성 비 × 인원 비.
  const P0 = 1
  const S0 = 10
  const sign = (x: number | null) => (x === null ? NaN : Math.abs(x - 1) < 1e-9 ? 0 : x > 1 ? 1 : -1)
  const cases: [string, number, number, number, number | 'both'][] = [
    // [이름, 생산성, 인원, CPI 부호, SPI 부호]
    ['생산성>, 인원>', 1.2, 12, 1, 1],
    ['생산성>, 인원=', 1.2, 10, 1, 1],
    ['생산성=, 인원>', 1, 12, 0, 1],
    ['생산성=, 인원=', 1, 10, 0, 0],
    ['생산성=, 인원<', 1, 8, 0, -1],
    ['생산성<, 인원=', 0.8, 10, -1, -1],
    ['생산성<, 인원<', 0.8, 8, -1, -1]
  ]
  it.each(cases)('%s', (_n, p, s, cpiSign, spiSign) => {
    const b = linearBaseline(1000, 100, S0) // 계획 속도 10 태스크/일 → 생산성 1 × 인원 10
    const [pt] = run(b, [{ day: 50, cum: { dev: p * s * 50 }, effort: s * 50 }])
    expect(sign(pt?.cpi ?? null)).toBe(cpiSign)
    expect(sign(pt?.spi ?? null)).toBe(spiSign)
    void P0
  })
  it('불확정 칸(생산성>, 인원<)은 크기에 따라 SPI의 부호가 달라진다', () => {
    const b = linearBaseline(1000, 100, S0)
    const [a] = run(b, [{ day: 50, cum: { dev: 1.1 * 9 * 50 }, effort: 9 * 50 }]) // 1.1×9 = 9.9 < 10
    const [c] = run(b, [{ day: 50, cum: { dev: 1.5 * 9 * 50 }, effort: 9 * 50 }]) // 13.5 > 10
    expect(a?.cpi).toBeGreaterThan(1)
    expect(c?.cpi).toBeGreaterThan(1)
    expect(a?.spi).toBeLessThan(1)
    expect(c?.spi).toBeGreaterThan(1)
  })
  it('불확정 칸(생산성<, 인원>)도 두 부호가 모두 나온다', () => {
    const b = linearBaseline(1000, 100, S0)
    const [a] = run(b, [{ day: 50, cum: { dev: 0.9 * 11 * 50 }, effort: 11 * 50 }]) // 9.9
    const [c] = run(b, [{ day: 50, cum: { dev: 0.9 * 15 * 50 }, effort: 15 * 50 }]) // 13.5
    expect(a?.cpi).toBeLessThan(1)
    expect(c?.cpi).toBeLessThan(1)
    expect(a?.spi).toBeLessThan(1)
    expect(c?.spi).toBeGreaterThan(1)
  })
})

describe('책 시험 2단계(정성): 생산성이 계획보다 낮다', () => {
  it('CPI·SPI < 1이고 편차는 시간이 갈수록 음으로 커진다', () => {
    const b = linearBaseline()
    const pts = run(b, work(0.08, 10, 80)) // 생산성 80%
    for (const p of pts) {
      expect(p.cpi).toBeCloseTo(0.8, 9)
      expect(p.spi).toBeCloseTo(0.8, 9)
    }
    const sv = pts.map((p) => p.sv)
    for (let i = 1; i < sv.length; i++) expect(sv[i]).toBeLessThan(sv[i - 1] as number)
  })
})

describe('계산 불가', () => {
  it('첫 보고일에 AC=0이면 CPI가 null이다', () => {
    const b = linearBaseline()
    const [p] = run(b, [{ day: 5, cum: { dev: 0 }, effort: 0 }])
    expect(p?.cpi).toBeNull()
    expect(p?.spi).toBe(0)
  })
  it('PV=0인 시각(day 0)에서 SPI가 null이다', () => {
    const b = linearBaseline()
    const [p] = run(b, [{ day: 0, cum: { dev: 0 }, effort: 0 }])
    expect(p?.spi).toBeNull()
    expect(p?.cpi).toBeNull()
  })
  it('범위가 늘어 P가 1을 넘어도 숨기지 않는다', () => {
    const b = linearBaseline()
    const [p] = run(b, [{ day: 100, cum: { dev: 130 }, effort: 1000 }])
    expect(p?.progress).toBeCloseTo(1.3)
  })
})

describe('구간 지수와 추세(책 p.457)', () => {
  // 쉬운 일을 먼저: 초반에 빠르고 이후 느려진다.
  const easyFirst = (): { b: Baseline; rows: ActualRow[] } => {
    const b = linearBaseline()
    const rows: ActualRow[] = []
    let done = 0
    for (let w = 1; w <= 12; w++) {
      done += Math.max(1, 15 - w * 1.2) // 주당 완료량이 줄어듦
      rows.push({ day: w * 7, cum: { dev: done }, effort: w * 7 * 10 })
    }
    return { b, rows }
  }
  it('누적 CPI는 높게 남고 구간 CPI는 계속 하락한다', () => {
    const { b, rows } = easyFirst()
    const pts = run(b, rows)
    const last = pts[pts.length - 1]!
    expect(last.cpi!).toBeGreaterThan(last.cpiK!)
    const k = pts.map((p) => p.cpiK)
    expect(isWorsening(k)).toBe(true)
    expect(isWorsening(pts.map((p) => p.cpi))).toBe(true)
  })
  it('i < k이면 출발점부터 센다(누적과 같다)', () => {
    const { b, rows } = easyFirst()
    const pts = run(b, rows, 3)
    expect(pts[0]!.cpiK).toBeCloseTo(pts[0]!.cpi!)
    expect(pts[2]!.cpiK).toBeCloseTo(pts[2]!.cpi!)
  })
  it('windowIndices: 분모가 0이면 null', () => {
    const pts = [{ pv: 10, ev: 5, ac: 20 }, { pv: 10, ev: 8, ac: 20 }]
    expect(windowIndices(pts, 1, 1)).toEqual({ cpi: null, spi: null })
  })
  it('isWorsening: 연속 3번 하락이 필요하고 null이 섞이면 아니다', () => {
    expect(isWorsening([1, 0.9, 0.8, 0.7])).toBe(true)
    expect(isWorsening([1, 0.9, 0.8])).toBe(false)
    expect(isWorsening([1, 0.9, 0.95, 0.7])).toBe(false)
    expect(isWorsening([1, 0.9, null, 0.7])).toBe(false)
    expect(isWorsening([1, 0.9, 0.9, 0.7])).toBe(false)
    expect(isWorsening([0.8, 0.7, 0.6, 0.5, 0.4], 4)).toBe(true)
  })
})

describe('진척률', () => {
  it('단계별 인정 비율을 합산하고 비어 있는 단계는 0이다', () => {
    expect(progressFromCum(THREE, { dev: 100, qa: 50, test: 20 }, 100)).toBeCloseTo(0.5 + 0.1 + 0.06)
    expect(progressFromCum(THREE, { dev: 100 }, 100)).toBeCloseTo(0.5)
  })
  const planAsActuals = (base: Baseline, days: number[]): ActualRow[] =>
    days.map((d) => {
      const cum: Record<string, number> = {}
      for (const c of base.credits) cum[c.variable] = (base.series.progress[d] as number) * base.totalTasks // 단일 인정 단계에서만 정확
      return { day: d, cum, effort: base.series.effort[d] as number }
    })

  it('시뮬레이션 기준선(Brooks)에서도 실적 = 계획이면 CPI = SPI = 1(비용 정렬)', () => {
    const result = runModel(compileModel(brooksModel))
    const base = buildBaseline(result, { credits: [{ variable: 'developed_software', weight: 1 }], totalTasks: 500, effortVariable: 'cum_effort', completion: 274.12 })
    const rows = planAsActuals(base, [20, 50, 100, 200, 270])
    const pts = evmSeries(base, rows, validateActuals(rows, base.credits, base.totalTasks))
    expect(pts).toHaveLength(5)
    for (const p of pts) {
      expect(p.cpi).toBeCloseTo(1, 3)
      expect(p.spi).toBeCloseTo(1, 3)
      expect(p.cv).toBeCloseTo(0, 1)
      expect(p.sv).toBeCloseTo(0, 1)
    }
  })

  it('통합 모델 기준선(3단계 인정)에서도 실적 = 계획이면 CPI = SPI = 1', () => {
    const result = runModel(compileModel(integratedProjectModel))
    const credits: EvmCredit[] = [
      { variable: 'prod_tasks_developed', weight: 0.5 },
      { variable: 'prod_tasks_qaed', weight: 0.2 },
      { variable: 'prod_tasks_tested', weight: 0.3 }
    ]
    const completion = Number(result.meta.completed ? result.time[result.time.length - 1] : 300)
    const base = buildBaseline(result, { credits, totalTasks: 400, effortVariable: 'ctl_cum_md', completion: Math.min(completion, 300) })
    // 계획 시뮬레이션의 단계별 완료량을 그대로 실적으로 입력한다.
    const rows: ActualRow[] = [40, 90, 150, 220].map((d) => ({
      day: d,
      cum: Object.fromEntries(credits.map((c) => [c.variable, valueAt(result, c.variable, d)])),
      effort: valueAt(result, 'ctl_cum_md', d)
    }))
    const pts = evmSeries(base, rows, validateActuals(rows, credits, 400))
    expect(pts.length).toBe(4)
    for (const p of pts) {
      expect(p.cpi).toBeCloseTo(1, 2)
      expect(p.spi).toBeCloseTo(1, 2)
    }
  })

  it('계획과 같은 진척을 계획보다 많은 공수로 하면 CPI가 낮다(진척 곡선과 무관)', () => {
    const result = runModel(compileModel(brooksModel))
    const base = buildBaseline(result, { credits: [{ variable: 'developed_software', weight: 1 }], totalTasks: 500, effortVariable: 'cum_effort', completion: 274.12 })
    const rows = planAsActuals(base, [100]).map((r) => ({ ...r, effort: r.effort * 1.25 }))
    const [p] = evmSeries(base, rows, validateActuals(rows, base.credits, base.totalTasks))
    expect(p?.cpi).toBeCloseTo(0.8, 3)
    expect(p?.spi).toBeCloseTo(1, 3)
  })
})

describe('validateActuals', () => {
  const row = (day: number, dev: number, effort: number, extra: Partial<ActualRow> = {}): ActualRow => ({ day, cum: { dev, qa: 0, test: 0 }, effort, ...extra })
  const v = (rows: ActualRow[]) => validateActuals(rows, THREE, 100)

  it('정상 행은 오류도 경고도 없다', () => {
    expect(v([row(7, 10, 70), row(14, 20, 140)])).toEqual([{ errors: [], warnings: [] }, { errors: [], warnings: [] }])
  })
  it('보고일은 0 이상이고 엄격히 증가해야 한다', () => {
    const r = v([row(7, 10, 70), row(7, 12, 80), row(3, 12, 80), row(-1, 0, 0)])
    expect(r[1]!.errors[0]).toContain('이전 행')
    expect(r[2]!.errors[0]).toContain('이전 행')
    expect(r[3]!.errors[0]).toContain('0 이상')
  })
  it('오류 행은 다음 행의 비교 기준이 되지 않는다', () => {
    const r = v([row(10, 1, 1), row(5, 1, 1), row(8, 2, 2), row(12, 3, 3)])
    expect(r[1]!.errors).toHaveLength(1)
    expect(r[2]!.errors).toHaveLength(1) // 8은 오류 행(5)이 아니라 마지막 정상 행(10)과 비교한다
    expect(r[3]!.errors).toEqual([])
  })
  it.each([
    ['NaN 공수', row(7, 10, NaN)],
    ['음수 공수', row(7, 10, -1)],
    ['음수 태스크', row(7, -1, 5)],
    ['무한대 태스크', row(7, Infinity, 5)],
    ['음수 인원', row(7, 1, 5, { headcount: -2 })],
    ['음수 결함', row(7, 1, 5, { defects: -1 })],
    ['긴 메모', row(7, 1, 5, { note: 'x'.repeat(201) })]
  ])('오류: %s', (_n, r) => {
    expect(v([r])[0]!.errors.length).toBeGreaterThan(0)
  })
  it('누적값이 줄면 경고(오류 아님)', () => {
    const r = v([row(7, 20, 100), row(14, 15, 90)])
    expect(r[1]!.errors).toEqual([])
    expect(r[1]!.warnings.some((w) => w.includes("'dev'"))).toBe(true)
    expect(r[1]!.warnings.some((w) => w.includes('공수'))).toBe(true)
  })
  it('개발 ≥ QA ≥ 시험 순서가 어긋나면 경고', () => {
    const r = v([{ day: 7, cum: { dev: 5, qa: 8, test: 0 }, effort: 10 }])
    expect(r[0]!.errors).toEqual([])
    expect(r[0]!.warnings.some((w) => w.includes('단계 순서'))).toBe(true)
  })
  it('개발 완료 > 총 태스크 × 1.5이면 범위 증가 경고', () => {
    expect(v([row(7, 151, 10)])[0]!.warnings.some((w) => w.includes('범위 증가'))).toBe(true)
    expect(v([row(7, 150, 10)])[0]!.warnings.some((w) => w.includes('범위 증가'))).toBe(false)
  })
  it('비어 있는 단계는 경고하고 0으로 본다', () => {
    const r = validateActuals([{ day: 7, cum: { dev: 5 }, effort: 10 }], THREE, 100)
    expect(r[0]!.errors).toEqual([])
    expect(r[0]!.warnings.filter((w) => w.includes('비어')).length).toBe(2)
  })
  it(`행은 최대 ${MAX_ACTUAL_ROWS}개`, () => {
    const rows = Array.from({ length: MAX_ACTUAL_ROWS + 1 }, (_, i) => row(i + 1, 0, 0))
    const r = v(rows)
    expect(r[MAX_ACTUAL_ROWS - 1]!.errors).toEqual([])
    expect(r[MAX_ACTUAL_ROWS]!.errors[0]).toContain('최대')
  })
  it('오류 행은 계산에서 제외되고 다른 행은 계산된다', () => {
    const b = linearBaseline()
    const rows = [{ day: 10, cum: { dev: 10 }, effort: 100 }, { day: 20, cum: { dev: -5 }, effort: 200 }, { day: 30, cum: { dev: 30 }, effort: 300 }]
    const pts = run(b, rows)
    expect(pts.map((p) => p.day)).toEqual([10, 30])
    expect(pts.map((p) => p.index)).toEqual([0, 2])
  })
})
