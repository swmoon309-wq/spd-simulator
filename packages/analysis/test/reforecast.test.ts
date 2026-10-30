import { describe, expect, it } from 'vitest'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '@spd/models'
import { clampKappa, integratedReforecast, brooksReforecast, lastOf, reforecast, ReforecastError, valueAt, type ObservedState } from '../src'

const integrated = compileModel(integratedProjectModel)
const brooks = compileModel(brooksModel)

const integratedDone = (r: RunResult): number | null => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null)
const brooksDone = (r: RunResult): number | null => (lastOf(r, 'requirements') <= 1e-6 ? lastOf(r, 'completion_time') : null)

const observeIntegrated = (r: RunResult, day: number): ObservedState => ({
  day,
  cum: { prod_tasks_developed: valueAt(r, 'prod_tasks_developed', day), prod_tasks_qaed: valueAt(r, 'prod_tasks_qaed', day), prod_tasks_tested: valueAt(r, 'prod_tasks_tested', day) },
  effort: valueAt(r, 'ctl_cum_md', day),
  headcount: valueAt(r, 'hr_total', day)
})
const observeBrooks = (r: RunResult, day: number): ObservedState => ({ day, cum: { developed_software: valueAt(r, 'developed_software', day) }, effort: valueAt(r, 'cum_effort', day), headcount: valueAt(r, 'total_personnel', day) })

describe('자기 일관성: 실적 = 기준선 자신이면 재예측 = 기준선 (κ = 1)', () => {
  const base = runModel(integrated)
  const plan = integratedDone(base) as number
  it.each([25, 50, 100, 150, 200])('통합 모델 %i일', (day) => {
    const out = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observeIntegrated(base, day), kappas: [{ name: 'k1', kappa: 1 }] })
    const tail = out.runs[0]!.result
    expect(out.atDay).toBe(day)
    expect(Math.abs((integratedDone(tail) as number) - plan)).toBeLessThan(0.01)
    // 최종 공수도 같다
    expect(valueAt(tail, 'ctl_cum_md', plan)).toBeCloseTo(valueAt(base, 'ctl_cum_md', plan), 6)
  })
  it('이어 실행한 모든 변수가 기준선과 거의 같다(부동소수 오차 이내)', () => {
    const out = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observeIntegrated(base, 100), kappas: [{ name: 'k1', kappa: 1 }] })
    const tail = out.runs[0]!.result
    const from = 100 / 0.25
    for (const name of ['prod_tasks_tested', 'ctl_cum_md', 'hr_total', 'err_escaped', 'exh_level']) {
      const a = tail.series[name] as Float64Array
      const b = (base.series[name] as Float64Array).slice(from)
      for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i] as number, 6)
    }
  })
  it('Brooks 50·110·200일', () => {
    const b = runModel(brooks, { overrides: { extra_people: 5, hire_day: 120 } })
    const plan = brooksDone(b) as number
    for (const day of [50, 110, 200]) {
      const out = reforecast(brooks, { adapter: brooksReforecast, params: { extra_people: 5, hire_day: 120 }, options: {}, observed: observeBrooks(b, day), kappas: [{ name: 'k1', kappa: 1 }] })
      expect(Math.abs((brooksDone(out.runs[0]!.result) as number) - plan)).toBeLessThan(0.01)
    }
  })
})

describe('κ', () => {
  const base = runModel(integrated)
  const at = (kappas: number[]) =>
    reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observeIntegrated(base, 80), kappas: kappas.map((k, i) => ({ name: `k${i}`, kappa: k })) })
  it('κ가 클수록 일찍, 작을수록 늦게 끝난다', () => {
    const [a, b, c] = at([0.7, 1, 1.4]).runs.map((r) => integratedDone(r.result) as number) as [number, number, number]
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })
  it('같은 스냅샷에서 κ마다 이어 실행해 서로 영향을 주지 않는다', () => {
    const both = at([0.8, 1.2]).runs.map((r) => integratedDone(r.result))
    expect(at([0.8]).runs.map((r) => integratedDone(r.result))[0]).toBe(both[0])
    expect(at([1.2]).runs.map((r) => integratedDone(r.result))[0]).toBe(both[1])
  })
  it('범위 밖은 [0.3, 3]으로 제한하고 표시한다', () => {
    const runs = at([0.01, 50, 1]).runs
    expect(runs.map((r) => [r.kappa, r.clamped])).toEqual([[0.3, true], [3, true], [1, false]])
    expect(runs[0]!.requested).toBe(0.01)
    expect(clampKappa(0.3)).toEqual({ kappa: 0.3, clamped: false })
    expect(clampKappa(3)).toEqual({ kappa: 3, clamped: false })
  })
  it('기준선의 상수가 이미 1이 아니면 그 값에 곱한다', () => {
    const b2 = runModel(integrated, { overrides: { prod_calibration: 1.5 } })
    const out = reforecast(integrated, { adapter: integratedReforecast, params: { prod_calibration: 1.5 }, options: {}, observed: observeIntegrated(b2, 80), kappas: [{ name: 'k', kappa: 1 }] })
    expect(Math.abs((integratedDone(out.runs[0]!.result) as number) - (integratedDone(b2) as number))).toBeLessThan(0.01)
  })
})

describe('가정 목록', () => {
  const base = runModel(integrated)
  const out = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observeIntegrated(base, 100), kappas: [{ name: 'k', kappa: 1 }] })
  it('덮어쓴 Level과 기준선 값이 함께 나온다', () => {
    const names = out.overwrites.map((o) => o.name)
    expect(names).toEqual(expect.arrayContaining(['prod_tasks_developed', 'prod_tasks_qaed', 'prod_tasks_tested', 'prod_qa_s1', 'prod_qa_s2', 'prod_qa_s3', 'ctl_cum_md', 'hr_new', 'hr_pros']))
    for (const o of out.overwrites) expect(o.baseline).toBeCloseTo(o.value, 6) // 실적 = 기준선
    expect(out.overwrites.find((o) => o.name === 'prod_tasks_developed')!.kind).toBe('observed')
    expect(out.overwrites.find((o) => o.name === 'hr_new')!.kind).toBe('derived')
  })
  it('덮어쓰지 않은 Level은 추정으로 남는다', () => {
    expect(out.estimatedLevels).toEqual(expect.arrayContaining(['exh_level', 'err_pde', 'ctl_discovered', 'plan_sched_completion']))
    expect(out.estimatedLevels).not.toContain('prod_tasks_developed')
  })
  it('인원이 없으면 인원은 기준선 값을 쓰고 가정에 나오지 않는다', () => {
    const o = observeIntegrated(base, 100)
    delete o.headcount
    const r = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: o, kappas: [{ name: 'k', kappa: 1 }] })
    expect(r.overwrites.some((x) => x.name === 'hr_new')).toBe(false)
    expect(r.estimatedLevels).toContain('hr_new')
  })
})

describe('덮어쓰기 규칙과 경계', () => {
  const base = runModel(integrated)
  const run = (o: Partial<ObservedState> & { day?: number }, kappas = [{ name: 'k', kappa: 1 }]) =>
    reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: { ...observeIntegrated(base, 100), ...o }, kappas })
  it('QA 완료가 개발 완료보다 많으면 개발 완료로 제한한다(단계 순서)', () => {
    const o = run({ cum: { prod_tasks_developed: 50, prod_tasks_qaed: 80, prod_tasks_tested: 90 } })
    const v = (n: string) => o.overwrites.find((x) => x.name === n)!.value
    expect(v('prod_tasks_qaed')).toBe(50)
    expect(v('prod_tasks_tested')).toBe(50)
    expect(v('prod_qa_s1') + v('prod_qa_s2') + v('prod_qa_s3')).toBeCloseTo(0, 12)
  })
  it('QA 대기 3단의 합은 개발 − QA 완료와 같다', () => {
    const o = run({ cum: { prod_tasks_developed: 200, prod_tasks_qaed: 120, prod_tasks_tested: 60 } })
    const v = (n: string) => o.overwrites.find((x) => x.name === n)!.value
    expect(v('prod_qa_s1') + v('prod_qa_s2') + v('prod_qa_s3')).toBeCloseTo(80, 9)
  })
  it('개발 완료가 총 태스크를 넘으면 총 태스크로 제한하고 오류 없이 끝난다', () => {
    const o = run({ cum: { prod_tasks_developed: 999, prod_tasks_qaed: 10, prod_tasks_tested: 5 } })
    expect(o.overwrites.find((x) => x.name === 'prod_tasks_developed')!.value).toBe(400)
    expect(o.runs[0]!.result.meta.completed).toBe(true)
  })
  it('모든 값이 0이어도 오류 없이 실행한다(끝나지 않을 수 있다)', () => {
    const o = run({ cum: {}, effort: 0, headcount: 0 })
    expect(o.runs[0]!.result.time.length).toBeGreaterThan(1)
  })
  it('인원 0이면 생산이 멈춰 끝나지 않는다', () => {
    const o = run({ headcount: 0 })
    expect(integratedDone(o.runs[0]!.result)).toBeNull()
  })
  it.each([
    ['보고일 0', { day: 0 }],
    ['음수 보고일', { day: -5 }],
    ['종료 시각 이후', { day: 400 }],
    ['종료 시각 이후(넘음)', { day: 900 }],
    ['0 가까운 보고일(첫 스텝 전)', { day: 0.1 }]
  ])('재예측 불가: %s', (_n, o) => {
    expect(() => run(o)).toThrow(ReforecastError)
  })
  it('κ가 없거나 유한하지 않으면 거부', () => {
    expect(() => run({}, [])).toThrow(/보정 계수/)
    expect(() => run({}, [{ name: 'x', kappa: NaN }])).toThrow(/유한/)
  })
  it('모델과 어댑터가 다르면 거부', () => {
    expect(() => reforecast(brooks, { adapter: integratedReforecast, params: {}, options: {}, observed: observeIntegrated(base, 50), kappas: [{ name: 'k', kappa: 1 }] })).toThrow(/어댑터/)
  })
  it('보고일을 dt 격자에 맞춘다', () => {
    expect(run({ day: 100.1 }).atDay).toBe(100)
    expect(run({ day: 100.2 }).atDay).toBe(100.25)
  })
  it('추가 상수 변경(조치)을 이어 실행에 적용한다', () => {
    const plain = integratedDone(run({}).runs[0]!.result) as number
    const more = reforecast(integrated, { adapter: integratedReforecast, params: {}, options: {}, observed: observeIntegrated(base, 100), kappas: [{ name: 'k', kappa: 1 }], constants: { extra_people: 6, extra_people_day: 101 } })
    expect(integratedDone(more.runs[0]!.result)).not.toBeCloseTo(plain, 3)
  })
})
