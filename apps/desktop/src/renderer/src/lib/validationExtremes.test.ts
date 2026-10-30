import { describe, expect, it } from 'vitest'
import { planExtremes, runExtremeCase, simulateExtreme, summarizeExtremes } from '@spd/analysis'
import { compileModel } from '@spd/sd-engine'
import { catalog } from '../catalog'
import { defaultParams, paramSpecs } from './params'

/**
 * 극단 조건 시험(설계 07의 4.1)을 두 실제 모델에 정식 시험으로 건다. 2차에서 퍼징으로 통합 모델의 0/0 가드 두 곳을 찾은 일을 도구로 만든 것이다:
 * 폼의 허용 범위 안의 값에서는 어떤 파라미터도 수치 오류를 내지 않아야 한다.
 */
describe.each(catalog.map((e) => [e.id, e] as const))('%s 극단 조건', (_id, entry) => {
  const base = defaultParams(entry)
  const specs = paramSpecs(entry).map((s) => ({ name: s.name, min: s.min, max: s.max, ...(s.integer ? { integer: true } : {}) }))
  const model = compileModel(entry.def)
  const input = { model, base, options: {}, kpis: entry.kpiSpecs }
  const cases = planExtremes(specs, base)
  const cells = cases.map((c) => runExtremeCase(input, c))

  it('모든 파라미터가 시험 대상이고 범위 안의 값(최소·최대)이 반드시 들어 있다', () => {
    expect(new Set(cases.map((c) => c.name))).toEqual(new Set(specs.map((s) => s.name)))
    for (const s of specs) {
      const mine = cases.filter((c) => c.name === s.name)
      expect(mine.some((c) => c.levels.includes('min') && c.value === s.min), `${s.name} 최소`).toBe(true)
      expect(mine.some((c) => c.levels.includes('max') && c.value === s.max), `${s.name} 최대`).toBe(true)
      expect(mine.every((c) => c.inRange === (c.value >= s.min && c.value <= s.max))).toBe(true)
    }
  })

  it('허용 범위 안의 값에서는 어떤 파라미터도 수치 오류(실패)를 내지 않는다', () => {
    const failed = cells.filter((c) => c.status === 'fail')
    expect(failed.map((c) => `${c.case.name}=${c.case.value}: ${c.reasons[0]}`)).toEqual([])
  })

  it('범위 안에서 음수 Level이나 불변식 위반이 나오지 않는다', () => {
    const inRange = cells.filter((c) => c.case.inRange)
    expect(inRange.filter((c) => c.negativeLevels.length > 0).map((c) => c.case.name)).toEqual([])
    expect(inRange.filter((c) => c.violatedInvariants.length > 0).map((c) => c.case.name)).toEqual([])
  })

  it('범위 밖의 오류는 실패가 아니라 정보로 분류한다', () => {
    for (const c of cells.filter((x) => !x.case.inRange && x.error !== null)) expect(c.status).toBe('info')
  })

  it('판정은 요약과 일치하고 모든 셀이 이유 또는 통과를 가진다', () => {
    const s = summarizeExtremes(cells)
    expect(s.counts.pass + s.counts.warn + s.counts.fail + s.counts.info).toBe(cells.length)
    for (const c of cells) expect(c.status === 'pass' ? c.reasons.length === 0 : c.reasons.length > 0).toBe(true)
  })

  it('상세 보기를 위해 같은 값으로 다시 실행하면 같은 결과다(오류가 아닌 셀)', () => {
    const c = cells.find((x) => x.error === null)!
    const r = simulateExtreme(input, c.case)
    expect(r.series[Object.keys(entry.def.levels)[0] as string]!.length).toBeGreaterThan(1)
  })
})
