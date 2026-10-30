import { describe, expect, it } from 'vitest'
import { reforecast, reforecastAdapters, valueAt } from '@spd/analysis'
import { compileModel, runModel } from '@spd/sd-engine'
import { integratedProjectModel } from '@spd/models'
import { getEntry } from '../catalog'
import { KAPPA_LABEL, summarizeReforecast } from './reforecastView'

const entry = getEntry('integrated-project')
const model = compileModel(integratedProjectModel)
const base = runModel(model)
const observed = (day: number) => ({
  day,
  cum: { prod_tasks_developed: valueAt(base, 'prod_tasks_developed', day), prod_tasks_qaed: valueAt(base, 'prod_tasks_qaed', day), prod_tasks_tested: valueAt(base, 'prod_tasks_tested', day) },
  effort: valueAt(base, 'ctl_cum_md', day),
  headcount: valueAt(base, 'hr_total', day)
})
const make = (kappas: { name: string; kappa: number }[], day = 100) =>
  summarizeReforecast(entry, reforecast(model, { adapter: reforecastAdapters['integrated-project']!, params: {}, options: {}, observed: observed(day), kappas }))

describe('summarizeReforecast', () => {
  it('κ별 완료일·EAC와 두 값의 범위를 낸다', () => {
    const v = make([{ name: 'cum', kappa: 0.8 }, { name: 'recent', kappa: 1.2 }])
    expect(v.runs.map((r) => r.label)).toEqual([KAPPA_LABEL['cum'], KAPPA_LABEL['recent']])
    expect(v.runs[0]!.completionDay!).toBeGreaterThan(v.runs[1]!.completionDay!)
    expect(v.completion!.low).toBe(v.runs[1]!.completionDay)
    expect(v.completion!.high).toBe(v.runs[0]!.completionDay)
    expect(v.eac!.low).toBeLessThan(v.eac!.high)
    expect(v.atDay).toBe(100)
  })
  it('누적 공수 곡선은 보고일에서 시작해 완료일에서 끝나고 1일 간격이며 늘기만 한다', () => {
    const r = make([{ name: 'cum', kappa: 1 }]).runs[0]!
    expect(r.ac[0]![0]).toBe(100)
    expect(r.ac[r.ac.length - 1]![0]).toBeLessThanOrEqual(r.completionDay! + 1e-9)
    for (let i = 1; i < r.ac.length; i++) {
      expect(r.ac[i]![0]).toBeGreaterThan(r.ac[i - 1]![0])
      expect(r.ac[i]![1]).toBeGreaterThanOrEqual(r.ac[i - 1]![1] - 1e-9)
    }
    expect(r.ac[r.ac.length - 1]![1]).toBeCloseTo(r.eac!, 0)
  })
  it('κ가 하나면 범위가 한 값이다', () => {
    const v = make([{ name: 'cum', kappa: 1 }])
    expect(v.completion!.low).toBe(v.completion!.high)
  })
  it('가정 목록에 라벨·구분·기준선 값이 있고 추정한 Level 이름이 따로 나온다', () => {
    const v = make([{ name: 'cum', kappa: 1 }])
    const dev = v.assumptions.find((a) => a.name === 'prod_tasks_developed')!
    expect(dev.kind).toBe('observed')
    expect(dev.value).toBeCloseTo(dev.baseline, 6)
    expect(dev.label.length).toBeGreaterThan(0)
    expect(v.estimatedLevels.length).toBeGreaterThan(10)
  })
  it('끝나지 않는 재예측은 완료일·EAC가 null이다', () => {
    const o = reforecast(model, { adapter: reforecastAdapters['integrated-project']!, params: {}, options: {}, observed: { ...observed(100), headcount: 0 }, kappas: [{ name: 'cum', kappa: 1 }] })
    const v = summarizeReforecast(entry, o)
    expect(v.runs[0]!.completionDay).toBeNull()
    expect(v.completion).toBeNull()
    expect(v.eac).toBeNull()
  })
})
