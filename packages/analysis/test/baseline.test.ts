import { describe, expect, it } from 'vitest'
import { compileModel, runModel } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '@spd/models'
import { buildBaseline, evAt, plannedFinalProgress, pvAt, progressAt, validateCredits, valueAt, type Baseline, type EvmCredit } from '../src'

const brooks = () => runModel(compileModel(brooksModel))
const integrated = () => runModel(compileModel(integratedProjectModel))
const BROOKS_CREDITS: EvmCredit[] = [{ variable: 'developed_software', weight: 1 }]
const INTEGRATED_CREDITS: EvmCredit[] = [
  { variable: 'prod_tasks_developed', weight: 0.5 },
  { variable: 'prod_tasks_qaed', weight: 0.2 },
  { variable: 'prod_tasks_tested', weight: 0.3 }
]

describe('validateCredits', () => {
  it('합이 1인 비율을 통과시킨다', () => {
    expect(validateCredits(INTEGRATED_CREDITS)).toBeNull()
    expect(validateCredits(BROOKS_CREDITS)).toBeNull()
  })
  it.each([
    ['빈 목록', [], '하나 이상'],
    ['합이 1이 아님', [{ variable: 'a', weight: 0.5 }, { variable: 'b', weight: 0.4 }], '합이 1'],
    ['음수', [{ variable: 'a', weight: -0.1 }, { variable: 'b', weight: 1.1 }], '0 이상 1 이하'],
    ['1 초과', [{ variable: 'a', weight: 1.5 }], '0 이상 1 이하'],
    ['비유한', [{ variable: 'a', weight: NaN }], '0 이상 1 이하'],
    ['중복 변수', [{ variable: 'a', weight: 0.5 }, { variable: 'a', weight: 0.5 }], '겹칩니다']
  ])('%s은 거부한다', (_n, credits, message) => {
    expect(validateCredits(credits as EvmCredit[])).toContain(message)
  })
  it('부동소수 잡음(0.1+0.2+0.7)은 허용한다', () => {
    expect(validateCredits([{ variable: 'a', weight: 0.1 }, { variable: 'b', weight: 0.2 }, { variable: 'c', weight: 0.7 }])).toBeNull()
  })
})

describe('buildBaseline: Brooks', () => {
  const r = brooks()
  const completion = 274.123
  const b = buildBaseline(r, { credits: BROOKS_CREDITS, totalTasks: 500, effortVariable: 'cum_effort', completion })

  it('BAC는 완료 시점의 누적 공수(20명 × 274.1일 ≈ 5,482 맨데이)이다', () => {
    expect(b.bac).toBeCloseTo(5482.5, 0)
    expect(b.plannedCompletion).toBeCloseTo(274.123, 3)
  })
  it('1일 간격으로 0~400일을 표본화한다(401개 점)', () => {
    expect(b.series.time).toHaveLength(401)
    expect(b.series.time[0]).toBe(0)
    expect(b.series.time[400]).toBe(400)
    expect(b.series.time.every((t, i) => t === i)).toBe(true)
    expect(b.series.progress).toHaveLength(401)
    expect(b.series.effort).toHaveLength(401)
  })
  it('진척률은 0에서 시작해 단조 증가하고 완료 시점에 1이 된다', () => {
    expect(b.series.progress[0]).toBe(0)
    for (let i = 1; i < b.series.progress.length; i++) expect(b.series.progress[i] as number).toBeGreaterThanOrEqual(b.series.progress[i - 1] as number)
    expect(b.series.progress[275]).toBeCloseTo(1, 5)
    expect(b.series.progress[400]).toBeCloseTo(1, 5)
  })
  it('진행 중 진척률은 개발 완료 규모 ÷ 500과 같다', () => {
    expect(b.series.progress[100]).toBeCloseTo(valueAt(r, 'developed_software', 100) / 500, 5)
    expect(b.series.progress[100]).toBeCloseTo((1.824 * 100) / 500, 4)
  })
  it('누적 공수는 20명 × 일수이다', () => {
    expect(b.series.effort[100]).toBeCloseTo(2000, 3)
    expect(b.series.effort[0]).toBe(0)
  })
  it('값은 모두 유한하고 소수 6자리로 반올림되어 있다', () => {
    for (const v of [...b.series.progress, ...b.series.effort, ...b.series.time]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(Number(v.toFixed(6))).toBe(v)
    }
  })
  it('JSON으로 저장했다가 읽어도 같다', () => {
    expect(JSON.parse(JSON.stringify(b))).toEqual(b)
  })
})

describe('buildBaseline: 통합 프로젝트 모델', () => {
  const r = integrated()
  const completion = 314.25
  const b = buildBaseline(r, { credits: INTEGRATED_CREDITS, totalTasks: 400, effortVariable: 'ctl_cum_md', completion })

  it('BAC ≈ 1,224 맨데이, 계획 완료 314.25일', () => {
    expect(b.bac).toBeCloseTo(1224, -1)
    expect(b.plannedCompletion).toBe(314.25)
  })
  it('진척률은 단조 증가하고 완료 시점에 거의 1이다(시험 완료 기준이 총량 − 0.5라 정확히 1은 아니다)', () => {
    for (let i = 1; i < b.series.progress.length; i++) expect(b.series.progress[i] as number).toBeGreaterThanOrEqual((b.series.progress[i - 1] as number) - 1e-9)
    expect(b.series.progress[315]).toBeGreaterThan(0.999)
    expect(b.series.progress[315]).toBeLessThanOrEqual(1.0001)
  })
  it('단계별 인정: 초반에는 개발 완료만 진척으로 잡힌다', () => {
    const t = 50
    const dev = valueAt(r, 'prod_tasks_developed', t)
    expect(valueAt(r, 'prod_tasks_tested', t)).toBe(0)
    const expected = (0.5 * dev + 0.2 * valueAt(r, 'prod_tasks_qaed', t)) / 400
    expect(b.series.progress[t]).toBeCloseTo(expected, 5)
    expect(b.series.progress[t]).toBeGreaterThan(0)
  })
  it('가중치를 바꾸면 진척률이 달라지지만 BAC와 완료 시각은 같다', () => {
    const tested = buildBaseline(r, { credits: [{ variable: 'prod_tasks_tested', weight: 1 }], totalTasks: 400, effortVariable: 'ctl_cum_md', completion })
    expect(tested.series.progress[100]).toBe(0) // 시험이 시작되기 전에는 진척이 없다
    expect(b.series.progress[100]).toBeGreaterThan(0.1)
    expect(tested.bac).toBe(b.bac)
  })
  it('시험이 끝난 뒤 인력이 빠지는 구간의 공수도 계속 쌓인다(BAC는 완료 시점 값)', () => {
    expect(b.series.effort[400] as number).toBeGreaterThan(b.bac)
  })
  it('progressAt은 시각 사이를 선형 보간한 값을 쓴다', () => {
    expect(progressAt(r, INTEGRATED_CREDITS, 400, 100.125)).toBeCloseTo(b.series.progress[100] as number, 2)
  })
})

describe('buildBaseline: 입력 검사', () => {
  const r = brooks()
  const ok = { credits: BROOKS_CREDITS, totalTasks: 500, effortVariable: 'cum_effort', completion: 274 }
  it.each([
    ['완료하지 못함(NaN)', { completion: NaN }, '완료하지 못한'],
    ['완료 시각 0', { completion: 0 }, '완료하지 못한'],
    ['총 태스크 0', { totalTasks: 0 }, '총 태스크'],
    ['비율 합이 1이 아님', { credits: [{ variable: 'developed_software', weight: 0.5 }] }, '비율'],
    ['표본 간격 0', { step: 0 }, '표본 간격']
  ])('%s은 오류', (_n, over, message) => {
    expect(() => buildBaseline(r, { ...ok, ...over })).toThrow(message)
  })
  it('없는 변수는 변수 이름을 담아 오류', () => {
    expect(() => buildBaseline(r, { ...ok, effortVariable: 'nope' })).toThrow(/nope/)
  })
  it('표본 간격을 바꿀 수 있다(5일 → 81개 점)', () => {
    expect(buildBaseline(r, { ...ok, step: 5 }).series.time).toHaveLength(81)
  })
  it('입력 결과와 인정 비율 객체를 바꾸지 않고 복사해 담는다', () => {
    const credits = [{ variable: 'developed_software', weight: 1 }]
    const b = buildBaseline(r, { ...ok, credits })
    credits[0]!.weight = 0.5
    expect(b.credits[0]?.weight).toBe(1)
  })
})

describe('pvAt (계획 공수 곡선)', () => {
  const b = buildBaseline(brooks(), { credits: BROOKS_CREDITS, totalTasks: 500, effortVariable: 'cum_effort', completion: 274.123 })
  it('표본점에서는 계획 공수와 정확히 같다', () => {
    expect(pvAt(b, 100)).toBeCloseTo(b.series.effort[100] as number, 9)
  })
  it('표본 사이는 선형 보간한다', () => {
    const mid = (pvAt(b, 100) + pvAt(b, 101)) / 2
    expect(pvAt(b, 100.5)).toBeCloseTo(mid, 9)
  })
  it('시작 전은 0이고 계획 완료 뒤에는 BAC로 평평하다', () => {
    expect(pvAt(b, -5)).toBe(0)
    expect(pvAt(b, 274.123)).toBeCloseTo(b.bac, 3)
    expect(pvAt(b, 300)).toBeCloseTo(b.bac, 9)
    expect(pvAt(b, 1000)).toBeCloseTo(b.bac, 9)
  })
  it('시간에 따라 줄어들지 않는다', () => {
    let prev = -1
    for (let t = 0; t <= 400; t += 7.3) {
      const v = pvAt(b, t)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
  it('표본이 없으면 0', () => {
    expect(pvAt({ bac: 10, plannedCompletion: 5, series: { time: [], progress: [], effort: [] } }, 5)).toBe(0)
  })
})

describe('evAt (계획이 그 진척에 도달할 때까지 쓴 공수)', () => {
  const b = buildBaseline(brooks(), { credits: BROOKS_CREDITS, totalTasks: 500, effortVariable: 'cum_effort', completion: 274.123 })
  it('계획의 진척을 넣으면 같은 시각의 계획 공수가 나온다(비용 정렬)', () => {
    for (const d of [10, 50, 100, 200, 270]) expect(evAt(b, b.series.progress[d] as number)).toBeCloseTo(b.series.effort[d] as number, 3)
  })
  it('진척 0 이하는 0, 계획 완료 진척은 BAC', () => {
    expect(evAt(b, 0)).toBe(0)
    expect(evAt(b, -1)).toBe(0)
    expect(evAt(b, plannedFinalProgress(b))).toBeCloseTo(b.bac, 6)
  })
  it('진척이 늘면 줄어들지 않는다', () => {
    let prev = -1
    for (let p = 0; p <= 1.2; p += 0.013) {
      const v = evAt(b, p)
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = v
    }
  })
  it('범위가 늘어 계획 완료 진척을 넘으면 BAC에 비례해 늘린다', () => {
    const pEnd = plannedFinalProgress(b)
    expect(evAt(b, pEnd * 1.3)).toBeCloseTo(b.bac * 1.3, 6)
  })
  it('진척이 평탄한 구간에서는 처음 도달한 시각의 공수를 쓴다', () => {
    const flat: Baseline = {
      credits: BROOKS_CREDITS,
      totalTasks: 10,
      bac: 100,
      plannedCompletion: 4,
      series: { time: [0, 1, 2, 3, 4], progress: [0, 0.5, 0.5, 0.5, 1], effort: [0, 20, 40, 60, 100] }
    }
    expect(evAt(flat, 0.5)).toBeCloseTo(20, 9)
    expect(evAt(flat, 0.75)).toBeCloseTo(80, 9)
    expect(evAt(flat, 0.25)).toBeCloseTo(10, 9)
  })
})
