import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lastOf, valueAt } from '@spd/analysis'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectModel } from '@spd/models'
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
  changes: [] as unknown[],
  reforecastFail: null as string | null,
  reforecastHold: null as Promise<void> | null
}))

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  const { reforecast, reforecastAdapters } = await import('@spd/analysis')
  const { getCompiledModel } = await import('../engine/models')
  return {
    startReforecast: async (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number>; observed: never; kappas: never; changes?: never }) => {
      ctl.reforecasts.push(req.kappas as unknown as { name: string; kappa: number }[])
      ctl.changes.push(req.changes ?? [])
      if (ctl.reforecastFail) throw new Error(ctl.reforecastFail)
      if (ctl.reforecastHold) await ctl.reforecastHold
      return reforecast(getCompiledModel(req.modelId), { adapter: reforecastAdapters[req.modelId] as never, params: req.overrides, options: req.options ?? {}, observed: req.observed, kappas: req.kappas, ...(req.changes ? { changes: req.changes } : {}) })
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
const CREDITS = ['prod_tasks_developed', 'prod_tasks_qaed', 'prod_tasks_tested']
const model = compileModel(integratedProjectModel)
const planRun = runModel(model)
const planDay = lastOf(planRun, 'ctl_completion_time') as number
/** "진짜 프로젝트"(숙련 생산성 0.7배)의 주간 실적 */
const truth = runModel(model, { overrides: { pro_prod: 0.7 } })
const rowsAt = (days: number[]) =>
  days.map((d) => ({ day: d, cum: Object.fromEntries(CREDITS.map((c) => [c, valueAt(truth, c, d)])), effort: valueAt(truth, 'ctl_cum_md', d), headcount: valueAt(truth, 'hr_total', d) }))
const WEEKS = Array.from({ length: 14 }, (_, i) => (i + 1) * 7) // 7 ~ 98

beforeEach(async () => {
  ctl.reforecasts.length = 0
  ctl.changes.length = 0
  ctl.reforecastFail = null
  ctl.reforecastHold = null
  await store().newProject('integrated-project')
  await settle()
})

async function ready(days = WEEKS) {
  await store().runScenarios('missing')
  expect(store().adoptScenario('@base')).toBeNull()
  store().setActuals(rowsAt(days))
}

describe('조치 후보', () => {
  it('후보를 더하고 고치고 지운다(상한 6)', async () => {
    await ready()
    const a = store().addCandidate('staffing', 105)!
    expect(store().candidates[0]).toEqual({ id: a, input: { kind: 'staffing', values: { people: 3 }, day: 105 } })
    store().updateCandidate(a, { values: { people: 6 }, day: 110 })
    expect(store().candidates[0]!.input).toEqual({ kind: 'staffing', values: { people: 6 }, day: 110 })
    store().updateCandidate(a, { kind: 'overtime' }) // 종류를 바꾸면 값은 그 종류의 처음 값
    expect(store().candidates[0]!.input.values).toHaveProperty('maxBoost')
    store().removeCandidate(a)
    expect(store().candidates).toEqual([])
    for (let i = 0; i < 6; i++) expect(store().addCandidate('qa', 100)).not.toBeNull()
    expect(store().addCandidate('qa', 100)).toBeNull()
    expect(new Set(store().candidates.map((c) => c.id)).size).toBe(6)
  })
  it('후보를 지워도 id를 재사용하지 않는다', async () => {
    const a = store().addCandidate('qa', 100)!
    const b = store().addCandidate('qa', 100)!
    store().removeCandidate(a)
    const c = store().addCandidate('qa', 100)!
    expect(new Set([a, b, c]).size).toBe(3)
  })
  it('후보와 비교 결과는 파일에 저장하지 않고 수정 상태로도 만들지 않는다', async () => {
    await ready()
    store().markSaved('x')
    store().addCandidate('staffing', 105)
    await store().runActions(98)
    const { selectIsDirty } = await import('./appStore')
    expect(selectIsDirty(store())).toBe(false)
    const json = JSON.stringify(store().buildProjectFile())
    expect(json).not.toContain('candidates')
    expect(json).not.toContain('actionRun')
  })
})

describe('조치 후보 비교 (runActions)', () => {
  it('채택·후보·지표가 없으면 거절한다', async () => {
    expect(await store().runActions(98)).toMatch(/채택/)
    await ready()
    expect(await store().runActions(98)).toMatch(/후보를 하나 이상/)
    store().addCandidate('staffing', 105)
    expect(await store().runActions(99)).toMatch(/지표를 계산할 수 없습니다/)
  })
  it('잘못된 후보는 몇 번째인지 알리고 아무것도 실행하지 않는다', async () => {
    await ready()
    store().addCandidate('staffing', 105)
    const b = store().addCandidate('qa', 90)! // 시작일이 보고일 이전
    expect(await store().runActions(98)).toMatch(/후보 2\(QA 축소\).*보고일/)
    expect(ctl.reforecasts).toHaveLength(0)
    store().updateCandidate(b, { day: 120 })
    expect(await store().runActions(98)).toBeNull()
  })
  it('공수가 0이면 κ를 정할 수 없어 거절한다', async () => {
    await ready()
    store().setActuals([{ day: 40, cum: { prod_tasks_developed: 20, prod_tasks_qaed: 0, prod_tasks_tested: 0 }, effort: 0 }])
    store().addCandidate('staffing', 45)
    expect(await store().runActions(40)).toMatch(/CPI/)
  })
  it('"조치 없음"과 후보를 같은 κ로 실행하고 후보의 상수 변경을 전달한다', async () => {
    await ready()
    store().addCandidate('staffing', 105)
    store().addCandidate('overtime', 120)
    expect(await store().runActions(98)).toBeNull()
    const run = store().actionRun!
    expect(run.status).toBe('done')
    expect(run.entries.map((e) => e.id)).toEqual(['none', 'c1', 'c2'])
    expect(run.entries[0]!.label).toBe('조치 없음')
    expect(run.entries[1]!.label).toContain('인력 보강 +3명')
    // 모든 항목이 같은 κ(누적·최근 구간 평균)로 한 번씩
    expect(ctl.reforecasts).toHaveLength(3)
    expect(new Set(ctl.reforecasts.map((k) => k[0]!.kappa)).size).toBe(1)
    expect(ctl.reforecasts[0]![0]!.kappa).toBeCloseTo(run.kappa, 12)
    expect(run.kappa).toBeGreaterThan(0.3)
    expect(run.kappa).toBeLessThan(1) // 생산성이 낮은 프로젝트
    expect(ctl.changes[0]).toEqual([])
    expect((ctl.changes[1] as { name: string }[]).map((c) => c.name)).toEqual(['extra_people', 'extra_people_day'])
    expect(ctl.changes[2]).toEqual([{ day: 120, name: 'max_boost', value: 0.9 }])
  })
  it('같은 후보를 두 번 실행하면 같은 결과이고 실행 중에는 다시 시작하지 않는다', async () => {
    await ready()
    store().addCandidate('staffing', 105)
    let release!: () => void
    ctl.reforecastHold = new Promise<void>((r) => (release = r))
    const first = store().runActions(98)
    await vi.waitFor(() => expect(store().actionRun?.status).toBe('running'))
    expect(await store().runActions(98)).toMatch(/이미 실행 중/)
    release()
    await first
    ctl.reforecastHold = null
    const a = store().actionRun!.entries[1]!.outcome.runs[0]!.result
    await store().runActions(98)
    const b = store().actionRun!.entries[1]!.outcome.runs[0]!.result
    expect(Array.from(a.series['ctl_cum_md'] as Float64Array)).toEqual(Array.from(b.series['ctl_cum_md'] as Float64Array))
  })
  it('실행 오류는 상태에 남고 이유를 돌려준다', async () => {
    await ready()
    store().addCandidate('staffing', 105)
    ctl.reforecastFail = '모의 오류'
    expect(await store().runActions(98)).toBe('모의 오류')
    expect(store().actionRun).toMatchObject({ status: 'error', error: '모의 오류' })
  })
})

describe('계획 개정 (reviseWith)', () => {
  async function compared() {
    await ready()
    store().addCandidate('staffing', 105)
    store().addCandidate('overtime', 105)
    await store().runActions(98)
  }
  it('먼저 비교하지 않으면 거절', async () => {
    await ready()
    expect(store().reviseWith('none', '사유')).toMatch(/먼저 조치 후보를 실행/)
  })
  it('사유는 필수이고 200자 이하', async () => {
    await compared()
    expect(store().reviseWith('c1', '')).toMatch(/사유를 입력/)
    expect(store().reviseWith('c1', '   ')).toMatch(/사유를 입력/)
    expect(store().reviseWith('c1', 'x'.repeat(201))).toMatch(/200자/)
    expect(store().revisions).toHaveLength(0)
  })
  it('후보를 채택하면 개정 이력이 남고 새 기준선이 개정 시점에서 시작한다', async () => {
    await compared()
    const before = structuredClone(store().adopted)
    expect(store().reviseWith('c2', '  야근 허용을 늘려 만회  ')).toBeNull()
    const r = store().revisions[0]!
    expect(store().revisions).toHaveLength(1)
    expect(r).toMatchObject({ number: 1, day: 98, reason: '야근 허용을 늘려 만회', kappa: expect.any(Number) })
    expect(r.action).toMatchObject({ kind: 'overtime', values: { maxBoost: 0.9 }, day: 105 })
    expect(r.action!.label).toContain('야근')
    expect(r.baseline.series.time[0]).toBe(98)
    expect(r.after.bac).toBeCloseTo(r.baseline.bac, 6)
    expect(r.before.plannedCompletion).toBeCloseTo(planDay, 1)
    expect(r.ac0).toBeCloseTo(store().actuals[13]!.effort, 9)
    // 원 기준선은 그대로, 비교 결과·재예측은 비워진다(오래되었으므로)
    expect(store().adopted).toEqual(before)
    expect(store().actionRun).toBeNull()
    expect(store().reforecast).toBeNull()
  })
  it('"조치 없음"으로도 개정한다(action = null)', async () => {
    await compared()
    expect(store().reviseWith('none', '재예측 결과로 계획을 다시 잡는다')).toBeNull()
    expect(store().revisions[0]!.action).toBeNull()
  })
  it('비교 후 입력이 바뀌면 오래된 결과로 거절', async () => {
    await compared()
    store().updateCandidate('c1', { values: { people: 9 } })
    expect(store().reviseWith('c1', '사유')).toMatch(/오래되었습니다/)
    expect(store().reviseWith('nope', '사유')).toMatch(/오래되었습니다/)
  })
  it('같은 보고일 이전·당일로 다시 개정할 수 없고 이후 보고일에는 두 번째 개정이 된다', async () => {
    await compared()
    store().reviseWith('c1', '첫 개정')
    // 98일을 다시 비교해도 이미 98일에 개정했다
    await store().runActions(98)
    expect(store().reviseWith('c1', '또')).toMatch(/이미 98일에 개정/)
    // 이후 실적을 더해 두 번째 개정
    store().setActuals([...store().actuals, ...rowsAt([105, 112, 119])])
    store().updateCandidate('c1', { day: 125 })
    store().updateCandidate('c2', { day: 125 })
    expect(await store().runActions(119)).toBeNull()
    expect(store().actionRun?.status).toBe('done')
    expect(store().reviseWith('c1', '두 번째 개정')).toBeNull()
    expect(store().revisions.map((r) => [r.number, r.day])).toEqual([[1, 98], [2, 119]])
    expect(store().revisions[1]!.before.bac).toBeCloseTo(store().revisions[0]!.after.bac, 6)
  })
  it('개정은 최대 20번', async () => {
    await ready()
    // 20개를 직접 채워 상한 검사만 확인한다
    await compared()
    store().reviseWith('c1', '1')
    const r = store().revisions[0]!
    useAppStore.setState({ revisions: Array.from({ length: 20 }, (_, i) => ({ ...r, number: i + 1, day: i + 1 })) })
    store().setActuals([...store().actuals, ...rowsAt([105])])
    store().updateCandidate('c1', { day: 106 })
    store().updateCandidate('c2', { day: 106 })
    expect(await store().runActions(105)).toBeNull()
    expect(store().reviseWith('c1', '21번째')).toMatch(/최대 20번/)
  })
  it('마지막 개정을 되돌리면 그 전 기준선이 다시 쓰인다', async () => {
    await compared()
    store().reviseWith('c1', '개정')
    store().undoLastRevision()
    expect(store().revisions).toEqual([])
  })
  it('새로 채택하거나 해제하거나 채택한 시나리오를 지우면 개정 이력이 사라진다', async () => {
    await compared()
    store().reviseWith('c1', '개정')
    expect(store().adoptScenario('@base')).toBeNull()
    expect(store().revisions).toEqual([])
    await compared()
    store().reviseWith('c1', '개정')
    store().releaseAdoption()
    expect(store().revisions).toEqual([])
  })
  it('개정은 수정 상태를 만들고 저장·열기로 복원되며 새 프로젝트는 비운다', async () => {
    await compared()
    store().markSaved('x')
    store().reviseWith('c1', '개정 사유')
    const { selectIsDirty } = await import('./appStore')
    expect(selectIsDirty(store())).toBe(true)
    const file = store().buildProjectFile()
    expect(file.revisions).toHaveLength(1)
    store().markSaved('x')
    expect(selectIsDirty(store())).toBe(false)
    await store().newProject('integrated-project')
    expect(store().revisions).toEqual([])
    await store().loadProjectFile(file, 'x')
    expect(store().revisions).toHaveLength(1)
    expect(store().revisions[0]!.reason).toBe('개정 사유')
    expect(selectIsDirty(store())).toBe(false)
  })
  it('개정 이후 지표: 이후 보고일은 개정 기준선으로 계산한다', async () => {
    await compared()
    store().reviseWith('none', '재예측으로 재설정')
    const { buildControlView } = await import('../lib/control')
    const s = store()
    store().setActuals([...s.actuals, ...rowsAt([105, 112])])
    const s2 = store()
    const entry = getEntry('integrated-project')
    const view = buildControlView(s2.adopted, s2.actuals, { credits: evmOf(entry).credits, totalTasks: 400 }, s2.evm, { revisions: s2.revisions })
    expect(view.points.filter((p) => p.revision === 1).map((p) => p.day)).toEqual([105, 112])
    expect(view.points.filter((p) => p.revision === 0).length).toBe(14)
    const orig = buildControlView(s2.adopted, s2.actuals, { credits: evmOf(entry).credits, totalTasks: 400 }, s2.evm, { revisions: s2.revisions, original: true })
    expect(orig.points.every((p) => p.revision === 0)).toBe(true)
  })
})
