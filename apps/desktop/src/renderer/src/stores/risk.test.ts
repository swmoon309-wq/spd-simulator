import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { compareResults, lastOf, McRunner, runMonteCarlo, valueAt, type McResult } from '@spd/analysis'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { getEntry } from '../catalog'
import { busyReason, selectCompareStale, selectIsDirty, selectOatStale, selectRiskStale, selectSweepStale, useAppStore } from './appStore'

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
  mcCalls: [] as Record<string, unknown>[],
  mcFail: null as string | null,
  /** 값이 있으면 청크마다 이 Promise가 풀릴 때까지 기다린다(실행 중 상태를 붙잡는다) */
  mcGate: null as Promise<void> | null,
  mcChunk: 5,
  reforecastFail: null as string | null,
  reforecastHold: null as Promise<void> | null
}))

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  const { reforecast, reforecastAdapters } = await import('@spd/analysis')
  const { getCompiledModel } = await import('../engine/models')
  const { getEntry: getCatalogEntry } = await import('../catalog')
  return {
    startMonteCarlo: (req: { modelId: string; overrides: Record<string, number>; options: { end?: number; dt?: number }; inputs: never[]; n: number; seed: number; band?: { variable: string } | null }, onProgress: (c: number, t: number, snap?: unknown) => void) => {
      ctl.mcCalls.push(req as unknown as Record<string, unknown>)
      let canceled = false
      const promise = (async () => {
        if (ctl.mcFail) throw new Error(ctl.mcFail)
        const runner = new McRunner({ model: getCompiledModel(req.modelId), baseParams: req.overrides, options: req.options, inputs: req.inputs, n: req.n, seed: req.seed, kpis: getCatalogEntry(req.modelId).kpiSpecs, band: req.band ?? null })
        onProgress(0, req.n)
        while (!runner.done && !canceled) {
          runner.step(ctl.mcChunk)
          onProgress(runner.completed, req.n, runner.completed % 20 === 0 ? runner.result() : undefined)
          await (ctl.mcGate ?? new Promise<void>((r) => setTimeout(r, 0)))
        }
        return { result: runner.result(), canceled: !runner.done }
      })()
      return { promise, cancel: () => void (canceled = true) }
    },
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
const tri = { kind: 'triangular' as const, min: 0.08, mode: 0.1, max: 0.13 }

beforeEach(async () => {
  ctl.mcCalls.length = 0
  ctl.mcFail = null
  ctl.mcGate = null
  ctl.mcChunk = 5
  ctl.calls.length = 0
  await store().newProject('brooks')
  await settle()
  ctl.calls.length = 0
})

const openGates: { finish(): void }[] = []
afterEach(() => {
  // 실패한 시험이 붙잡아 둔 실행을 풀어 주고 취소해 다음 시험에 영향이 없게 한다.
  for (const g of openGates.splice(0)) g.finish()
  store().cancelRisk()
})

/** 청크마다 멈추게 하고 풀어 주는 도구 */
function gate() {
  let open!: () => void
  const make = () => new Promise<void>((r) => (open = r))
  ctl.mcGate = make()
  const handle = {
    /** 지금 기다리는 청크 하나를 풀고 다음 청크가 다시 기다릴 때까지 잠시 기다린다 */
    release: async () => {
      const o = open
      ctl.mcGate = make()
      o()
      await new Promise<void>((r) => setTimeout(r, 5))
    },
    finish: () => {
      const o = open
      ctl.mcGate = null
      o()
    }
  }
  openGates.push(handle)
  return handle
}

function ready(n = 40) {
  store().setRiskIterations(n)
  expect(store().addRiskInput('nominal_productivity')).toBeNull()
}

describe('위험 분석 설정', () => {
  it('처음 값: 기준 대상, 500회, 시드 1, 입력 없음', () => {
    expect(store().risk).toEqual({ scenarioId: '@base', n: 500, seed: 1, inputs: [], targets: [], bandVariable: null, compareIds: [] })
    expect(store().riskRun).toBeNull()
  })
  it('입력을 더하면 대상의 현재 값에서 만든 삼각 템플릿이 들어간다', () => {
    expect(store().addRiskInput('nominal_productivity')).toBeNull()
    const d = store().risk.inputs[0]!.dist
    expect(d).toEqual({ kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 })
  })
  it('정수 파라미터의 템플릿은 정수로 맞춘다', () => {
    store().addRiskInput('initial_experienced')
    const d = store().risk.inputs[0]!.dist
    expect(d.kind === 'triangular' && [d.min, d.mode, d.max].every((x) => Number.isInteger(x))).toBe(true)
  })
  it('같은 유효 파라미터를 만드는 대상(값이 같은 시나리오)은 같은 결과이므로 오래된 것이 아니다', async () => {
    store().setRiskIterations(20)
    store().addRiskInput('nominal_productivity')
    await store().runRisk()
    const id = store().addScenario()!
    store().setRiskScenario(id) // 기준과 같은 값
    expect(selectRiskStale(store())).toBe(false)
  })
  it('대상 시나리오의 값에서 템플릿을 만든다', () => {
    const id = store().addScenario()!
    store().setScenarioOverride(id, 'nominal_productivity', 0.2)
    store().setRiskScenario(id)
    store().addRiskInput('nominal_productivity')
    const d = store().risk.inputs[0]!.dist
    expect(d.kind === 'triangular' && d.mode).toBeCloseTo(0.2, 12)
  })
  it('중복·모르는 이름·상한을 거절한다', () => {
    expect(store().addRiskInput('nominal_productivity')).toBeNull()
    expect(store().addRiskInput('nominal_productivity')).toMatch(/이미 추가/)
    expect(store().addRiskInput('nope')).toMatch(/입력 항목이 아닙니다/)
    expect(store().risk.inputs).toHaveLength(1)
  })
  it('통합 모델에서는 12개까지', async () => {
    await store().newProject('integrated-project')
    await settle()
    const names = ['total_tasks', 'plan_known_fraction', 'planned_duration_days', 'initial_pros', 'initial_new', 'max_staff', 'hiring_delay', 'assim_delay', 'pro_prod', 'new_prod', 'max_boost', 'prod_calibration']
    for (const n of names) expect(store().addRiskInput(n)).toBeNull()
    expect(store().addRiskInput('comm_coeff')).toMatch(/최대 12개/)
    expect(store().risk.inputs).toHaveLength(12)
  })
  it('수정·삭제·목표·시계열 변수·시드·반복 수', () => {
    store().addRiskInput('nominal_productivity')
    store().updateRiskInput('nominal_productivity', { kind: 'uniform', min: 0.05, max: 0.2 })
    expect(store().risk.inputs[0]!.dist).toEqual({ kind: 'uniform', min: 0.05, max: 0.2 })
    store().setRiskTargets([{ kpi: 'completionDay', op: '<=', value: 300 }])
    store().setRiskBand('developed_software')
    store().setRiskSeed(7)
    store().setRiskIterations(1000)
    expect(store().risk).toMatchObject({ targets: [{ kpi: 'completionDay', op: '<=', value: 300 }], bandVariable: 'developed_software', seed: 7, n: 1000 })
    store().setRiskIterations(NaN)
    store().setRiskSeed(Infinity)
    expect(store().risk).toMatchObject({ seed: 7, n: 1000 })
    store().removeRiskInput('nominal_productivity')
    expect(store().risk.inputs).toEqual([])
  })
  it('없는 시나리오는 대상으로 고르지 않는다', () => {
    store().setRiskScenario('nope')
    expect(store().risk.scenarioId).toBe('@base')
  })
})

describe('실행 전 검사', () => {
  it.each([
    ['입력 없음', () => store().setRiskIterations(100), '하나 이상'],
    ['반복 수가 작음', () => (ready(), store().setRiskIterations(10)), '20 ~ 5000'],
    ['반복 수가 큼', () => (ready(), store().setRiskIterations(5001)), '20 ~ 5000'],
    ['반복 수가 소수', () => (ready(), store().setRiskIterations(50.5)), '20 ~ 5000'],
    ['시드가 음수', () => (ready(), store().setRiskSeed(-1)), '시드'],
    ['분포 오류', () => (ready(), store().updateRiskInput('nominal_productivity', { kind: 'triangular', min: 1, mode: 0.5, max: 2 })), '최소 ≤ 최빈 ≤ 최대'],
    ['분포가 허용 범위 밖', () => (ready(), store().updateRiskInput('nominal_productivity', { kind: 'uniform', min: 0, max: 1 })), '허용 범위'],
    ['없는 시계열 변수', () => (ready(), store().setRiskBand('nope')), '시계열 변수'],
    ['없는 목표 지표', () => (ready(), store().setRiskTargets([{ kpi: 'nope', op: '<=', value: 1 }])), '목표의 지표']
  ])('거절: %s', async (_n, setup, msg) => {
    setup()
    const r = await store().runRisk()
    expect(r).toContain(msg)
    expect(ctl.mcCalls).toHaveLength(0)
    expect(store().riskRun).toBeNull()
  })
})

describe('실행', () => {
  it('끝까지 실행하면 done이고 직접 실행한 결과와 같다', async () => {
    ready(40)
    expect(await store().runRisk()).toBeNull()
    const run = store().riskRun!
    expect(run.status).toBe('done')
    expect(run.completed).toBe(40)
    expect(run.total).toBe(40)
    expect(run.partial).toBeNull()
    expect(run.error).toBeNull()
    const direct = runMonteCarlo({
      model: compileModel(brooksModel),
      baseParams: store().params,
      options: { end: store().runSettings.end, dt: store().runSettings.dt },
      inputs: [{ name: 'nominal_productivity', dist: tri, min: 0.001, max: 10 }],
      n: 40,
      seed: 1,
      kpis: getEntry('brooks').kpiSpecs
    })
    expect(Array.from(run.result!.kpis[0] as Float64Array)).toEqual(Array.from(direct.kpis[0] as Float64Array))
  })
  it('Worker 요청에 대상 파라미터·실행 설정·입력(허용 범위 포함)·반복 수·시드가 들어간다', async () => {
    ready(30)
    store().setRiskSeed(9)
    store().setRunSetting('end', 350)
    await store().runRisk()
    const req = ctl.mcCalls[0] as { modelId: string; overrides: Record<string, number>; options: unknown; inputs: unknown[]; n: number; seed: number; band: unknown }
    expect(req.modelId).toBe('brooks')
    expect(req.overrides).toEqual(store().params)
    expect(req.options).toEqual({ end: 350, dt: 0.25 })
    expect(req.inputs).toEqual([{ name: 'nominal_productivity', dist: tri, min: 0.001, max: 10 }])
    expect(req.n).toBe(30)
    expect(req.seed).toBe(9)
    expect(req.band).toBeNull()
  })
  it('정수 입력은 integer 표시를 붙여 보낸다', async () => {
    store().setRiskIterations(20)
    store().addRiskInput('initial_experienced')
    await store().runRisk()
    expect((ctl.mcCalls[0] as { inputs: { integer?: boolean }[] }).inputs[0]!.integer).toBe(true)
  })
  it('대상이 시나리오이면 그 유효 파라미터로 실행한다', async () => {
    const id = store().addScenario()!
    store().setScenarioOverride(id, 'extra_people', 5)
    store().setRiskScenario(id)
    ready(20)
    await store().runRisk()
    expect((ctl.mcCalls[0] as { overrides: Record<string, number> }).overrides['extra_people']).toBe(5)
    const base = runMonteCarlo({ model: compileModel(brooksModel), baseParams: store().params, options: {}, inputs: [{ name: 'nominal_productivity', dist: tri, min: 0.001, max: 10 }], n: 20, seed: 1, kpis: getEntry('brooks').kpiSpecs })
    const sc = store().riskRun!.result!
    expect((sc.kpis[0] as Float64Array)[0]).toBeLessThan((base.kpis[0] as Float64Array)[0]!) // 인력 보강은 일찍 끝남
  })
  it('시계열 띠를 요청하면 전달하고 결과에 담긴다', async () => {
    ready(20)
    store().setRiskBand('developed_software')
    await store().runRisk()
    expect(store().riskRun!.result!.band?.variable).toBe('developed_software')
  })
  it('진행 중에는 completed가 늘고 중간 결과가 오며, 끝나면 partial은 비워진다', async () => {
    ready(60)
    const g = gate()
    const done = store().runRisk()
    await vi.waitFor(() => expect(store().riskRun?.status).toBe('running'))
    expect(store().riskRun).toMatchObject({ total: 60 })
    await vi.waitFor(() => expect(store().riskRun!.completed).toBeGreaterThan(0))
    const c1 = store().riskRun!.completed
    for (let i = 0; i < 4; i++) await g.release()
    await vi.waitFor(() => expect(store().riskRun!.completed).toBeGreaterThan(c1))
    await vi.waitFor(() => expect(store().riskRun!.partial).not.toBeNull())
    expect(store().riskRun!.partial!.completed % 20).toBe(0)
    g.finish()
    await done
    expect(store().riskRun!.status).toBe('done')
    expect(store().riskRun!.partial).toBeNull()
  })
  it('취소하면 canceled이고 끝난 반복이 전체의 앞부분과 같다', async () => {
    ready(100)
    const g = gate()
    const done = store().runRisk()
    await vi.waitFor(() => expect(store().riskRun?.status).toBe('running'))
    await g.release()
    await g.release()
    await vi.waitFor(() => expect(store().riskRun!.completed).toBeGreaterThanOrEqual(10))
    store().cancelRisk()
    g.finish()
    expect(await done).toBeNull()
    const run = store().riskRun!
    expect(run.status).toBe('canceled')
    expect(run.result!.completed).toBeLessThan(100)
    expect(run.result!.completed).toBeGreaterThanOrEqual(10)
    expect(run.completed).toBe(run.result!.completed)
    const full = runMonteCarlo({ model: compileModel(brooksModel), baseParams: store().params, options: {}, inputs: [{ name: 'nominal_productivity', dist: tri, min: 0.001, max: 10 }], n: 100, seed: 1, kpis: getEntry('brooks').kpiSpecs })
    expect(Array.from(run.result!.kpis[0] as Float64Array)).toEqual(Array.from(full.kpis[0] as Float64Array).slice(0, run.result!.completed))
  })
  it('Worker 오류는 error 상태와 메시지로 남고 다시 실행할 수 있다', async () => {
    ready(20)
    ctl.mcFail = '모의 오류'
    expect(await store().runRisk()).toBe('모의 오류')
    expect(store().riskRun).toMatchObject({ status: 'error', error: '모의 오류' })
    ctl.mcFail = null
    expect(await store().runRisk()).toBeNull()
    expect(store().riskRun!.status).toBe('done')
  })
  it('결과 지우기', async () => {
    ready(20)
    await store().runRisk()
    store().clearRiskRun()
    expect(store().riskRun).toBeNull()
  })
})

describe('다른 실행과의 상호 배제', () => {
  it('위험 분석이 실행 중이면 새 시뮬레이션·일괄 실행·재예측·조치 시험·위험 분석을 시작하지 않는다', async () => {
    ready(60)
    const g = gate()
    const done = store().runRisk()
    await vi.waitFor(() => expect(store().riskRun?.status).toBe('running'))
    expect(busyReason(store())).toMatch(/위험 분석/)
    ctl.calls.length = 0
    await store().run()
    expect(store().status).toBe('idle')
    expect(await store().runScenarios('all')).toBeNull()
    expect(await store().runRisk()).toMatch(/위험 분석이 실행 중/)
    expect(await store().runReforecast(50)).toBeTruthy()
    expect(await store().runActions(50)).toBeTruthy()
    expect(ctl.calls).toHaveLength(0)
    expect(ctl.mcCalls).toHaveLength(1)
    g.finish()
    await done
    expect(busyReason(store())).toBeNull()
  })
  it('시뮬레이션·일괄 실행이 진행 중이면 위험 분석을 시작하지 않는다', async () => {
    ready(20)
    useAppStore.setState({ status: 'running' })
    expect(await store().runRisk()).toMatch(/시뮬레이션이 실행 중/)
    useAppStore.setState({ status: 'idle', batch: { total: 2, done: 0 } })
    expect(await store().runRisk()).toMatch(/일괄 실행/)
    useAppStore.setState({ batch: null })
    expect(ctl.mcCalls).toHaveLength(0)
    expect(await store().runRisk()).toBeNull()
  })
  it('재예측·조치 시험이 진행 중이면 위험 분석을 시작하지 않는다', async () => {
    ready(20)
    useAppStore.setState({ reforecast: { key: 'k', day: 1, status: 'running', outcome: null, error: null } })
    expect(await store().runRisk()).toMatch(/재예측 또는 조치 시험/)
    useAppStore.setState({ reforecast: null })
  })
  it('실행이 끝나면 다시 실행할 수 있다', async () => {
    ready(20)
    await store().runRisk()
    expect(busyReason(store())).toBeNull()
    await store().run()
    expect(store().runs.length).toBeGreaterThan(0)
  })
})

describe('오래됨 키', () => {
  async function ran() {
    ready(20)
    await store().runRisk()
    expect(selectRiskStale(store())).toBe(false)
  }
  it('결과가 없으면 오래된 것이 아니다', () => {
    expect(selectRiskStale(store())).toBe(false)
  })
  it.each([
    ['기본 설정의 파라미터', () => store().setParam('initial_experienced', 22)],
    ['반복 수', () => store().setRiskIterations(25)],
    ['시드', () => store().setRiskSeed(2)],
    ['입력 분포', () => store().updateRiskInput('nominal_productivity', { kind: 'uniform', min: 0.05, max: 0.2 })],
    ['입력 추가', () => store().addRiskInput('initial_experienced')],
    ['시계열 변수', () => store().setRiskBand('developed_software')],
    ['종료 시각', () => store().setRunSetting('end', 300)],
    ['대상 시나리오의 값', () => {
      const id = store().addScenario()!
      store().setScenarioOverride(id, 'extra_people', 5)
      store().setRiskScenario(id)
    }]
  ])('바뀌면 오래된 결과가 된다: %s', async (_n, change) => {
    await ran()
    change()
    expect(selectRiskStale(store())).toBe(true)
  })
  it('목표·실행과 무관한 변경은 오래된 것이 아니다(목표는 해석만 바꾼다)', async () => {
    await ran()
    store().setRiskTargets([{ kpi: 'completionDay', op: '<=', value: 300 }])
    store().setChartVariable('total_personnel')
    expect(selectRiskStale(store())).toBe(false)
  })
  it('원래대로 되돌리면 다시 최신', async () => {
    await ran()
    store().setRiskSeed(5)
    expect(selectRiskStale(store())).toBe(true)
    store().setRiskSeed(1)
    expect(selectRiskStale(store())).toBe(false)
  })
})

describe('프로젝트 전환', () => {
  it('새 프로젝트는 설정과 결과를 비운다', async () => {
    ready(20)
    await store().runRisk()
    await store().newProject('brooks')
    expect(store().risk).toEqual({ scenarioId: '@base', n: 500, seed: 1, inputs: [], targets: [], bandVariable: null, compareIds: [] })
    expect(store().riskRun).toBeNull()
  })
  it('실행 중에 새 프로젝트를 시작하면 취소하고 끝날 때까지 기다린 뒤 비운다', async () => {
    ready(200)
    const g = gate()
    const done = store().runRisk()
    await vi.waitFor(() => expect(store().riskRun?.status).toBe('running'))
    const switching = store().newProject('brooks')
    g.finish()
    await switching
    await done
    expect(store().riskRun).toBeNull()
    expect(store().risk.inputs).toEqual([])
  })
  it('프로젝트를 열면 위험 분석 결과를 비운다', async () => {
    ready(20)
    await store().runRisk()
    const file = store().buildProjectFile()
    await store().loadProjectFile(file, 'x')
    expect(store().riskRun).toBeNull()
  })
  it('위험 분석 설정은 수정 상태를 만들고 파일에 들어가지만 결과·실행 상태는 들어가지 않는다', async () => {
    store().markSaved('x')
    ready(20)
    store().setRiskSeed(3)
    expect(selectIsDirty(store())).toBe(true)
    await store().runRisk()
    const json = JSON.stringify(store().buildProjectFile())
    expect(json).toContain('"risk"')
    expect(json).toContain('triangular')
    expect(json).not.toContain('riskRun')
    expect(json).not.toContain('"partial"')
  })
})

describe('시나리오 간 비교', () => {
  /** 기준과 "추가 인원 10" 시나리오를 만들어 둘을 비교 대상으로 고른다. */
  function twoTargets() {
    const id = store().addScenario()!
    store().setScenarioOverride(id, 'extra_people', 10)
    expect(store().toggleRiskCompare('@base')).toBeNull()
    expect(store().toggleRiskCompare(id)).toBeNull()
    return id
  }

  it('고르고 빼며 최대 3개까지, 모르는 시나리오는 거절한다', () => {
    const a = store().addScenario()!
    const b = store().addScenario()!
    const c = store().addScenario()!
    for (const id of ['@base', a, b]) expect(store().toggleRiskCompare(id)).toBeNull()
    expect(store().toggleRiskCompare(c)).toMatch(/최대 3개/)
    expect(store().toggleRiskCompare(a)).toBeNull() // 빼기
    expect(store().risk.compareIds).toEqual(['@base', b])
    expect(store().toggleRiskCompare(c)).toBeNull()
    expect(store().toggleRiskCompare('없는-id')).toMatch(/찾을 수 없/)
  })

  it('2개 미만이거나 입력이 없으면 실행하지 않는다', async () => {
    store().toggleRiskCompare('@base')
    expect(await store().runRiskCompare()).toMatch(/2개 이상/)
    store().toggleRiskCompare('@base')
    twoTargets()
    expect(await store().runRiskCompare()).toMatch(/입력을 하나 이상/)
    expect(ctl.mcCalls).toHaveLength(0)
    expect(store().riskCompare).toBeNull()
  })

  it('같은 표본으로 시나리오마다 한 번씩 실행하고 쌍별 비교가 된다', async () => {
    ready(30)
    const id = twoTargets()
    expect(await store().runRiskCompare()).toBeNull()
    const run = store().riskCompare!
    expect(run.status).toBe('done')
    expect(run.results.map((r) => r.id)).toEqual(['@base', id])
    expect(ctl.mcCalls).toHaveLength(2)
    expect(ctl.mcCalls[0]!.overrides).not.toEqual(ctl.mcCalls[1]!.overrides)
    expect(ctl.mcCalls[0]!.seed).toBe(ctl.mcCalls[1]!.seed)
    const [a, b] = run.results.map((r) => r.result) as [McResult, McResult]
    expect(Array.from(a.inputs[0]!)).toEqual(Array.from(b.inputs[0]!)) // 공통난수
    expect(() => compareResults(a, b, 'completionDay')).not.toThrow()
    expect(selectCompareStale(store())).toBe(false)
  })

  it('취소하면 끝나지 않은 시나리오는 버리고 끝난 것만 남긴다', async () => {
    ready(40)
    twoTargets()
    const g = gate()
    const done = store().runRiskCompare()
    await vi.waitFor(() => expect(store().riskCompare?.status).toBe('running'))
    expect(busyReason(store())).toMatch(/위험 분석/)
    expect(await store().runRisk()).toMatch(/위험 분석이 실행 중/)
    store().cancelRisk()
    g.finish()
    await done
    expect(store().riskCompare?.status).toBe('canceled')
    expect(store().riskCompare?.results).toHaveLength(0)
    expect(ctl.mcCalls).toHaveLength(1) // 두 번째 시나리오는 시작하지 않았다
    expect(busyReason(store())).toBeNull()
  })

  it('입력이 바뀌면 오래됨, 새 프로젝트는 비운다', async () => {
    ready(20)
    twoTargets()
    await store().runRiskCompare()
    expect(selectCompareStale(store())).toBe(false)
    store().setRiskSeed(7)
    expect(selectCompareStale(store())).toBe(true)
    await store().newProject('brooks')
    await settle()
    expect(store().riskCompare).toBeNull()
    expect(store().risk.compareIds).toEqual([])
  })

  it('수치 오류는 상태에 남기고 이유를 돌려준다', async () => {
    ready(20)
    twoTargets()
    ctl.mcFail = '고장'
    expect(await store().runRiskCompare()).toBe('고장')
    expect(store().riskCompare).toMatchObject({ status: 'error', error: '고장' })
  })
})

describe('민감도', () => {
  it('입력이 없으면 토네이도를 계산하지 않는다', () => {
    expect(store().runRiskOat()).toMatch(/입력을 하나 이상/)
    expect(store().riskSens.oat).toBeNull()
  })

  it('토네이도는 입력마다 낮은/높은 값으로 즉시 계산한다', () => {
    store().addRiskInput('nominal_productivity')
    store().addRiskInput('extra_people')
    expect(store().runRiskOat()).toBeNull()
    const oat = store().riskSens.oat!
    const list = oat.result.entries.completionDay!
    expect(list.map((e) => e.name).sort()).toEqual(['extra_people', 'nominal_productivity'])
    expect(list[0]!.swing!).toBeGreaterThanOrEqual(list[1]!.swing!)
    expect(selectOatStale(store())).toBe(false)
    store().updateRiskInput('nominal_productivity', { kind: 'triangular', min: 0.05, mode: 0.1, max: 0.2 })
    expect(selectOatStale(store())).toBe(true)
  })

  it('스윕은 범위·수준을 검사하고 곡선을 낸다', () => {
    expect(store().runRiskSweep({ name: 'nope', min: 0, max: 1, k: 5 })).toMatch(/입력 항목이 아닙니다/)
    expect(store().runRiskSweep({ name: 'nominal_productivity', min: 0.2, max: 0.1, k: 5 })).toMatch(/커야/)
    expect(store().runRiskSweep({ name: 'nominal_productivity', min: 0.0001, max: 0.2, k: 5 })).toMatch(/허용 범위/)
    expect(store().runRiskSweep({ name: 'nominal_productivity', min: 0.05, max: 0.2, k: 5 })).toBeNull()
    const sw = store().riskSens.sweep!
    expect(sw.result.levels).toHaveLength(5)
    expect(sw.result.values.completionDay).toHaveLength(5)
    expect(selectSweepStale(store())).toBe(false)
    store().setParam('extra_people', 3)
    expect(selectSweepStale(store())).toBe(true)
  })

  it('다른 실행이 진행 중이면 계산하지 않는다', () => {
    store().addRiskInput('nominal_productivity')
    useAppStore.setState({ status: 'running' })
    expect(store().runRiskOat()).toMatch(/시뮬레이션이 실행 중/)
    expect(store().runRiskSweep({ name: 'nominal_productivity', min: 0.05, max: 0.2, k: 5 })).toMatch(/시뮬레이션이 실행 중/)
    useAppStore.setState({ status: 'idle' })
  })
})

describe('프로젝트 파일 저장·열기', () => {
  it('설정을 바꾸면 저장 안 됨, 저장하면 깨끗해지고, 처음 값으로 돌리면 다시 같다', () => {
    expect(selectIsDirty(store())).toBe(false)
    store().addRiskInput('nominal_productivity')
    expect(selectIsDirty(store())).toBe(true)
    store().markSaved('a.spd.json')
    expect(selectIsDirty(store())).toBe(false)
    store().setRiskSeed(5)
    expect(selectIsDirty(store())).toBe(true)
    store().setRiskSeed(1)
    expect(selectIsDirty(store())).toBe(false)
    store().setRiskTargets([{ kpi: 'completionDay', op: '<=', value: 300 }])
    expect(selectIsDirty(store())).toBe(true)
  })

  it('실행 결과가 있어도 결과만으로는 저장 안 됨이 되지 않는다', async () => {
    ready(20)
    store().markSaved('a.spd.json')
    await store().runRisk()
    expect(store().riskRun?.status).toBe('done')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('저장했다가 열면 설정이 복원되고 같은 시드로 같은 결과가 나온다(결과는 저장하지 않는다)', async () => {
    store().setRiskIterations(30)
    store().setRiskSeed(11)
    store().addRiskInput('nominal_productivity')
    store().addRiskInput('hire_day')
    store().setRiskTargets([{ kpi: 'completionDay', op: '<=', value: 300 }])
    store().setRiskBand('cum_effort')
    await store().runRisk()
    const first = store().riskRun!.result!
    const settings = structuredClone(store().risk)
    const file = JSON.parse(JSON.stringify(store().buildProjectFile())) // 파일을 거쳐 온 것처럼
    expect(JSON.stringify(file)).not.toContain('"status"') // 결과·상태는 담기지 않는다

    await store().newProject('brooks')
    await settle()
    expect(store().riskRun).toBeNull()
    expect(await store().loadProjectFile(file, 'b.spd.json')).toBe(true)
    await settle()
    expect(store().risk).toEqual(settings)
    expect(store().riskRun).toBeNull()
    expect(selectIsDirty(store())).toBe(false)
    expect(store().notice).toBeNull()

    await store().runRisk()
    const again = store().riskRun!.result!
    expect(Array.from(again.kpis[0]!)).toEqual(Array.from(first.kpis[0]!))
    expect(Array.from(again.inputs[0]!)).toEqual(Array.from(first.inputs[0]!))
  })

  it('고친 파일(모르는 입력)을 열면 버리고 경고를 알린다', async () => {
    store().addRiskInput('nominal_productivity')
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    file.risk.inputs.push({ name: 'nope', dist: { kind: 'uniform', min: 0, max: 1 } })
    expect(await store().loadProjectFile(file, 'c.spd.json')).toBe(true)
    await settle()
    expect(store().risk.inputs.map((i) => i.name)).toEqual(['nominal_productivity'])
    expect(store().notice?.kind).toBe('warning')
    expect(store().notice?.details?.join(' ')).toContain("'nope'")
  })

  it('위험 분석 도입 전 파일(risk 없음)은 처음 값으로 열린다', async () => {
    store().addRiskInput('nominal_productivity')
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    delete file.risk
    expect(await store().loadProjectFile(file, 'd.spd.json')).toBe(true)
    await settle()
    expect(store().risk.inputs).toEqual([])
  })
})
