import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_DESCRIPTION } from '../../../shared/projectFile'
import { catalog } from '../catalog'
import { exampleFor } from '../lib/examples'
import { openExample, openRecent, startProject } from '../lib/projectActions'
import { useHistoryStore } from './history'
import { selectIsDirty, useAppStore } from './appStore'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
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
const brooks = () => exampleFor(catalog.find((m) => m.id === 'brooks')!, new Date('2026-10-22T00:00:00.000Z'))

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})
afterEach(() => vi.unstubAllGlobals())

describe('프로젝트 설명 (PRJ-01)', () => {
  it('설명을 고치면 수정됨이 되고 파일에 들어가며, 되돌릴 수 있다', async () => {
    expect(selectIsDirty(store())).toBe(false)
    store().setProjectDescription('고객 A 일정 검토')
    await Promise.resolve()
    expect(selectIsDirty(store())).toBe(true)
    expect(store().buildProjectFile().meta.description).toBe('고객 A 일정 검토')
    expect(useHistoryStore.getState().undoLabel).toBe('프로젝트 설명 변경')
    const { undoEdit } = await import('./history')
    undoEdit()
    expect(store().projectDescription).toBe('')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('설명이 없으면 파일에 넣지 않고, 길이 상한을 넘는 부분은 버린다', () => {
    expect(store().buildProjectFile().meta).not.toHaveProperty('description')
    store().setProjectDescription('가'.repeat(MAX_DESCRIPTION + 50))
    expect(store().projectDescription).toHaveLength(MAX_DESCRIPTION)
  })

  it('저장한 파일을 열면 설명이 돌아온다', async () => {
    store().setProjectDescription('메모')
    const file = store().buildProjectFile()
    await store().newProject('brooks')
    await settle()
    expect(store().projectDescription).toBe('')
    await store().loadProjectFile(file, 'a.spd.json')
    await settle()
    expect(store().projectDescription).toBe('메모')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('설명이 없는 옛 파일도 열린다', async () => {
    const file = store().buildProjectFile()
    expect(await store().loadProjectFile(file, 'old.spd.json')).toBe(true)
    expect(store().projectDescription).toBe('')
  })

  it('새 프로젝트를 이름·설명과 함께 시작하면 수정되지 않은 상태다', async () => {
    await store().newProject('brooks', { name: '  고객 A  ', description: '검토용' })
    await settle()
    expect(store().projectName).toBe('고객 A')
    expect(store().projectDescription).toBe('검토용')
    expect(store().projectFile).toBeNull()
    expect(selectIsDirty(store())).toBe(false)
    expect(store().buildProjectFile().meta).toMatchObject({ name: '고객 A', description: '검토용' })
  })

  it('이름을 비우면 기본 이름이다', async () => {
    await store().newProject('brooks', { name: '   ' })
    await settle()
    expect(store().projectName).toBe('이름 없는 프로젝트')
  })
})

describe('예제 열기 (PRJ-03)', () => {
  it('복사본으로 열린다: 파일 연결 없음, 수정 안 됨, 시나리오가 들어 있다', async () => {
    expect(await store().openExample(brooks().file)).toBe(true)
    await settle()
    expect(store().projectFile).toBeNull()
    expect(store().projectName).toBe('Brooks 법칙 예제')
    expect(selectIsDirty(store())).toBe(false)
    expect(store().scenarios.map((s) => s.name)).toEqual(['5명 추가', '10명 추가'])
    expect(store().notice?.text).toContain('복사본')
  })

  it('고쳐도 원본 예제는 그대로다', async () => {
    const example = brooks()
    await store().openExample(example.file)
    await settle()
    store().setParam('extra_people', 7)
    store().renameScenario('s1', '내 것')
    expect(selectIsDirty(store())).toBe(true)
    expect(brooks().file.scenarios[0]?.name).toBe('5명 추가')
    expect(brooks().file.params['extra_people']).toBe(0)
  })

  it('runPresets면 프리셋을 모두 실행해 겹쳐 보인다(기준 포함 3개)', async () => {
    await store().openExample(brooks().file, { runPresets: true })
    await settle()
    expect(store().runs).toHaveLength(3)
    expect(store().runs.map((r) => r.kpis.completionDay).every((d) => d !== null)).toBe(true)
  })

  it('열 수 없는 내용이면 false', async () => {
    const bad = { ...brooks().file, model: { id: '없는-모델', version: 1 } }
    expect(await store().openExample(bad)).toBe(false)
  })

  it('openExample 동작: 저장하지 않은 변경이 있으면 묻고, 취소하면 열지 않는다', async () => {
    const choice = vi.fn(async () => 'cancel' as const)
    vi.stubGlobal('window', { spd: { project: { confirmDiscard: choice, reset: async () => undefined, setDirty: () => undefined }, recovery: { clear: async () => undefined } } })
    store().setParam('extra_people', 4)
    expect(await openExample(brooks())).toBe(false)
    expect(choice).toHaveBeenCalledTimes(1)
    expect(store().params['extra_people']).toBe(4)
  })

  it('변경이 없으면 묻지 않고 연다', async () => {
    const choice = vi.fn(async () => 'cancel' as const)
    vi.stubGlobal('window', { spd: { project: { confirmDiscard: choice, reset: async () => undefined, setDirty: () => undefined }, recovery: { clear: async () => undefined } } })
    expect(await openExample(brooks())).toBe(true)
    await settle()
    expect(choice).not.toHaveBeenCalled()
    expect(store().projectName).toBe('Brooks 법칙 예제')
  })
})

describe('새 프로젝트 시작과 최근 열기 흐름', () => {
  it('startProject는 이름·설명으로 새로 시작한다', async () => {
    vi.stubGlobal('window', { spd: { project: { confirmDiscard: async () => 'discard', reset: async () => undefined, setDirty: () => undefined }, recovery: { clear: async () => undefined } } })
    expect(await startProject('integrated-project', { name: '새 계획', description: '설명' })).toBe(true)
    await settle()
    expect(store().modelId).toBe('integrated-project')
    expect(store().projectName).toBe('새 계획')
    expect(store().projectDescription).toBe('설명')
  })

  it('openRecent는 저장하지 않은 변경을 먼저 묻고, 열면 파일에 연결된다', async () => {
    const file = store().buildProjectFile()
    const open = vi.fn(async () => ({ status: 'opened' as const, fileName: 'r.spd.json', project: file }))
    vi.stubGlobal('window', { spd: { project: { confirmDiscard: async () => 'discard', reset: async () => undefined, setDirty: () => undefined }, recovery: { clear: async () => undefined }, recent: { open } } })
    store().setParam('extra_people', 4)
    expect(await openRecent('abc')).toBe(true)
    await settle()
    expect(open).toHaveBeenCalledWith('abc')
    expect(store().projectFile).toBe('r.spd.json')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('openRecent가 오류를 받으면 알림으로 보이고 프로젝트는 그대로다', async () => {
    const open = vi.fn(async () => ({ status: 'error' as const, message: '파일을 찾을 수 없습니다.' }))
    vi.stubGlobal('window', { spd: { project: { confirmDiscard: async () => 'discard', reset: async () => undefined, setDirty: () => undefined }, recovery: { clear: async () => undefined }, recent: { open } } })
    expect(await openRecent('abc')).toBe(false)
    expect(store().notice).toMatchObject({ kind: 'error', text: '파일을 찾을 수 없습니다.' })
  })

  it('브라우저(개발용)에서는 최근 열기를 쓸 수 없다고 알린다', async () => {
    vi.stubGlobal('window', {})
    expect(await openRecent('abc')).toBe(false)
    expect(store().notice?.kind).toBe('error')
  })
})
