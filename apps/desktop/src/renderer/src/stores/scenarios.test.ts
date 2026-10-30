import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SCENARIOS, MAX_SCENARIO_NOTE, MAX_SCENARIO_NAME } from '@spd/analysis'
import { parseProjectJson, serializeProject } from '../../../shared/projectFile'
import { selectIsDirty, useAppStore } from './appStore'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {}
    })
  }
})

const store = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(store().status).toBe('idle'))
const byId = (id: string) => store().scenarios.find((s) => s.id === id)
const names = () => store().scenarios.map((s) => s.name)

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})

describe('addScenario', () => {
  it('기본 설정에서 시작하는 시나리오를 만들고 선택한다', () => {
    const id = store().addScenario()
    expect(id).toBe('s1')
    expect(store().scenarios).toEqual([{ id: 's1', name: '시나리오 1', overrides: {} }])
    expect(store().activeScenarioId).toBe('s1')
  })

  it('id와 이름이 겹치지 않는다. 지운 뒤 만들면 id는 가장 큰 번호 다음, 이름은 비어 있는 가장 작은 번호', () => {
    store().addScenario()
    store().addScenario()
    store().addScenario()
    store().deleteScenario('s1')
    const id = store().addScenario()
    expect(id).toBe('s4')
    expect(names()).toEqual(['시나리오 2', '시나리오 3', '시나리오 1'])
    expect(new Set(store().scenarios.map((s) => s.id)).size).toBe(store().scenarios.length)
  })

  it(`${MAX_SCENARIOS}개를 넘으면 만들지 않고 상태를 바꾸지 않는다`, () => {
    for (let i = 0; i < MAX_SCENARIOS; i++) expect(store().addScenario()).not.toBeNull()
    const before = store().scenarios
    expect(store().addScenario()).toBeNull()
    expect(store().scenarios).toBe(before)
    expect(store().scenarios).toHaveLength(MAX_SCENARIOS)
  })

  it('수정 상태가 되고, 바로 지우면 다시 깨끗하다', () => {
    expect(selectIsDirty(store())).toBe(false)
    const id = store().addScenario() as string
    expect(selectIsDirty(store())).toBe(true)
    store().deleteScenario(id)
    expect(selectIsDirty(store())).toBe(false)
  })
})

describe('duplicateScenario', () => {
  const seed = () => {
    const id = store().addScenario() as string
    store().renameScenario(id, '채용 앞당기기')
    store().setScenarioNote(id, '지연 단축')
    store().setScenarioOverride(id, 'extra_people', 8)
    store().setScenarioOverride(id, 'hire_day', 90)
    return id
  }

  it('이름·메모·값을 복사하고 원본 바로 뒤에 넣어 선택한다', () => {
    const original = seed()
    store().addScenario() // s2
    const copy = store().duplicateScenario(original) as string
    expect(store().scenarios.map((s) => s.id)).toEqual([original, copy, 's2'])
    expect(byId(copy)).toEqual({ id: copy, name: '채용 앞당기기 (복사)', note: '지연 단축', overrides: { extra_people: 8, hire_day: 90 } })
    expect(store().activeScenarioId).toBe(copy)
  })

  it('복사본을 고쳐도 원본은 그대로이다(값을 공유하지 않는다)', () => {
    const original = seed()
    const copy = store().duplicateScenario(original) as string
    store().setScenarioOverride(copy, 'extra_people', 1)
    store().setScenarioNote(copy, '다른 메모')
    expect(byId(original)?.overrides['extra_people']).toBe(8)
    expect(byId(original)?.note).toBe('지연 단축')
  })

  it('같은 원본을 다시 복제하면 번호가 붙는다', () => {
    const original = seed()
    store().duplicateScenario(original)
    store().duplicateScenario(original)
    expect(names()).toContain('채용 앞당기기 (복사)')
    expect(names()).toContain('채용 앞당기기 (복사 2)')
  })

  it('원본이 없거나 개수 상한이면 null이고 상태가 그대로이다', () => {
    expect(store().duplicateScenario('nope')).toBeNull()
    for (let i = 0; i < MAX_SCENARIOS; i++) store().addScenario()
    const before = store().scenarios
    expect(store().duplicateScenario('s1')).toBeNull()
    expect(store().scenarios).toBe(before)
  })

  it('메모가 없는 원본은 메모 키 없이 복사한다', () => {
    const id = store().addScenario() as string
    const copy = store().duplicateScenario(id) as string
    expect(byId(copy)).not.toHaveProperty('note')
  })
})

describe('renameScenario', () => {
  beforeEach(() => {
    store().addScenario()
    store().addScenario()
  })

  it('앞뒤 공백을 지우고 바꾼다', () => {
    expect(store().renameScenario('s1', '  새 이름  ')).toBeNull()
    expect(byId('s1')?.name).toBe('새 이름')
  })

  it.each([
    ['빈 이름', ''],
    ['공백뿐', '   '],
    ['다른 시나리오와 같은 이름', '시나리오 2'],
    ['너무 긴 이름', '가'.repeat(MAX_SCENARIO_NAME + 1)]
  ])('%s은 오류를 돌려주고 바꾸지 않는다', (_n, name) => {
    const before = names()
    expect(store().renameScenario('s1', name)).toBeTruthy()
    expect(names()).toEqual(before)
  })

  it('자기 이름 그대로는 허용한다', () => {
    expect(store().renameScenario('s1', '시나리오 1')).toBeNull()
  })

  it('다른 시나리오는 건드리지 않는다', () => {
    store().renameScenario('s1', '바뀜')
    expect(byId('s2')?.name).toBe('시나리오 2')
  })
})

describe('setScenarioNote', () => {
  it('메모를 정하고 빈 문자열이면 지운다', () => {
    const id = store().addScenario() as string
    store().setScenarioNote(id, '설명')
    expect(byId(id)?.note).toBe('설명')
    store().setScenarioNote(id, '')
    expect(byId(id)).not.toHaveProperty('note')
  })
  it('길이 상한을 넘는 부분은 버린다', () => {
    const id = store().addScenario() as string
    store().setScenarioNote(id, 'x'.repeat(MAX_SCENARIO_NOTE + 50))
    expect(byId(id)?.note).toHaveLength(MAX_SCENARIO_NOTE)
  })
  it('다른 시나리오의 메모는 그대로이다', () => {
    const a = store().addScenario() as string
    const b = store().addScenario() as string
    store().setScenarioNote(a, 'A')
    store().setScenarioNote(b, 'B')
    expect([byId(a)?.note, byId(b)?.note]).toEqual(['A', 'B'])
  })
})

describe('deleteScenario', () => {
  it('지우고, 선택한 시나리오였다면 "기준"으로 돌아간다', () => {
    store().addScenario()
    const b = store().addScenario() as string
    expect(store().activeScenarioId).toBe(b)
    store().deleteScenario(b)
    expect(store().activeScenarioId).toBeNull()
    expect(names()).toEqual(['시나리오 1'])
  })
  it('다른 시나리오를 지우면 선택은 유지된다', () => {
    const a = store().addScenario() as string
    const b = store().addScenario() as string
    store().setActiveScenario(a)
    store().deleteScenario(b)
    expect(store().activeScenarioId).toBe(a)
  })
  it('없는 id는 아무 일도 하지 않는다', () => {
    store().addScenario()
    store().deleteScenario('zzz')
    expect(store().scenarios).toHaveLength(1)
  })
})

describe('setScenarioOverride', () => {
  let id: string
  beforeEach(() => {
    id = store().addScenario() as string
  })

  it('값을 정한다', () => {
    expect(store().setScenarioOverride(id, 'extra_people', 8)).toBeNull()
    expect(byId(id)?.overrides).toEqual({ extra_people: 8 })
  })

  it('기본 설정과 같은 값이면 override를 지운다', () => {
    store().setScenarioOverride(id, 'extra_people', 8)
    expect(store().setScenarioOverride(id, 'extra_people', store().params['extra_people'] as number)).toBeNull()
    expect(byId(id)?.overrides).toEqual({})
  })

  it('기본 설정이 바뀐 뒤에는 새 기본 설정과 같은 값이 지워진다', () => {
    store().setScenarioOverride(id, 'hire_day', 90)
    store().setParam('hire_day', 70)
    store().setScenarioOverride(id, 'hire_day', 70)
    expect(byId(id)?.overrides).toEqual({})
  })

  it.each([
    ['범위 밖', 'extra_people', 9999],
    ['음수', 'extra_people', -1],
    ['정수가 아님', 'extra_people', 2.5],
    ['유한하지 않음', 'hire_day', NaN],
    ['범위 밖(소수 항목)', 'training_overhead', 5]
  ])('%s: 오류를 돌려주고 바꾸지 않는다', (_n, name, value) => {
    store().setScenarioOverride(id, 'hire_day', 90)
    const before = byId(id)
    expect(store().setScenarioOverride(id, name, value)).toBeTruthy()
    expect(byId(id)).toEqual(before)
  })

  it('모르는 항목과 없는 시나리오는 오류', () => {
    expect(store().setScenarioOverride(id, 'mystery', 1)).toContain('mystery')
    expect(store().setScenarioOverride('zzz', 'extra_people', 1)).toContain('찾을 수 없')
  })

  it('다른 시나리오에는 영향이 없다', () => {
    const other = store().addScenario() as string
    store().setScenarioOverride(id, 'extra_people', 8)
    expect(byId(other)?.overrides).toEqual({})
  })
})

describe('값 되돌리기', () => {
  it('한 항목만, 또는 전체를 기본 설정으로 되돌린다', () => {
    const id = store().addScenario() as string
    store().setScenarioOverride(id, 'extra_people', 8)
    store().setScenarioOverride(id, 'hire_day', 90)
    store().resetScenarioValue(id, 'extra_people')
    expect(byId(id)?.overrides).toEqual({ hire_day: 90 })
    store().resetScenarioOverrides(id)
    expect(byId(id)?.overrides).toEqual({})
  })
  it('없는 항목을 되돌려도 아무 일도 없다', () => {
    const id = store().addScenario() as string
    store().resetScenarioValue(id, 'extra_people')
    expect(byId(id)?.overrides).toEqual({})
  })
})

describe('저장과 열기', () => {
  it('만든 시나리오가 파일로 저장되고 다시 열어도 같다', async () => {
    const a = store().addScenario() as string
    store().renameScenario(a, '채용 앞당기기')
    store().setScenarioNote(a, '지연 단축')
    store().setScenarioOverride(a, 'extra_people', 8)
    const b = store().addScenario() as string
    store().setScenarioOverride(b, 'hire_day', 60)
    const saved = store().scenarios

    const parsed = parseProjectJson(serializeProject(store().buildProjectFile()))
    if (!parsed.ok) throw new Error(parsed.message)
    await store().newProject()
    await settle()
    expect(store().scenarios).toEqual([])

    await store().loadProjectFile(parsed.project, 'exp.spd.json')
    await settle()
    expect(store().scenarios).toEqual(saved)
    expect(store().activeScenarioId).toBeNull() // 선택은 저장하지 않는다
    expect(selectIsDirty(store())).toBe(false)
    expect(store().notice).toBeNull()
  })

  it('저장하면 깨끗해지고 시나리오를 고치면 다시 수정됨이다', () => {
    const id = store().addScenario() as string
    expect(selectIsDirty(store())).toBe(true)
    store().markSaved('x.spd.json')
    expect(selectIsDirty(store())).toBe(false)
    store().setScenarioOverride(id, 'extra_people', 3)
    expect(selectIsDirty(store())).toBe(true)
    store().resetScenarioValue(id, 'extra_people')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('선택만 바꾸는 것은 수정이 아니다', () => {
    store().addScenario()
    store().markSaved('x.spd.json')
    store().setActiveScenario(null)
    store().setActiveScenario('s1')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('새 프로젝트와 모델 전환은 시나리오와 선택을 비운다', async () => {
    store().addScenario()
    await store().newProject('integrated-project')
    await settle()
    expect(store().scenarios).toEqual([])
    expect(store().activeScenarioId).toBeNull()
  })
})

describe('saveRunAsScenario (SCN-07)', () => {
  it('실행 기록의 달라진 값만 override로 하는 시나리오를 만들고 선택한다', async () => {
    const name = Object.keys(store().params)[0] as string
    const spec = (await import('../lib/params')).paramSpecs((await import('../catalog')).getEntry(store().modelId)).find((p) => p.name === name)!
    const value = spec.integer ? spec.max : (store().params[name] as number) === spec.max ? spec.min : spec.max
    await store().run({ [name]: value })
    await settle()
    const run = store().runs.find((r) => r.params[name] === value)!
    const before = store().params
    const out = store().saveRunAsScenario(run.id)
    expect(out.message).toBeNull()
    const sc = byId(out.scenarioId as string)!
    expect(sc.overrides).toEqual({ [name]: value })
    expect(sc.note).toBe(`실험 탭의 실행 #${run.id}에서 저장`)
    expect(store().activeScenarioId).toBe(sc.id)
    expect(store().params).toBe(before)
    expect(sc.name).not.toMatch(/^#/)
  })

  it('기본 설정과 같은 실행과 없는 실행은 만들지 않는다', () => {
    const none = store().saveRunAsScenario(999)
    expect(none.scenarioId).toBeNull()
    const same = store().saveRunAsScenario(store().runs[0]!.id)
    expect(same.scenarioId).toBeNull()
    expect(same.message).toContain('같아')
    expect(store().scenarios).toEqual([])
  })

  it('같은 실행을 다시 저장해도 이름이 겹치지 않는다', async () => {
    const name = Object.keys(store().params)[0] as string
    const entry = (await import('../catalog')).getEntry(store().modelId)
    const spec = (await import('../lib/params')).paramSpecs(entry).find((p) => p.name === name)!
    const value = (store().params[name] as number) === spec.max ? spec.min : spec.max
    await store().run({ [name]: value })
    await settle()
    const run = store().runs[store().runs.length - 1]!
    const a = store().saveRunAsScenario(run.id).scenarioId as string
    const b = store().saveRunAsScenario(run.id).scenarioId as string
    expect(byId(a)!.name).not.toBe(byId(b)!.name)
  })

  it(`${MAX_SCENARIOS}개가 차 있으면 만들지 않는다`, async () => {
    const name = Object.keys(store().params)[0] as string
    const entry = (await import('../catalog')).getEntry(store().modelId)
    const spec = (await import('../lib/params')).paramSpecs(entry).find((p) => p.name === name)!
    const value = (store().params[name] as number) === spec.max ? spec.min : spec.max
    await store().run({ [name]: value })
    await settle()
    for (let i = 0; i < MAX_SCENARIOS; i++) store().addScenario()
    const out = store().saveRunAsScenario(store().runs[store().runs.length - 1]!.id)
    expect(out.scenarioId).toBeNull()
    expect(store().scenarios).toHaveLength(MAX_SCENARIOS)
  })
})
