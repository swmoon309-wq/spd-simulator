import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog, getEntry } from '../catalog'
import { controlUnsupported } from '../catalog/evm'
import { docFromBuiltin } from '../catalog/exportDoc'
import { BASE_SCENARIO_ID } from '../lib/adoption'
import { installUserModel, removeUserModel } from '../lib/modelRegistry'
import { parseProjectJson, serializeProject } from '../../../shared/projectFile'
import { MODEL_DOC_VERSION, type ModelDocRaw } from '../../../shared/modelDoc'
import { selectIsDirty, useAppStore } from './appStore'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    registerModel: () => undefined,
    unregisterModel: () => undefined,
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {},
      pause() {},
      resume() {},
      step() {}
    })
  }
})

const store = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(store().status).toBe('idle'))
const NOW = new Date('2026-10-23T00:00:00.000Z')

/** 진척 정의가 없는 작은 모델(채택·통제는 쓸 수 없다) */
const miniDoc = (): ModelDocRaw => ({
  docVersion: MODEL_DOC_VERSION,
  def: {
    meta: { id: 'user-mini-0000000a', name: '작은 모델', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 20, dt: 0.5 },
    constants: { k: { value: 2, unit: 'FP/일' } },
    levels: { x: { init: '0', inflows: ['r'], outflows: [], unit: 'FP' } },
    rates: { r: { expr: 'k', unit: 'FP/일' } },
    auxiliaries: {},
    tables: {},
    outputs: []
  },
  info: { description: '', createdAt: NOW.toISOString() },
  view: { positions: {}, sectors: [], notes: [] },
  spec: { params: [{ name: 'k', group: '입력', min: 0.1, max: 10, step: 0.1 }], kpis: [], presets: [{ label: '기본', overrides: {} }] }
})

const installed: string[] = []
const install = (raw: ModelDocRaw): string => {
  const r = installUserModel(raw)
  if (!r.ok) throw new Error(r.message)
  installed.push(r.entry.id)
  return r.entry.id
}
const brooksCopy = () => docFromBuiltin(getEntry('brooks'), { now: NOW, name: '내 Brooks', random: () => 0.3 })
afterEach(async () => {
  await store().newProject('brooks')
  await settle()
  for (const id of installed.splice(0)) removeUserModel(id)
})

describe('사용자 모델: Brooks 사본이 앱의 다른 기능과 함께 동작한다', () => {
  let id = ''
  beforeEach(async () => {
    id = install(brooksCopy())
    await store().newProject(id)
    await settle()
  })

  it('새 프로젝트의 기준 실행이 끝나고 완료일이 있다(내장과 한 스텝 안쪽)', () => {
    expect(store().modelId).toBe(id)
    const mine = store().runs[0]?.kpis.completionDay as number
    expect(mine).toBeGreaterThan(270)
    expect(Math.abs(mine - 274.1228)).toBeLessThanOrEqual(0.25)
  })

  it('프리셋을 시나리오로 만들어 일괄 실행하고 기준을 채택할 수 있다', async () => {
    for (const preset of getEntry(id).presets) {
      const sid = store().addScenario() as string
      for (const [name, value] of Object.entries(preset.overrides)) expect(store().setScenarioOverride(sid, name, value)).toBeNull()
    }
    expect(await store().runScenarios('all')).not.toBeNull()
    expect(store().adoptScenario(BASE_SCENARIO_ID)).toBeNull()
    expect(store().adopted?.model).toEqual({ id, version: 1 })
    store().addActual()
    expect(store().actuals).toHaveLength(1)
  })

  it('구조 점검·극단 조건 시험·위험 분석 입력이 동작한다', async () => {
    expect(store().runStructure()).toBeNull()
    expect(store().validationStructure!.report.findings.filter((f) => f.status === 'fail')).toEqual([])
    expect(await store().runExtremes()).toBeNull()
    expect(store().addRiskInput('nominal_productivity')).toBeNull()
  })

  it('재예측은 지원하지 않는다고 알린다', async () => {
    await store().runScenarios('all')
    store().adoptScenario(BASE_SCENARIO_ID)
    store().addActual()
    expect(await store().runReforecast(7)).toContain('지원하지 않습니다')
  })
})

describe('사용자 모델: 진척 정의가 없는 모델', () => {
  it('실행·시나리오는 되고 채택은 이유를 알려 거절한다', async () => {
    const id = install(miniDoc())
    expect(controlUnsupported(getEntry(id))).toMatch(/진척/)
    await store().newProject(id)
    await settle()
    expect(store().runs[0]?.kpis.completionDay).toBeNull()
    expect(await store().runScenarios('all')).not.toBeNull()
    expect(store().adoptScenario(BASE_SCENARIO_ID)).toMatch(/진척/)
    expect(store().adopted).toBeNull()
    expect(store().addActual()).toBe(0) // 실적 행은 단계 없이 만들어진다(통제 탭이 막는다)
  })
})

describe('프로젝트 파일 v3: 사용자 모델 내장', () => {
  it('내장 모델 프로젝트에는 custom이 없다', () => {
    expect(store().buildProjectFile().model.custom).toBeUndefined()
  })

  it('저장 → 앱에서 모델 제거 → 열기: 파일 안의 모델로 열린다', async () => {
    const id = install(brooksCopy())
    await store().newProject(id)
    await settle()
    store().setParam('extra_people', 4)
    const file = parseProjectJson(serializeProject(store().buildProjectFile()))
    if (!file.ok) throw new Error(file.message)
    expect(file.project.model.custom?.def['meta']).toMatchObject({ id })
    expect(file.project.model.id).toBe(id)

    await store().newProject('brooks')
    await settle()
    removeUserModel(id)
    expect(catalog.some((m) => m.id === id)).toBe(false)

    expect(await store().loadProjectFile(file.project, 'p.spd.json')).toBe(true)
    await settle()
    expect(store().modelId).toBe(id)
    expect(store().params['extra_people']).toBe(4)
    expect(getEntry(id).category).toBe('user')
    expect(selectIsDirty(store())).toBe(false)
    expect(store().notice).toBeNull()
  })

  it('앱에 같은 id의 다른 내용 모델이 있으면 파일의 것으로 바꾸고 알린다', async () => {
    const raw = brooksCopy()
    const id = install(raw)
    await store().newProject(id)
    await settle()
    const file = parseProjectJson(serializeProject(store().buildProjectFile()))
    if (!file.ok) throw new Error(file.message)
    const other = { ...raw, def: { ...raw.def, time: { ...(raw.def['time'] as object), end: 300 } } }
    expect(installUserModel(other).ok).toBe(true)
    expect(getEntry(id).def.time.end).toBe(300)
    expect(await store().loadProjectFile(file.project, 'p.spd.json')).toBe(true)
    expect(getEntry(id).def.time.end).toBe(400)
    expect(store().notice?.details?.join(' ')).toMatch(/프로젝트의 것으로 바꿨습니다/)
  })

  it('내장된 모델이 손상되었으면 열기를 거절하고 이유를 보인다', async () => {
    const id = install(brooksCopy())
    await store().newProject(id)
    await settle()
    const bad = JSON.parse(serializeProject(store().buildProjectFile()))
    bad.model.custom.def.auxiliaries = { oops: { expr: 'nothing_here + 1' } }
    const parsed = parseProjectJson(JSON.stringify(bad))
    if (!parsed.ok) throw new Error(parsed.message)
    await store().newProject('brooks')
    await settle()
    expect(await store().loadProjectFile(parsed.project, 'bad.spd.json')).toBe(false)
    expect(store().notice?.text).toMatch(/내장된 모델을 쓸 수 없습니다/)
    expect(store().notice?.text).toMatch(/oops|위치/)
  })

  it('사용자 모델 id인데 정의가 없으면 파일 형식 검사에서 거절한다', async () => {
    const id = install(brooksCopy())
    await store().newProject(id)
    await settle()
    const noCustom = JSON.parse(serializeProject(store().buildProjectFile()))
    delete noCustom.model.custom
    const r = parseProjectJson(JSON.stringify(noCustom))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/정의가 파일에 없습니다/)
  })

  it('id와 버전이 정의와 다르면 거절한다', async () => {
    const id = install(brooksCopy())
    await store().newProject(id)
    await settle()
    const raw = JSON.parse(serializeProject(store().buildProjectFile()))
    raw.model.version = 9
    const parsed = parseProjectJson(JSON.stringify(raw))
    if (!parsed.ok) throw new Error(parsed.message)
    expect(await store().loadProjectFile(parsed.project, 'v.spd.json')).toBe(false)
    expect(store().notice?.text).toMatch(/버전/)
  })
})
