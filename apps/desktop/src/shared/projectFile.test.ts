import { DEFAULT_EVM_SETTINGS, MAX_SCENARIOS as ANALYSIS_MAX, MAX_SCENARIO_NAME as ANALYSIS_NAME, MAX_SCENARIO_NOTE as ANALYSIS_NOTE } from '@spd/analysis'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVM_FILE,
  MAX_BASELINE_POINTS,
  MAX_SCENARIOS,
  MAX_SCENARIO_NAME,
  MAX_SCENARIO_NOTE,
  migrateProject,
  parseProjectJson,
  serializeProject,
  type ProjectFile
} from './projectFile'

const valid: ProjectFile = {
  schemaVersion: 3,
  meta: { name: 'p', createdAt: 'a', updatedAt: 'b' },
  model: { id: 'brooks', version: 1 },
  params: { extra_people: 5 },
  run: { end: 400, dt: 0.25, seed: 1 },
  scenarios: [],
  adopted: null,
  actuals: [],
  evm: DEFAULT_EVM_FILE,
  revisions: [],
  risk: null,
  validation: null,
  reports: null
}
const scenario = (id: string, name: string, overrides: Record<string, number> = {}) => ({ id, name, overrides })
const withScenarios = (scenarios: unknown[]) => JSON.stringify({ ...valid, scenarios })
const message = (text: string) => {
  const r = parseProjectJson(text)
  if (r.ok) throw new Error('오류가 나야 합니다')
  return r.message
}

/** MVP가 쓰던 v1 파일 */
const v1 = () => {
  const { scenarios: _s, adopted: _a, actuals: _c, ...rest } = valid
  return { ...rest, schemaVersion: 1 }
}

describe('parseProjectJson (v2)', () => {
  it('serialize와 parse가 왕복한다', () => {
    expect(parseProjectJson(serializeProject(valid))).toEqual({ ok: true, project: valid })
  })
  it('ui와 run의 선택 항목은 없어도 된다', () => {
    expect(parseProjectJson(JSON.stringify({ ...valid, run: {} })).ok).toBe(true)
  })
  it('알 수 없는 최상위 항목은 버린다', () => {
    const r = parseProjectJson(JSON.stringify({ ...valid, future: 1 }))
    expect(r.ok && 'future' in r.project).toBe(false)
  })
  it.each([
    ['깨진 JSON', '{', 'JSON'],
    ['배열', '[]', '형식이 아닙니다'],
    ['null', 'null', '형식이 아닙니다'],
    ['문자열', '"x"', '형식이 아닙니다']
  ])('%s', (_n, text, expected) => {
    expect(message(text)).toContain(expected)
  })
  it('항목 위치를 포함한 메시지를 준다', () => {
    expect(message(JSON.stringify({ ...valid, params: { extra_people: 'five' } }))).toContain('params.extra_people')
  })
  it('schemaVersion이 없거나 0, 정수가 아니면 거부한다', () => {
    for (const v of [undefined, 0, 1.5, '2']) {
      expect(parseProjectJson(JSON.stringify({ ...valid, schemaVersion: v })).ok).toBe(false)
    }
  })
  it('더 새로운 버전은 별도 메시지', () => {
    expect(message(JSON.stringify({ ...valid, schemaVersion: 7 }))).toContain('스키마 7')
  })
  it('빈 이름과 정수가 아닌 시드를 거부한다', () => {
    expect(parseProjectJson(JSON.stringify({ ...valid, meta: { ...valid.meta, name: '' } })).ok).toBe(false)
    expect(parseProjectJson(JSON.stringify({ ...valid, run: { seed: 1.5 } })).ok).toBe(false)
  })
})

describe('v1 → v3 마이그레이션', () => {
  it('v1 파일을 열면 시나리오 없음·채택 없음의 최신 버전이 된다', () => {
    const r = parseProjectJson(JSON.stringify(v1()))
    expect(r).toEqual({ ok: true, project: valid, migratedFrom: 1 })
  })
  it('기존 내용(모델, 파라미터, 실행 설정, UI)은 그대로 보존된다', () => {
    const file = { ...v1(), ui: { chartVariable: 'total_personnel' }, params: { extra_people: 7, hire_day: 95 }, run: { end: 350, dt: 0.5, seed: 42 } }
    const r = parseProjectJson(JSON.stringify(file))
    expect(r.ok && r.project).toMatchObject({
      schemaVersion: 3,
      model: { id: 'brooks', version: 1 },
      params: { extra_people: 7, hire_day: 95 },
      run: { end: 350, dt: 0.5, seed: 42 },
      ui: { chartVariable: 'total_personnel' },
      scenarios: [],
      adopted: null,
      actuals: []
    })
  })
  it('변환한 결과를 저장하면 최신 파일이 되고 다시 읽어도 변환이 필요 없다', () => {
    const first = parseProjectJson(JSON.stringify(v1()))
    if (!first.ok) throw new Error('expected ok')
    const second = parseProjectJson(serializeProject(first.project))
    expect(second).toEqual({ ok: true, project: first.project })
    expect(second.ok && 'migratedFrom' in second).toBe(false)
  })
  it('깨진 v1 파일은 변환 뒤 검증에서 거부된다', () => {
    expect(message(JSON.stringify({ ...v1(), params: { x: 'a' } }))).toContain('params.x')
  })
  it('v1 파일에 우연히 scenarios가 들어 있어도 비어 있는 파일로 취급한다', () => {
    const r = parseProjectJson(JSON.stringify({ ...v1(), scenarios: [scenario('s1', 'x')] }))
    expect(r.ok && r.project.scenarios).toEqual([])
  })
})

describe('migrateProject', () => {
  it('v2는 내용 그대로 v3이 된다(사용자 모델 내장 필드만 새로 생겼다)', () => {
    const input = { schemaVersion: 2, a: 1 }
    expect(migrateProject(input)).toEqual({ raw: { schemaVersion: 3, a: 1 }, from: 2 })
    expect(input).toEqual({ schemaVersion: 2, a: 1 })
  })

  it('최신과 그 이상, 버전을 알 수 없는 입력은 그대로 돌려준다', () => {
    for (const raw of [{ schemaVersion: 3 }, { schemaVersion: 9 }, {}, { schemaVersion: 'x' }, { schemaVersion: 0 }, { schemaVersion: 1.5 }]) {
      expect(migrateProject(raw)).toEqual({ raw })
    }
  })
  it('v1은 변환하고 시작 버전을 알린다. 입력 객체는 바꾸지 않는다', () => {
    const input = { schemaVersion: 1, a: 1 }
    const out = migrateProject(input)
    expect(out).toEqual({ raw: { schemaVersion: 3, a: 1, scenarios: [], adopted: null }, from: 1 })
    expect(input).toEqual({ schemaVersion: 1, a: 1 })
  })
})

describe('시나리오', () => {
  it('저장하고 다시 읽으면 같다(메모와 overrides 포함)', () => {
    const file = {
      ...valid,
      scenarios: [
        { id: 's1', name: '채용 앞당기기', note: '채용·동화 지연을 줄인다', overrides: { hiring_delay: 10, assim_delay: 40 } },
        scenario('s2', '일정 촉박', { planned_duration_days: 120 })
      ]
    }
    expect(parseProjectJson(serializeProject(file))).toEqual({ ok: true, project: file })
  })

  it('id가 겹치면 위치와 함께 거부한다', () => {
    expect(message(withScenarios([scenario('s1', 'a'), scenario('s1', 'b')]))).toContain('scenarios.1.id')
  })
  it('이름이 겹치면 위치와 함께 거부한다', () => {
    expect(message(withScenarios([scenario('s1', 'a'), scenario('s2', 'a')]))).toContain('scenarios.1.name')
  })
  it.each([
    ['빈 이름', ''],
    ['앞뒤 공백', ' a'],
    ['너무 긴 이름', '가'.repeat(MAX_SCENARIO_NAME + 1)]
  ])('%s을 거부한다', (_n, name) => {
    expect(message(withScenarios([scenario('s1', name)]))).toContain('scenarios.0.name')
  })
  it('이름 길이 상한은 허용한다', () => {
    expect(parseProjectJson(withScenarios([scenario('s1', '가'.repeat(MAX_SCENARIO_NAME))])).ok).toBe(true)
  })
  it.each(['', 'a b', 'a/b', '가', 'x'.repeat(41)])('id "%s"를 거부한다', (id) => {
    expect(parseProjectJson(withScenarios([scenario(id, 'n')])).ok).toBe(false)
  })
  it('overrides가 유한한 수가 아니면 거부한다', () => {
    expect(parseProjectJson(withScenarios([{ id: 's1', name: 'a', overrides: { x: 'many' } }])).ok).toBe(false)
  })
  it('메모 길이 상한', () => {
    expect(parseProjectJson(withScenarios([{ ...scenario('s1', 'a'), note: 'x'.repeat(MAX_SCENARIO_NOTE) }])).ok).toBe(true)
    expect(parseProjectJson(withScenarios([{ ...scenario('s1', 'a'), note: 'x'.repeat(MAX_SCENARIO_NOTE + 1) }])).ok).toBe(false)
  })
  it('12개까지 허용하고 13개는 거부한다', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => scenario(`s${i}`, `시나리오 ${i}`))
    expect(parseProjectJson(withScenarios(many(MAX_SCENARIOS))).ok).toBe(true)
    expect(parseProjectJson(withScenarios(many(MAX_SCENARIOS + 1))).ok).toBe(false)
  })
  it('scenarios가 없는 v2 파일은 거부한다(마이그레이션은 v1만)', () => {
    const { scenarios: _s, ...rest } = valid
    expect(message(JSON.stringify(rest))).toContain('scenarios')
  })
})

describe('채택 계획(adopted)', () => {
  const adopted = (over: Record<string, unknown> = {}) => ({
    scenarioId: 's1',
    scenarioName: '채용 앞당기기',
    adoptedAt: '2026-10-20T10:00:00.000Z',
    revision: 0,
    model: { id: 'brooks', version: 1 },
    params: { extra_people: 5 },
    run: { end: 400, dt: 0.25, seed: 1 },
    credits: [{ variable: 'developed_software', weight: 1 }],
    totalTasks: 500,
    bac: 5482.5,
    plannedCompletion: 274.1,
    series: { time: [0, 1, 2], progress: [0, 0.004, 0.008], effort: [0, 20, 40] },
    ...over
  })
  const withAdopted = (a: unknown) => JSON.stringify({ ...valid, scenarios: [scenario('s1', '채용 앞당기기')], adopted: a })
  const err = (a: unknown) => {
    const r = parseProjectJson(withAdopted(a))
    if (r.ok) throw new Error('오류가 나야 합니다')
    return r.message
  }

  it('채택 계획이 있는 파일을 저장하고 다시 읽으면 같다', () => {
    const file = { ...valid, scenarios: [scenario('s1', '채용 앞당기기')], adopted: adopted() }
    expect(parseProjectJson(serializeProject(file as ProjectFile))).toEqual({ ok: true, project: file })
  })
  it('기준("@base")을 채택할 수 있다', () => {
    expect(parseProjectJson(withAdopted(adopted({ scenarioId: '@base', scenarioName: '기준' }))).ok).toBe(true)
  })
  it('채택이 없는(null) v2 파일은 그대로 읽힌다', () => {
    expect(parseProjectJson(JSON.stringify(valid)).ok).toBe(true)
  })
  it.each([
    ['잘못된 시나리오 id', { scenarioId: '@other' }, 'adopted.scenarioId'],
    ['빈 이름', { scenarioName: '' }, 'adopted.scenarioName'],
    ['음수 개정 번호', { revision: -1 }, 'adopted.revision'],
    ['BAC가 0', { bac: 0 }, 'adopted.bac'],
    ['계획 완료가 0 이하', { plannedCompletion: -3 }, 'adopted.plannedCompletion'],
    ['총 태스크가 0', { totalTasks: 0 }, 'adopted.totalTasks'],
    ['인정 비율 합이 1이 아님', { credits: [{ variable: 'a', weight: 0.5 }] }, 'adopted.credits'],
    ['인정 비율이 1 초과', { credits: [{ variable: 'a', weight: 1.5 }] }, 'adopted.credits'],
    ['인정 단계가 없음', { credits: [] }, 'adopted.credits'],
    ['같은 변수가 겹침', { credits: [{ variable: 'a', weight: 0.5 }, { variable: 'a', weight: 0.5 }] }, 'adopted.credits'],
    ['시계열 길이가 다름', { series: { time: [0, 1, 2], progress: [0, 1], effort: [0, 1, 2] } }, 'adopted.series'],
    ['시각이 증가하지 않음', { series: { time: [0, 2, 1], progress: [0, 1, 2], effort: [0, 1, 2] } }, 'adopted.series.time'],
    ['시각이 겹침', { series: { time: [0, 1, 1], progress: [0, 1, 2], effort: [0, 1, 2] } }, 'adopted.series.time'],
    ['진척률이 음수', { series: { time: [0, 1], progress: [-0.1, 1], effort: [0, 1] } }, 'adopted.series'],
    ['공수가 음수', { series: { time: [0, 1], progress: [0, 1], effort: [0, -1] } }, 'adopted.series'],
    ['점이 1개', { series: { time: [0], progress: [0], effort: [0] } }, 'adopted.series']
  ])('%s을 거부하고 위치를 알린다', (_n, over, where) => {
    expect(err(adopted(over))).toContain(where)
  })
  it('시계열 점이 너무 많으면 거부한다', () => {
    const n = MAX_BASELINE_POINTS + 1
    const big = { time: Array.from({ length: n }, (_, i) => i), progress: Array(n).fill(0), effort: Array(n).fill(0) }
    expect(err(adopted({ series: big }))).toContain('adopted.series')
  })
  it('비유한 수는 JSON에 쓸 수 없어 저장 단계에서 걸러진다', () => {
    expect(JSON.stringify({ x: NaN })).toBe('{"x":null}')
    expect(err(adopted({ bac: null }))).toContain('adopted.bac')
  })
})

describe('분석 패키지와 한도 일치', () => {
  it('시나리오 개수·이름·메모 한도가 `@spd/analysis`와 같다', () => {
    expect(MAX_SCENARIOS).toBe(ANALYSIS_MAX)
    expect(MAX_SCENARIO_NAME).toBe(ANALYSIS_NAME)
    expect(MAX_SCENARIO_NOTE).toBe(ANALYSIS_NOTE)
  })
})

describe('actuals', () => {
  const parseJ = (o: unknown) => parseProjectJson(JSON.stringify(o))
  const row = { day: 7, cum: { prod_tasks_developed: 12, prod_tasks_qaed: 6 }, effort: 28, headcount: 4, defects: 15, note: '첫 보고' }
  it('없으면 빈 목록이 된다(실적 도입 전의 v2 파일도 읽힌다)', () => {
    const { actuals: _a, ...noActuals } = valid
    const r = parseJ(noActuals)
    expect(r.ok && r.project.actuals).toEqual([])
  })
  it('올바른 실적은 그대로 읽힌다', () => {
    const r = parseJ({ ...valid, actuals: [row, { day: 14, cum: { prod_tasks_developed: 20 }, effort: 60 }] })
    expect(r.ok && r.project.actuals).toHaveLength(2)
    expect(r.ok && r.project.actuals[0]).toEqual(row)
  })
  it('내용 오류(음수, 순서)는 구조 검사에서 막지 않는다(앱이 행마다 표시)', () => {
    expect(parseJ({ ...valid, actuals: [{ day: 5, cum: {}, effort: -1 }, { day: 3, cum: {}, effort: 0 }] }).ok).toBe(true)
  })
  it.each([
    ['day 누락', { cum: {}, effort: 1 }],
    ['effort가 문자열', { day: 1, cum: {}, effort: '3' }],
    ['cum 값이 문자열', { day: 1, cum: { a: 'x' }, effort: 1 }],
    ['긴 메모', { day: 1, cum: {}, effort: 1, note: 'x'.repeat(201) }]
  ])('구조 오류: %s', (_n, bad) => {
    expect(parseJ({ ...valid, actuals: [bad] }).ok).toBe(false)
  })
  it('최대 400행', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ day: i + 1, cum: {}, effort: i }))
    expect(parseJ({ ...valid, actuals: rows(400) }).ok).toBe(true)
    expect(parseJ({ ...valid, actuals: rows(401) }).ok).toBe(false)
  })
})

describe('evm 설정', () => {
  it('파일의 기본값은 분석 패키지의 기본값과 같다', () => {
    expect(DEFAULT_EVM_FILE).toEqual(DEFAULT_EVM_SETTINGS)
  })
  it('없으면 기본값이 된다', () => {
    const { evm: _e, revisions: _r, ...rest } = valid
    const r = parseProjectJson(JSON.stringify(rest))
    expect(r.ok && r.project.evm).toEqual(DEFAULT_EVM_FILE)
  })
  it('저장한 값이 그대로 읽힌다', () => {
    const evm = { k: 4, alerts: { warn: 0.95, critical: 0.7, trend: 2, early: { progress: 0.2, cpi: 0.85 } } }
    const r = parseProjectJson(JSON.stringify({ ...valid, evm }))
    expect(r.ok && r.project.evm).toEqual(evm)
  })
  it('구조가 틀리면 거부(내용 검사는 앱이 한다)', () => {
    expect(parseProjectJson(JSON.stringify({ ...valid, evm: { k: 3 } })).ok).toBe(false)
  })
})

describe('revisions (기준선 개정 이력)', () => {
  const parseJ = (o: unknown) => parseProjectJson(JSON.stringify(o))
  const adopted = {
    scenarioId: '@base', scenarioName: '기준', adoptedAt: '2026-01-01T00:00:00.000Z', revision: 0,
    model: { id: 'brooks', version: 1 }, params: {}, run: { end: 400, dt: 0.25, seed: 1 },
    credits: [{ variable: 'developed_software', weight: 1 }], totalTasks: 500, bac: 5000, plannedCompletion: 270,
    series: { time: [0, 1, 2], progress: [0, 0.1, 0.2], effort: [0, 10, 20] }
  }
  const rev = (n: number, day: number, over: Record<string, unknown> = {}) => ({
    number: n, revisedAt: '2026-02-01T00:00:00.000Z', day, reason: '지연 만회', action: { kind: 'staffing', label: '인력 보강 +3명 (60일)', values: { people: 3 }, day: 60 },
    kappa: 0.9, before: { plannedCompletion: 270, bac: 5000 }, after: { plannedCompletion: 290, bac: 5600 }, ev0: 800, ac0: 900,
    baseline: { bac: 5600, plannedCompletion: 290, series: { time: [day, day + 1, day + 2], progress: [0.2, 0.3, 0.4], effort: [800, 900, 1000] } },
    ...over
  })
  const file = (revisions: unknown[], ad: unknown = adopted) => ({ ...valid, model: { id: 'brooks', version: 1 }, adopted: ad, revisions })

  it('없으면 빈 목록(개정 도입 전의 v2 파일도 읽힌다)', () => {
    const { revisions: _r, ...rest } = valid
    const r = parseJ(rest)
    expect(r.ok && r.project.revisions).toEqual([])
  })
  it('올바른 개정 이력은 그대로 읽힌다(조치 없음은 action null)', () => {
    const r = parseJ(file([rev(1, 50), rev(2, 80, { action: null })]))
    expect(r.ok && r.project.revisions.map((x) => [x.number, x.day, x.action === null])).toEqual([[1, 50, false], [2, 80, true]])
  })
  it.each([
    ['번호가 이어지지 않음', [rev(2, 50)], '개정 번호'],
    ['개정 시점이 이전보다 늦지 않음', [rev(1, 50), rev(2, 50)], '이전 개정보다 늦어야'],
    ['사유가 공백', [rev(1, 50, { reason: '   ' })], '사유'],
    ['사유가 너무 김', [rev(1, 50, { reason: 'x'.repeat(201) })], '200자'],
    ['시계열이 개정 시점에서 시작하지 않음', [rev(1, 50, { baseline: { bac: 1, plannedCompletion: 1, series: { time: [10, 11], progress: [0, 1], effort: [0, 1] } } })], '개정 시점에서 시작'],
    ['시각이 증가하지 않음', [rev(1, 50, { baseline: { bac: 1, plannedCompletion: 1, series: { time: [50, 50], progress: [0, 1], effort: [0, 1] } } })], '엄격히 증가'],
    ['길이가 다름', [rev(1, 50, { baseline: { bac: 1, plannedCompletion: 1, series: { time: [50, 51], progress: [0], effort: [0, 1] } } })], '길이'],
    ['음수 공수', [rev(1, 50, { baseline: { bac: 1, plannedCompletion: 1, series: { time: [50, 51], progress: [0, 1], effort: [-1, 1] } } })], '음수'],
    ['BAC가 0', [rev(1, 50, { baseline: { bac: 0, plannedCompletion: 1, series: { time: [50, 51], progress: [0, 1], effort: [0, 1] } } })], '0보다'],
    ['개정 시점이 0 이하', [rev(1, 0)], '0보다']
  ])('거부: %s', (_n, revisions, msg) => {
    const r = parseJ(file(revisions))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain(msg)
  })
  it('채택 계획이 없으면 개정 이력을 둘 수 없다', () => {
    const r = parseJ(file([rev(1, 50)], null))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('채택 계획이 없으면')
  })
  it('최대 20개', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => rev(i + 1, 10 + i * 2))
    expect(parseJ(file(many(20))).ok).toBe(true)
    expect(parseJ(file(many(21))).ok).toBe(false)
  })
})

describe('risk (위험 분석 설정)', () => {
  const risk = {
    scenarioId: '@base',
    n: 500,
    seed: 1,
    inputs: [
      { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 } },
      { name: 'hire_day', dist: { kind: 'normal', mean: 100, sd: 10, lo: 50 } }
    ],
    targets: [{ kpi: 'completionDay', op: '<=', value: 300 }],
    bandVariable: 'cum_effort',
    compareIds: ['@base', 's1']
  }
  const parse = (r: unknown) => parseProjectJson(JSON.stringify({ ...valid, risk: r }))

  it('없으면 null이 된다(위험 분석 도입 전의 v2 파일도 읽힌다)', () => {
    const { risk: _r, ...without } = valid
    const r = parseProjectJson(JSON.stringify(without))
    expect(r.ok && r.project.risk).toBeNull()
  })
  it('저장하고 다시 읽으면 같다(분포 4종 포함)', () => {
    const all = { ...risk, inputs: ['uniform', 'triangular', 'pert', 'normal'].map((kind, i) => ({ name: `p${i}`, dist: kind === 'uniform' ? { kind, min: 1, max: 2 } : kind === 'normal' ? { kind, mean: 1, sd: 0.1 } : { kind, min: 1, mode: 1.5, max: 2 } })) }
    const r = parse(all)
    expect(r.ok && r.project.risk).toEqual(all)
    expect(r.ok && parseProjectJson(serializeProject(r.project))).toEqual(r)
  })
  it('시계열 변수와 비교 대상은 없어도 된다', () => {
    const { bandVariable: _b, compareIds: _c, ...minimal } = risk
    const r = parse(minimal)
    expect(r.ok && r.project.risk?.bandVariable).toBeNull()
    expect(r.ok && r.project.risk?.compareIds).toEqual([])
  })
  it('구조가 틀리면 위치와 함께 거부한다', () => {
    expect(message(JSON.stringify({ ...valid, risk: { ...risk, inputs: [{ name: 'x', dist: { kind: 'lognormal', mu: 1 } }] } }))).toContain('risk')
    expect(message(JSON.stringify({ ...valid, risk: { ...risk, targets: [{ kpi: 'a', op: '<', value: 1 }] } }))).toContain('risk')
    expect(message(JSON.stringify({ ...valid, risk: { ...risk, seed: 'x' } }))).toContain('risk.seed')
    expect(message(JSON.stringify({ ...valid, risk: { ...risk, scenarioId: '잘못 된 id' } }))).toContain('risk.scenarioId')
  })
  it('입력 12개까지, 비교 대상 3개까지', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, dist: { kind: 'uniform', min: 0, max: 1 } }))
    expect(parse({ ...risk, inputs: many(12) }).ok).toBe(true)
    expect(parse({ ...risk, inputs: many(13) }).ok).toBe(false)
    expect(parse({ ...risk, compareIds: ['@base', 'a', 'b'] }).ok).toBe(true)
    expect(parse({ ...risk, compareIds: ['@base', 'a', 'b', 'c'] }).ok).toBe(false)
  })
  it('비유한 값은 거부한다', () => {
    expect(parse({ ...risk, n: 'Infinity' }).ok).toBe(false)
  })
})

describe('validation (모델 검증 설정)', () => {
  const col = (name: string, n = 3, variable: string | null = 'total_personnel') => ({ name, variable, scale: 1, points: Array.from({ length: n }, (_, i) => [i * 7, 10 + i]) })
  const ds = (id: string, columns = [col('a')]) => ({ id, name: `자료 ${id}`, fileName: `${id}.csv`, timeUnit: 'week', offsetDay: 0, actualCompletionDay: null, columns })
  const val = { datasets: [ds('d1')], tolerances: { nrmse: 0.15 }, targetScenarioId: '@base' }
  const parse = (v: unknown) => parseProjectJson(JSON.stringify({ ...valid, validation: v }))

  it('없으면 null이 된다(검증 도입 전의 v2 파일도 읽힌다)', () => {
    const { validation: _v, ...without } = valid
    const r = parseProjectJson(JSON.stringify(without))
    expect(r.ok && r.project.validation).toBeNull()
  })
  it('저장하고 다시 읽으면 같다', () => {
    const r = parse(val)
    expect(r.ok && r.project.validation).toEqual({ ...val, datasets: [{ ...val.datasets[0], actualCompletionDay: null }], checklist: [], presets: [], report: null })
    expect(r.ok && parseProjectJson(serializeProject(r.project))).toEqual(r)
  })
  it('허용 기준·대상은 없어도 된다(기본값: 기준 없음, 기준 시나리오)', () => {
    const r = parse({ datasets: [] })
    expect(r.ok && r.project.validation).toEqual({ datasets: [], tolerances: {}, targetScenarioId: '@base', checklist: [], presets: [], report: null })
  })
  it('열의 변수는 null일 수 있다(비교에서 제외)', () => {
    expect(parse({ ...val, datasets: [ds('d1', [col('a', 3, null)])] }).ok).toBe(true)
  })
  it('구조가 틀리면 위치와 함께 거부한다', () => {
    expect(message(JSON.stringify({ ...valid, validation: { ...val, datasets: [{ ...ds('d1'), timeUnit: 'year' }] } }))).toContain('validation.datasets.0.timeUnit')
    expect(message(JSON.stringify({ ...valid, validation: { ...val, datasets: [ds('d1', [{ ...col('a'), points: [[1, 'x']] }] as never)] } }))).toContain('validation')
    expect(message(JSON.stringify({ ...valid, validation: { ...val, targetScenarioId: '잘못 된 id' } }))).toContain('targetScenarioId')
  })
  it('id가 겹치면 거부한다', () => {
    expect(message(JSON.stringify({ ...valid, validation: { ...val, datasets: [ds('d1'), ds('d1')] } }))).toContain('겹칩니다')
  })
  it('한도: 데이터셋 5개, 열 20개, 열당 5,000점, 합계 50,000점', () => {
    expect(parse({ ...val, datasets: ['1', '2', '3', '4', '5'].map((i) => ds(`d${i}`)) }).ok).toBe(true)
    expect(parse({ ...val, datasets: ['1', '2', '3', '4', '5', '6'].map((i) => ds(`d${i}`)) }).ok).toBe(false)
    expect(parse({ ...val, datasets: [ds('d1', Array.from({ length: 20 }, (_, i) => col(`c${i}`)))] }).ok).toBe(true)
    expect(parse({ ...val, datasets: [ds('d1', Array.from({ length: 21 }, (_, i) => col(`c${i}`)))] }).ok).toBe(false)
    expect(parse({ ...val, datasets: [ds('d1', [col('a', 5000)])] }).ok).toBe(true)
    expect(parse({ ...val, datasets: [ds('d1', [col('a', 5001)])] }).ok).toBe(false)
    const big = (id: string) => ds(id, Array.from({ length: 5 }, (_, i) => col(`c${i}`, 4000)))
    expect(parse({ ...val, datasets: [big('d1'), big('d2'), big('d3')] }).ok).toBe(false) // 합계 60,000
    expect(message(JSON.stringify({ ...valid, validation: { ...val, datasets: [big('d1'), big('d2'), big('d3')] } }))).toContain('합계')
  })
})

describe('validation: 체크리스트와 검증 기록', () => {
  const rec = {
    generatedAt: '2026-10-22T09:00:00.000Z', model: { id: 'brooks', version: 1 }, target: { id: '@base', name: '기준' }, run: { end: 400, dt: 0.25, seed: 1 }, tolerances: { nrmse: 0.1 },
    data: [{ name: 'A', fileName: 'a.csv', timeUnit: 'week', offsetDay: 0, unmapped: 0, overall: 0.01, completion: { simulated: 274.1, actual: 300, days: -25.9, percent: -8.6 },
      columns: [{ name: 'hr', variable: 'total_personnel', n: 20, skipped: 0, me: -1, rmse: 2, nrmse: 0.1, mre: null, nse: 0.5, theilM: 0.1, theilS: 0.2, theilC: 0.7, trend: 1, status: { nrmse: 'in' } }] }],
    extremes: { total: 42, counts: { pass: 30, warn: 10, fail: 0, info: 2 }, failures: [] },
    structure: [{ id: 'S1', title: '단위 일관성', status: 'pass', summary: '통과', items: [], notChecked: ['수식 안의 항별 단위'] }],
    checklist: [{ id: 'face-validity', status: 'ok', note: '' }]
  }
  const parse = (v: unknown) => parseProjectJson(JSON.stringify({ ...valid, validation: { datasets: [], ...(v as object) } }))

  it('체크리스트를 저장하고 다시 읽으면 같다', () => {
    const c = [{ id: 'face-validity', status: 'ok', note: '검토 완료' }, { id: 'audience-fit', status: 'problem', note: '' }]
    const r = parse({ checklist: c })
    expect(r.ok && r.project.validation?.checklist).toEqual(c)
    expect(r.ok && parseProjectJson(serializeProject(r.project))).toEqual(r)
  })
  it('체크리스트 구조 오류: 상태 값, id 형식, 메모 길이, 중복', () => {
    expect(parse({ checklist: [{ id: 'face-validity', status: 'passed', note: '' }] }).ok).toBe(false)
    expect(parse({ checklist: [{ id: 'Bad Id', status: 'ok', note: '' }] }).ok).toBe(false)
    expect(parse({ checklist: [{ id: 'face-validity', status: 'ok', note: 'x'.repeat(501) }] }).ok).toBe(false)
    expect(parse({ checklist: [{ id: 'face-validity', status: 'ok', note: 'x'.repeat(500) }] }).ok).toBe(true)
    expect(message(JSON.stringify({ ...valid, validation: { datasets: [], checklist: [{ id: 'face-validity', status: 'ok', note: '' }, { id: 'face-validity', status: 'problem', note: '' }] } }))).toContain('겹칩니다')
  })
  it('검증 기록을 저장하고 다시 읽으면 같다(지표가 null일 수 있다)', () => {
    const r = parse({ report: rec })
    expect(r.ok && r.project.validation?.report).toEqual({ ...rec, presets: [] }) // 이전 기록에는 프리셋 요약이 없다
    expect(r.ok && parseProjectJson(serializeProject(r.project))).toEqual(r)
  })
  it('기록에는 실행하지 않은 영역을 null로 둘 수 있다', () => {
    expect(parse({ report: { ...rec, extremes: null, structure: null, data: [] } }).ok).toBe(true)
  })
  it('기록 구조 오류: 판정 값, 숫자가 아닌 지표, 모델 버전', () => {
    expect(parse({ report: { ...rec, structure: [{ ...rec.structure[0], status: 'passed' }] } }).ok).toBe(false)
    expect(parse({ report: { ...rec, data: [{ ...rec.data[0], columns: [{ ...rec.data[0]!.columns[0], rmse: 'x' }] }] } }).ok).toBe(false)
    expect(parse({ report: { ...rec, model: { id: 'brooks', version: 0 } } }).ok).toBe(false)
    expect(message(JSON.stringify({ ...valid, validation: { datasets: [], report: { ...rec, run: { end: 'x', dt: 1, seed: 1 } } } }))).toContain('validation.report.run.end')
  })
  it('기록의 한도: 실패 목록 30개, 점검 항목 30개', () => {
    const fails = (n: number) => Array.from({ length: n }, (_, i) => ({ param: `p${i}`, value: i, reason: 'x' }))
    expect(parse({ report: { ...rec, extremes: { ...rec.extremes, failures: fails(30) } } }).ok).toBe(true)
    expect(parse({ report: { ...rec, extremes: { ...rec.extremes, failures: fails(31) } } }).ok).toBe(false)
  })
  it('검증 도입 전에 만든 validation(체크리스트·기록 없음)도 읽힌다', () => {
    const r = parseProjectJson(JSON.stringify({ ...valid, validation: { datasets: [], tolerances: { nrmse: 0.1 }, targetScenarioId: '@base' } }))
    expect(r.ok && r.project.validation?.checklist).toEqual([])
    expect(r.ok && r.project.validation?.report).toBeNull()
  })
})

describe('validation: 보정 프리셋', () => {
  const preset = (id: string, over: Record<string, unknown> = {}) => ({ id, name: `프리셋 ${id}`, modelId: 'brooks', modelVersion: 1, params: { nominal_productivity: 0.13 }, origin: { dataset: '실제 A', columns: ['developed_software'], objective: 0.001, valObjective: null, split: 0.7, at: '2026-10-22T09:00:00.000Z' }, ...over })
  const parse = (presets: unknown) => parseProjectJson(JSON.stringify({ ...valid, validation: { datasets: [], presets } }))

  it('저장하고 다시 읽으면 같다', () => {
    const p = [preset('p1'), preset('p2', { params: { hire_day: 90 } })]
    const r = parse(p)
    expect(r.ok && r.project.validation?.presets).toEqual(p)
    expect(r.ok && parseProjectJson(serializeProject(r.project))).toEqual(r)
  })
  it('없으면 빈 목록(프리셋 도입 전의 파일도 읽힌다)', () => {
    const r = parseProjectJson(JSON.stringify({ ...valid, validation: { datasets: [] } }))
    expect(r.ok && r.project.validation?.presets).toEqual([])
  })
  it('구조 오류: 파라미터 없음, 이름 공백, id 형식, id 중복, 비유한 값', () => {
    expect(parse([preset('p1', { params: {} })]).ok).toBe(false)
    expect(parse([preset('p1', { name: '   ' })]).ok).toBe(false)
    expect(parse([preset('bad id')]).ok).toBe(false)
    expect(parse([preset('p1', { params: { x: 'a' } })]).ok).toBe(false)
    expect(message(JSON.stringify({ ...valid, validation: { datasets: [], presets: [preset('p1'), preset('p1')] } }))).toContain('겹칩니다')
  })
  it('한도: 20개까지', () => {
    expect(parse(Array.from({ length: 20 }, (_, i) => preset(`p${i}`))).ok).toBe(true)
    expect(parse(Array.from({ length: 21 }, (_, i) => preset(`p${i}`))).ok).toBe(false)
  })
})

describe('reports (보고서 설정)', () => {
  const base = JSON.parse(serializeProject(valid))
  const reports = { kind: 'risk', title: '위험 보고', author: '나', sections: { riskInputs: false }, includeStale: true, chartSize: 'large' }
  const parse = (r: unknown) => parseProjectJson(JSON.stringify({ ...base, reports: r }))

  it('없는 파일은 null로 읽는다(이전 파일과 호환)', () => {
    const { reports: _omit, ...older } = base
    const r = parseProjectJson(JSON.stringify(older))
    expect(r.ok && r.project.reports).toBeNull()
  })

  it('올바른 설정을 그대로 읽는다', () => {
    const r = parse(reports)
    expect(r.ok && r.project.reports).toEqual(reports)
  })

  it('한도를 넘거나 형식이 틀리면 거절한다', () => {
    expect(parse({ ...reports, title: 'a'.repeat(201) }).ok).toBe(false)
    expect(parse({ ...reports, author: 'a'.repeat(101) }).ok).toBe(false)
    expect(parse({ ...reports, chartSize: 'huge' }).ok).toBe(false)
    expect(parse({ ...reports, sections: { a: 'yes' } }).ok).toBe(false)
    expect(parse({ ...reports, sections: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`s${i}`, true])) }).ok).toBe(false)
  })
})
