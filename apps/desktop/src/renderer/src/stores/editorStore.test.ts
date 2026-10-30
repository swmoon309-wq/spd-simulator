import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog, getEntry } from '../catalog'
import { addVariable, deleteVariable, renameVariable, setField } from '../lib/modelEdit/commands'
import { removeUserModel } from '../lib/modelRegistry'
import type { ModelDocRaw } from '../../../shared/modelDoc'
import { selectCanRedo, selectCanUndo, selectDirty, selectRedoLabel, selectUndoLabel, setEditorClock, useEditorStore } from './editorStore'
import { selectIsDirty, useAppStore } from './appStore'
import { useUiStore } from './uiStore'

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

const ed = () => useEditorStore.getState()
const app = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(app().status).toBe('idle'))
const saved: ModelDocRaw[] = []
let now = 0

beforeEach(async () => {
  saved.length = 0
  now = 0
  setEditorClock(() => now)
  vi.stubGlobal('window', { spd: { models: { save: async (d: ModelDocRaw) => (saved.push(d), { status: 'saved' as const }), list: async () => ({ status: 'ok', models: [], skipped: 0 }), remove: async () => undefined }, project: { reset: async () => undefined } } })
  await app().newProject('brooks')
  await settle()
  ed().close()
  useUiStore.setState({ libraryIds: [], modelsVersion: 0 })
})
afterEach(async () => {
  await app().newProject('brooks')
  await settle()
  for (const m of catalog.filter((x) => x.category === 'user')) removeUserModel(m.id)
  ed().close()
  vi.unstubAllGlobals()
})

const rename = (from: string, to: string) => ed().run('이름 바꾸기', (d) => renameVariable(d, from, to))

describe('편집 열기', () => {
  it('내장 모델은 사본을 연다(원본은 그대로, 아직 올라와 있지 않다)', () => {
    ed().openCurrent()
    const doc = ed().doc!
    expect(doc.def.meta.id.startsWith('user-')).toBe(true)
    expect(doc.info.basedOn).toBe('brooks@1')
    expect(ed().installedVersion).toBe(0)
    expect(selectDirty(ed())).toBe(false)
    expect(getEntry('brooks').def.meta.id).toBe('brooks')
  })

  it('비어 있으면 명령이 거절된다', () => {
    expect(ed().run('x', (d) => addVariable(d, 'rate'))).toMatch(/편집할 모델이 없습니다/)
    expect(ed().check()).toBeNull()
  })

  it('빈 모델은 바로 적용되고 실행된다', async () => {
    ed().openBlank()
    const out = await ed().apply()
    expect(out.ok).toBe(true)
    const id = ed().doc!.def.meta.id
    await app().newProject(id)
    await settle()
    expect(app().runs[0]?.kpis.completionDay).toBe(50) // 100 ÷ 2
  })

  it('닫으면 비운다', () => {
    ed().openBlank()
    ed().close()
    expect(ed().doc).toBeNull()
    expect(ed().history).toBeNull()
  })
})

describe('편집·이력', () => {
  beforeEach(() => ed().openCurrent())

  it('명령을 반영하면 수정됨이 되고 되돌리고 다시 할 수 있다', () => {
    expect(rename('extra_people', 'added_staff')).toBeNull()
    expect(ed().doc!.def.constants['added_staff']).toBeDefined()
    expect(ed().message?.text).toContain('수식')
    expect(selectDirty(ed())).toBe(true)
    expect(selectUndoLabel(ed())).toBe('이름 바꾸기')
    ed().undo()
    expect(ed().doc!.def.constants['extra_people']).toBeDefined()
    expect(selectDirty(ed())).toBe(false)
    expect(selectCanRedo(ed())).toBe(true)
    expect(selectRedoLabel(ed())).toBe('이름 바꾸기')
    ed().redo()
    expect(ed().doc!.def.constants['added_staff']).toBeDefined()
    expect(selectCanUndo(ed())).toBe(true)
  })

  it('거절된 명령은 초안을 바꾸지 않고 이유를 알린다', () => {
    const before = ed().doc
    expect(rename('extra_people', 'hire_day')).toMatch(/이미 있는 이름/)
    expect(ed().doc).toBe(before)
    expect(ed().message?.kind).toBe('error')
    expect(selectDirty(ed())).toBe(false)
    expect(deleteMsg()).toMatch(/쓰고 있습니다/)
  })
  const deleteMsg = () => ed().run('삭제', (d) => deleteVariable(d, 'requirements'))

  it('같은 키의 연속 입력은 한 단계로 합친다', () => {
    for (const [i, text] of ['1', '1 +', '1 + 2'].entries()) {
      now = i * 100
      ed().run('수식 입력', (d) => setField(d, 'software_development_rate', { field: 'expr', value: text }), 'expr:software_development_rate')
    }
    expect(ed().history!.past).toHaveLength(1)
    ed().undo()
    expect(ed().doc!.def.rates['software_development_rate']?.expr).not.toBe('1')
  })

  it('새 편집은 다시 하기를 지우고, 되돌린 뒤 선택은 유지된다', () => {
    ed().select('requirements')
    rename('extra_people', 'a_1')
    ed().undo()
    rename('hire_day', 'h_1')
    expect(selectCanRedo(ed())).toBe(false)
    expect(ed().selected).toBe('requirements')
  })

  it('check는 게이트를 돌려 보이고, 편집하면 결과가 지워진다', () => {
    expect(ed().check()?.canApply).toBe(true)
    expect(ed().gate).not.toBeNull()
    rename('extra_people', 'a_2')
    expect(ed().gate).toBeNull()
  })
})

describe('단위 오류가 있는 모델의 적용 (D5)', () => {
  const breakUnits = () => ed().run('수식 고치기', (d) => setField(d, 'software_development_rate', { field: 'expr', value: 'MIN(potential_development_rate, requirements / DT) + DT' }))

  it('확인 없이는 적용하지 않고 이유를 알린다(게이트는 막지 않는다)', async () => {
    ed().openCurrent()
    expect(breakUnits()).toBeNull()
    const out = await ed().apply()
    expect(out.ok).toBe(false)
    expect(!out.ok && out.message).toMatch(/단위 오류 \d+건/)
    expect(!out.ok && out.gate?.canApply).toBe(true)
    expect(!out.ok && out.gate?.unitErrors).toBeGreaterThan(0)
    expect(catalog.some((m) => m.id === ed().doc!.def.meta.id)).toBe(false)
    expect(saved).toHaveLength(0)
  })

  it('확인하고 적용하면 올라가고, 그 모델은 단위 오류로 표시된다', async () => {
    ed().openCurrent()
    breakUnits()
    const out = await ed().apply({ confirmUnitErrors: true })
    expect(out.ok).toBe(true)
    const entry = getEntry(ed().doc!.def.meta.id)
    const { unitNote } = await import('../lib/modelEdit/unitStatus')
    expect(unitNote(entry)).toMatch(/단위 오류 \d+건/)
    const { modelCaveat } = await import('../lib/report/caveats')
    expect(modelCaveat(entry)).toContain('단위 오류')
  })

  it('단위가 맞는 모델과 내장 모델에는 표시가 없다', async () => {
    ed().openCurrent()
    await ed().apply()
    const { unitNote } = await import('../lib/modelEdit/unitStatus')
    expect(unitNote(getEntry(ed().doc!.def.meta.id))).toBeNull()
    expect(unitNote(getEntry('brooks'))).toBeNull()
  })
})

describe('적용', () => {
  it('새 사본: 앱에 올리고 내 모델 목록에 저장한다(버전은 그대로 1)', async () => {
    ed().openCurrent()
    rename('extra_people', 'added_staff')
    const out = await ed().apply()
    expect(out.ok).toBe(true)
    const doc = ed().doc!
    const id = doc.def.meta.id
    expect(getEntry(id).category).toBe('user')
    expect(getEntry(id).def.meta.version).toBe(1)
    expect(getEntry(id).groups.flatMap((g) => g.params.map((p) => p.name))).toContain('added_staff')
    expect(saved).toHaveLength(1)
    expect(useUiStore.getState().libraryIds).toContain(id)
    expect(selectDirty(ed())).toBe(false)
    expect(ed().installedVersion).toBe(1)
    expect(out.ok && out.projectUpdated).toBe(false) // 지금 프로젝트는 내장 Brooks라 바뀌지 않는다
    expect(app().modelId).toBe('brooks')
  })

  it('다시 적용하면 버전이 오르고 결과 키가 바뀐다', async () => {
    ed().openCurrent()
    await ed().apply()
    const id = ed().doc!.def.meta.id
    rename('extra_people', 'added_staff')
    await ed().apply()
    expect(getEntry(id).def.meta.version).toBe(2)
    await ed().apply()
    expect(getEntry(id).def.meta.version).toBe(3)
    expect(saved.map((d) => (d.def['meta'] as { version: number }).version)).toEqual([1, 2, 3])
  })

  it('막는 문제가 있으면 올리지 않고 게이트 결과를 돌려준다', async () => {
    ed().openCurrent()
    ed().run('수식 고치기', (d) => setField(d, 'software_development_rate', { field: 'expr', value: 'no_such * 2' }))
    const out = await ed().apply()
    expect(out.ok).toBe(false)
    expect(!out.ok && out.gate?.steps[0]?.status).toBe('fail')
    expect(catalog.some((m) => m.id === ed().doc!.def.meta.id)).toBe(false)
    expect(saved).toHaveLength(0)
    expect(selectDirty(ed())).toBe(true)
  })

  it('사용자 모델은 그 자리에서 고친다(같은 id) — 열린 프로젝트에 반영되고 이름·파일 연결은 그대로, 수정됨이 된다', async () => {
    ed().openCurrent()
    await ed().apply()
    const id = ed().doc!.def.meta.id
    await app().newProject(id)
    await settle()
    app().setParam('extra_people', 4)
    app().setParam('hire_day', 150)
    const sid = app().addScenario() as string
    app().setScenarioOverride(sid, 'extra_people', 6)
    app().setScenarioOverride(sid, 'hire_day', 120)
    app().markSaved('내프로젝트.spd.json')
    expect(selectIsDirty(app())).toBe(false)

    ed().openCurrent() // 사용자 모델이므로 같은 id를 그대로 연다
    expect(ed().doc!.def.meta.id).toBe(id)
    expect(ed().installedVersion).toBe(1)
    // 상수 하나를 이름 바꾸고(파라미터 값은 이어진다), 다른 하나는 지운다
    expect(rename('extra_people', 'added_staff')).toBeNull()
    expect(ed().run('상수 삭제', (d) => deleteVariable(d, 'hire_day', { replaceWithZero: true }))).toBeNull()
    const out = await ed().apply()
    expect(out.ok && out.projectUpdated).toBe(true)
    await settle()

    expect(app().modelId).toBe(id)
    expect(getEntry(id).def.meta.version).toBe(2)
    expect(app().projectName).toBe('내프로젝트')
    expect(app().projectFile).toBe('내프로젝트.spd.json')
    expect(selectIsDirty(app())).toBe(true)
    expect(Object.keys(app().params)).toContain('added_staff')
    expect(Object.keys(app().params)).not.toContain('hire_day')
    // 시나리오의 없어진 상수 override는 버려진다
    expect(app().scenarios[0]?.overrides).toEqual({})
    expect(app().notice?.details?.join(' ')).toMatch(/hire_day|시나리오/)
    expect(app().runs.length).toBeGreaterThan(0)
  })

  it('프로젝트가 다른 모델을 쓰면 프로젝트는 그대로다', async () => {
    ed().openCurrent()
    await ed().apply()
    await app().newProject('integrated-project')
    await settle()
    app().setParam('total_tasks', 300)
    ed().openInstalled(ed().doc!.def.meta.id)
    rename('extra_people', 'added_staff')
    const out = await ed().apply()
    expect(out.ok && out.projectUpdated).toBe(false)
    expect(app().modelId).toBe('integrated-project')
    expect(app().params['total_tasks']).toBe(300)
  })

  it('목록에 저장하지 못해도 앱에는 올리고 경고를 돌려준다', async () => {
    vi.stubGlobal('window', { spd: { models: { save: async () => ({ status: 'error' as const, message: '디스크 가득' }) } } })
    ed().openBlank()
    const out = await ed().apply()
    expect(out.ok).toBe(true)
    expect(out.ok && out.warnings.join(' ')).toMatch(/디스크 가득/)
    expect(useUiStore.getState().libraryIds).toEqual([])
  })

  it('변수 추가는 새 파라미터를 만들고 적용 뒤 새 프로젝트에서 입력 칸으로 나온다', async () => {
    ed().openCurrent()
    ed().run('상수 추가', (d) => addVariable(d, 'constant', 'overtime_factor'))
    await ed().apply()
    const id = ed().doc!.def.meta.id
    await app().newProject(id)
    await settle()
    expect(app().params['overtime_factor']).toBe(0)
    expect(getEntry(id).groups.flatMap((g) => g.params.map((p) => p.name))).toContain('overtime_factor')
  })
})
