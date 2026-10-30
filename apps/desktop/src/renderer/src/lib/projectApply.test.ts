import { DEFAULT_EVM_SETTINGS } from '@spd/analysis'
import { describe, expect, it } from 'vitest'
import { getEntry } from '../catalog'
import type { ProjectFile } from '../../../shared/projectFile'
import type { Scenario } from '@spd/analysis'
import { applyProjectFile, buildProjectFile } from './projectApply'
import { defaultParams, snapshotOf } from './params'
import { checkRunSettings, defaultRunSettings, MAX_STEPS } from './runSettings'
import { defaultRiskSettings, riskToFile, type RiskSettings } from './risk'

const entry = getEntry('brooks')
const NOW = new Date('2026-03-04T05:06:07.000Z')

const base = (): ProjectFile =>
  buildProjectFile({
    entry,
    name: '실험',
    createdAt: '2026-01-01T00:00:00.000Z',
    params: { ...defaultParams(entry), extra_people: 5, hire_day: 95 },
    runSettings: { end: 300, dt: 0.5, seed: 7 },
    chartVariable: 'total_personnel',
    scenarios: [],
    adopted: null,
    actuals: [],
    evm: DEFAULT_EVM_SETTINGS,
    revisions: [],
    now: NOW
  })

describe('buildProjectFile', () => {
  it('폼 항목과 실행 설정, 모델 버전을 담는다', () => {
    const f = base()
    expect(f.schemaVersion).toBe(3)
    expect(f.scenarios).toEqual([])
    expect(f.adopted).toBeNull()
    expect(f.meta).toEqual({ name: '실험', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: NOW.toISOString() })
    expect(f.model).toEqual({ id: 'brooks', version: entry.def.meta.version })
    expect(f.params['extra_people']).toBe(5)
    expect(Object.keys(f.params)).toHaveLength(11)
    expect(f.run).toEqual({ end: 300, dt: 0.5, seed: 7 })
    expect(f.ui).toEqual({ chartVariable: 'total_personnel' })
  })
})

describe('통합 프로젝트 모델 파일', () => {
  const integrated = getEntry('integrated-project')

  it('저장했다가 열면 모델과 모든 파라미터가 복원된다', () => {
    const params = { ...defaultParams(integrated), plan_known_fraction: 1, hiring_delay: 10, total_tasks: 250 }
    const file = buildProjectFile({
      entry: integrated,
      name: '통합',
      createdAt: '2026-01-01T00:00:00.000Z',
      params,
      runSettings: { end: 450, dt: 0.25, seed: 3 },
      chartVariable: 'exh_level',
      scenarios: [],
      adopted: null,
    actuals: [],
    evm: DEFAULT_EVM_SETTINGS,
    revisions: [],
      now: NOW
    })
    expect(file.model).toEqual({ id: 'integrated-project', version: 1 })
    expect(Object.keys(file.params)).toHaveLength(41)
    const r = applyProjectFile(file)
    expect(r).toMatchObject({ ok: true, warnings: [] })
    if (!r.ok) return
    expect(r.state.entry.id).toBe('integrated-project')
    expect(r.state.params).toEqual(params)
    expect(r.state.chartVariable).toBe('exh_level')
  })
})

describe('applyProjectFile', () => {
  it('저장한 상태를 그대로 복원한다(경고 없음)', () => {
    const r = applyProjectFile(base())
    expect(r).toMatchObject({ ok: true, warnings: [] })
    if (!r.ok) return
    expect(r.state.params['extra_people']).toBe(5)
    expect(r.state.params['hire_day']).toBe(95)
    expect(r.state.runSettings).toEqual({ end: 300, dt: 0.5, seed: 7 })
    expect(r.state.chartVariable).toBe('total_personnel')
    expect(r.state.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('복원한 뒤의 스냅샷이 저장 시점과 같아 변경 없음으로 판단된다', () => {
    const r = applyProjectFile(base())
    if (!r.ok) throw new Error('expected ok')
    const saved = snapshotOf(entry, { ...defaultParams(entry), extra_people: 5, hire_day: 95 }, { end: 300, dt: 0.5, seed: 7 })
    expect(snapshotOf(entry, r.state.params, r.state.runSettings)).toBe(saved)
  })

  it('알 수 없는 모델은 실패한다', () => {
    const f = base()
    f.model.id = 'nope'
    expect(applyProjectFile(f)).toEqual({ ok: false, message: expect.stringContaining('nope') })
  })

  it('범위를 벗어난 값은 기본값으로 대체하고 경고한다', () => {
    const f = base()
    f.params['extra_people'] = 9999
    f.params['hire_day'] = -3
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.params['extra_people']).toBe(0)
    expect(r.state.params['hire_day']).toBe(110)
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings[0]).toContain('추가 투입 인원')
  })

  it('정수 항목의 소수는 기본값으로 대체한다', () => {
    const f = base()
    f.params['extra_people'] = 2.5
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.params['extra_people']).toBe(0)
    expect(r.warnings.join()).toContain('정수')
  })

  it('없는 항목은 기본값, 모르는 항목은 무시하고 알린다', () => {
    const f = base()
    delete f.params['hire_day']
    f.params['mystery'] = 1
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.params['hire_day']).toBe(110)
    expect(r.state.params).not.toHaveProperty('mystery')
    expect(r.warnings).toEqual([expect.stringContaining('mystery')])
  })

  it('파일이 더 새로운 모델 버전이면 경고한다', () => {
    const f = base()
    f.model.version = 99
    const r = applyProjectFile(f)
    expect(r).toMatchObject({ ok: true })
    expect((r as { warnings: string[] }).warnings.join()).toContain('더 새로운 모델')
  })

  it('실행 설정이 범위를 벗어나면 그 항목만 기본값으로 쓴다', () => {
    const f = base()
    f.run = { end: 300, dt: 0, seed: 7 }
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.runSettings).toEqual({ end: 300, dt: 0.25, seed: 7 })
    expect(r.warnings.join()).toContain('적분 간격')
  })

  it('조합이 허용 스텝 수를 넘으면 실행 설정을 기본값으로 되돌린다', () => {
    const f = base()
    f.run = { end: 5000, dt: 0.01, seed: 1 } // 500,000 스텝
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.runSettings).toEqual(defaultRunSettings(entry))
    expect(r.warnings.join()).toContain('스텝 수')
  })

  it('실행 설정이 비어 있으면 모델 기본값', () => {
    const f = base()
    f.run = {}
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.runSettings).toEqual(defaultRunSettings(entry))
  })

  it('알 수 없는 그래프 변수는 기본 변수로 대체한다', () => {
    const f = base()
    f.ui = { chartVariable: 'zzz' }
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.chartVariable).toBe(entry.defaultVariable)
  })
})

describe('시나리오 저장·복원', () => {
  const scenarios: Scenario[] = [
    { id: 's1', name: '채용 앞당기기', note: '지연 단축', overrides: { extra_people: 8, hire_day: 120 } },
    { id: 's2', name: '기본과 같음', overrides: {} }
  ]
  const fileWith = (sc: Scenario[], overrideParams = {}) =>
    buildProjectFile({
      entry,
      name: '실험',
      createdAt: '2026-01-01T00:00:00.000Z',
      params: { ...defaultParams(entry), extra_people: 5, ...overrideParams },
      runSettings: { end: 400, dt: 0.25, seed: 1 },
      chartVariable: 'total_personnel',
      scenarios: sc,
      adopted: null,
    actuals: [],
    evm: DEFAULT_EVM_SETTINGS,
    revisions: [],
      now: NOW
    })

  it('build한 파일에 시나리오가 그대로 담기고 채택 계획은 null이다', () => {
    const f = fileWith(scenarios)
    expect(f.scenarios).toEqual(scenarios)
    expect(f.adopted).toBeNull()
  })

  it('빈 메모는 저장하지 않는다', () => {
    const f = fileWith([{ id: 's1', name: 'a', note: '', overrides: {} }])
    expect(f.scenarios[0]).not.toHaveProperty('note')
  })

  it('저장했다가 열면 시나리오가 같다(경고 없음)', () => {
    const r = applyProjectFile(fileWith(scenarios))
    expect(r).toMatchObject({ ok: true, warnings: [] })
    expect(r.ok && r.state.scenarios).toEqual(scenarios)
  })

  it('기본 설정과 같아진 overrides는 조용히 정리한다', () => {
    // 기본 설정에서 extra_people가 5이므로 override 5는 정리된다
    const r = applyProjectFile(fileWith([{ id: 's1', name: 'a', overrides: { extra_people: 5, hire_day: 90 } }]))
    expect(r.ok && r.state.scenarios[0]?.overrides).toEqual({ hire_day: 90 })
    expect(r.ok && r.warnings).toEqual([])
  })

  it('범위 밖·모르는 항목은 버리고 시나리오 이름과 함께 경고한다', () => {
    const f = fileWith([{ id: 's1', name: '엉뚱한 값', overrides: { extra_people: 9999, mystery: 1, hire_day: 90 } }])
    const r = applyProjectFile(f)
    if (!r.ok) throw new Error('expected ok')
    expect(r.state.scenarios[0]?.overrides).toEqual({ hire_day: 90 })
    expect(r.warnings).toHaveLength(2)
    expect(r.warnings.every((w) => w.startsWith("시나리오 '엉뚱한 값':"))).toBe(true)
    expect(r.warnings.join()).toContain('mystery')
    expect(r.warnings.join()).toContain('허용 범위')
  })

  it('시나리오는 파일의 기본 설정(params)을 기준으로 정리한다', () => {
    // 파일의 기본 설정이 hire_day=95이면 override 95는 기본과 같아 정리된다
    const r = applyProjectFile(fileWith([{ id: 's1', name: 'a', overrides: { hire_day: 95 } }], { hire_day: 95 }))
    expect(r.ok && r.state.scenarios[0]?.overrides).toEqual({})
  })

  it('시나리오의 id·이름·메모·순서는 보존한다', () => {
    const r = applyProjectFile(fileWith(scenarios))
    expect(r.ok && r.state.scenarios.map((s) => [s.id, s.name, s.note])).toEqual([
      ['s1', '채용 앞당기기', '지연 단축'],
      ['s2', '기본과 같음', undefined]
    ])
  })
})

describe('snapshotOf', () => {
  it('값이 바뀌면 달라지고 키 순서와 무관하다', () => {
    const p = defaultParams(entry)
    const s = defaultRunSettings(entry)
    const reordered = Object.fromEntries(Object.entries(p).reverse())
    expect(snapshotOf(entry, reordered, s)).toBe(snapshotOf(entry, p, s))
    expect(snapshotOf(entry, { ...p, extra_people: 1 }, s)).not.toBe(snapshotOf(entry, p, s))
    expect(snapshotOf(entry, p, { ...s, seed: 2 })).not.toBe(snapshotOf(entry, p, s))
  })
})

describe('snapshotOf: 시나리오', () => {
  const p = defaultParams(entry)
  const run = defaultRunSettings(entry)
  const sc = (over: Partial<Scenario> = {}): Scenario => ({ id: 's1', name: 'a', overrides: { extra_people: 3 }, ...over })

  it('시나리오가 달라지면 스냅샷도 달라진다(이름, 메모, overrides, 개수)', () => {
    const base = snapshotOf(entry, p, run, [sc()])
    expect(snapshotOf(entry, p, run, [sc({ name: 'b' })])).not.toBe(base)
    expect(snapshotOf(entry, p, run, [sc({ note: '메모' })])).not.toBe(base)
    expect(snapshotOf(entry, p, run, [sc({ overrides: { extra_people: 4 } })])).not.toBe(base)
    expect(snapshotOf(entry, p, run, [])).not.toBe(base)
    expect(snapshotOf(entry, p, run, [sc(), sc({ id: 's2', name: 'b' })])).not.toBe(base)
  })

  it('overrides 키 순서와 무관하고, 시나리오 순서는 의미가 있다', () => {
    const a = sc({ overrides: { extra_people: 3, hire_day: 90 } })
    const b = sc({ overrides: { hire_day: 90, extra_people: 3 } })
    expect(snapshotOf(entry, p, run, [a])).toBe(snapshotOf(entry, p, run, [b]))
    const x = sc({ id: 's2', name: 'x' })
    expect(snapshotOf(entry, p, run, [a, x])).not.toBe(snapshotOf(entry, p, run, [x, a]))
  })

  it('시나리오가 없으면 기존 호출(3개 인자)과 같다', () => {
    expect(snapshotOf(entry, p, run)).toBe(snapshotOf(entry, p, run, []))
  })
})

describe('checkRunSettings', () => {
  it('최대 스텝 수 이하는 통과하고 초과는 메시지를 준다', () => {
    expect(checkRunSettings({ end: 400, dt: 0.25, seed: 1 })).toBeNull()
    expect(checkRunSettings({ end: MAX_STEPS, dt: 1, seed: 1 })).toBeNull()
    expect(checkRunSettings({ end: 5000, dt: 0.01, seed: 1 })).toContain('스텝 수')
  })
})

describe('개정 이력 (revisions)', () => {
  const rev = {
    number: 1, revisedAt: '2026-02-01T00:00:00.000Z', day: 50, reason: '만회', action: null, kappa: 0.9,
    before: { plannedCompletion: 270, bac: 5000 }, after: { plannedCompletion: 290, bac: 5600 }, ev0: 800, ac0: 900,
    baseline: { bac: 5600, plannedCompletion: 290, series: { time: [50, 51], progress: [0.2, 0.3], effort: [800, 900] } }
  }
  const adopted = {
    scenarioId: '@base', scenarioName: '기준', adoptedAt: '2026-01-01T00:00:00.000Z', revision: 0, model: { id: 'brooks', version: 1 }, params: {}, run: { end: 400, dt: 0.25, seed: 1 },
    credits: [{ variable: 'developed_software', weight: 1 }], totalTasks: 500, bac: 5000, plannedCompletion: 270, series: { time: [0, 1], progress: [0, 0.1], effort: [0, 10] }
  }
  const base = () => {
    const entry = getEntry('brooks')
    return buildProjectFile({ entry, name: 'p', createdAt: '2026-01-01T00:00:00.000Z', params: defaultParams(entry), runSettings: defaultRunSettings(entry), chartVariable: 'total_personnel', scenarios: [], adopted: adopted as never, actuals: [], evm: DEFAULT_EVM_SETTINGS, revisions: [rev] as never, now: new Date('2026-03-04T00:00:00.000Z') })
  }
  it('저장했다가 열면 개정 이력이 복원된다', () => {
    const r = applyProjectFile(base())
    expect(r.ok && r.state.revisions).toHaveLength(1)
    expect(r.ok && r.warnings).toEqual([])
  })
  it('채택 계획이 다른 모델이라 버려지면 개정 이력도 함께 버리고 알린다', () => {
    const file = base()
    file.adopted = { ...file.adopted!, model: { id: 'integrated-project', version: 1 } }
    const r = applyProjectFile(file)
    expect(r.ok && r.state.adopted).toBeNull()
    expect(r.ok && r.state.revisions).toEqual([])
    expect(r.ok && r.warnings.join(' ')).toContain('개정 이력 1건')
  })
})

describe('위험 분석 설정 저장·복원', () => {
  const e = getEntry('brooks')
  const settings = (patch: Partial<RiskSettings> = {}): RiskSettings => ({
    ...defaultRiskSettings(),
    n: 200,
    seed: 9,
    inputs: [
      { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 } },
      { name: 'hire_day', dist: { kind: 'pert', min: 60, mode: 100, max: 140 } }
    ],
    targets: [{ kpi: 'completionDay', op: '<=', value: 300 }],
    bandVariable: 'cum_effort',
    ...patch
  })
  const sc: Scenario = { id: 's1', name: '추가 10명', overrides: { extra_people: 10 } }
  const make = (risk?: RiskSettings, scenarios: Scenario[] = [sc]) =>
    buildProjectFile({ entry: e, name: 'p', createdAt: '2026-01-01T00:00:00.000Z', params: defaultParams(e), runSettings: defaultRunSettings(e), chartVariable: 'total_personnel', scenarios, adopted: null, actuals: [], evm: DEFAULT_EVM_SETTINGS, revisions: [], ...(risk ? { risk } : {}), now: NOW })

  it('설정하지 않았으면 파일에는 null이고 열면 처음 값이다', () => {
    expect(make().risk).toBeNull()
    expect(make(defaultRiskSettings()).risk).toBeNull()
    const r = applyProjectFile(make())
    expect(r.ok && r.state.risk).toEqual(defaultRiskSettings())
  })

  it('저장했다가 열면 같은 설정이 복원된다(경고 없음)', () => {
    const risk = settings({ scenarioId: 's1', compareIds: ['@base', 's1'] })
    const r = applyProjectFile(make(risk))
    expect(r.ok && r.state.risk).toEqual(risk)
    expect(r.ok && r.warnings).toEqual([])
  })

  it('저장 파일은 입력과 시드만 담고 결과는 담지 않는다', () => {
    const file = make(settings())
    expect(Object.keys(file.risk!).sort()).toEqual(['bandVariable', 'compareIds', 'inputs', 'n', 'scenarioId', 'seed', 'targets'])
    expect(JSON.stringify(file)).not.toContain('"completed"')
  })

  it('모델에 없는 입력·잘못된 분포·겹침은 버리고 이유와 함께 경고한다', () => {
    const file = make(settings())
    file.risk!.inputs = [
      { name: 'nope', dist: { kind: 'uniform', min: 0, max: 1 } },
      { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.3, mode: 0.1, max: 0.13 } }, // 순서가 틀림
      { name: 'hire_day', dist: { kind: 'uniform', min: 60, max: 140 } },
      { name: 'hire_day', dist: { kind: 'uniform', min: 70, max: 130 } }
    ]
    const r = applyProjectFile(file)
    expect(r.ok && r.state.risk.inputs.map((i) => i.name)).toEqual(['hire_day'])
    const text = r.ok ? r.warnings.join(' | ') : ''
    expect(text).toContain("'nope'")
    expect(text).toContain('겹쳐')
    expect(text.split('|').length).toBeGreaterThanOrEqual(3)
  })

  it('허용 범위를 벗어난 분포는 버린다', () => {
    const file = make(settings())
    file.risk!.inputs = [{ name: 'nominal_productivity', dist: { kind: 'uniform', min: -1, max: 1000 } }]
    const r = applyProjectFile(file)
    expect(r.ok && r.state.risk.inputs).toEqual([])
    expect(r.ok && r.warnings.join(' ')).toContain('버렸습니다')
  })

  it('없는 시나리오·지표·변수와 잘못된 반복 수·시드는 처음 값으로 돌리고 경고한다', () => {
    const file = make(settings({ scenarioId: 's1', compareIds: ['@base', 's1'] }), [sc])
    file.risk = { ...file.risk!, scenarioId: 'gone', n: 5, seed: -3, targets: [{ kpi: 'nope', op: '<=', value: 1 }, { kpi: 'completionDay', op: '>=', value: 1 }], bandVariable: 'nope', compareIds: ['@base', 'gone', 's1', 's1'] }
    const r = applyProjectFile(file)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = defaultRiskSettings()
    expect(r.state.risk.scenarioId).toBe('@base')
    expect(r.state.risk.n).toBe(d.n)
    expect(r.state.risk.seed).toBe(d.seed)
    expect(r.state.risk.targets).toEqual([{ kpi: 'completionDay', op: '>=', value: 1 }])
    expect(r.state.risk.bandVariable).toBeNull()
    expect(r.state.risk.compareIds).toEqual(['@base', 's1'])
    expect(r.warnings.length).toBeGreaterThanOrEqual(5)
  })

  it('대상 시나리오가 시나리오 정리 뒤에도 있으면 유지한다', () => {
    const r = applyProjectFile(make(settings({ scenarioId: 's1' })))
    expect(r.ok && r.state.risk.scenarioId).toBe('s1')
  })

  it('열기 직후 스냅샷이 저장 시점과 같고, 설정이 바뀌면 달라진다', () => {
    const risk = settings()
    const file = make(risk)
    const r = applyProjectFile(file)
    if (!r.ok) throw new Error('열기 실패')
    const snap = (rk: RiskSettings) => snapshotOf(e, r.state.params, r.state.runSettings, r.state.scenarios, r.state.adopted, r.state.actuals, r.state.evm, r.state.revisions, riskToFile(rk))
    expect(snap(r.state.risk)).toBe(snap(risk))
    expect(snap({ ...risk, seed: 10 })).not.toBe(snap(risk))
    expect(snap({ ...risk, inputs: risk.inputs.slice(1) })).not.toBe(snap(risk))
    expect(snap({ ...risk, targets: [] })).not.toBe(snap(risk))
    expect(snap(defaultRiskSettings())).toBe(snapshotOf(e, r.state.params, r.state.runSettings, r.state.scenarios, r.state.adopted, r.state.actuals, r.state.evm, r.state.revisions))
  })
})
