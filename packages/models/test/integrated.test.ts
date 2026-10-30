import { beforeAll, describe, expect, it } from 'vitest'
import { compileModel, runModel, type CompiledModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectModel } from '../src'

/**
 * 통합 프로젝트 모델(4섹터 단순판) 검증. 명세 docs/02.설계/03의 6.3(불변식)과 6.2(정성 거동)를 따른다.
 *
 * 이 모델은 책의 .itm 모델이 없어 구조를 따라 새로 설계한 것이라 수치가 책 그림과 정량적으로 일치하지 않는다.
 * 그래서 정량 값 대신 불변식과 방향·순서 같은 정성 거동을 검증한다.
 */

const END = 450
let model: CompiledModel
const cache = new Map<string, RunResult>()

const run = (overrides: Record<string, number> = {}, opts: { dt?: number; end?: number } = {}): RunResult => {
  const key = JSON.stringify([overrides, opts])
  let r = cache.get(key)
  if (!r) {
    r = runModel(model, { overrides, end: opts.end ?? END, ...(opts.dt ? { dt: opts.dt } : {}) })
    cache.set(key, r)
  }
  return r
}
const s = (r: RunResult, name: string): Float64Array => {
  const x = r.series[name]
  if (!x) throw new Error(`기록되지 않은 변수: ${name}`)
  return x
}
const at = (r: RunResult, name: string, day: number): number => {
  const i = r.time.findIndex((t) => Math.abs(t - day) < 1e-9)
  if (i < 0) throw new Error(`시각 ${day}가 기록에 없습니다`)
  return s(r, name)[i] as number
}
const last = (r: RunResult, name: string): number => s(r, name)[s(r, name).length - 1] as number
const completion = (r: RunResult): number => last(r, 'ctl_completion_time')
const finished = (r: RunResult): boolean => last(r, 'ctl_completion_rate') === 0
const firstIndex = (a: Float64Array, pred: (x: number, i: number) => boolean): number => a.findIndex(pred)

beforeAll(() => {
  model = compileModel(integratedProjectModel)
})

/** 불변식은 다양한 조건(정상, 극단, 일부러 어색한 입력)에서 모두 성립해야 한다. */
const SCENARIOS: [string, Record<string, number>][] = [
  ['기본', {}],
  ['과소추정 없음', { plan_known_fraction: 1 }],
  ['일정 촉박', { planned_duration_days: 120 }],
  ['신입 위주로 시작', { initial_pros: 4, initial_new: 12 }],
  ['과로 없음', { max_boost: 0 }],
  ['빠른 채용·동화', { planned_duration_days: 120, hiring_delay: 10, assim_delay: 20 }],
  ['작은 규모', { total_tasks: 20 }],
  ['큰 규모', { total_tasks: 1500 }],
  ['인원 상한 1명', { max_staff: 1 }],
  ['초기 인원 0명', { initial_pros: 0 }],
  ['과소추정 크게', { plan_known_fraction: 0.3 }]
]
const totalOf = (o: Record<string, number>) => o['total_tasks'] ?? 400

describe('모델 정의', () => {
  it('컴파일되고 모든 상수에 라벨과 단위가 있다', () => {
    expect(model.flows.length).toBeGreaterThan(60)
    for (const [name, c] of Object.entries(integratedProjectModel.constants)) {
      expect(c.label, name).toBeTruthy()
      expect(c.unit, name).toBeTruthy()
    }
  })

  it('명세의 네 섹터 접두어를 모두 쓴다', () => {
    const names = model.names
    for (const prefix of ['hr_', 'plan_', 'prod_', 'ctl_', 'err_', 'exh_']) {
      expect(names.some((n) => n.startsWith(prefix)), prefix).toBe(true)
    }
  })

  it('기본 실행은 종료 시각 안에 끝난다', () => {
    const r = run()
    expect(finished(r)).toBe(true)
    expect(completion(r)).toBeGreaterThan(100)
    expect(completion(r)).toBeLessThan(400)
  })

  it('완료 시각은 시험이 끝난 시각과 한 스텝 이내로 같다', () => {
    const r = run()
    const tested = s(r, 'prod_tasks_tested')
    const i = firstIndex(tested, (x) => x >= 400 - 0.5)
    expect(Math.abs((r.time[i] as number) - completion(r))).toBeLessThanOrEqual(0.25 + 1e-9)
  })
})

describe('6.3 불변식', () => {
  describe.each(SCENARIOS)('%s', (_label, overrides) => {
    const total = totalOf(overrides)

    it('1. 모든 Level은 0 이상이다', () => {
      const r = run(overrides)
      for (const name of Object.keys(integratedProjectModel.levels)) {
        expect(Math.min(...s(r, name)), name).toBeGreaterThanOrEqual(-1e-9)
      }
    })

    it('2. 시험 ≤ QA ≤ 개발 ≤ 총 태스크이고, 개발한 태스크는 QA 파이프라인과 QA 완료로 보존된다', () => {
      const r = run(overrides)
      const dev = s(r, 'prod_tasks_developed')
      const qaed = s(r, 'prod_tasks_qaed')
      const tested = s(r, 'prod_tasks_tested')
      const stages = [s(r, 'prod_qa_s1'), s(r, 'prod_qa_s2'), s(r, 'prod_qa_s3')]
      for (let i = 0; i < r.time.length; i++) {
        expect(tested[i] as number).toBeLessThanOrEqual((qaed[i] as number) + 1e-9)
        expect(qaed[i] as number).toBeLessThanOrEqual((dev[i] as number) + 1e-9)
        expect(dev[i] as number).toBeLessThanOrEqual(total + 1e-9)
        const inQa = stages.reduce((sum, st) => sum + (st[i] as number), 0)
        expect((qaed[i] as number) + inQa).toBeCloseTo(dev[i] as number, 8)
      }
    })

    it('3. 오류 보존: 발생 + 불량 수정 = 잠재 + 검출 + QA 통과 + 수정 완료 + 시험 발견', () => {
      const r = run(overrides)
      const get = (n: string) => s(r, n)
      const gen = get('err_cum_generated')
      const bad = get('err_cum_bad_fixes')
      const pde = get('err_pde')
      const detected = get('err_detected')
      const escaped = get('err_escaped')
      const reworked = get('err_cum_reworked')
      const foundTest = get('err_cum_found_test')
      const foundQa = get('err_cum_found_qa')
      for (let i = 0; i < r.time.length; i++) {
        const lhs = (gen[i] as number) + (bad[i] as number)
        const rhs = (pde[i] as number) + (detected[i] as number) + (escaped[i] as number) + (reworked[i] as number) + (foundTest[i] as number)
        expect(lhs).toBeCloseTo(rhs, 6)
        // QA에서 검출한 오류는 아직 수정 대기이거나 수정 완료이다
        expect(foundQa[i] as number).toBeCloseTo((detected[i] as number) + (reworked[i] as number), 6)
      }
    })

    it('4. 누적 투입 공수는 총 인원의 시간적분(Euler 합)과 같다', () => {
      const r = run(overrides)
      const wf = s(r, 'hr_total')
      const cum = s(r, 'ctl_cum_md')
      let sum = 0
      for (let i = 0; i < r.time.length; i++) {
        expect(cum[i] as number).toBeCloseTo(sum, 6)
        sum += (wf[i] as number) * r.meta.dt
      }
    })

    it('5. 같은 입력은 비트 단위로 같은 결과이고, 모델에 난수가 없어 시드와도 무관하다', () => {
      const a = run(overrides)
      const b = runModel(model, { overrides, end: END, seed: 12345 })
      for (const name of Object.keys(a.series)) {
        const x = s(a, name)
        const y = s(b, name)
        for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) throw new Error(`${name}[${i}]: ${x[i]} ≠ ${y[i]}`)
      }
    })

    it('인식·미발견·반영 대기 태스크의 합은 총 태스크로 보존된다', () => {
      const r = run(overrides)
      const p = s(r, 'ctl_perceived_job_size')
      const u = s(r, 'ctl_undiscovered')
      const d = s(r, 'ctl_discovered')
      for (let i = 0; i < r.time.length; i++) expect((p[i] as number) + (u[i] as number) + (d[i] as number)).toBeCloseTo(total, 8)
    })

    it('소진은 허용 한도를 넘지 않는다', () => {
      const r = run(overrides)
      expect(Math.max(...s(r, 'exh_level'))).toBeLessThanOrEqual((overrides['exh_max_tolerable'] ?? 50) + 1)
    })
  })

  describe('6. 단위: 레이트 단위 × 일 = 레벨 단위', () => {
    const def = integratedProjectModel
    // 1명이 하루 일하면 1맨데이이므로 인원(명)은 맨데이/일로 본다.
    const asPerDay = (unit: string) => (unit === '명' ? '맨데이/일' : unit)
    const unitOf = (name: string) => def.rates[name]?.unit ?? def.auxiliaries[name]?.unit

    it.each(Object.entries(def.levels))('%s', (name, level) => {
      expect(level.unit, `${name}의 단위`).toBeTruthy()
      for (const flow of [...level.inflows, ...level.outflows]) {
        const u = unitOf(flow)
        expect(u, `${flow}의 단위`).toBeTruthy()
        expect(asPerDay(u as string), `${name} ← ${flow}`).toBe(`${level.unit}/일`)
      }
    })

    it('모든 Rate와 Auxiliary에 단위가 있다', () => {
      for (const [n, f] of [...Object.entries(def.rates), ...Object.entries(def.auxiliaries)]) expect(f.unit, n).toBeTruthy()
    })
  })
})

describe('시작 상태', () => {
  it('압박 0, 업무 비율은 기준값, 소진 0, 인력은 초기 인원, 진행은 0이다', () => {
    const r = run()
    expect(at(r, 'ctl_sched_pressure', 0)).toBeCloseTo(0, 9) // 계획 추정과 인식 진척이 같은 생산성에서 출발한다
    expect(at(r, 'prod_frac_manday', 0)).toBeCloseTo(0.6, 9)
    expect(at(r, 'exh_level', 0)).toBe(0)
    expect(at(r, 'hr_total', 0)).toBe(4)
    expect(at(r, 'prod_tasks_developed', 0)).toBe(0)
    expect(at(r, 'plan_sched_completion', 0)).toBe(200)
    expect(at(r, 'ctl_job_size_md', 0)).toBeCloseTo(at(r, 'ctl_initial_estimate_md', 0), 9)
  })

  it('초기 인원이 0이면 신입을 수용할 숙련자가 없어 채용도 진행도 없다', () => {
    const r = run({ initial_pros: 0 })
    expect(Math.max(...s(r, 'hr_total'))).toBe(0)
    expect(last(r, 'prod_tasks_developed')).toBe(0)
    expect(finished(r)).toBe(false)
  })
})

describe('6.2 정성 거동', () => {
  describe('과소추정이 없을 때(plan_known_fraction=1)', () => {
    const r = () => run({ plan_known_fraction: 1 })

    it('인식 규모가 처음부터 끝까지 총 태스크와 같고 발견할 태스크가 없다', () => {
      for (const v of s(r(), 'ctl_perceived_job_size')) expect(v).toBeCloseTo(400, 9)
      expect(Math.max(...s(r(), 'ctl_undiscovered'))).toBeCloseTo(0, 9)
      expect(Math.max(...s(r(), 'ctl_discovered'))).toBeCloseTo(0, 12)
    })

    it('계획 맨데이(작업 예산)이 늘어나지 않는다', () => {
      const budget = s(r(), 'ctl_job_size_md')
      expect(Math.max(...budget) - Math.min(...budget)).toBeCloseTo(0, 6)
    })

    it('끝나며, 과소추정이 있을 때보다 일정 지연이 작다', () => {
      expect(finished(r())).toBe(true)
      expect(completion(r())).toBeLessThan(completion(run()))
      const slip = (completion(r()) - 200) / 200
      expect(slip).toBeGreaterThan(0) // 시험·재작업 노력이 계획에 충분히 반영되지 않아 약간 늦는다
      expect(slip).toBeLessThan(0.5)
    })

    it('채용이 거의 없다(최대 인원이 초기 인원 근처)', () => {
      expect(Math.max(...s(r(), 'hr_total'))).toBeLessThan(4 * 1.5)
    })
  })

  describe('과소추정이 있을 때(기본, plan_known_fraction=0.67)', () => {
    const r = () => run()

    it('인식 규모가 268에서 400까지 줄어들지 않고 늘어난다', () => {
      const p = s(r(), 'ctl_perceived_job_size')
      expect(p[0]).toBeCloseTo(268, 9)
      for (let i = 1; i < p.length; i++) expect(p[i] as number).toBeGreaterThanOrEqual((p[i - 1] as number) - 1e-9)
      expect(p[p.length - 1]).toBeCloseTo(400, 3)
    })

    it('계획 일정이 시간 지연을 두고 늘어난다: 인식 규모가 먼저, 계획 일정이 나중에 오른다', () => {
      const p = s(r(), 'ctl_perceived_job_size')
      const sched = s(r(), 'plan_sched_completion')
      const iPerceived = firstIndex(p, (x) => x >= 268 * 1.1)
      const iSched = firstIndex(sched, (x, i) => i > iPerceived - 1 && x >= 200 * 1.1)
      expect(iPerceived).toBeGreaterThan(0)
      expect(iSched).toBeGreaterThan(iPerceived)
      expect(at(r(), 'plan_sched_completion', Math.floor(completion(r())))).toBeGreaterThan(200 * 1.25)
    })

    it('실제 완료는 초기 계획보다 늦고 투입 공수도 초기 추정을 크게 넘는다', () => {
      expect(completion(r())).toBeGreaterThan(200 * 1.25)
      expect(last(r(), 'ctl_cum_md')).toBeGreaterThan(at(r(), 'ctl_initial_estimate_md', 0) * 1.5)
    })

    it('과소추정이 없을 때보다 더 많은 인원을 투입한다', () => {
      expect(Math.max(...s(r(), 'hr_total'))).toBeGreaterThan(Math.max(...s(run({ plan_known_fraction: 1 }), 'hr_total')))
      expect(Math.max(...s(r(), 'hr_total'))).toBeGreaterThanOrEqual(4 * 1.5)
    })

    it('채용은 계획 일정이 한계 일정에 다가가는 후반에 몰린다(늦은 증원)', () => {
      const hires = s(r(), 'hr_hiring_rate')
      const total = hires.reduce((a, b) => a + b, 0)
      let early = 0
      const split = Math.floor(completion(r()) * 0.5 / 0.25)
      for (let i = 0; i < split; i++) early += hires[i] as number
      expect(total).toBeGreaterThan(0)
      expect(early / total).toBeLessThan(0.3)
    })
  })

  describe('일정 압박이 지속될 때(소진)', () => {
    const r = () => run()

    it('압박이 오르고 업무 비율이 기준(0.6) 위로 올라 소진이 한도에 가까워진다', () => {
      expect(Math.max(...s(r(), 'ctl_sched_pressure'))).toBeGreaterThan(1)
      expect(Math.max(...s(r(), 'prod_frac_manday'))).toBeGreaterThan(0.65)
      expect(Math.max(...s(r(), 'exh_level'))).toBeGreaterThan(50 * 0.9)
    })

    it('소진이 한도에 가까우면 과로 허용이 거의 0이다(과로 지속 불가)', () => {
      const exh = s(r(), 'exh_level')
      const allowed = s(r(), 'prod_overwork_allowed')
      let checked = 0
      for (let i = 0; i < exh.length; i++) {
        if ((exh[i] as number) >= 0.98 * 50) {
          expect(allowed[i] as number).toBeLessThanOrEqual(0.02 + 1e-9)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(0)
    })

    it('압박이 사라지면 소진이 회복된다(완료 후 최대의 절반 이하)', () => {
      const exh = s(r(), 'exh_level')
      expect(last(r(), 'exh_level')).toBeLessThan(Math.max(...exh) / 2)
    })

    it('압박이 크면 QA 인력 비율이 줄어든다(계획 15% → 7.5%)', () => {
      const p = s(r(), 'ctl_sched_pressure')
      const qa = s(r(), 'prod_qa_fraction')
      expect(qa[0]).toBeCloseTo(0.15, 9)
      const i = firstIndex(p, (x) => x >= 1.999)
      expect(i).toBeGreaterThan(0)
      expect(qa[i]).toBeCloseTo(0.075, 9)
    })

    it('압박이 클 때 오류 발생 배수가 1보다 커진다', () => {
      const mult = s(r(), 'err_pressure_mult')
      expect(mult[0]).toBe(1)
      expect(Math.max(...mult)).toBeGreaterThan(1.5)
    })

    it('과로를 막으면(max_boost=0) 소진이 없고 업무 비율이 기준을 넘지 않는다', () => {
      const x = run({ max_boost: 0 })
      expect(Math.max(...s(x, 'exh_level'))).toBe(0)
      expect(Math.max(...s(x, 'prod_frac_manday'))).toBeLessThanOrEqual(0.6 + 1e-9)
    })
  })

  describe('신입이 많은 상태', () => {
    const pros = () => run({ initial_pros: 16 })
    const mixed = () => run({ initial_pros: 4, initial_new: 12 })

    it('같은 인원이라도 신입이 많으면 생산성이 낮고 오류 배수가 높고 가용 인력이 적다', () => {
      const t = 1
      expect(at(mixed(), 'prod_potential', t)).toBeLessThan(at(pros(), 'prod_potential', t) * 0.7)
      expect(at(mixed(), 'err_mix_mult', t)).toBeGreaterThan(1.7) // 신입은 오류를 2배 낸다
      expect(at(pros(), 'err_mix_mult', t)).toBeCloseTo(1, 9)
      expect(at(mixed(), 'hr_avail_mp', t)).toBeLessThan(at(pros(), 'hr_avail_mp', t))
      expect(at(mixed(), 'prod_dev_rate', t)).toBeLessThan(at(pros(), 'prod_dev_rate', t) * 0.6)
    })

    it('신입이 동화되면 오류 배수와 생산성이 회복된다', () => {
      const early = at(mixed(), 'err_mix_mult', 1)
      const later = at(mixed(), 'err_mix_mult', 240)
      expect(later).toBeLessThan(early)
      expect(later).toBeLessThan(1.15)
      expect(at(mixed(), 'hr_new', 240)).toBeLessThan(12 * 0.1)
    })

    it('신입 위주로 시작하면 오류를 더 많이 만든다', () => {
      expect(last(mixed(), 'err_cum_generated') / last(mixed(), 'prod_tasks_developed')).toBeGreaterThan(
        last(pros(), 'err_cum_generated') / last(pros(), 'prod_tasks_developed')
      )
    })
  })

  describe('채용·동화 지연', () => {
    const tight = { planned_duration_days: 120 }
    const fast = () => run({ ...tight, hiring_delay: 10, assim_delay: 20 })
    const slow = () => run({ ...tight, hiring_delay: 80, assim_delay: 160 })

    it('지연이 짧으면 초기 인력 보강이 빠르고 더 일찍 끝난다', () => {
      // 지연이 긴 쪽은 압박이 쌓인 뒤 후반에 몰아서 채용하므로 최대 인원은 비교하지 않는다.
      expect(at(fast(), 'hr_total', 60)).toBeGreaterThan(at(slow(), 'hr_total', 60) * 1.3)
      expect(completion(fast())).toBeLessThan(completion(slow()) - 30)
    })

    it('plan_wcwf1: 남은 시간이 지연 합의 0.3배 이하면 0, 1.5배 이상이면 1이다', () => {
      const check = (r: RunResult) => {
        const remaining = s(r, 'plan_time_remaining')
        const w1 = s(r, 'plan_wcwf1')
        const counts = { low: 0, high: 0 }
        for (let i = 0; i < r.time.length; i++) {
          const ratio = (remaining[i] as number) / (40 + 80) // 기본 지연 합 120일
          if (ratio <= 0.3) {
            expect(w1[i]).toBe(0)
            counts.low++
          }
          if (ratio >= 1.5) {
            expect(w1[i]).toBe(1)
            counts.high++
          }
        }
        return counts
      }
      // 계획 200일로 시작하면 시작 직후 남은 시간이 지연 합의 1.5배를 넘는다.
      expect(check(run()).high).toBeGreaterThan(0)
      // 계획이 촉박하면 종료가 가까워지며 0.3배 아래로 내려간다.
      expect(check(run({ ...tight, max_tolerable_factor: 3 })).low).toBeGreaterThan(0)
    })

    it('종료가 가까워 채용 의지가 0이면 필요 인원이 현재 인원이 되어 채용하지 않는다', () => {
      const r = run({ ...tight, max_tolerable_factor: 3 })
      const wcwf = s(r, 'plan_wcwf')
      const gap = s(r, 'hr_wf_gap')
      const hiring = s(r, 'hr_hiring_rate')
      const needed = s(r, 'plan_wf_needed')
      const total = s(r, 'hr_total')
      let checked = 0
      for (let i = 0; i < r.time.length; i++) {
        if (wcwf[i] === 0 && (total[i] as number) <= 20) {
          expect(needed[i] as number).toBeCloseTo(total[i] as number, 9)
          expect(gap[i] as number).toBeCloseTo(0, 9)
          expect(hiring[i]).toBe(0)
          checked++
        }
      }
      expect(checked).toBeGreaterThan(100)
    })

    it('plan_wcwf2: 계획 일정이 한계 일정의 86% 미만이면 0, 한계에 닿으면 0.8이다', () => {
      const r = run()
      const sched = s(r, 'plan_sched_completion')
      const w2 = s(r, 'plan_wcwf2')
      for (let i = 0; i < r.time.length; i++) {
        const ratio = (sched[i] as number) / 300
        if (ratio < 0.86) expect(w2[i]).toBe(0)
        if (ratio >= 1) expect(w2[i]).toBeCloseTo(0.8, 12)
      }
      expect(Math.max(...w2)).toBeCloseTo(0.8, 12)
    })
  })

  describe('모델 동작의 방향', () => {
    it('초기 인원이 많을수록(과소추정 없음) 일찍 끝난다', () => {
      const base = { plan_known_fraction: 1 }
      expect(completion(run({ ...base, initial_pros: 6 }))).toBeLessThan(completion(run({ ...base, initial_pros: 4 })))
    })

    it('인원 상한이 1명이면 진행이 거의 없다(상한이 인력 계획을 제한한다)', () => {
      const r = run({ max_staff: 1 })
      // 초과 인원은 전출 지연(10일)을 두고 줄어든다. 100일 이후에는 상한 이내이다.
      const settled = s(r, 'hr_total').slice(400)
      expect(Math.max(...settled)).toBeLessThanOrEqual(1 + 1e-3)
      expect(finished(r)).toBe(false)
    })

    it('작업 규모가 작으면 일찍 끝난다', () => {
      expect(completion(run({ total_tasks: 20 }))).toBeLessThan(completion(run()) / 3)
    })

    it('적분 간격을 줄여도 완료 시각이 거의 같다(dt 0.25 vs 0.125)', () => {
      const coarse = completion(run())
      const fine = completion(run({}, { dt: 0.125 }))
      expect(Math.abs(coarse - fine)).toBeLessThan(1)
    })
  })
})
