import { describe, expect, it } from 'vitest'
import { compareValue, type KpiSpec, type Scenario } from '@spd/analysis'
import { compileModel, runModel } from '@spd/sd-engine'
import { getEntry } from '../catalog'
import { defaultParams } from './params'
import { scenarioColor } from './palette'
import { defaultRunSettings } from './runSettings'
import { BASE_ID, taskFor, type ScenarioInputs, type ScenarioRun } from './scenarioRunner'
import {
  barData,
  BASE_COLOR,
  buildComparison,
  formatDelta,
  formatValue,
  overlayRuns,
  radarData,
  withUnit,
  type Comparison
} from './scenarioCompare'

/** 입력에 맞는 행들을 실제 모델 실행으로 만든다. `skip`은 결과가 없는 행, `staleIds`는 결과를 만든 뒤 입력이 바뀐 행. */
function world(modelId: string, scenarios: Scenario[], opts: { skip?: string[]; baseOverrides?: Record<string, number> } = {}) {
  const entry = getEntry(modelId)
  const compiled = compileModel(entry.def)
  const inputs: ScenarioInputs = {
    modelId,
    params: { ...defaultParams(entry), ...opts.baseOverrides },
    settings: defaultRunSettings(entry),
    scenarios
  }
  const runs: Record<string, ScenarioRun> = {}
  for (const id of [BASE_ID, ...scenarios.map((s) => s.id)]) {
    if (opts.skip?.includes(id)) continue
    const task = taskFor(inputs, id)
    if (!task) continue
    runs[id] = {
      phase: 'idle',
      progress: 0,
      result: runModel(compiled, { overrides: task.params, ...task.settings }),
      resultKey: task.key,
      resultParams: task.params
    }
  }
  return { entry, inputs, runs, comparison: buildComparison(entry, inputs, runs) }
}

const sc = (id: string, name: string, overrides: Record<string, number> = {}): Scenario => ({ id, name, overrides })
const cell = (c: Comparison, specId: string, colId: string) => c.groups.flatMap((g) => g.rows).find((r) => r.spec.id === specId)?.cells[colId]

describe('buildComparison: Brooks', () => {
  const w = world('brooks', [sc('s1', '5명 추가', { extra_people: 5 }), sc('s2', '10명 추가', { extra_people: 10 })])

  it('열은 기준 다음에 시나리오 순서이고 기준은 색이 없다', () => {
    expect(w.comparison.columns.map((c) => [c.id, c.name, c.color])).toEqual([
      [BASE_ID, '기준', null],
      ['s1', '5명 추가', scenarioColor('s1')],
      ['s2', '10명 추가', scenarioColor('s2')]
    ])
    expect(w.comparison.baseReady).toBe(true)
    expect(w.comparison.anyStale).toBe(false)
  })

  it('지표를 그룹 순서(일정, 비용, 위험)로 묶는다. Brooks에는 품질 지표가 없어 그룹도 없다', () => {
    expect(w.comparison.groups.map((g) => g.label)).toEqual(['일정', '비용', '위험'])
  })

  it('책 값: 기준 274.1일, 5명 추가 272.0일, 10명 추가 294.6일', () => {
    expect(cell(w.comparison, 'completionDay', BASE_ID)?.value).toBeCloseTo(274.12, 1)
    expect(cell(w.comparison, 'completionDay', 's1')?.value).toBeCloseTo(272.0, 1)
    expect(cell(w.comparison, 'completionDay', 's2')?.value).toBeCloseTo(294.64, 1)
  })

  it('기준 열은 차이가 없고, 나머지는 기준 대비 차이와 판정을 갖는다', () => {
    expect(cell(w.comparison, 'completionDay', BASE_ID)?.delta).toBeNull()
    expect(cell(w.comparison, 'completionDay', 's1')?.delta).toMatchObject({ verdict: 'better' })
    expect(cell(w.comparison, 'completionDay', 's1')?.delta?.diff).toBeCloseTo(-2.12, 1)
    expect(cell(w.comparison, 'completionDay', 's2')?.delta).toMatchObject({ verdict: 'worse' })
  })

  it('일정은 줄어도 공수는 늘어나는 상충이 표에 드러난다(책 p.21)', () => {
    expect(cell(w.comparison, 'completionDay', 's1')?.delta?.verdict).toBe('better')
    expect(cell(w.comparison, 'totalEffort', 's1')?.delta?.verdict).toBe('worse')
  })

  it('방향이 없는 지표(최대 인원)는 차이는 있어도 판정은 없다', () => {
    expect(cell(w.comparison, 'peakStaff', 's1')?.delta).toMatchObject({ verdict: 'n/a' })
    expect(cell(w.comparison, 'peakStaff', 's1')?.delta?.diff).toBeCloseTo(5, 6)
  })
})

describe('buildComparison: 결과가 없거나 오래되었을 때', () => {
  it('결과가 없는 열은 값과 차이가 비어 있다', () => {
    const w = world('brooks', [sc('s1', 'a', { extra_people: 5 })], { skip: ['s1'] })
    const col = w.comparison.columns[1]
    expect(col).toMatchObject({ hasResult: false, stale: false, kpis: null, status: 'none' })
    expect(cell(w.comparison, 'completionDay', 's1')).toEqual({ value: null, delta: null })
    expect(cell(w.comparison, 'completionDay', BASE_ID)?.value).not.toBeNull()
  })

  it('기준에 결과가 없으면 모든 차이를 계산하지 않는다', () => {
    const w = world('brooks', [sc('s1', 'a', { extra_people: 5 })], { skip: [BASE_ID] })
    expect(w.comparison.baseReady).toBe(false)
    expect(cell(w.comparison, 'completionDay', 's1')?.value).toBeCloseTo(272.0, 1)
    expect(cell(w.comparison, 'completionDay', 's1')?.delta).toMatchObject({ diff: null, verdict: 'n/a' })
  })

  it('입력이 바뀐 열은 오래됨으로 표시하고, 지표는 그 결과를 만든 입력으로 계산한다', () => {
    const w = world('integrated-project', [sc('s1', '계획 120일', { planned_duration_days: 120 })])
    const before = cell(w.comparison, 'scheduleSlip', 's1')?.value
    // 기본 설정과 시나리오 값이 바뀌었지만 결과는 그대로(오래된 결과)
    const inputs: ScenarioInputs = { ...w.inputs, scenarios: [sc('s1', '계획 120일', { planned_duration_days: 100 })] }
    const comparison = buildComparison(w.entry, inputs, w.runs)
    expect(comparison.columns[1]).toMatchObject({ stale: true, status: 'stale' })
    expect(comparison.anyStale).toBe(true)
    expect(cell(comparison, 'scheduleSlip', 's1')?.value).toBe(before) // 계획 일정 120 기준으로 계산한 값 유지
  })

  it('미완료 실행은 완료 시점 지표가 null이고 판정도 n/a이다', () => {
    const entry = getEntry('brooks')
    const compiled = compileModel(entry.def)
    const inputs: ScenarioInputs = { modelId: 'brooks', params: defaultParams(entry), settings: { ...defaultRunSettings(entry), end: 100 }, scenarios: [] }
    const task = taskFor(inputs, BASE_ID)!
    const runs = { [BASE_ID]: { phase: 'idle' as const, progress: 0, result: runModel(compiled, { overrides: task.params, ...task.settings }), resultKey: task.key, resultParams: task.params } }
    const c = buildComparison(entry, inputs, runs)
    expect(cell(c, 'completionDay', BASE_ID)?.value).toBeNull()
    expect(cell(c, 'peakStaff', BASE_ID)?.value).not.toBeNull()
  })
})

describe('buildComparison: 통합 프로젝트 모델', () => {
  const w = world('integrated-project', [sc('s1', '과소추정 없음', { plan_known_fraction: 1 }), sc('s2', '기준과 같음')])

  it('모든 그룹(일정·비용·품질·위험)이 나온다', () => {
    expect(w.comparison.groups.map((g) => g.label)).toEqual(['일정', '비용', '품질', '위험'])
  })
  it('알려진 값: 기준 314.3일, 과소추정 없음 266.0일', () => {
    expect(cell(w.comparison, 'completionDay', BASE_ID)?.value).toBeCloseTo(314.25, 1)
    expect(cell(w.comparison, 'completionDay', 's1')?.value).toBeCloseTo(266.0, 1)
  })
  it('과소추정이 없으면 일정·비용·품질이 모두 좋아진다', () => {
    for (const id of ['completionDay', 'scheduleSlip', 'totalEffort', 'residualDefects', 'residualDensity']) {
      expect(cell(w.comparison, id, 's1')?.delta?.verdict, id).toBe('better')
    }
  })
  it('기준과 같은 시나리오는 모든 지표가 같다', () => {
    for (const row of w.comparison.groups.flatMap((g) => g.rows)) {
      const v = row.cells['s2']?.delta?.verdict
      expect(v === 'same' || v === 'n/a', row.spec.id).toBe(true)
    }
  })
})

describe('buildComparison: 비용 지표(emptyLabel)', () => {
  it('단가를 아무도 정하지 않았으면 비용 지표 줄이 없고, 한 시나리오라도 정하면 나타난다', () => {
    const none = world('integrated-project-ai', [sc('s1', 'AI 켬', { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2 })])
    const ids = (c: Comparison) => c.groups.flatMap((g) => g.rows).map((r) => r.spec.id)
    expect(ids(none.comparison)).not.toContain('totalCost')
    expect(ids(none.comparison)).toContain('totalEffort')
    const priced = world('integrated-project-ai', [sc('s1', 'AI 켬', { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, cost_md_rate: 40 })])
    expect(ids(priced.comparison)).toContain('totalCost')
    expect(cell(priced.comparison, 'totalCost', BASE_ID)?.value).toBeNull()
    expect(cell(priced.comparison, 'totalCost', 's1')?.value).toBeGreaterThan(0)
    expect(formatValue(priced.entry.kpiSpecs.find((k) => k.id === 'totalCost') as KpiSpec, null)).toBe('미완료/단가 없음')
  })
})

describe('형식', () => {
  const spec = (decimals: number, unit: string): Pick<KpiSpec, 'decimals' | 'unit'> => ({ decimals, unit })

  it('한 글자 단위와 %는 붙이고 나머지는 띄운다', () => {
    expect(withUnit('314.3', '일')).toBe('314.3일')
    expect(withUnit('8', '명')).toBe('8명')
    expect(withUnit('57', '%')).toBe('57%')
    expect(withUnit('1,224', '맨데이')).toBe('1,224 맨데이')
    expect(withUnit('0.3', '오류/KDSI')).toBe('0.3 오류/KDSI')
    expect(withUnit('3', '')).toBe('3')
  })
  it('값 표시: 자릿수, 천 단위 구분, 미완료', () => {
    expect(formatValue(spec(1, '일'), 314.25)).toBe('314.3일')
    expect(formatValue(spec(0, '맨데이'), 5482.456)).toBe('5,482 맨데이')
    expect(formatValue(spec(2, '비율'), 0.994)).toBe('0.99 비율')
    expect(formatValue(spec(1, '일'), null)).toBe('미완료')
  })

  it('차이 표시: 부호·화살표·판정 글자를 함께 만든다', () => {
    expect(formatDelta(spec(1, '일'), compareValue('lower', 314.3, 266))).toEqual({ text: '−48.3일', arrow: '▼', verdict: '좋음', percent: '−15.4%' })
    expect(formatDelta(spec(0, '맨데이'), compareValue('lower', 1000, 1250))).toEqual({ text: '+250 맨데이', arrow: '▲', verdict: '나쁨', percent: '+25.0%' })
    expect(formatDelta(spec(0, '명'), compareValue('none', 20, 25))).toEqual({ text: '+5명', arrow: '▲', verdict: '', percent: '+25.0%' })
  })
  it('같거나 표시 자릿수에서 0이 되는 차이는 "변화 없음"이고 좋음/나쁨을 주장하지 않는다', () => {
    expect(formatDelta(spec(1, '일'), compareValue('lower', 100, 100))).toMatchObject({ text: '변화 없음', arrow: '＝', verdict: '같음' })
    expect(formatDelta(spec(0, '맨데이'), compareValue('lower', 1000, 1000.3))).toMatchObject({ text: '변화 없음', arrow: '＝', verdict: '같음' })
    expect(formatDelta(spec(0, '명'), compareValue('none', 5, 5.1))).toMatchObject({ text: '변화 없음', arrow: '＝', verdict: '' })
  })
  it('기준이 0이면 변화율이 없고, 값이 없으면 차이도 없다', () => {
    expect(formatDelta(spec(1, '일'), compareValue('lower', 0, 3))?.percent).toBeNull()
    expect(formatDelta(spec(1, '일'), compareValue('lower', null, 3))).toBeNull()
  })
})

describe('barData', () => {
  const w = world('brooks', [sc('s1', '5명 추가', { extra_people: 5 }), sc('s2', '10명 추가', { extra_people: 10 })])
  it('지표 하나의 값을 기준 포함 열 순서로 돌려주고 기준값을 담는다', () => {
    const d = barData(w.comparison, 'completionDay')!
    expect(d.categories).toEqual(['기준', '5명 추가', '10명 추가'])
    expect(d.values.map((v) => Number(v?.toFixed(1)))).toEqual([274.1, 272.0, 294.6])
    expect(d.colors).toEqual([BASE_COLOR, scenarioColor('s1'), scenarioColor('s2')])
    expect(d.baseValue).toBeCloseTo(274.12, 1)
    expect(d.spec.id).toBe('completionDay')
  })
  it('숨긴 열은 뺀다', () => {
    expect(barData(w.comparison, 'completionDay', { s1: true })?.categories).toEqual(['기준', '10명 추가'])
  })
  it('결과가 없는 열은 막대에 넣지 않는다', () => {
    const none = world('brooks', [sc('s1', 'a', { extra_people: 5 })], { skip: ['s1'] })
    expect(barData(none.comparison, 'completionDay')?.categories).toEqual(['기준'])
  })
  it('없는 지표는 null', () => {
    expect(barData(w.comparison, 'zzz')).toBeNull()
  })
})

describe('radarData', () => {
  it('Brooks는 축이 둘뿐이라 레이더를 그리지 않고 이유를 알린다', () => {
    const w = world('brooks', [sc('s1', 'a', { extra_people: 5 })])
    const r = radarData(w.entry, w.comparison)
    expect(r.ready).toBe(false)
    expect(r.reason).toContain('2개뿐')
  })

  it('통합 모델: 기준 = 1, 과소추정 없음은 일정·비용·품질에서 1보다 크다', () => {
    const w = world('integrated-project', [sc('s1', '과소추정 없음', { plan_known_fraction: 1 })])
    const r = radarData(w.entry, w.comparison)
    expect(r.ready).toBe(true)
    expect(r.axes.map((a) => a.label)).toEqual(['일정', '비용', '품질', '위험'])
    expect(r.series).toHaveLength(1)
    const [schedule, cost, quality, risk] = r.series[0]?.values as number[]
    expect(schedule).toBeCloseTo(314.25 / 266, 2)
    expect(cost).toBeGreaterThan(1)
    expect(quality).toBe(2) // 잔존 결함이 절반 아래로 줄어 상한
    expect(risk).toBeGreaterThan(0.9)
    expect(r.series[0]?.color).toBe(scenarioColor('s1'))
  })

  it('기준이 없으면 그리지 않고, 숨긴 시나리오는 뺀다', () => {
    const noBase = world('integrated-project', [sc('s1', 'a', { plan_known_fraction: 1 })], { skip: [BASE_ID] })
    expect(radarData(noBase.entry, noBase.comparison)).toMatchObject({ ready: false, reason: expect.stringContaining('기준을 먼저') })
    const w = world('integrated-project', [sc('s1', 'a', { plan_known_fraction: 1 }), sc('s2', 'b', { planned_duration_days: 120 })])
    expect(radarData(w.entry, w.comparison).series.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(radarData(w.entry, w.comparison, { s1: true }).series.map((s) => s.id)).toEqual(['s2'])
  })

  it('완료하지 못한 시나리오는 0으로 그리지 않고 제외하며 이유를 알린다', () => {
    const entry = getEntry('integrated-project')
    const compiled = compileModel(entry.def)
    const base = defaultParams(entry)
    const inputs: ScenarioInputs = {
      modelId: entry.id,
      params: base,
      settings: defaultRunSettings(entry),
      scenarios: [sc('s1', '느림', { initial_pros: 1 })]
    }
    const runs: Record<string, ScenarioRun> = {}
    for (const id of [BASE_ID, 's1']) {
      const t = taskFor(inputs, id)!
      // 종료 시각을 줄여 s1만 미완료로 만든다
      const settings = id === 's1' ? { ...t.settings, end: 150 } : t.settings
      runs[id] = { phase: 'idle', progress: 0, result: runModel(compiled, { overrides: t.params, ...settings }), resultKey: t.key, resultParams: t.params }
    }
    const r = radarData(entry, buildComparison(entry, inputs, runs))
    expect(r.ready).toBe(true)
    expect(r.series).toEqual([])
    expect(r.excluded).toEqual([{ name: '느림', reason: expect.stringContaining('완료하지 못해') }])
  })
})

describe('overlayRuns', () => {
  it('결과가 있고 보이기로 한 열만 담고 기준은 회색, 시나리오는 고정 색이다', () => {
    const w = world('brooks', [sc('s1', '5명 추가', { extra_people: 5 }), sc('s2', '10명 추가', { extra_people: 10 })])
    const runs = overlayRuns(w.entry, w.comparison, w.runs)
    expect(runs.map((r) => [r.name, r.color])).toEqual([
      ['기준', BASE_COLOR],
      ['5명 추가', scenarioColor('s1')],
      ['10명 추가', scenarioColor('s2')]
    ])
    expect(runs.every((r) => r.visible)).toBe(true)
    expect(runs[0]?.kpis.completionDay).toBeCloseTo(274.12, 1)
    expect(overlayRuns(w.entry, w.comparison, w.runs, { s1: true }).map((r) => r.name)).toEqual(['기준', '10명 추가'])
  })
  it('오래된 결과는 이름에 표시하고 결과가 없는 열은 뺀다', () => {
    const w = world('brooks', [sc('s1', 'a', { extra_people: 5 }), sc('s2', 'b', { extra_people: 8 })], { skip: ['s2'] })
    const inputs: ScenarioInputs = { ...w.inputs, scenarios: [sc('s1', 'a', { extra_people: 6 }), sc('s2', 'b', { extra_people: 8 })] }
    const comparison = buildComparison(w.entry, inputs, w.runs)
    expect(overlayRuns(w.entry, comparison, w.runs).map((r) => r.name)).toEqual(['기준', 'a (오래됨)'])
  })
})
