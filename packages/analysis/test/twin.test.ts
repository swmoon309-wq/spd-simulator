import { describe, expect, it } from 'vitest'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectModel } from '@spd/models'
import { buildBaseline, evmSeries, forecastAt, integratedReforecast, lastOf, reforecast, validateActuals, valueAt, type ActualRow, type EvmCredit } from '../src'

/**
 * 쌍둥이 실험(설계 05의 7.4): "진짜 프로젝트"를 기준선(계획)과 다른 파라미터로 시뮬레이션해 만들고, t_now까지의
 * 주간 실적을 표본으로 입력해 재예측한 완료일의 오차를 기준선 계획의 오차와 비교한다.
 *
 * 합격 기준(첫 실험 결과를 보고 정함 — 설계 문서가 그렇게 하도록 했다):
 *   계획 오차가 5일 이상인 모든 경우에서
 *   (1) 재예측 오차의 중앙 감소율 ≥ 50%  (2) 재예측 오차 < 계획 오차인 비율 ≥ 80%  (3) 계획 오차보다 5일 넘게 나빠진 경우가 없다.
 *   재예측 값은 누적 κ와 최근 구간 κ로 낸 두 완료일의 중간값이다.
 */
const model = compileModel(integratedProjectModel)
const done = (r: RunResult): number | null => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null)
const credits: EvmCredit[] = [
  { variable: 'prod_tasks_developed', weight: 0.5 },
  { variable: 'prod_tasks_qaed', weight: 0.2 },
  { variable: 'prod_tasks_tested', weight: 0.3 }
]
const planRun = runModel(model)
const plan = done(planRun) as number
const baseline = buildBaseline(planRun, { credits, totalTasks: 400, effortVariable: 'ctl_cum_md', completion: plan })

export const TWINS: [string, Record<string, number>][] = [
  ['초기 인원 3, 과소추정 없음', { initial_pros: 3, plan_known_fraction: 1 }],
  ['숙련 생산성 0.7배', { pro_prod: 0.7 }],
  ['숙련 생산성 1.3배', { pro_prod: 1.3 }],
  ['초기 인원 3', { initial_pros: 3 }],
  ['과소추정 없음', { plan_known_fraction: 1 }],
  ['계획 일정 150일', { planned_duration_days: 150 }],
  // 기본 설정에서는 결과에 영향이 없는 파라미터(진짜 = 계획). 재예측이 해를 끼치지 않는지 본다.
  ['채용 지연 40일(영향 없음)', { hiring_delay: 40 }],
  ['신입 생산성 0.5배(영향 없음)', { new_prod: 0.5 }]
]
const T_NOW = [50, 100, 150]

interface Case {
  twin: string
  tNow: number
  truth: number
  planError: number
  kCum: number
  kRecent: number
  /** 두 완료일 */
  cum: number
  recent: number
  mid: number
  error: number
  /** 지표 기반 예측(획득 일정, 누적)의 오차. 산출 불가면 null */
  metricError: number | null
}

function runCase(name: string, overrides: Record<string, number>, tNow: number): Case | null {
  const truthRun = runModel(model, { overrides })
  const truth = done(truthRun)
  if (truth === null || tNow >= truth) return null
  const reports: ActualRow[] = []
  for (let d = 7; d < tNow; d += 7) reports.push(report(truthRun, d))
  reports.push(report(truthRun, tNow))
  const points = evmSeries(baseline, reports, validateActuals(reports, credits, 400), 3)
  const last = points[points.length - 1]!
  const kCum = last.cpi as number
  const kRecent = last.cpiK as number
  const row = reports[reports.length - 1]!
  const out = reforecast(model, {
    adapter: integratedReforecast,
    params: {},
    options: {},
    observed: { day: tNow, cum: row.cum, effort: row.effort, ...(row.headcount !== undefined ? { headcount: row.headcount } : {}) },
    kappas: [{ name: 'cum', kappa: kCum }, { name: 'recent', kappa: kRecent }]
  })
  const cum = done(out.runs[0]!.result) as number
  const recent = done(out.runs[1]!.result) as number
  const mid = (cum + recent) / 2
  const metric = forecastAt(baseline, points, points.length - 1, 3).cumulative.completionDay
  return { twin: name, tNow, truth, planError: Math.abs(plan - truth), kCum, kRecent, cum, recent, mid, error: Math.abs(mid - truth), metricError: metric === null ? null : Math.abs(metric - truth) }
}

function report(truthRun: RunResult, day: number): ActualRow {
  return {
    day,
    cum: Object.fromEntries(credits.map((c) => [c.variable, valueAt(truthRun, c.variable, day)])),
    effort: valueAt(truthRun, 'ctl_cum_md', day),
    headcount: valueAt(truthRun, 'hr_total', day)
  }
}

const cases: Case[] = TWINS.flatMap(([n, o]) => T_NOW.map((t) => runCase(n, o, t))).filter((c): c is Case => c !== null)
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number
const informative = cases.filter((c) => c.planError >= 5)
const reduction = (c: Case) => 1 - c.error / c.planError

describe('쌍둥이 실험: 시뮬레이션 기반 재예측의 유효성', () => {
  it('실험 규모: 계획과 다른 진짜 프로젝트 6종 × 3개 시점 = 18건', () => {
    expect(informative).toHaveLength(18)
    expect(new Set(informative.map((c) => c.twin)).size).toBe(6)
  })
  it('(1) 재예측 오차의 중앙 감소율이 50% 이상이다', () => {
    expect(median(informative.map(reduction))).toBeGreaterThanOrEqual(0.5)
  })
  it('(2) 재예측이 계획보다 정확한 경우가 80% 이상이다', () => {
    const wins = informative.filter((c) => c.error < c.planError).length
    expect(wins / informative.length).toBeGreaterThanOrEqual(0.8)
  })
  it('(3) 계획 오차보다 5일 넘게 나빠진 경우가 없다', () => {
    for (const c of informative) expect(c.error - c.planError, `${c.twin} ${c.tNow}일`).toBeLessThanOrEqual(5)
  })
  it('t_now = 50·100·150일 각각에서도 중앙 감소율이 50% 이상이다', () => {
    for (const t of T_NOW) expect(median(informative.filter((c) => c.tNow === t).map(reduction)), `${t}일`).toBeGreaterThanOrEqual(0.5)
  })
  it('진짜 = 계획인 경우(영향 없는 파라미터)에도 오차가 2일을 넘지 않는다(해를 끼치지 않음)', () => {
    const same = cases.filter((c) => c.planError < 5)
    expect(same.length).toBeGreaterThanOrEqual(6)
    for (const c of same) expect(c.error, `${c.twin} ${c.tNow}일`).toBeLessThanOrEqual(2)
  })
  it('생산성이 다른 진짜 프로젝트(숙련 0.7배)에서는 50일에 이미 오차가 80% 넘게 줄어든다', () => {
    const c = informative.find((x) => x.twin === '숙련 생산성 0.7배' && x.tNow === 50) as Case
    expect(reduction(c)).toBeGreaterThan(0.8)
  })
  // 알려진 한계(특성화): 관측할 수 없는 계획 쪽 상태(인식 규모, 계획 일정)가 다른 프로젝트는 이른 시점에 개선이 작다.
  it('한계: 계획 쪽이 다른 진짜 프로젝트는 50일 시점에 개선이 50%에 못 미친다', () => {
    for (const name of ['계획 일정 150일', '과소추정 없음', '초기 인원 3, 과소추정 없음']) {
      const c = informative.find((x) => x.twin === name && x.tNow === 50) as Case
      expect(reduction(c), name).toBeLessThan(0.5)
    }
  })
  it('한계: 생산성이 30% 높은 프로젝트는 150일에 계획보다 나아지지 않는다(κ가 실제 생산성 변화를 다 담지 못함)', () => {
    const c = informative.find((x) => x.twin === '숙련 생산성 1.3배' && x.tNow === 150) as Case
    expect(reduction(c)).toBeLessThan(0.1)
  })
  it('κ는 CPI에서 오므로 생산성이 낮은 프로젝트는 κ < 1, 높은 프로젝트는 κ > 1이다', () => {
    for (const t of T_NOW) {
      expect((informative.find((x) => x.twin === '숙련 생산성 0.7배' && x.tNow === t) as Case).kCum).toBeLessThan(1)
      expect((informative.find((x) => x.twin === '숙련 생산성 1.3배' && x.tNow === t) as Case).kCum).toBeGreaterThan(1)
    }
  })

  // 지표 기반 예측(획득 일정)과의 비교. 두 방법은 잘 맞추는 경우가 반대다.
  it('비교: 지표 기반 예측은 생산성이 다른 경우 크게 빗나가고, 계획 쪽이 다른 경우에는 재예측보다 낫다', () => {
    const get = (twin: string, t: number) => informative.find((x) => x.twin === twin && x.tNow === t) as Case
    // 숙련 생산성 0.7배, 50일: 재예측은 3.3일, 지표 기반 예측은 90일 가까이 빗나간다
    expect(get('숙련 생산성 0.7배', 50).error).toBeLessThan(5)
    expect(get('숙련 생산성 0.7배', 50).metricError as number).toBeGreaterThan(50)
    // 과소추정 없음, 50일: 지표 기반 예측이 재예측보다 정확하다
    expect(get('과소추정 없음', 50).metricError as number).toBeLessThan(get('과소추정 없음', 50).error)
    // 전체적으로 지표 기반 예측은 계획보다 나아지지 않는다(중앙 감소율이 0 이하)
    const reds = informative.filter((c) => c.metricError !== null).map((c) => 1 - (c.metricError as number) / c.planError)
    expect(median(reds)).toBeLessThanOrEqual(0)
  })
})
