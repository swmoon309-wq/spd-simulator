import { describe, expect, it } from 'vitest'
import { checkInvariants, compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectAiModel, integratedProjectModel } from '../src'

/**
 * 통합 프로젝트 + AI 보조 모델(설계 10, P0). 기본값(영향 없음)에서는 통합 프로젝트 모델과 모든 변수가 비트 단위로 같아야 하고,
 * AI를 켜면 방향이 설계대로여야 한다. 크기(몇 배)는 정하지 않았으므로 정성 거동만 본다.
 */

const base = compileModel(integratedProjectModel)
const ai = compileModel(integratedProjectAiModel)
const END = 450
const runBase = (o: Record<string, number> = {}) => runModel(base, { overrides: o, end: END })
const runAi = (o: Record<string, number> = {}) => runModel(ai, { overrides: o, end: END })
const last = (r: RunResult, name: string): number => {
  const x = r.series[name]
  if (!x) throw new Error(`기록되지 않은 변수: ${name}`)
  return x[x.length - 1] as number
}
const completion = (r: RunResult): number => last(r, 'ctl_completion_time')
const effort = (r: RunResult): number => last(r, 'ctl_cum_md')

describe('기본값은 통합 프로젝트 모델과 같다 (불변식)', () => {
  it('AI 적용 비율 0이면 기존 모델의 모든 변수가 비트 단위로 같다', () => {
    const a = runBase()
    const b = runAi()
    const shared = Object.keys(a.series)
    expect(shared.length).toBeGreaterThan(100)
    for (const name of shared) {
      const x = a.series[name] as Float64Array
      const y = b.series[name] as Float64Array | undefined
      expect(y, name).toBeDefined()
      expect(y!.length, name).toBe(x.length)
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y![i])) throw new Error(`${name}[${i}]: ${x[i]} != ${y![i]}`)
    }
  })

  it('가속·오버헤드를 바꿔도 적용 비율이 0이면 달라지지 않는다', () => {
    const a = runAi()
    const b = runAi({ ai_gen_pro: 3, ai_gen_new: 2.5, ai_iter_overhead: 0.8 })
    expect(completion(b)).toBe(completion(a))
    expect(effort(b)).toBe(effort(a))
  })

  it('가속 1, 오버헤드 0이면 적용 비율이 달라도 같다', () => {
    const a = runAi()
    const b = runAi({ ai_adoption: 1 })
    expect(completion(b)).toBe(completion(a))
    expect(effort(b)).toBe(effort(a))
  })

  it('다른 파라미터를 바꿔도 같다(인원·규모 변화)', () => {
    for (const o of ([{ initial_pros: 10, initial_new: 5 }, { total_tasks: 800 }, { planned_duration_days: 120 }] as Record<string, number>[])) {
      expect(completion(runAi(o))).toBe(completion(runBase(o)))
    }
  })

  it('인원이 0이어도 NaN이 생기지 않는다', () => {
    const r = runAi({ initial_pros: 0, initial_new: 0, ai_adoption: 0 })
    for (const name of ['prod_productivity', 'ai_dev_time_mult', 'ai_gen_mix']) {
      const x = r.series[name] as Float64Array
      expect(Array.from(x).every(Number.isFinite), name).toBe(true)
    }
  })
})

/** 채용을 막고 인원을 고정한다. 계획 섹터의 인력 되먹임 없이 생산성 효과만 본다. */
const FIXED = { hiring_delay: 5000, initial_pros: 10, initial_new: 0, max_staff: 10 }
/** 완료 시점까지 쓴 누적 공수(실행 끝까지 쓰면 완료 뒤에도 쌓인다). */
const effortAtCompletion = (r: RunResult): number => {
  const t = completion(r)
  const i = r.time.findIndex((x) => x >= t - 1e-9)
  return (r.series['ctl_cum_md'] as Float64Array)[i] as number
}

describe('AI를 켰을 때의 방향 (정성)', () => {
  it('인원을 고정하면 가속이 클수록 단조롭게 빨리 끝난다', () => {
    const t = [1, 1.25, 1.5, 2, 3].map((g) => completion(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: g, ai_gen_new: g })))
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThan(t[i - 1] as number)
  })

  it('인원을 고정하면 적용 비율이 클수록 효과가 커진다', () => {
    const t = [0, 0.25, 0.5, 0.75, 1].map((x) => completion(runAi({ ...FIXED, ai_adoption: x, ai_gen_pro: 2, ai_gen_new: 2 })))
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThan(t[i - 1] as number)
  })

  it('가속이 1보다 작으면(익숙한 코드의 숙련자, RCT) 오히려 늦어진다', () => {
    const off = runAi(FIXED)
    const slow = runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 0.8, ai_gen_new: 0.8 })
    expect(completion(slow)).toBeGreaterThan(completion(off))
  })

  it('반복·재시도 오버헤드가 가속의 이득을 깎는다', () => {
    const fast = runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2 })
    const retry = runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, ai_iter_overhead: 0.4 })
    expect(completion(retry)).toBeGreaterThan(completion(fast))
    // 오버헤드가 가속을 모두 상쇄하면(1/2 + 0.5 = 1) 기본과 같다
    const cancel = runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, ai_iter_overhead: 0.5 })
    expect(completion(cancel)).toBeCloseTo(completion(runAi(FIXED)), 6)
  })

  it('가속을 숙련자와 신입에게 따로 줄 수 있다', () => {
    // 신입이 없으면 신입 가속은 효과가 없고 숙련자 가속은 효과가 있다
    const off = completion(runAi(FIXED))
    expect(completion(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 1, ai_gen_new: 3 }))).toBe(off)
    expect(completion(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 1 }))).toBeLessThan(off)
  })

  it('완료까지 쓴 공수는 인원을 고정하면 거의 같다(속도만 빨라진다)', () => {
    const off = effortAtCompletion(runAi(FIXED))
    const on = effortAtCompletion(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2 }))
    expect(on).toBeLessThan(off)
  })

  it('인력이 일정에 따라 정해지면 AI로 빨라진 프로젝트는 팀이 작아지고, 완료일 이득은 일정하지 않다', () => {
    // 되먹임(필요 인력 = 남은 일 ÷ 남은 시간)이 있어 가속이 클수록 완료일이 단조롭게 줄지는 않는다.
    // 문헌의 "개인 속도 향상이 조직 결과로 그대로 이어지지 않는다"(QUE, SLR)와 같은 방향의 거동이므로 단조를 기대하지 않는다.
    const off = runAi()
    const gs = [1.25, 1.5, 2, 3]
    for (const g of gs) {
      const on = runAi({ ai_adoption: 1, ai_gen_pro: g, ai_gen_new: g })
      expect(completion(on)).toBeLessThan(completion(off))
      expect(Math.max(...Array.from(on.series['hr_total'] as Float64Array))).toBeLessThan(Math.max(...Array.from(off.series['hr_total'] as Float64Array)))
      expect(effortAtCompletion(on)).toBeLessThan(effortAtCompletion(off))
    }
  })
})

/** AI 적용 100%, 생성 가속 2배, 인원 고정. 검토 항목만 바꿔 본다. */
const REV = { ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_review_md_nominal: 0.15 }
const arr = (r: RunResult, n: string): number[] => Array.from(r.series[n] as Float64Array)
const maxOf = (r: RunResult, n: string): number => Math.max(...arr(r, n))
const minOf = (r: RunResult, n: string): number => Math.min(...arr(r, n))
const generated = (r: RunResult): number => {
  const t = completion(r)
  const i = r.time.findIndex((x) => x >= t - 1e-9)
  return (r.series['err_cum_generated'] as Float64Array)[i] as number
}

describe('P1: 검토 부하·깊이·오류 탈출 (설계 10의 4.2 b·c)', () => {
  it('검토 노력이 0이면 검토 파라미터를 바꿔도 P0와 완전히 같다', () => {
    const p0 = runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2 })
    for (const o of ([{ ai_review_cap_fraction: 0.05 }, { ai_review_cap_fraction: 1 }, { ai_verify_skill: 20 }, { ai_miss_floor: 0 }, { ai_review_perception_delay: 1 }] as Record<string, number>[])) {
      const r = runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ...o })
      for (const name of ['ctl_completion_time', 'ctl_cum_md', 'err_cum_generated', 'prod_tasks_tested']) expect(arr(r, name), `${JSON.stringify(o)} ${name}`).toEqual(arr(p0, name))
    }
  })

  it('AI 적용 비율이 0이면 검토 항목을 켜도 기존 모델과 같다', () => {
    const off = runAi(FIXED)
    const r = runAi({ ...FIXED, ai_review_md_nominal: 0.5, ai_err_raw_mult: 2, ai_miss_floor: 0.5 })
    for (const name of ['ctl_completion_time', 'ctl_cum_md', 'err_cum_generated', 'err_cum_found_test']) expect(arr(r, name), name).toEqual(arr(off, name))
  })

  it('검토는 숙련자 용량 안에서 가용 인일을 쓰고 개발 인일을 줄인다', () => {
    const r = runAi(REV)
    const used = arr(r, 'prod_mp_review')
    const cap = arr(r, 'ai_review_capacity')
    expect(Math.max(...used)).toBeGreaterThan(0.5)
    used.forEach((u, i) => expect(u).toBeLessThanOrEqual((cap[i] as number) + 1e-9))
    const noReview = runAi({ ...REV, ai_review_md_nominal: 0 })
    expect(maxOf(r, 'prod_mp_dev')).toBeLessThan(maxOf(noReview, 'prod_mp_dev'))
  })

  it('용량이 충분하면 깊이 1로 꼼꼼히 보고, 용량이 모자라면 부하 비율이 1을 넘어 얕아진다', () => {
    const roomy = runAi({ ...REV, ai_review_cap_fraction: 0.5 })
    expect(minOf(roomy, 'ai_depth')).toBe(1)
    expect(maxOf(roomy, 'ai_load_ratio')).toBeLessThan(1)
    const tight = runAi({ ...REV, ai_review_cap_fraction: 0.08 })
    expect(maxOf(tight, 'ai_load_ratio')).toBeGreaterThan(1)
    expect(minOf(tight, 'ai_depth')).toBeLessThan(1)
    expect(minOf(tight, 'ai_depth')).toBeGreaterThanOrEqual(0.25)
  })

  it('검토가 얕아지면 오류가 더 많이 빠져나가 더 많은 오류가 생긴다 (QUE: 혼잡하면 덜 꼼꼼히 본다)', () => {
    const miss = [0.5, 0.15, 0.08].map((cap) => maxOf(runAi({ ...REV, ai_review_cap_fraction: cap }), 'ai_review_miss'))
    expect(miss[1]).toBeGreaterThanOrEqual(miss[0] as number)
    expect(miss[2]).toBeGreaterThan(miss[1] as number)
    const roomy = generated(runAi({ ...REV, ai_review_cap_fraction: 0.5 }))
    const tight = generated(runAi({ ...REV, ai_review_cap_fraction: 0.08 }))
    expect(tight).toBeGreaterThan(roomy)
  })

  it('용량을 고정하면 생성이 빠를수록 검토 부하 비율이 오른다 (병목이 검토로 옮겨감)', () => {
    const load = [1, 1.5, 2, 3].map((g) => maxOf(runAi({ ...REV, ai_gen_pro: g, ai_review_cap_fraction: 0.15 }), 'ai_load_ratio'))
    for (let i = 1; i < load.length; i++) expect(load[i]).toBeGreaterThan(load[i - 1] as number)
    expect(load[load.length - 1]).toBeGreaterThan(1)
  })

  it('검증 숙련도가 높을수록 빠져나가는 오류 비율이 낮고 오류가 적다', () => {
    const lo = runAi({ ...REV, ai_verify_skill: 1 })
    const hi = runAi({ ...REV, ai_verify_skill: 8 })
    expect(minOf(hi, 'ai_review_miss')).toBeLessThan(minOf(lo, 'ai_review_miss'))
    expect(generated(hi)).toBeLessThan(generated(lo))
  })

  it('검토로도 못 잡는 하한이 높을수록 오류가 많다', () => {
    const lo = generated(runAi({ ...REV, ai_miss_floor: 0.05 }))
    const hi = generated(runAi({ ...REV, ai_miss_floor: 0.6 }))
    expect(hi).toBeGreaterThan(lo)
  })

  it('검토 전 AI 오류 밀도가 수작업보다 높으면 오류가 늘고 낮으면 준다', () => {
    const base = generated(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2 }))
    expect(generated(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_err_raw_mult: 1.5 }))).toBeGreaterThan(base)
    expect(generated(runAi({ ...FIXED, ai_adoption: 1, ai_gen_pro: 2, ai_err_raw_mult: 0.5 }))).toBeLessThan(base)
  })

  it('오류 보존식을 포함한 불변식이 검토를 켜도 성립한다', () => {
    for (const o of [REV, { ...REV, ai_review_cap_fraction: 0.08, ai_err_raw_mult: 1.5 }, { ...REV, ai_miss_floor: 0.5, ai_verify_skill: 0 }]) {
      const checks = checkInvariants(integratedProjectAiModel, runAi(o), o)
      expect(checks.filter((c) => c.violated || c.missing.length > 0).map((c) => c.name)).toEqual([])
    }
  })

  it('모든 변수가 유한하다(0 나눗셈·NaN 없음)', () => {
    const r = runAi({ ...REV, ai_review_cap_fraction: 0.05, initial_pros: 1, max_staff: 1 })
    for (const name of ['ai_load_ratio', 'ai_depth', 'prod_mp_review', 'ai_review_miss', 'ai_err_factor', 'ai_avail_mp']) expect(arr(r, name).every(Number.isFinite), name).toBe(true)
  })
})

/** 규모가 큰 프로젝트(기준 규모 400의 4배). 인력을 넉넉히 둔다. */
const BIG = { initial_pros: 20, max_staff: 40, total_tasks: 1600 }
const share = (r: RunResult, name: string): number => {
  const t = completion(r)
  const i = r.time.findIndex((x) => x >= t - 1e-9)
  return ((r.series[name] as Float64Array)[i] as number) / ((r.series['err_cum_generated'] as Float64Array)[i] as number)
}
const eff = (r: RunResult): number => {
  const t = completion(r)
  const i = r.time.findIndex((x) => x >= t - 1e-9)
  return (r.series['ctl_cum_md'] as Float64Array)[i] as number
}

describe('P1b: 규모 의존 검출 효율과 후기 발견 비용 (설계 10의 4.2 c2, F16·F17)', () => {
  it('지수 0·후기 배수 1이면 기준 규모와 상관없이 P1과 완전히 같다', () => {
    const p1 = runAi(BIG)
    for (const o of ([{ ai_scale_ref: 20 }, { ai_scale_ref: 5000 }, { ai_scale_exponent: 0, ai_late_rework_mult: 1 }] as Record<string, number>[])) {
      const r = runAi({ ...BIG, ...o })
      for (const name of ['ctl_completion_time', 'ctl_cum_md', 'err_cum_generated', 'err_cum_found_qa']) expect(arr(r, name), `${JSON.stringify(o)} ${name}`).toEqual(arr(p1, name))
    }
  })

  it('기준 규모 이하에서는 지수를 올려도 효과가 없다(작은 프로젝트가 더 잘 잡지는 않는다)', () => {
    const neutral = runAi({ total_tasks: 400 })
    for (const total of [400, 100]) {
      const r = runAi({ total_tasks: total, ai_scale_exponent: 1 })
      expect(minOf(r, 'ai_scale_detect_mult')).toBe(1)
      if (total === 400) expect(arr(r, 'ctl_cum_md')).toEqual(arr(neutral, 'ctl_cum_md'))
    }
  })

  it('기준 규모를 넘으면 검출 효율 배수가 (규모÷기준)^(-지수)이다', () => {
    for (const e of [0.25, 0.5, 1]) {
      const r = runAi({ ...BIG, ai_scale_exponent: e })
      expect(minOf(r, 'ai_scale_detect_mult')).toBeCloseTo(Math.pow(4, -e), 12)
    }
  })

  it('지수가 클수록 QA가 잡는 오류의 비중이 줄고 시험까지 가서야 발견하는 비중이 는다', () => {
    const rs = [0, 0.3, 0.6, 1].map((e) => runAi({ ...BIG, ai_scale_exponent: e }))
    const qa = rs.map((r) => share(r, 'err_cum_found_qa'))
    const test = rs.map((r) => share(r, 'err_cum_found_test'))
    for (let i = 1; i < rs.length; i++) {
      expect(qa[i]).toBeLessThan(qa[i - 1] as number)
      expect(test[i]).toBeGreaterThan(test[i - 1] as number)
    }
  })

  it('후기 발견 오류의 처리 노력 배수가 클수록 늦게 끝나고 공수가 는다', () => {
    const rs = [1, 2, 3].map((m) => runAi({ ...BIG, ai_scale_exponent: 0.5, ai_late_rework_mult: m }))
    for (let i = 1; i < rs.length; i++) {
      expect(completion(rs[i] as RunResult)).toBeGreaterThan(completion(rs[i - 1] as RunResult))
      expect(eff(rs[i] as RunResult)).toBeGreaterThan(eff(rs[i - 1] as RunResult))
    }
  })

  it('후기 배수가 1이면 검출 효율이 떨어져도 일정이 오히려 줄어든다(기존 모델의 가정). 후기 발견이 충분히 비싸야 뒤집힌다', () => {
    // 기존 모델은 시험에서 발견한 오류의 처리(0.15맨데이)가 QA 검출 + 재작업(0.3 + 0.5)보다 싸다. 그래서 QA가 덜 잡을수록 빨라 보인다.
    // 현실의 "늦게 발견할수록 비싸다"는 이 배수로 넣는다. 이 시험은 그 가정을 문서화하고 뒤집히는 지점이 있음을 확인한다.
    const neutral = completion(runAi(BIG))
    const weakQa = completion(runAi({ ...BIG, ai_scale_exponent: 0.5 }))
    const weakQaCostlyLate = completion(runAi({ ...BIG, ai_scale_exponent: 0.5, ai_late_rework_mult: 3 }))
    expect(weakQa).toBeLessThan(neutral)
    expect(weakQaCostlyLate).toBeGreaterThan(neutral)
  })

  it('AI 검토와 함께 켜도 불변식이 성립하고 모든 변수가 유한하다', () => {
    for (const o of [{ ...BIG, ai_scale_exponent: 1, ai_late_rework_mult: 4 }, { ...BIG, ...REV, ai_scale_exponent: 0.5, ai_late_rework_mult: 2, ai_err_raw_mult: 1.5 }]) {
      const r = runAi(o)
      expect(checkInvariants(integratedProjectAiModel, r, o).filter((c) => c.violated || c.missing.length > 0).map((c) => c.name)).toEqual([])
      expect(arr(r, 'ai_scale_detect_mult').every(Number.isFinite)).toBe(true)
    }
  })
})

/** 채용을 막고 숙련 30명으로 1,600 태스크를 만드는 큰 프로젝트. 부채가 쌓일 시간이 충분하다. */
const LONG = { hiring_delay: 5000, initial_pros: 30, max_staff: 30, initial_new: 0, total_tasks: 1600 }
/** AI를 쓰면 개발은 2배 빠르지만 부채도 많이 만든다(숙련자 5배). 값은 이 시험용 가정이다. */
const DEBT = { ai_gen_pro: 2, ai_gen_new: 2, td_per_task: 0.1, ai_td_pro: 5, ai_td_new: 5, td_compound: 1 }
const lastOf = (r: RunResult, n: string): number => last(r, n)
const debtAtCompletion = (r: RunResult): number => {
  const t = completion(r)
  const i = r.time.findIndex((x) => x >= t - 1e-9)
  return (r.series['td_level'] as Float64Array)[i] as number
}
const XS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]
const sweepAdoption = (o: Record<string, number>): number[] => XS.map((x) => completion(runAi({ ...DEBT, ...o, ai_adoption: x })))
const argminX = (row: number[]): number => XS[row.indexOf(Math.min(...row))] as number

describe('P2: 기술 부채 (설계 10의 4.2 d, 요인 F7·F8·F10·F15)', () => {
  it('부채 항목이 모두 기본값이면 P1b와 완전히 같고, 부채가 없으면 다른 부채 파라미터는 무의미하다', () => {
    const p1b = runAi(LONG)
    for (const o of ([{ td_compound: 5 }, { ai_td_pro: 5, ai_td_new: 5, ai_adoption: 1 }, { td_sensitivity: 3 }, { td_obsolescence_time: 30 }, { td_refactor_fraction: 0.5 }, { td_refactor_prod: 5 }] as Record<string, number>[])) {
      const r = runAi({ ...LONG, ...o })
      const ref = o.ai_adoption ? runAi({ ...LONG, ai_adoption: 1 }) : p1b
      for (const name of ['ctl_completion_time', 'ctl_cum_md', 'err_cum_generated', 'prod_tasks_tested']) expect(arr(r, name), `${JSON.stringify(o)} ${name}`).toEqual(arr(ref, name))
    }
    expect(maxOf(runAi(LONG), 'td_level')).toBe(0)
  })

  it('새 태스크마다 부채가 쌓이고 생산성이 떨어지고 오류가 늘고 늦게 끝난다', () => {
    const off = runAi(LONG)
    const on = runAi({ ...LONG, td_per_task: 0.2 })
    expect(maxOf(on, 'td_level')).toBeGreaterThan(0)
    expect(minOf(on, 'td_prod_mult')).toBeLessThan(1)
    expect(maxOf(on, 'td_err_mult')).toBeGreaterThan(1)
    expect(completion(on)).toBeGreaterThan(completion(off))
    expect(generated(on)).toBeGreaterThan(generated(off))
  })

  it('부채가 부채를 낳는 정도가 클수록 부채가 더 쌓인다 (강화 고리 A1)', () => {
    const d = [0, 1, 3].map((c) => maxOf(runAi({ ...LONG, td_per_task: 0.2, td_compound: c }), 'td_level'))
    expect(d[1]).toBeGreaterThan(d[0] as number)
    expect(d[2]).toBeGreaterThan(d[1] as number)
  })

  it('AI가 부채를 더 만들면(배수 > 1) 더 쌓이고, 신입 구성은 더 쌓인다 (AND 결과 3의 방향)', () => {
    const base = { ...LONG, td_per_task: 0.2, ai_gen_pro: 1.5, ai_gen_new: 1.5 }
    const noAi = maxOf(runAi({ ...base, ai_adoption: 0 }), 'td_level')
    const withAi = maxOf(runAi({ ...base, ai_adoption: 1, ai_td_pro: 3, ai_td_new: 3 }), 'td_level')
    expect(withAi).toBeGreaterThan(noAi)
    // 같은 AI 배수에서도 신입이 더 많이 만들면 더 쌓인다(신입 배수 > 숙련자 배수)
    const seniors = runAi({ ...base, ai_adoption: 1, ai_td_pro: 1, ai_td_new: 6, initial_pros: 30, initial_new: 0, max_staff: 30 })
    const juniors = runAi({ ...base, ai_adoption: 1, ai_td_pro: 1, ai_td_new: 6, initial_pros: 10, initial_new: 20, max_staff: 30 })
    expect(maxOf(juniors, 'td_level') / generated(juniors)).toBeGreaterThan(maxOf(seniors, 'td_level') / generated(seniors))
  })

  it('리팩터링은 부채를 줄이고 큰 프로젝트에서는 일정도 줄인다 (A5, AND 결과 5의 방향). 부채가 없으면 인일을 쓰지 않는다', () => {
    const heavy = { ...LONG, ...DEBT, ai_adoption: 1 }
    const rs = [0, 0.1, 0.2, 0.3].map((f) => runAi({ ...heavy, td_refactor_fraction: f }))
    const debt = rs.map(debtAtCompletion)
    for (let i = 1; i < rs.length; i++) expect(debt[i]).toBeLessThan(debt[i - 1] as number)
    expect(completion(rs[3] as RunResult)).toBeLessThan(completion(rs[0] as RunResult))
    // 상환은 있는 부채만큼만 한다
    const refactored = lastOf(rs[3] as RunResult, 'td_cum_refactored')
    expect(refactored).toBeGreaterThan(0)
    expect(minOf(rs[3] as RunResult, 'td_level')).toBeGreaterThanOrEqual(-1e-9)
    // 부채가 없으면 리팩터링 비율을 올려도 개발 인일을 빼앗지 않는다(위 중립 시험과 같은 사실을 직접 확인)
    expect(maxOf(runAi({ ...LONG, td_refactor_fraction: 0.5 }), 'prod_mp_refactor')).toBe(0)
  })

  it('서비스가 낡아 사라지는 시간이 짧을수록 최종 부채가 적다', () => {
    const d = [3650, 365, 90].map((t) => debtAtCompletion(runAi({ ...LONG, td_per_task: 0.2, td_obsolescence_time: t })))
    expect(d[1]).toBeLessThan(d[0] as number)
    expect(d[2]).toBeLessThan(d[1] as number)
  })

  it('기존 시스템의 초기 부채는 시작부터 생산성을 깎고 일정을 늦춘다 (brownfield, F10)', () => {
    const green = runAi(LONG)
    const brown = runAi({ ...LONG, td_base_size: 2000, td_initial_ratio: 0.3 })
    expect(arr(brown, 'td_level')[0]).toBeCloseTo(600, 9)
    expect(arr(brown, 'td_prod_mult')[0]).toBeLessThan(1)
    expect(completion(brown)).toBeGreaterThan(completion(green))
  })

  it('부채 영향 곡선의 민감도를 올리면 같은 부채가 더 큰 피해를 준다', () => {
    const a = completion(runAi({ ...LONG, td_per_task: 0.2, td_sensitivity: 0.5 }))
    const b = completion(runAi({ ...LONG, td_per_task: 0.2, td_sensitivity: 2 }))
    expect(b).toBeGreaterThan(a)
  })

  it('AI 적용 비율에 대해 역U자가 나온다: 적정점이 있고 많이 쓰면 오히려 늦어진다 (AND 결과 1의 방향)', () => {
    const row = sweepAdoption(LONG)
    const best = argminX(row)
    expect(best).toBeGreaterThan(0)
    expect(best).toBeLessThan(1)
    expect(Math.min(...row)).toBeLessThan(row[0] as number) // 적당히 쓰면 이득
    expect(Math.min(...row)).toBeLessThan(row[row.length - 1] as number) // 전부 쓰면 이득이 줄거나 사라짐
    expect(row[row.length - 1]).toBeGreaterThan(row[XS.indexOf(0.5)] as number)
  }, 60000)

  it('신입 중심 팀은 AI를 덜 쓰는 편이 낫다: 같은 설정에서 신입이 부채를 더 만들면 적정점이 낮아진다 (AND 결과 3)', () => {
    const seniors = sweepAdoption(LONG)
    const juniors = sweepAdoption({ ...LONG, initial_pros: 10, initial_new: 20, ai_td_new: 10 })
    expect(argminX(juniors)).toBeLessThan(argminX(seniors))
  }, 60000)

  it('부채 보존식을 포함한 불변식이 성립하고 모든 변수가 유한하다', () => {
    for (const o of [{ ...LONG, ...DEBT, ai_adoption: 1, td_refactor_fraction: 0.2 }, { ...LONG, td_base_size: 500, td_initial_ratio: 0.5, td_per_task: 0.3, td_compound: 5, td_obsolescence_time: 30 }]) {
      const r = runAi(o)
      expect(checkInvariants(integratedProjectAiModel, r, o).filter((c) => c.violated || c.missing.length > 0).map((c) => c.name)).toEqual([])
      for (const name of ['td_level', 'td_ratio', 'td_prod_mult', 'td_err_mult', 'prod_mp_refactor', 'ai_td_mix']) expect(arr(r, name).every(Number.isFinite), name).toBe(true)
    }
  })
})

/** 일정에 따라 인력이 정해지는 기본 편성(채용 있음). 계획 오판은 이 되먹임을 통해 비용과 일정으로 나타난다. */
const initialEstimate = (r: RunResult): number => (r.series['ctl_initial_estimate_md'] as Float64Array)[0] as number
const REAL_NONE = { ai_adoption: 1, ai_gen_pro: 1, ai_gen_new: 1 } // AI가 실제로는 빨라지지 않는데 쓴다
const REAL_2X = { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2 }

describe('P3: 계획이 믿는 효과와 실제의 차이 (설계 10의 4.2 e, 요인 F11)', () => {
  it('계획이 믿는 가속이 1이면 AI를 얼마나 쓰든 P2와 같고, AI를 안 쓰면 믿는 값이 무엇이든 같다', () => {
    const p2 = runAi({ ...REAL_2X, ai_gen_perceived: 1 })
    expect(arr(runAi(REAL_2X), 'ctl_completion_time')).toEqual(arr(p2, 'ctl_completion_time'))
    const off = runAi({})
    for (const pg of [0.5, 3, 5]) {
      const r = runAi({ ai_adoption: 0, ai_gen_perceived: pg })
      for (const name of ['ctl_completion_time', 'ctl_cum_md', 'ctl_initial_estimate_md', 'err_cum_generated']) expect(arr(r, name), `${pg} ${name}`).toEqual(arr(off, name))
    }
  })

  it('믿는 가속이 클수록 초기 맨데이 추정이 작아진다(계획이 낙관적이 된다)', () => {
    const est = [1, 1.5, 2, 3].map((pg) => initialEstimate(runAi({ ...REAL_NONE, ai_gen_perceived: pg })))
    for (let i = 1; i < est.length; i++) expect(est[i]).toBeLessThan(est[i - 1] as number)
  })

  it('계획 시점의 생산성 기대가 실제보다 높으면, 시작에는 어긋나 있다가 진행하며 실적으로 좁혀진다', () => {
    const r = runAi({ ...REAL_NONE, ai_gen_perceived: 2 })
    const assumed = arr(r, 'ctl_assumed_dev_prod')
    const actual = arr(runAi(REAL_NONE), 'ctl_assumed_dev_prod') // 계획이 정확한 경우의 값
    const start = assumed[0] as number
    expect(start).toBeCloseTo(0.6 * 2, 12) // plan_dev_prod(0.6) × 믿는 가속 2
    expect(start).toBeGreaterThan(actual[0] as number)
    const t = completion(r)
    const i = r.time.findIndex((x) => x >= t - 1e-9)
    const gapEnd = Math.abs((assumed[i] as number) - (actual[i] as number))
    expect(gapEnd).toBeLessThan(start - (actual[0] as number))
  })

  it('AI가 실제로는 빨라지지 않는데 계획이 빨라진다고 믿으면 더 늦고 비싸고 오류가 많다 (A6)', () => {
    const rs = [1, 1.5, 2, 3].map((pg) => runAi({ ...REAL_NONE, ai_gen_perceived: pg }))
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1] as RunResult
      const b = rs[i] as RunResult
      expect(completion(b)).toBeGreaterThan(completion(a))
      expect(effort(b)).toBeGreaterThan(effort(a))
      expect(generated(b)).toBeGreaterThan(generated(a))
    }
  })

  it('실제 가속을 정확히 알면 가장 좋다: 낮게 보든 높게 보든 더 늦고 더 비싸다', () => {
    const low = runAi({ ...REAL_2X, ai_gen_perceived: 1 })
    const exact = runAi({ ...REAL_2X, ai_gen_perceived: 2 })
    const high = runAi({ ...REAL_2X, ai_gen_perceived: 3 })
    expect(completion(exact)).toBeLessThan(completion(low))
    expect(completion(exact)).toBeLessThan(completion(high))
    expect(effort(exact)).toBeLessThan(effort(low))
    expect(effort(exact)).toBeLessThan(effort(high))
  })

  it('인원을 고정하면 낙관적인 계획은 일정 압박을 높여 더 오래 일하게 하고 오류와 소진이 는다(일정은 오히려 줄 수 있다)', () => {
    // 같은 계획 일정을 더 적은 예산으로 보므로 압박이 커져 업무 비율이 오르고 이를 완료일 앞당김으로 메운다.
    // 대가는 오류와 소진이다. 이 모델의 기존 되먹임(압박 → 과로 → 오류)이므로 일정이 줄어든 것을 이득으로 읽으면 안 된다.
    const rs = [1, 1.5, 2, 3].map((pg) => runAi({ ...FIXED, ...REAL_NONE, ai_gen_perceived: pg }))
    for (let i = 1; i < rs.length; i++) {
      expect(generated(rs[i] as RunResult)).toBeGreaterThan(generated(rs[i - 1] as RunResult))
      expect(maxOf(rs[i] as RunResult, 'exh_level')).toBeGreaterThanOrEqual(maxOf(rs[i - 1] as RunResult, 'exh_level'))
    }
    expect(completion(rs[3] as RunResult)).toBeLessThan(completion(rs[0] as RunResult))
  })

  it('불변식이 성립하고 모든 변수가 유한하다', () => {
    for (const o of [{ ...REAL_NONE, ai_gen_perceived: 3 }, { ...REAL_2X, ai_gen_perceived: 0.5, ...DEBT }]) {
      const r = runAi(o)
      expect(checkInvariants(integratedProjectAiModel, r, o).filter((c) => c.violated || c.missing.length > 0).map((c) => c.name)).toEqual([])
      for (const name of ['plan_ai_time_mult', 'plan_dev_prod_eff', 'ctl_initial_estimate_md', 'ctl_assumed_dev_prod']) expect(arr(r, name).every(Number.isFinite), name).toBe(true)
    }
  })
})

const COST = { cost_md_rate: 10, cost_token_per_task: 2, cost_seat_per_day: 0.5, cost_infra_per_day: 20 }
const AI_ON = { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2 }
const lastv = (r: RunResult, n: string): number => last(r, n)

describe('P4: 비용 층 (설계 10의 요인 F14, 출력 전용)', () => {
  it('비용 파라미터를 켜도 기존 모델의 모든 변수가 비트 단위로 같다(동역학에 영향 없음)', () => {
    const a = runBase()
    const b = runAi(COST)
    for (const name of Object.keys(a.series)) {
      const x = a.series[name] as Float64Array
      const y = b.series[name] as Float64Array
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) throw new Error(`${name}[${i}]`)
    }
    // AI를 켠 실행에서도 비용 단가만 달라지는 두 실행의 동역학은 같다
    const c = runAi({ ...AI_ON })
    const d = runAi({ ...AI_ON, ...COST })
    expect(completion(d)).toBe(completion(c))
    expect(effort(d)).toBe(effort(c))
    expect(arr(d, 'err_cum_generated')).toEqual(arr(c, 'err_cum_generated'))
  })

  it('기본값(단가 0)에서는 비용이 모두 0이다', () => {
    const r = runAi(AI_ON)
    for (const n of ['cost_total_cum', 'cost_labor_cum', 'cost_review_cum', 'cost_token_cum', 'cost_infra_cum']) expect(lastv(r, n), n).toBe(0)
  })

  it('인건비 = 누적 공수 × 맨데이 단가', () => {
    const r = runAi({ ...AI_ON, cost_md_rate: 12 })
    const cum = arr(r, 'ctl_cum_md')
    const labor = arr(r, 'cost_labor_cum')
    for (let i = 0; i < cum.length; i += 40) expect(labor[i] as number).toBeCloseTo(12 * (cum[i] as number), 6)
  })

  it('토큰 비용 = 개발한 태스크 × 태스크당 비용 × (1 + 반복 오버헤드), AI를 안 쓰면 0', () => {
    const r = runAi({ ...AI_ON, ai_iter_overhead: 0.3, cost_token_per_task: 2 })
    expect(lastv(r, 'cost_token_cum')).toBeCloseTo(2 * 1.3 * lastv(r, 'prod_tasks_developed'), 3)
    const off = runAi({ cost_token_per_task: 2, cost_seat_per_day: 1, cost_infra_per_day: 5 })
    expect(lastv(off, 'cost_token_cum')).toBe(0)
    expect(lastv(off, 'cost_infra_cum')).toBe(0)
  })

  it('인프라 비용은 적용 비율에 비례한다', () => {
    const half = runAi({ ...AI_ON, ai_adoption: 0.5, cost_infra_per_day: 10 })
    const full = runAi({ ...AI_ON, ai_adoption: 1, cost_infra_per_day: 10 })
    // 동역학이 달라 길이가 다르므로 하루당 고정비 부분만 비교한다
    expect(arr(half, 'cost_infra_rate')[0]).toBeCloseTo(0.5 * 10, 9)
    expect(arr(full, 'cost_infra_rate')[0]).toBeCloseTo(10, 9)
  })

  it('이용료는 인원에 비례한다', () => {
    const r = runAi({ ...AI_ON, ...FIXED, cost_seat_per_day: 2 })
    expect(arr(r, 'cost_infra_rate')[0]).toBeCloseTo(2 * 10, 9)
  })

  it('검토 인건비는 검토 노력이 0이면 0이고, 켜면 양수이며 인건비를 넘지 않는다', () => {
    const none = runAi({ ...AI_ON, cost_md_rate: 10 })
    expect(lastv(none, 'cost_review_cum')).toBe(0)
    const rv = runAi({ ...AI_ON, ...FIXED, ai_review_md_nominal: 0.15, cost_md_rate: 10 })
    expect(lastv(rv, 'cost_review_cum')).toBeGreaterThan(0)
    expect(lastv(rv, 'cost_review_cum')).toBeLessThanOrEqual(lastv(rv, 'cost_labor_cum'))
  })

  it('방향: AI가 일정과 공수를 줄여도 도구 비용이 크면 총 비용은 늘 수 있다', () => {
    const base = runAi({ ...FIXED, ...COST })
    const ai = runAi({ ...FIXED, ...AI_ON, ...COST, cost_seat_per_day: 8, cost_infra_per_day: 60 })
    expect(effortAtCompletion(ai)).toBeLessThan(effortAtCompletion(base))
    const at = (r: RunResult, n: string) => (r.series[n] as Float64Array)[r.time.findIndex((x) => x >= completion(r) - 1e-9)] as number
    expect(at(ai, 'cost_labor_cum')).toBeLessThan(at(base, 'cost_labor_cum'))
    expect(at(ai, 'cost_total_cum')).toBeGreaterThan(at(base, 'cost_total_cum'))
  })

  it('불변식이 성립하고 모든 변수가 유한하다', () => {
    for (const o of [{ ...AI_ON, ...COST }, { ...COST }, { ...AI_ON, ...COST, ai_iter_overhead: 0.5, ai_review_md_nominal: 0.2 }] as Record<string, number>[]) {
      const r = runAi(o)
      expect(checkInvariants(integratedProjectAiModel, r, o).filter((c) => c.violated || c.missing.length > 0).map((c) => c.name)).toEqual([])
      for (const name of ['cost_total_cum', 'cost_total_rate', 'cost_token_rate']) expect(arr(r, name).every(Number.isFinite), name).toBe(true)
    }
  })
})

describe('불변식은 AI를 켜도 성립한다', () => {
  it('선언한 불변식이 모두 점검되고 위반이 없다', () => {
    for (const o of ([{}, { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 1.5, ai_iter_overhead: 0.2 }, { ai_adoption: 0.5, ai_gen_pro: 0.7, ai_gen_new: 3 }] as Record<string, number>[])) {
      const checks = checkInvariants(integratedProjectAiModel, runAi(o), o)
      expect(checks.length).toBe((integratedProjectModel.invariants?.length ?? 0) + 2) // 기술 부채·비용 보존식
      expect(checks.length).toBeGreaterThan(0)
      expect(checks.filter((c) => c.violated || c.missing.length > 0).map((c) => c.name)).toEqual([])
    }
  })
})
