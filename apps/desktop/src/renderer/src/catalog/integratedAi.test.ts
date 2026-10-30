import { describe, expect, it } from 'vitest'
import { actionsFor, computeKpis, reforecastAdapters } from '@spd/analysis'
import { compileModel, runModel } from '@spd/sd-engine'
import { catalog, getEntry } from '.'
import { defaultParams, paramSpecs } from '../lib/params'
import { modelCaveat } from '../lib/report/caveats'

const ai = getEntry('integrated-project-ai')
const base = getEntry('integrated-project')

/** 값이 파라미터 범위 밖인 이름들 */
const outOfRange = (values: Record<string, number>): string[] =>
  paramSpecs(ai)
    .filter((sp) => {
      const v = values[sp.name]
      return v === undefined || v < sp.min || v > sp.max
    })
    .map((sp) => sp.name)

describe('통합 프로젝트 + AI 보조 항목 (설계 10, P0)', () => {
  it('프로젝트 모델 묶음에 있고 통합 프로젝트 바로 뒤에 놓인다', () => {
    expect(ai.category).toBe('project')
    const ids = catalog.map((m) => m.id)
    expect(ids.indexOf('integrated-project-ai')).toBe(ids.indexOf('integrated-project') + 1)
  })

  it('AI 파라미터가 새 묶음 둘에 있고 기본값은 모두 영향 없음이다', () => {
    const gen = ai.groups.find((g) => g.title === 'AI 보조 개발')
    expect(gen?.params.map((p) => p.name)).toEqual(['ai_adoption', 'ai_gen_pro', 'ai_gen_new', 'ai_iter_overhead'])
    const review = ai.groups.find((g) => g.title === 'AI 보조 개발: 검토와 오류')
    expect(review?.params.map((p) => p.name)).toEqual(['ai_review_md_nominal', 'ai_review_cap_fraction', 'ai_review_perception_delay', 'ai_verify_skill', 'ai_miss_floor', 'ai_err_raw_mult'])
    const scale = ai.groups.find((g) => g.title === '검증과 규모(AI 사용과 무관하게 적용)')
    expect(scale?.params.map((p) => p.name)).toEqual(['ai_scale_ref', 'ai_scale_exponent', 'ai_late_rework_mult'])
    expect(ai.groups.find((g) => g.title === '계획과 인식')?.params.map((p) => p.name)).toEqual(['ai_gen_perceived'])
    expect(defaultParams(ai)['ai_gen_perceived']).toBe(1)
    const debt = ai.groups.find((g) => g.title === '기술 부채')
    expect(debt?.params.map((p) => p.name)).toEqual(['td_per_task', 'td_compound', 'ai_td_pro', 'ai_td_new', 'td_refactor_fraction', 'td_refactor_prod', 'td_obsolescence_time', 'td_sensitivity', 'td_base_size', 'td_initial_ratio'])
    const d = defaultParams(ai)
    expect(d['td_per_task']).toBe(0)
    expect(d['td_refactor_fraction']).toBe(0)
    expect(d['td_initial_ratio']).toBe(0)
    expect(d['ai_scale_exponent']).toBe(0)
    expect(d['ai_late_rework_mult']).toBe(1)
    expect([d['ai_adoption'], d['ai_gen_pro'], d['ai_gen_new'], d['ai_iter_overhead'], d['ai_review_md_nominal'], d['ai_err_raw_mult']]).toEqual([0, 1, 1, 0, 0, 1])
  })

  it('기본 파라미터는 범위 검사를 통과한다', () => {
    expect(outOfRange(defaultParams(ai))).toEqual([])
  })

  it('기본값 실행은 통합 프로젝트 모델과 같은 완료일·공수를 낸다', () => {
    const a = runModel(compileModel(base.def), { overrides: defaultParams(base) })
    const b = runModel(compileModel(ai.def), { overrides: defaultParams(ai) })
    for (const k of ['ctl_completion_time', 'ctl_cum_md', 'hr_total']) expect(Array.from(b.series[k] as Float64Array)).toEqual(Array.from(a.series[k] as Float64Array))
  })

  it('프리셋은 모두 범위 안이다', () => {
    for (const preset of ai.presets) expect(outOfRange({ ...defaultParams(ai), ...preset.overrides }), preset.label).toEqual([])
  })

  it('진척 정의·지표는 통합 프로젝트와 같고, 재예측·시정 조치를 지원한다', () => {
    expect(ai.evm).toBe(base.evm)
    expect(ai.kpiSpecs.slice(0, base.kpiSpecs.length)).toEqual(base.kpiSpecs)
    expect(ai.kpiSpecs.slice(base.kpiSpecs.length).map((k) => k.id)).toEqual(['totalCost', 'laborCost', 'reviewCost', 'tokenCost', 'infraCost', 'costPerTask'])
    expect(reforecastAdapters['integrated-project-ai']?.modelId).toBe('integrated-project-ai')
    expect(actionsFor('integrated-project-ai').map((a) => a.kind).sort()).toEqual(['overtime', 'qa', 'staffing'])
  })

  it('보고서 안내가 보정되지 않았다는 점과 아직 넣지 않은 것을 밝힌다', () => {
    const text = modelCaveat(ai)
    expect(text).toContain('보정되지 않았습니다')
    expect(text).toContain('기술 부채')
    expect(text).toContain('믿는 생성 가속')
    expect(text).toContain('검토 깊이')
    expect(text).toContain('후기 발견 비용 배수')
    expect(text).toContain('기술 부채')
  })
})

describe('비용 층 (설계 10, P4)', () => {
  it('비용 묶음이 있고 단가의 기본값은 모두 0이다', () => {
    const g = ai.groups.find((x) => x.title === '비용(출력 전용 · 일정·품질에 영향 없음)')
    expect(g?.params.map((q) => q.name)).toEqual(['cost_md_rate', 'cost_token_per_task', 'cost_seat_per_day', 'cost_infra_per_day'])
    const d = defaultParams(ai)
    expect([d['cost_md_rate'], d['cost_token_per_task'], d['cost_seat_per_day'], d['cost_infra_per_day']]).toEqual([0, 0, 0, 0])
  })

  it('단가를 정하기 전에는 비용 지표가 없고, 정하면 완료 시점의 금액이 나온다', () => {
    const run = (o: Record<string, number>) => runModel(compileModel(ai.def), { overrides: { ...defaultParams(ai), ...o }, end: 450 })
    const k = (o: Record<string, number>) => computeKpis(ai.kpiSpecs, run(o), { ...defaultParams(ai), ...o })
    const none = k({})
    expect(none['totalCost']).toBeNull()
    expect(none['costPerTask']).toBeNull()
    const o = { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, cost_md_rate: 40, cost_token_per_task: 2, cost_seat_per_day: 0.5, cost_infra_per_day: 20 }
    const some = k(o)
    expect(some['totalCost']).toBeGreaterThan(0)
    expect((some['laborCost'] as number) + (some['tokenCost'] as number) + (some['infraCost'] as number)).toBeCloseTo(some['totalCost'] as number, 4)
    expect(some['costPerTask']).toBeCloseTo((some['totalCost'] as number) / 400, 6)
    // 일정은 단가와 무관하다
    expect(some['completionDay']).toBe(k({ ...o, cost_md_rate: 0, cost_token_per_task: 0, cost_seat_per_day: 0, cost_infra_per_day: 0 })['completionDay'])
  })

  it('보고서 안내가 비용 층이 출력 전용임을 밝힌다', () => {
    const text = modelCaveat(ai)
    expect(text).toContain('일정·품질 동역학에 영향을 주지 않으며')
    expect(text).not.toContain('아직 반영하지 않았으므로')
  })
})
