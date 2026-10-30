import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecoveryReadResult, RestoreChoice } from '../../../shared/ipc'
import type { RecoveryRecord } from '../../../shared/recoveryFile'
import { checkRecovery, resetRecoveryCheck } from '../lib/recoveryActions'
import { openProject, saveProject } from '../lib/projectActions'
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

function fakeSpd(opts: { read: RecoveryReadResult; choice?: RestoreChoice }) {
  const calls = { clear: 0, confirm: [] as { name: string; savedAt: string }[], read: 0 }
  const spd = {
    recovery: {
      read: async () => {
        calls.read++
        return opts.read
      },
      clear: async () => void calls.clear++,
      confirmRestore: async (info: { name: string; savedAt: string }) => {
        calls.confirm.push(info)
        return opts.choice ?? 'restore'
      },
      write: async () => ({ status: 'saved' as const })
    },
    project: {
      save: async () => ({ status: 'saved' as const, fileName: 'x.spd.json' }),
      saveAs: async () => ({ status: 'saved' as const, fileName: 'x.spd.json' }),
      confirmDiscard: async () => 'discard' as const,
      open: async () => ({ status: 'canceled' as const }),
      reset: async () => undefined,
      setDirty: () => undefined
    }
  }
  vi.stubGlobal('window', { spd })
  return calls
}

let record: RecoveryRecord

beforeEach(async () => {
  resetRecoveryCheck()
  await store().newProject('brooks')
  await settle()
  store().setParam('extra_people', 9)
  store().addScenario()
  store().setScenarioOverride('s1', 'hire_day', 150)
  store().markSaved('원본.spd.json')
  store().setParam('extra_people', 12) // 저장하지 않은 변경
  record = { savedAt: '2026-10-22T05:00:00.000Z', sourceFile: '원본.spd.json', project: store().buildProjectFile() }
  await store().newProject('brooks')
  await settle()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('restoreRecovered', () => {
  it('자동 저장본을 저장하지 않은 프로젝트로 연다', async () => {
    expect(await store().restoreRecovered(record.project)).toBe(true)
    await settle()
    expect(store().params['extra_people']).toBe(12)
    expect(store().scenarios.map((s) => s.name)).toEqual(['시나리오 1'])
    expect(store().scenarios[0]?.overrides).toEqual({ hire_day: 150 })
    expect(store().projectName).toBe(record.project.meta.name)
    expect(store().projectFile).toBeNull() // 저장하면 이름을 묻는다
    expect(selectIsDirty(store())).toBe(true)
    expect(store().notice).toMatchObject({ kind: 'info' })
    expect(store().notice?.text).toContain('복구')
  })

  it('이전 프로젝트의 실행 취소 기록은 가져오지 않는다', async () => {
    store().setParam('extra_people', 3)
    await Promise.resolve()
    expect(useHistoryStore.getState().undoCount).toBe(1)
    await store().restoreRecovered(record.project)
    expect(useHistoryStore.getState().undoCount).toBe(0)
  })

  it('열 수 없는 내용이면 false이고 지금 프로젝트를 그대로 둔다', async () => {
    const bad = { ...record.project, model: { id: '없는-모델', version: 1 } }
    expect(await store().restoreRecovered(bad)).toBe(false)
    expect(store().params['extra_people']).not.toBe(12)
    expect(store().notice?.kind).toBe('error')
  })
})

describe('checkRecovery', () => {
  it('자동 저장본이 없으면 묻지 않는다', async () => {
    const calls = fakeSpd({ read: { status: 'none' } })
    expect(await checkRecovery()).toBe('none')
    expect(calls.confirm).toHaveLength(0)
    expect(calls.clear).toBe(0)
  })

  it('복구를 고르면 열고, 자동 저장본은 다음 자동 저장·저장까지 그대로 둔다', async () => {
    const calls = fakeSpd({ read: { status: 'found', record }, choice: 'restore' })
    expect(await checkRecovery()).toBe('restored')
    await settle()
    expect(calls.confirm).toEqual([{ name: '원본.spd.json', savedAt: '2026-10-22T05:00:00.000Z' }])
    expect(calls.clear).toBe(0)
    expect(store().params['extra_people']).toBe(12)
    expect(selectIsDirty(store())).toBe(true)
  })

  it('버리기를 고르면 지우고 프로젝트는 그대로다', async () => {
    const calls = fakeSpd({ read: { status: 'found', record }, choice: 'discard' })
    expect(await checkRecovery()).toBe('discarded')
    expect(calls.clear).toBe(1)
    expect(store().params['extra_people']).not.toBe(12)
  })

  it('읽지 못하면 경고만 하고 묻지 않는다', async () => {
    const calls = fakeSpd({ read: { status: 'error', message: '권한이 없습니다' } })
    expect(await checkRecovery()).toBe('failed')
    expect(calls.confirm).toHaveLength(0)
    expect(store().notice).toMatchObject({ kind: 'warning' })
  })

  it('두 번 불러도 한 번만 묻는다', async () => {
    const calls = fakeSpd({ read: { status: 'found', record }, choice: 'discard' })
    await Promise.all([checkRecovery(), checkRecovery()])
    expect(calls.read).toBe(1)
    expect(calls.confirm).toHaveLength(1)
  })

  it('브라우저(개발용)에서는 아무것도 하지 않는다', async () => {
    vi.stubGlobal('window', {})
    expect(await checkRecovery()).toBe('none')
  })
})

describe('자동 저장본 정리', () => {
  it('저장하면 자동 저장본을 지운다', async () => {
    const calls = fakeSpd({ read: { status: 'none' } })
    store().setParam('extra_people', 2)
    expect(await saveProject(false)).toBe(true)
    expect(calls.clear).toBe(1)
    expect(selectIsDirty(store())).toBe(false)
  })

  it('저장하지 않은 변경을 버리고 다른 파일을 열려 하면 지운다', async () => {
    const calls = fakeSpd({ read: { status: 'none' } })
    store().setParam('extra_people', 2)
    await openProject()
    expect(calls.clear).toBe(1)
  })
})
