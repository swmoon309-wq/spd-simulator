import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunResult } from '@spd/sd-engine'
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

beforeEach(async () => {
  await store().newProject('integrated-project')
  await settle()
})

describe('실적 상태', () => {
  it('첫 줄은 7일, 모든 단계 0이고 이후 줄은 이전 값을 이어받는다', () => {
    expect(store().addActual()).toBe(0)
    expect(store().actuals[0]).toEqual({ day: 7, cum: { prod_tasks_developed: 0, prod_tasks_qaed: 0, prod_tasks_tested: 0 }, effort: 0 })
    store().updateActual(0, { cum: { prod_tasks_developed: 10 }, effort: 40 })
    expect(store().addActual()).toBe(1)
    expect(store().actuals[1]).toEqual({ day: 14, cum: { prod_tasks_developed: 10, prod_tasks_qaed: 0, prod_tasks_tested: 0 }, effort: 40 })
    // 새 줄은 이전 줄과 값을 공유하지 않는다
    store().updateActual(1, { cum: { prod_tasks_developed: 12 } })
    expect(store().actuals[0]?.cum['prod_tasks_developed']).toBe(10)
  })
  it('수정은 일부 항목만 바꾸고 단계 값은 합쳐진다', () => {
    store().addActual()
    store().updateActual(0, { cum: { prod_tasks_qaed: 3 } })
    store().updateActual(0, { day: 9, headcount: 5, note: '메모' })
    expect(store().actuals[0]).toMatchObject({ day: 9, headcount: 5, note: '메모', cum: { prod_tasks_qaed: 3, prod_tasks_developed: 0 } })
  })
  it('삭제와 모두 지우기', () => {
    store().addActual()
    store().addActual()
    store().removeActual(0)
    expect(store().actuals).toHaveLength(1)
    expect(store().actuals[0]?.day).toBe(14)
    store().clearActuals()
    expect(store().actuals).toEqual([])
  })
  it('400줄을 넘으면 더하지 않는다', () => {
    for (let i = 0; i < 400; i++) expect(store().addActual()).toBe(i)
    expect(store().addActual()).toBeNull()
    expect(store().actuals).toHaveLength(400)
  })
  it('변경됨 표시를 켜고 저장하면 끄며 파일로 왕복한다', async () => {
    store().markSaved('x')
    expect(selectIsDirty(store())).toBe(false)
    store().addActual()
    store().updateActual(0, { effort: 33, defects: 4 })
    expect(selectIsDirty(store())).toBe(true)
    const file = store().buildProjectFile()
    expect(file.actuals).toHaveLength(1)
    store().markSaved('x')
    expect(selectIsDirty(store())).toBe(false)
    await store().newProject('integrated-project')
    expect(store().actuals).toEqual([])
    await store().loadProjectFile(file, 'x')
    expect(store().actuals[0]).toMatchObject({ day: 7, effort: 33, defects: 4 })
    expect(selectIsDirty(store())).toBe(false)
  })
  it('채택을 해제하거나 시나리오를 지워도 실적은 남는다', async () => {
    store().addActual()
    await store().runScenarios('missing')
    store().adoptScenario('@base')
    store().releaseAdoption()
    expect(store().actuals).toHaveLength(1)
  })
  it('다른 모델의 실적 키가 든 파일은 실적을 버리고 경고한다', async () => {
    store().addActual()
    const file = store().buildProjectFile()
    const other = { ...file, model: { id: 'brooks', version: 1 }, params: {}, scenarios: [], adopted: null }
    await store().newProject('brooks')
    await store().loadProjectFile(other as never, 'x')
    expect(store().actuals).toEqual([])
  })
})

describe('실적 일괄 설정과 경고 설정', () => {
  it('setActuals는 통째로 바꾸고 복사해 보관한다', () => {
    const rows = [{ day: 7, cum: { prod_tasks_developed: 1 }, effort: 5 }]
    expect(store().setActuals(rows)).toBe(true)
    rows[0]!.effort = 99
    expect(store().actuals[0]?.effort).toBe(5)
  })
  it('401줄은 거부하고 기존 값을 유지한다', () => {
    store().addActual()
    const many = Array.from({ length: 401 }, (_, i) => ({ day: i + 1, cum: {}, effort: 0 }))
    expect(store().setActuals(many)).toBe(false)
    expect(store().actuals).toHaveLength(1)
  })
  it('경고 설정은 변경됨 표시를 켜고 파일로 왕복한다', async () => {
    store().markSaved('x')
    const evm = { k: 4, alerts: { warn: 0.95, critical: 0.7, trend: 2, early: { progress: 0.2, cpi: 0.85 } } }
    store().setEvmSettings(evm)
    expect(selectIsDirty(store())).toBe(true)
    const file = store().buildProjectFile()
    expect(file.evm).toEqual(evm)
    store().markSaved('x')
    await store().newProject('integrated-project')
    expect(store().evm.k).toBe(3)
    await store().loadProjectFile(file, 'x')
    expect(store().evm).toEqual(evm)
    expect(selectIsDirty(store())).toBe(false)
  })
  it('잘못된 경고 설정이 든 파일은 기본값으로 돌리고 알린다', async () => {
    const file = { ...store().buildProjectFile(), evm: { k: 0, alerts: { warn: 0.9, critical: 0.8, trend: 3, early: { progress: 0.15, cpi: 0.9 } } } }
    await store().loadProjectFile(file, 'x')
    expect(store().evm.k).toBe(3)
    expect(JSON.stringify(store().notice)).toContain('경고 설정')
  })
})
