import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunResult } from '@spd/sd-engine'
import { getEntry } from '../catalog'
import { adoptionStatus } from '../lib/adoption'
import { selectIsDirty, useAppStore } from './appStore'

type Req = { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }

/** 실행기 제어: 실패시키기, 붙잡아 두기(취소·배제 시험), 호출 기록 */
const ctl = vi.hoisted(() => ({
  calls: [] as { modelId: string; overrides: Record<string, number> }[],
  failWhen: null as null | ((req: { overrides: Record<string, number> }) => string | null),
  holdWhen: null as null | ((req: { overrides: Record<string, number> }) => boolean),
  held: [] as { overrides: Record<string, number>; release(): void; canceled: boolean }[],
  progress: null as number | null
}))

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    startRun: (req: Req, onProgress?: (p: { time: number; fraction: number; values: Record<string, number> }) => void) => {
      ctl.calls.push({ modelId: req.modelId, overrides: req.overrides })
      if (ctl.progress !== null) onProgress?.({ time: 0, fraction: ctl.progress, values: {} })
      const compute = () => runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })
      const failure = ctl.failWhen?.(req)
      if (failure) return { promise: Promise.reject(new Error(failure)), cancel() {} }
      if (ctl.holdWhen?.(req)) {
        let resolve!: (r: RunResult) => void
        const promise = new Promise<RunResult>((r) => (resolve = r))
        const entry = {
          overrides: req.overrides,
          canceled: false,
          release: () => resolve(compute())
        }
        ctl.held.push(entry)
        return {
          promise,
          cancel() {
            entry.canceled = true
            resolve({ ...compute(), meta: { ...compute().meta, completed: false } })
          }
        }
      }
      return { promise: Promise.resolve(compute()), cancel() {} }
    }
  }
})

const store = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(store().status).toBe('idle'))
const addScenario = (name: string, overrides: Record<string, number> = {}) => {
  const id = store().addScenario() as string
  store().renameScenario(id, name)
  for (const [k, v] of Object.entries(overrides)) store().setScenarioOverride(id, k, v)
  return id
}

beforeEach(async () => {
  ctl.calls.length = 0
  ctl.failWhen = null
  ctl.holdWhen = null
  ctl.held.length = 0
  ctl.progress = null
  await store().newProject('brooks')
  await settle()
})

describe('채택 계획', () => {
  it('실행하기 전에는 채택할 수 없다', () => {
    const id = addScenario('a', { extra_people: 5 })
    expect(store().adoptScenario(id)).toMatch(/실행/)
    expect(store().adopted).toBeNull()
  })

  it('실행한 시나리오를 채택하면 스냅샷이 만들어진다', async () => {
    const id = addScenario('5명 추가', { extra_people: 5 })
    await store().runScenarios('missing')
    expect(store().adoptScenario(id)).toBeNull()
    const a = store().adopted
    expect(a?.scenarioId).toBe(id)
    expect(a?.scenarioName).toBe('5명 추가')
    expect(a?.plannedCompletion).toBeCloseTo(272.0, 0)
    expect(a?.params['extra_people']).toBe(5)
    expect(a?.series.time).toHaveLength(401)
  })

  it('기준(@base)도 채택할 수 있다', async () => {
    await store().runScenarios('missing')
    expect(store().adoptScenario('@base')).toBeNull()
    expect(store().adopted?.scenarioName).toBe('기준')
    expect(store().adopted?.plannedCompletion).toBeCloseTo(274.12, 0)
  })

  it('입력이 바뀌어 오래된 결과는 채택할 수 없다', async () => {
    const id = addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    store().setScenarioOverride(id, 'extra_people', 8)
    expect(store().adoptScenario(id)).toMatch(/오래/)
    expect(store().adopted).toBeNull()
  })

  it('종료 시각 안에 끝나지 않은 결과는 채택할 수 없다', async () => {
    store().setRunSetting('end', 100)
    await store().runScenarios('missing')
    expect(store().adoptScenario('@base')).toMatch(/끝나지/)
  })

  it('다른 시나리오를 채택하면 이전 채택은 바뀐다', async () => {
    const a = addScenario('a', { extra_people: 5 })
    const b = addScenario('b', { extra_people: 8 })
    await store().runScenarios('missing')
    store().adoptScenario(a)
    store().adoptScenario(b)
    expect(store().adopted?.scenarioId).toBe(b)
  })

  it('채택한 뒤에 시나리오를 고쳐도 스냅샷은 그대로이고 어긋남이 보인다', async () => {
    const id = addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    store().adoptScenario(id)
    const before = structuredClone(store().adopted)
    store().setScenarioOverride(id, 'extra_people', 8)
    expect(store().adopted).toEqual(before)
    const s = store()
    const st = adoptionStatus(s.adopted!, { modelId: s.modelId, params: s.params, settings: s.runSettings, scenarios: s.scenarios }, getEntry('brooks'))
    expect(st.linked).toBe(true)
    expect(st.changes.map((c) => c.key)).toEqual(['extra_people'])
  })

  it('해제하면 스냅샷이 지워진다', async () => {
    await store().runScenarios('missing')
    store().adoptScenario('@base')
    store().releaseAdoption()
    expect(store().adopted).toBeNull()
  })

  it('채택한 시나리오를 삭제하면 채택도 해제되고 다른 시나리오 삭제는 영향이 없다', async () => {
    const a = addScenario('a', { extra_people: 5 })
    const b = addScenario('b', { extra_people: 8 })
    await store().runScenarios('missing')
    store().adoptScenario(a)
    store().deleteScenario(b)
    expect(store().adopted?.scenarioId).toBe(a)
    store().deleteScenario(a)
    expect(store().adopted).toBeNull()
  })

  it('채택은 변경 표시(dirty)를 켜고 저장하면 꺼지며 파일로 왕복한다', async () => {
    await store().runScenarios('missing')
    store().markSaved('x')
    expect(selectIsDirty(store())).toBe(false)
    store().adoptScenario('@base')
    expect(selectIsDirty(store())).toBe(true)
    const file = store().buildProjectFile()
    expect(file.adopted?.scenarioId).toBe('@base')
    await store().newProject('brooks')
    expect(store().adopted).toBeNull()
    await store().loadProjectFile(file, "x")
    expect(store().adopted?.scenarioId).toBe('@base')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('새 프로젝트는 채택을 비운다', async () => {
    await store().runScenarios('missing')
    store().adoptScenario('@base')
    await store().newProject('brooks')
    expect(store().adopted).toBeNull()
  })
})
