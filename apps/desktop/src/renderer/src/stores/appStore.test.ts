import { DEFAULT_EVM_SETTINGS } from '@spd/analysis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scenario } from '@spd/analysis'
import { parseProjectJson, serializeProject, type ProjectFile } from '../../../shared/projectFile'
import { getEntry } from '../catalog'
import { buildProjectFile } from '../lib/projectApply'
import { defaultParams } from '../lib/params'
import { defaultRunSettings } from '../lib/runSettings'
import { selectIsDirty, useAppStore } from './appStore'

// Worker 대신 같은 계산을 바로 수행한다(화면 상태 논리만 시험한다).
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

const brooks = getEntry('brooks')
const scenarios: Scenario[] = [
  { id: 's1', name: '채용 앞당기기', note: '지연 단축', overrides: { extra_people: 8, hire_day: 120 } },
  { id: 's2', name: '인원 적게', overrides: { extra_people: 2 } }
]
const fileWith = (sc: Scenario[], params: Record<string, number> = {}): ProjectFile =>
  buildProjectFile({
    entry: brooks,
    name: 'p',
    createdAt: '2026-01-01T00:00:00.000Z',
    params: { ...defaultParams(brooks), ...params },
    runSettings: defaultRunSettings(brooks),
    chartVariable: 'total_personnel',
    scenarios: sc,
    adopted: null,
    actuals: [],
    evm: DEFAULT_EVM_SETTINGS,
    revisions: [],
    now: new Date('2026-03-04T00:00:00.000Z')
  })

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})

describe('시나리오가 있는 프로젝트 열기', () => {
  it('시나리오가 복원되고 열자마자 수정 상태가 아니다', async () => {
    await store().loadProjectFile(fileWith(scenarios), 'exp.spd.json')
    await settle()
    expect(store().scenarios).toEqual(scenarios)
    expect(selectIsDirty(store())).toBe(false)
    expect(store().notice).toBeNull()
  })

  it('저장하면 시나리오가 그대로 파일에 담긴다(열고 저장해도 잃지 않는다)', async () => {
    await store().loadProjectFile(fileWith(scenarios), 'exp.spd.json')
    await settle()
    const out = store().buildProjectFile()
    expect(out.scenarios).toEqual(scenarios)
    expect(out.adopted).toBeNull()
    expect(parseProjectJson(serializeProject(out))).toMatchObject({ ok: true, project: { scenarios } })
  })

  it('범위 밖이거나 모르는 값은 정리하고 시나리오 이름과 함께 경고를 보인다', async () => {
    const bad: Scenario[] = [{ id: 's1', name: '엉뚱한 값', overrides: { extra_people: 9999, mystery: 1, hire_day: 90 } }]
    await store().loadProjectFile(fileWith(bad), 'bad.spd.json')
    await settle()
    expect(store().scenarios[0]?.overrides).toEqual({ hire_day: 90 })
    expect(store().notice?.kind).toBe('warning')
    expect(store().notice?.details?.join('\n')).toContain("시나리오 '엉뚱한 값'")
  })

  it('MVP가 저장한 v1 파일도 열리고(시나리오 없음) 저장하면 v2가 된다', async () => {
    const { scenarios: _s, adopted: _a, ...rest } = fileWith([])
    const parsed = parseProjectJson(JSON.stringify({ ...rest, schemaVersion: 1 }))
    if (!parsed.ok) throw new Error(parsed.message)
    expect(parsed.migratedFrom).toBe(1)
    await store().loadProjectFile(parsed.project, 'old.spd.json')
    await settle()
    expect(store().scenarios).toEqual([])
    expect(selectIsDirty(store())).toBe(false)
    expect(store().buildProjectFile().schemaVersion).toBe(3)
  })
})

describe('수정 상태(dirty)', () => {
  it('시나리오를 바꾸면 수정됨이고, 저장하면 다시 깨끗해진다', async () => {
    await store().loadProjectFile(fileWith(scenarios), 'exp.spd.json')
    await settle()
    store().setScenarios([...store().scenarios, { id: 's3', name: '새 대안', overrides: {} }])
    expect(selectIsDirty(store())).toBe(true)
    store().markSaved('exp.spd.json')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('이름만 바꿔도, 시나리오를 지워도 수정됨이다', async () => {
    await store().loadProjectFile(fileWith(scenarios), 'exp.spd.json')
    await settle()
    store().setScenarios(scenarios.map((s, i) => (i === 0 ? { ...s, name: '다른 이름' } : s)))
    expect(selectIsDirty(store())).toBe(true)
    store().setScenarios(scenarios)
    expect(selectIsDirty(store())).toBe(false)
    store().setScenarios(scenarios.slice(0, 1))
    expect(selectIsDirty(store())).toBe(true)
  })
})

describe('새 프로젝트', () => {
  it('시나리오를 비우고 수정 상태도 아니다', async () => {
    await store().loadProjectFile(fileWith(scenarios), 'exp.spd.json')
    await settle()
    await store().newProject()
    await settle()
    expect(store().scenarios).toEqual([])
    expect(selectIsDirty(store())).toBe(false)
    expect(store().projectFile).toBeNull()
  })

  it('다른 모델로 시작하면 그 모델의 기본 설정이고 시나리오는 없다', async () => {
    await store().loadProjectFile(fileWith(scenarios), 'exp.spd.json')
    await settle()
    await store().newProject('integrated-project')
    await settle()
    expect(store().modelId).toBe('integrated-project')
    expect(store().scenarios).toEqual([])
    expect(store().params['total_tasks']).toBe(400)
  })
})
