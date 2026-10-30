import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeKpis } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import { getEntry } from '../catalog'
import { BASE_ID, rowStatus, taskFor } from '../lib/scenarioRunner'
import { useAppStore } from './appStore'

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
const brooks = getEntry('brooks')
const current = (id: string) => {
  const s = store()
  const t = taskFor({ modelId: s.modelId, params: s.params, settings: s.runSettings, scenarios: s.scenarios }, id)
  if (!t) throw new Error(`행 ${id} 없음`)
  return t.key
}
const status = (id: string) => rowStatus(store().scenarioRuns[id], current(id)).kind
const completion = (id: string) => {
  const run = store().scenarioRuns[id]
  if (!run?.result) return undefined
  return computeKpis(brooks.kpiSpecs, run.result, taskFor({ modelId: 'brooks', params: store().params, settings: store().runSettings, scenarios: store().scenarios }, id)?.params ?? {})['completionDay']
}
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
  await store().newProject('brooks') // 이전 시험의 시나리오·결과·캐시를 비운다
  await settle()
  ctl.calls.length = 0 // 새 프로젝트의 기준 실행은 세지 않는다
})

describe('일괄 실행', () => {
  it('기준과 시나리오를 목록 순서대로 실행하고 결과가 알려진 값과 같다', async () => {
    const s1 = addScenario('5명 추가', { extra_people: 5 })
    const out = await store().runScenarios('missing')
    expect(out).toEqual({ completed: 2, failed: 0, canceled: false })
    expect(ctl.calls.map((c) => c.overrides['extra_people'])).toEqual([0, 5])
    expect(completion(BASE_ID)).toBeCloseTo(274.12, 1)
    expect(completion(s1)).toBeCloseTo(272.0, 1)
    expect(status(BASE_ID)).toBe('done')
    expect(status(s1)).toBe('done')
    expect(store().batch).toBeNull()
  })

  it('입력이 기준과 같은 시나리오는 실행하지 않고 기준의 결과를 나눠 갖는다', async () => {
    const same = addScenario('기준과 같음')
    await store().runScenarios('missing')
    expect(ctl.calls).toHaveLength(1)
    expect(store().scenarioRuns[same]?.result).toBe(store().scenarioRuns[BASE_ID]?.result)
  })

  it('실행 중 진행률이 행에 반영되고 끝나면 정리된다', async () => {
    addScenario('a', { extra_people: 5 })
    ctl.progress = 0.3
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    const running = Object.values(store().scenarioRuns).find((r) => r.phase === 'running')
    expect(running?.progress).toBeCloseTo(0.3, 9)
    expect(store().batch).toEqual({ total: 2, done: 1 }) // 기준은 끝남
    ctl.held[0]?.release()
    await p
    expect(store().batch).toBeNull()
    expect(Object.values(store().scenarioRuns).every((r) => r.phase === 'idle' && r.progress === 0)).toBe(true)
  })

  it('입력 단위로 진행 개수를 센다(같은 입력은 한 번)', async () => {
    addScenario('기준과 같음')
    addScenario('다름', { extra_people: 5 })
    const seen: number[] = []
    const unsubscribe = useAppStore.subscribe((s) => s.batch && seen.push(s.batch.done))
    await store().runScenarios('missing')
    unsubscribe()
    expect(seen[0]).toBe(0)
    expect(Math.max(...seen)).toBe(2)
    expect(ctl.calls).toHaveLength(2)
  })
})

describe('오래됨 표시와 캐시', () => {
  it('시나리오의 값을 바꾸면 그 행만 오래됨이 된다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    const s2 = addScenario('b', { extra_people: 8 })
    await store().runScenarios('missing')
    store().setScenarioOverride(s1, 'extra_people', 6)
    expect([status(BASE_ID), status(s1), status(s2)]).toEqual(['done', 'stale', 'done'])
    expect(store().scenarioRuns[s1]?.result).toBeDefined() // 이전 결과는 비교용으로 남는다
  })

  it('기본 설정이나 실행 설정을 바꾸면 모든 행이 오래됨이 된다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    store().setParam('hire_day', 100)
    expect([status(BASE_ID), status(s1)]).toEqual(['stale', 'stale'])
    await store().runScenarios('missing')
    expect([status(BASE_ID), status(s1)]).toEqual(['done', 'done'])
    store().setRunSetting('seed', 5)
    expect([status(BASE_ID), status(s1)]).toEqual(['stale', 'stale'])
  })

  it('missing은 오래된 행만 다시 실행하고, 모두 최신이면 아무것도 실행하지 않는다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    addScenario('b', { extra_people: 8 })
    await store().runScenarios('missing')
    expect(ctl.calls).toHaveLength(3)
    expect(await store().runScenarios('missing')).toEqual({ completed: 0, failed: 0, canceled: false })
    expect(ctl.calls).toHaveLength(3)
    store().setScenarioOverride(s1, 'extra_people', 6)
    await store().runScenarios('missing')
    expect(ctl.calls).toHaveLength(4)
    expect(ctl.calls[3]?.overrides['extra_people']).toBe(6)
  })

  it('all은 최신 행도 모두 다시 실행한다', async () => {
    addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    await store().runScenarios('all')
    expect(ctl.calls).toHaveLength(4)
  })

  it('이전에 계산한 입력으로 되돌리면 캐시에서 가져와 실행하지 않는다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    const first = store().scenarioRuns[s1]?.result
    store().setScenarioOverride(s1, 'extra_people', 6)
    await store().runScenarios('missing') // 6 실행
    const callsBefore = ctl.calls.length
    store().setScenarioOverride(s1, 'extra_people', 5)
    expect(status(s1)).toBe('stale')
    await store().runScenarios('missing')
    expect(ctl.calls).toHaveLength(callsBefore)
    expect(status(s1)).toBe('done')
    expect(store().scenarioRuns[s1]?.result).toBe(first)
  })

  it('특정 행만 다시 실행할 수 있다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    addScenario('b', { extra_people: 8 })
    await store().runScenarios('missing')
    ctl.calls.length = 0
    await store().runScenarios('all', [s1])
    expect(ctl.calls).toHaveLength(1)
    expect(ctl.calls[0]?.overrides['extra_people']).toBe(5)
  })

  it('프로젝트를 새로 시작하면 행과 캐시가 비워져 같은 입력도 다시 계산한다', async () => {
    addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    await store().newProject('brooks')
    await settle()
    expect(store().scenarioRuns).toEqual({})
    ctl.calls.length = 0
    addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    expect(ctl.calls).toHaveLength(2) // 기준과 시나리오 모두 새로 계산
  })

  it('시나리오를 지우면 그 행의 결과도 지운다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    store().deleteScenario(s1)
    expect(store().scenarioRuns[s1]).toBeUndefined()
    expect(store().scenarioRuns[BASE_ID]).toBeDefined()
  })
})

describe('마지막 일괄 실행 결과(lastBatch)', () => {
  it('끝나면 결과가 남고, 새 일괄 실행을 시작하면 지워진다', async () => {
    addScenario('a', { extra_people: 5 })
    expect(store().lastBatch).toBeNull()
    await store().runScenarios('missing')
    expect(store().lastBatch).toEqual({ completed: 2, failed: 0, canceled: false })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    store().setScenarioOverride(store().scenarios[0]?.id as string, 'extra_people', 5) // 같은 값: 최신 유지
    const p = store().runScenarios('all')
    expect(store().lastBatch).toBeNull() // 시작과 함께 지움
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    ctl.held[0]?.release()
    await p
    expect(store().lastBatch?.completed).toBe(2)
  })

  it('실패와 취소가 결과에 반영된다', async () => {
    addScenario('실패', { extra_people: 7 })
    addScenario('늦은', { extra_people: 5 })
    ctl.failWhen = (r) => (r.overrides['extra_people'] === 7 ? '실패' : null)
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    store().cancelBatch()
    await p
    expect(store().lastBatch).toEqual({ completed: 1, failed: 1, canceled: true })
  })

  it('이미 최신이면 아무것도 하지 않은 결과가 남는다', async () => {
    await store().runScenarios('missing')
    await store().runScenarios('missing')
    expect(store().lastBatch).toEqual({ completed: 0, failed: 0, canceled: false })
  })

  it('입력 오류로 시작하지 못하면 이전 결과를 건드리지 않는다', async () => {
    await store().runScenarios('missing')
    const before = store().lastBatch
    store().setParamError('hire_day', '오류')
    await store().runScenarios('missing')
    expect(store().lastBatch).toBe(before)
    store().setParamError('hire_day', null)
  })

  it('프로젝트를 새로 시작하면 지워진다', async () => {
    await store().runScenarios('missing')
    await store().newProject('brooks')
    await settle()
    expect(store().lastBatch).toBeNull()
  })
})

describe('비교 차트 표시 토글(compareHidden)', () => {
  it('열을 숨기고 다시 보이게 한다', () => {
    const id = addScenario('a')
    expect(store().compareHidden).toEqual({})
    store().toggleCompareVisible(id)
    expect(store().compareHidden).toEqual({ [id]: true })
    store().toggleCompareVisible(BASE_ID)
    expect(Object.keys(store().compareHidden).sort()).toEqual([BASE_ID, id].sort())
    store().toggleCompareVisible(id)
    expect(store().compareHidden).toEqual({ [BASE_ID]: true })
  })

  it('시나리오를 지우면 그 열의 토글도 지운다', () => {
    const id = addScenario('a')
    store().toggleCompareVisible(id)
    store().deleteScenario(id)
    expect(store().compareHidden).toEqual({})
  })

  it('새 프로젝트를 시작하면 비운다', async () => {
    store().toggleCompareVisible(BASE_ID)
    await store().newProject('brooks')
    await settle()
    expect(store().compareHidden).toEqual({})
  })

  it('프로젝트의 수정 상태를 바꾸지 않는다', async () => {
    const id = addScenario('a')
    store().markSaved('x.spd.json')
    store().toggleCompareVisible(id)
    const { selectIsDirty } = await import('./appStore')
    expect(selectIsDirty(store())).toBe(false)
  })
})

describe('실패 격리', () => {
  it('한 시나리오가 실패해도 나머지는 완료되고, 실패한 행에 오류가 남는다', async () => {
    const bad = addScenario('실패', { extra_people: 7 })
    const good = addScenario('성공', { extra_people: 5 })
    ctl.failWhen = (r) => (r.overrides['extra_people'] === 7 ? '수치 오류: software_development_rate' : null)
    const out = await store().runScenarios('missing')
    expect(out).toEqual({ completed: 2, failed: 1, canceled: false })
    expect([status(BASE_ID), status(bad), status(good)]).toEqual(['done', 'error', 'done'])
    expect(rowStatus(store().scenarioRuns[bad], current(bad))).toEqual({ kind: 'error', message: '수치 오류: software_development_rate' })
    expect(store().scenarioRuns[good]?.result).toBeDefined()
  })

  it('입력을 고치면 오류가 사라지고 다시 실행하면 성공한다', async () => {
    const bad = addScenario('실패', { extra_people: 7 })
    ctl.failWhen = (r) => (r.overrides['extra_people'] === 7 ? '실패' : null)
    await store().runScenarios('missing')
    expect(status(bad)).toBe('error')
    store().setScenarioOverride(bad, 'extra_people', 6)
    expect(status(bad)).toBe('none')
    await store().runScenarios('missing')
    expect(status(bad)).toBe('done')
  })

  it('같은 입력에서 이미 실패한 행은 missing에서 다시 실행하지 않지만 all에서는 다시 시도한다', async () => {
    const bad = addScenario('실패', { extra_people: 7 })
    ctl.failWhen = (r) => (r.overrides['extra_people'] === 7 ? '실패' : null)
    await store().runScenarios('missing')
    ctl.calls.length = 0
    await store().runScenarios('missing')
    expect(ctl.calls).toHaveLength(0)
    ctl.failWhen = null // 일시적 문제가 해결된 경우
    await store().runScenarios('all', [bad])
    expect(ctl.calls).toHaveLength(1)
    expect(status(bad)).toBe('done')
  })

  it('실패한 입력은 캐시하지 않는다', async () => {
    addScenario('실패', { extra_people: 7 })
    ctl.failWhen = (r) => (r.overrides['extra_people'] === 7 ? '실패' : null)
    await store().runScenarios('missing')
    ctl.failWhen = null
    ctl.calls.length = 0
    await store().runScenarios('all')
    expect(ctl.calls.map((c) => c.overrides['extra_people'])).toEqual([0, 7])
  })
})

describe('취소', () => {
  it('실행 중에 취소하면 그 입력과 대기 중인 입력을 멈추고 끝난 결과는 유지한다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    const s2 = addScenario('b', { extra_people: 8 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    expect(status(BASE_ID)).toBe('done')
    expect(status(s1)).toBe('running')
    expect(status(s2)).toBe('queued')

    store().cancelBatch()
    const out = await p
    expect(out?.canceled).toBe(true)
    expect(ctl.held[0]?.canceled).toBe(true)
    expect(ctl.calls.map((c) => c.overrides['extra_people'])).toEqual([0, 5]) // 8은 시작하지 않았다
    expect(status(BASE_ID)).toBe('done')
    expect([status(s1), status(s2)]).toEqual(['none', 'none'])
    expect(store().batch).toBeNull()
  })

  it('취소한 입력은 캐시되지 않아 다시 실행하면 새로 계산한다', async () => {
    addScenario('a', { extra_people: 5 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    store().cancelBatch()
    await p
    ctl.holdWhen = null
    ctl.calls.length = 0
    await store().runScenarios('missing')
    expect(ctl.calls.map((c) => c.overrides['extra_people'])).toEqual([5])
  })

  it('취소해도 이전(오래된) 결과는 지우지 않는다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    await store().runScenarios('missing')
    const old = store().scenarioRuns[s1]?.result
    store().setScenarioOverride(s1, 'extra_people', 6)
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 6
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    store().cancelBatch()
    await p
    expect(status(s1)).toBe('stale')
    expect(store().scenarioRuns[s1]?.result).toBe(old)
  })

  it('일괄 실행이 없을 때 취소는 아무 일도 하지 않는다', () => {
    expect(() => store().cancelBatch()).not.toThrow()
  })

  it('새 프로젝트를 시작하면 진행 중인 일괄 실행을 취소하고 끝날 때까지 기다린다', async () => {
    addScenario('a', { extra_people: 5 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    await store().newProject('brooks')
    await p
    expect(ctl.held[0]?.canceled).toBe(true)
    expect(store().batch).toBeNull()
    expect(store().scenarios).toEqual([])
  })
})

describe('다른 실행과의 배제', () => {
  it('일괄 실행 중에는 실험 탭 실행과 다른 일괄 실행을 시작하지 않는다', async () => {
    addScenario('a', { extra_people: 5 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    const runsBefore = store().runs.length
    await store().run({ extra_people: 3 })
    expect(store().runs).toHaveLength(runsBefore)
    expect(await store().runScenarios('all')).toBeNull()
    ctl.held[0]?.release()
    await p
  })

  it('실험 탭 실행 중에는 일괄 실행을 시작하지 않는다', async () => {
    addScenario('a', { extra_people: 5 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 3
    const running = store().run({ extra_people: 3 })
    await vi.waitFor(() => expect(store().status).toBe('running'))
    expect(await store().runScenarios('missing')).toBeNull()
    ctl.held[0]?.release()
    await running
    await settle()
    expect(await store().runScenarios('missing')).not.toBeNull()
  })

  it('입력 오류가 있으면 시작하지 않는다', async () => {
    addScenario('a', { extra_people: 5 })
    store().setParamError('hire_day', '숫자를 입력하세요')
    expect(await store().runScenarios('missing')).toBeNull()
    expect(ctl.calls).toHaveLength(0)
    store().setParamError('hire_day', null)
  })

  it('일괄 실행은 프로젝트의 수정 상태를 바꾸지 않는다', async () => {
    addScenario('a', { extra_people: 5 })
    store().markSaved('x.spd.json')
    await store().runScenarios('missing')
    const { selectIsDirty } = await import('./appStore')
    expect(selectIsDirty(store())).toBe(false)
  })
})

describe('실행 중 편집', () => {
  it('실행 중에 시나리오 값을 바꾸면 끝난 결과는 오래됨으로 보인다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    store().setScenarioOverride(s1, 'extra_people', 6) // 실행 시작 이후의 편집
    ctl.held[0]?.release()
    await p
    expect(status(s1)).toBe('stale') // 5로 계산한 결과이므로 현재 입력(6)과 다르다
  })

  it('실행 중에 지운 시나리오의 행을 다시 만들지 않는다', async () => {
    const s1 = addScenario('a', { extra_people: 5 })
    ctl.holdWhen = (r) => r.overrides['extra_people'] === 5
    const p = store().runScenarios('missing')
    await vi.waitFor(() => expect(ctl.held).toHaveLength(1))
    store().deleteScenario(s1)
    ctl.held[0]?.release()
    await p
    expect(store().scenarioRuns[s1]).toBeUndefined()
  })
})
