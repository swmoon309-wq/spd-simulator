import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lastOf, valueAt } from '@spd/analysis'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectModel } from '@spd/models'
import { reforecastKey, summarizeReforecast } from '../lib/reforecastView'
import { getEntry } from '../catalog'
import { useAppStore } from './appStore'
import { evmOf } from '../catalog/evm'

type Req = { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }

/** 실행기 제어: 실패시키기, 붙잡아 두기(취소·배제 시험), 호출 기록 */
const ctl = vi.hoisted(() => ({
  calls: [] as { modelId: string; overrides: Record<string, number> }[],
  failWhen: null as null | ((req: { overrides: Record<string, number> }) => string | null),
  holdWhen: null as null | ((req: { overrides: Record<string, number> }) => boolean),
  held: [] as { overrides: Record<string, number>; release(): void; canceled: boolean }[],
  progress: null as number | null,
  reforecasts: [] as { name: string; kappa: number }[][],
  reforecastFail: null as string | null,
  reforecastHold: null as Promise<void> | null
}))

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  const { reforecast, reforecastAdapters } = await import('@spd/analysis')
  const { getCompiledModel } = await import('../engine/models')
  return {
    startReforecast: async (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number>; observed: never; kappas: never }) => {
      ctl.reforecasts.push(req.kappas as unknown as { name: string; kappa: number }[])
      if (ctl.reforecastFail) throw new Error(ctl.reforecastFail)
      if (ctl.reforecastHold) await ctl.reforecastHold
      return reforecast(getCompiledModel(req.modelId), { adapter: reforecastAdapters[req.modelId] as never, params: req.overrides, options: req.options ?? {}, observed: req.observed, kappas: req.kappas })
    },
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
const planRun = runModel(compileModel(integratedProjectModel))
const planDay = lastOf(planRun, 'ctl_completion_time') as number
const CREDITS = ['prod_tasks_developed', 'prod_tasks_qaed', 'prod_tasks_tested']
/** 계획(기준선) 그대로의 실적을 보고일마다 만든다 */
const planRows = (days: number[]) =>
  days.map((d) => ({ day: d, cum: Object.fromEntries(CREDITS.map((c) => [c, valueAt(planRun, c, d)])), effort: valueAt(planRun, 'ctl_cum_md', d), headcount: valueAt(planRun, 'hr_total', d) }))

beforeEach(async () => {
  ctl.reforecasts.length = 0
  ctl.reforecastFail = null
  ctl.reforecastHold = null
  await store().newProject('integrated-project')
  await settle()
})

async function adoptWithPlanActuals(days = [25, 50, 75, 100]) {
  await store().runScenarios('missing')
  expect(store().adoptScenario('@base')).toBeNull()
  store().setActuals(planRows(days))
}

describe('재예측 (스토어)', () => {
  it('채택이 없으면 거절한다', async () => {
    store().setActuals(planRows([50]))
    expect(await store().runReforecast(50)).toMatch(/채택/)
    expect(store().reforecast).toBeNull()
  })

  it('보고일의 지표가 없으면(오류 행·없는 날) 거절한다', async () => {
    await adoptWithPlanActuals()
    expect(await store().runReforecast(51)).toMatch(/지표를 계산할 수 없습니다/)
    store().updateActual(1, { effort: -1 }) // 50일 행을 오류로
    expect(await store().runReforecast(50)).toMatch(/지표를 계산할 수 없습니다/)
  })

  it('공수가 0이면 κ를 정할 수 없어 거절하고 아무것도 실행하지 않는다', async () => {
    await adoptWithPlanActuals()
    store().setActuals([{ day: 40, cum: { prod_tasks_developed: 20, prod_tasks_qaed: 0, prod_tasks_tested: 0 }, effort: 0 }])
    expect(await store().runReforecast(40)).toMatch(/CPI/)
    expect(ctl.reforecasts).toHaveLength(0)
    expect(store().reforecast).toBeNull()
  })

  it('실적 = 계획이면 κ ≈ 1이고 두 재예측 모두 계획 완료일과 같다(자기 일관성)', async () => {
    await adoptWithPlanActuals()
    expect(await store().runReforecast(100)).toBeNull()
    const r = store().reforecast!
    expect(r.status).toBe('done')
    expect(ctl.reforecasts[0]!.map((k) => k.name)).toEqual(['cum', 'recent'])
    for (const k of ctl.reforecasts[0]!) expect(k.kappa).toBeCloseTo(1, 3)
    const view = summarizeReforecast(getEntry('integrated-project'), r.outcome!)
    expect(view.runs).toHaveLength(2)
    for (const run of view.runs) expect(run.completionDay).toBeCloseTo(planDay, 1)
    expect(view.eac!.high).toBeCloseTo(valueAt(planRun, 'ctl_cum_md', planDay), 0)
    expect(view.assumptions.some((a) => a.name === 'prod_tasks_developed' && a.kind === 'observed')).toBe(true)
    expect(view.estimatedLevels).toContain('exh_level')
  })

  it('기준선이 아니라 채택 스냅샷(고정된 값)으로 실행한다', async () => {
    await adoptWithPlanActuals()
    const before = store().adopted!.params
    store().setParam('total_tasks', 300) // 기본 설정을 바꿔도 재예측은 채택 시점의 값을 쓴다
    await store().runReforecast(100)
    expect(store().reforecast!.status).toBe('done')
    expect(store().adopted!.params).toEqual(before)
    const completion = evmOf(getEntry('integrated-project')).completion(store().reforecast!.outcome!.runs[0]!.result) as number
    expect(completion).toBeCloseTo(planDay, 1)
  })

  it('입력이 바뀌면 키가 달라져 오래된 결과로 알아볼 수 있다', async () => {
    await adoptWithPlanActuals()
    await store().runReforecast(100)
    const key = store().reforecast!.key
    const s = store()
    expect(key).toBe(reforecastKey(s.adopted!, s.actuals[3]!, s.evm.k))
    store().updateActual(3, { effort: s.actuals[3]!.effort + 50 })
    expect(reforecastKey(store().adopted!, store().actuals[3]!, store().evm.k)).not.toBe(key)
  })

  it('실행 중에는 다시 시작하지 않고, 오류는 상태에 남는다', async () => {
    await adoptWithPlanActuals()
    let release!: () => void
    ctl.reforecastHold = new Promise<void>((r) => (release = r))
    const first = store().runReforecast(100)
    await vi.waitFor(() => expect(store().reforecast?.status).toBe('running'))
    expect(await store().runReforecast(100)).toMatch(/이미 실행 중/)
    release()
    expect(await first).toBeNull()
    ctl.reforecastHold = null
    ctl.reforecastFail = '모의 오류'
    store().updateActual(3, { effort: store().actuals[3]!.effort + 1 })
    expect(await store().runReforecast(100)).toBe('모의 오류')
    expect(store().reforecast).toMatchObject({ status: 'error', error: '모의 오류' })
  })

  it('새 프로젝트와 열기는 재예측을 비운다', async () => {
    await adoptWithPlanActuals()
    await store().runReforecast(100)
    expect(store().reforecast).not.toBeNull()
    const file = store().buildProjectFile()
    await store().newProject('integrated-project')
    expect(store().reforecast).toBeNull()
    await store().runScenarios('missing')
    store().adoptScenario('@base')
    store().setActuals(planRows([100]))
    await store().runReforecast(100)
    await store().loadProjectFile(file, 'x')
    expect(store().reforecast).toBeNull()
  })

  it('재예측은 프로젝트를 수정 상태로 만들지 않고 파일에도 저장하지 않는다', async () => {
    await adoptWithPlanActuals()
    store().markSaved('x')
    await store().runReforecast(100)
    const { selectIsDirty } = await import('./appStore')
    expect(selectIsDirty(store())).toBe(false)
    expect(JSON.stringify(store().buildProjectFile())).not.toContain('reforecast')
  })

  it('Brooks 모델도 재예측한다', async () => {
    await store().newProject('brooks')
    await settle()
    await store().runScenarios('missing')
    store().adoptScenario('@base')
    const base = runModel(compileModel((await import('@spd/models')).brooksModel))
    store().setActuals([{ day: 100, cum: { developed_software: valueAt(base, 'developed_software', 100) }, effort: valueAt(base, 'cum_effort', 100), headcount: 20 }])
    expect(await store().runReforecast(100)).toBeNull()
    const done = evmOf(getEntry('brooks')).completion(store().reforecast!.outcome!.runs[0]!.result) as number
    expect(done).toBeCloseTo(274.12, 1)
  })
})
