import { describe, expect, it } from 'vitest'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '@spd/models'
import {
  ACTIONS,
  actionChanges,
  actionsFor,
  defaultActionValues,
  describeAction,
  integratedReforecast,
  lastOf,
  reforecast,
  brooksReforecast,
  valueAt,
  validateAction,
  type ActionInput,
  type ObservedState
} from '../src'

const integrated = compileModel(integratedProjectModel)
const brooks = compileModel(brooksModel)
const ctx = { modelId: 'integrated-project', atDay: 100, end: 400 }
const staffing = (people = 3, day = 100): ActionInput => ({ kind: 'staffing', values: { people }, day })

describe('조치 목록', () => {
  it('통합 모델은 세 조치, Brooks는 인력 보강만 지원한다(범위 축소는 없다)', () => {
    expect(actionsFor('integrated-project').map((a) => a.kind)).toEqual(['staffing', 'overtime', 'qa'])
    expect(actionsFor('brooks').map((a) => a.kind)).toEqual(['staffing'])
    expect(actionsFor('zzz')).toEqual([])
    expect(ACTIONS.some((a) => a.label.includes('범위'))).toBe(false)
  })
})

describe('validateAction', () => {
  it('올바른 입력은 통과', () => {
    expect(validateAction(staffing(), ctx)).toBeNull()
    expect(validateAction({ kind: 'overtime', values: { maxBoost: 1 }, day: 150 }, ctx)).toBeNull()
    expect(validateAction({ kind: 'qa', values: { qaFraction: 0 }, day: 399 }, ctx)).toBeNull()
  })
  it.each([
    ['인원 0', staffing(0), '1 ~ 200'],
    ['인원 소수', staffing(2.5), '정수'],
    ['인원 NaN', { kind: 'staffing', values: { people: NaN }, day: 100 } as ActionInput, '입력하세요'],
    ['값 누락', { kind: 'staffing', values: {}, day: 100 } as ActionInput, '입력하세요'],
    ['과로 증가율 1.2', { kind: 'overtime', values: { maxBoost: 1.2 }, day: 100 } as ActionInput, '0 ~ 1'],
    ['QA 비율 0.5', { kind: 'qa', values: { qaFraction: 0.5 }, day: 100 } as ActionInput, '0 ~ 0.4'],
    ['시작일이 보고일 이전', staffing(3, 99), '보고일'],
    ['시작일이 종료 이후', staffing(3, 400), '종료 시각'],
    ['시작일 NaN', staffing(3, NaN), '시작일']
  ])('거부: %s', (_n, input, msg) => {
    expect(validateAction(input, ctx)).toContain(msg)
  })
  it('모델이 지원하지 않는 조치는 거부', () => {
    expect(validateAction({ kind: 'qa', values: { qaFraction: 0.1 }, day: 100 }, { ...ctx, modelId: 'brooks' })).toContain('지원하지 않습니다')
    expect(validateAction({ kind: 'nope' as never, values: {}, day: 100 }, ctx)).toContain('알 수 없는')
  })
})

describe('actionChanges / describeAction / defaultActionValues', () => {
  it('인력 보강: 통합 모델은 extra_people와 extra_people_day, Brooks는 hire_day', () => {
    expect(actionChanges(staffing(4, 120), { modelId: 'integrated-project' })).toEqual([
      { day: 120, name: 'extra_people', value: 4 },
      { day: 120, name: 'extra_people_day', value: 120 }
    ])
    expect(actionChanges(staffing(4, 120), { modelId: 'brooks' }).map((c) => c.name)).toEqual(['extra_people', 'hire_day'])
  })
  it('야근 허용 확대와 QA 축소는 시작일부터 상수 하나를 바꾼다', () => {
    expect(actionChanges({ kind: 'overtime', values: { maxBoost: 0.9 }, day: 130 }, ctx)).toEqual([{ day: 130, name: 'max_boost', value: 0.9 }])
    expect(actionChanges({ kind: 'qa', values: { qaFraction: 0.05 }, day: 130 }, ctx)).toEqual([{ day: 130, name: 'planned_qa_fraction', value: 0.05 }])
  })
  it('설명과 처음 값', () => {
    expect(describeAction(staffing(3, 120))).toBe('인력 보강 +3명 (120일)')
    expect(describeAction({ kind: 'qa', values: { qaFraction: 0.05 }, day: 130 })).toContain('0.05')
    expect(defaultActionValues('overtime', { max_boost: 0.7 })).toEqual({ maxBoost: 0.9 })
    expect(defaultActionValues('overtime', { max_boost: 0.95 })).toEqual({ maxBoost: 1 })
    expect(defaultActionValues('qa', { planned_qa_fraction: 0.15 })).toEqual({ qaFraction: 0.08 })
    expect(defaultActionValues('staffing', {})).toEqual({ people: 3 })
  })
})

describe('시각별 상수 변경으로 조치를 시험한다 (reforecast의 changes)', () => {
  const base = runModel(integrated)
  const done = (r: RunResult): number | null => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null)
  const observe = (day: number): ObservedState => ({
    day,
    cum: { prod_tasks_developed: valueAt(base, 'prod_tasks_developed', day), prod_tasks_qaed: valueAt(base, 'prod_tasks_qaed', day), prod_tasks_tested: valueAt(base, 'prod_tasks_tested', day) },
    effort: valueAt(base, 'ctl_cum_md', day),
    headcount: valueAt(base, 'hr_total', day)
  })
  const run = (input: ActionInput | null, atDay = 100) =>
    reforecast(integrated, {
      adapter: integratedReforecast,
      params: {},
      options: {},
      observed: observe(atDay),
      kappas: [{ name: 'k', kappa: 1 }],
      ...(input ? { changes: actionChanges(input, { modelId: 'integrated-project' }) } : {})
    }).runs[0]!.result
  const col = (r: RunResult, n: string) => r.series[n] as Float64Array
  const at = (r: RunResult, day: number) => Math.round((day - (r.time[0] as number)) / 0.25)

  it('조치 없음 = 변경 없는 재예측 = 기준선(κ = 1)', () => {
    expect(Math.abs((done(run(null)) as number) - (done(base) as number))).toBeLessThan(0.01)
  })

  it('보고일에 시작하는 조치는 시작 전 상수로 이어 실행한 것과 같다', () => {
    const viaChanges = run({ kind: 'overtime', values: { maxBoost: 0.3 }, day: 100 })
    const viaConstants = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observe(100), kappas: [{ name: 'k', kappa: 1 }], constants: { max_boost: 0.3 } }).runs[0]!.result
    expect(col(viaChanges, 'prod_frac_manday')).toEqual(col(viaConstants, 'prod_frac_manday'))
    expect(done(viaChanges)).toBe(done(viaConstants))
  })

  it('나중 날짜에 시작하는 조치는 그 시각 전까지 조치 없음과 같고 그 뒤에 달라진다', () => {
    const plain = run(null)
    const late = run({ kind: 'overtime', values: { maxBoost: 0.0 }, day: 160 })
    const i = at(plain, 160)
    for (let k = 0; k < i; k++) expect(col(late, 'ctl_cum_md')[k]).toBe(col(plain, 'ctl_cum_md')[k])
    expect(col(late, 'ctl_cum_md').at(-1)).not.toBe(col(plain, 'ctl_cum_md').at(-1))
  })

  it('과로를 막으면(max_boost 0) 소진이 줄고 일정은 늘어난다 / 늘리면 반대 방향', () => {
    const plain = run(null)
    const none = run({ kind: 'overtime', values: { maxBoost: 0 }, day: 100 })
    const more = run({ kind: 'overtime', values: { maxBoost: 1 }, day: 100 })
    expect(Math.max(...col(none, 'exh_level'))).toBeLessThanOrEqual(Math.max(...col(plain, 'exh_level')) + 1e-9)
    expect(done(none) as number).toBeGreaterThanOrEqual(done(plain) as number)
    expect(done(more) as number).toBeLessThanOrEqual(done(plain) as number)
  })

  it('QA를 줄이면 잔존 오류(QA를 통과한 오류)가 늘고 일정이 줄거나 같다', () => {
    const plain = run(null)
    const less = run({ kind: 'qa', values: { qaFraction: 0.02 }, day: 100 })
    expect(col(less, 'err_escaped').at(-1)!).toBeGreaterThan(col(plain, 'err_escaped').at(-1)!)
    expect(done(less) as number).toBeLessThanOrEqual((done(plain) as number) + 1e-9)
  })

  it('인력 보강은 지정한 날에 한 번만 인원을 더한다', () => {
    const plain = run(null)
    const r = run(staffing(5, 130))
    const rate = col(r, 'hr_extra_rate')
    const hits = [...rate].map((v, i) => [v, i] as const).filter(([v]) => v !== 0)
    expect(hits).toHaveLength(1)
    expect(r.time[hits[0]![1]]).toBe(130)
    expect(hits[0]![0] * 0.25).toBeCloseTo(5, 9)
    expect(col(plain, 'hr_extra_rate').every((v) => v === 0)).toBe(true)
  })

  it('종료 이후에 시작하는 변경은 무시된다', () => {
    const r = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observe(100), kappas: [{ name: 'k', kappa: 1 }], changes: [{ day: 9999, name: 'max_boost', value: 0 }] }).runs[0]!.result
    expect(done(r)).toBe(done(run(null)))
  })

  it('같은 후보를 두 번 실행하면 결과가 같다(재현성)', () => {
    const a = run(staffing(3, 120))
    const b = run(staffing(3, 120))
    expect(col(a, 'ctl_cum_md')).toEqual(col(b, 'ctl_cum_md'))
  })

  it('여러 변경은 날짜 순으로 적용한다(입력 순서와 무관)', () => {
    const mk = (changes: { day: number; name: string; value: number }[]) =>
      reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observe(100), kappas: [{ name: 'k', kappa: 1 }], changes }).runs[0]!.result
    const a = mk([{ day: 120, name: 'max_boost', value: 0.1 }, { day: 160, name: 'max_boost', value: 0.9 }])
    const b = mk([{ day: 160, name: 'max_boost', value: 0.9 }, { day: 120, name: 'max_boost', value: 0.1 }])
    expect(col(a, 'ctl_cum_md')).toEqual(col(b, 'ctl_cum_md'))
  })

  it('Brooks: 인력 보강 조치가 늦게 하면 일정을 늘릴 수 있다(Brooks 법칙)', () => {
    const b = runModel(brooks)
    const obs = (day: number): ObservedState => ({ day, cum: { developed_software: valueAt(b, 'developed_software', day) }, effort: valueAt(b, 'cum_effort', day), headcount: 20 })
    const bDone = (r: RunResult) => lastOf(r, 'completion_time')
    const go = (input: ActionInput | null) =>
      reforecast(brooks, { adapter: brooksReforecast, params: {}, options: {}, observed: obs(100), kappas: [{ name: 'k', kappa: 1 }], ...(input ? { changes: actionChanges(input, { modelId: 'brooks' }) } : {}) }).runs[0]!.result
    const plain = bDone(go(null))
    expect(plain).toBeCloseTo(274.12, 1)
    expect(bDone(go(staffing(10, 150)))).toBeGreaterThan(plain) // 늦은 대규모 투입은 일정을 늦춘다
    expect(bDone(go(staffing(5, 100)))).toBeLessThan(bDone(go(staffing(10, 150))))
  })
})
