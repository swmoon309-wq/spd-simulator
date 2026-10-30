import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McRunner, lastOf, valueAt } from '@spd/analysis'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectModel } from '@spd/models'
import { useAppStore } from './appStore'
import { buildReport } from '../lib/report/build'
import { makeMissingResults, makeable } from '../lib/report/make'
import { reportStateFrom } from '../lib/report/actions'
import { renderReportHtml } from '../lib/report/render'
import { REPORT_KINDS, type ReportKind } from '../lib/report/model'

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
const DATE = new Date('2026-10-22T05:00:00.000Z')
const build = (kind: ReportKind, extra: Record<string, unknown> = {}) => buildReport(reportStateFrom('SPD 테스트'), { kind, date: DATE, ...extra })
const info = (r: ReturnType<typeof build>, id: string) => r.sections.find((s) => s.id === id)!
const json = (r: ReturnType<typeof build>) => JSON.stringify(r.doc)

const planRun = runModel(compileModel(integratedProjectModel))
const CREDITS = ['prod_tasks_developed', 'prod_tasks_qaed', 'prod_tasks_tested']
const planRows = (days: number[]) =>
  days.map((d) => ({ day: d, cum: Object.fromEntries(CREDITS.map((c) => [c, valueAt(planRun, c, d)])), effort: valueAt(planRun, 'ctl_cum_md', d), headcount: valueAt(planRun, 'hr_total', d) }))

beforeEach(async () => {
  ctl.mcCalls.length = 0
  ctl.mcFail = null
  ctl.mcGate = null
  ctl.mcChunk = 5
  await store().newProject('brooks')
  await settle()
})

describe('위험 분석 보고서 (RPT-04)', () => {
  it('위험 설정이 없으면 입력은 해당 없음, 결과는 없음이고 만들기 대상이다', () => {
    const r = build('risk')
    expect(info(r, 'riskInputs').status).toBe('na')
    expect(info(r, 'riskCompare').status).toBe('na')
    expect(info(r, 'riskResults').status).toBe('missing')
    expect(makeable('risk', r.sections)).toBe(true)
    expect(json(r)).not.toContain('P50')
  })

  it('결과가 있으면 가정 안내와 결과 절이 들어가고, 입력이 바뀌면 오래된 결과로 숫자를 숨긴다', async () => {
    store().setRiskIterations(40)
    store().addRiskInput('nominal_productivity')
    store().setRiskTargets([{ kpi: 'completionDay', op: '<=', value: 300 }])
    expect(await store().runRisk()).toBeNull()
    const fresh = build('risk')
    expect(info(fresh, 'riskResults').status).toBe('fresh')
    expect(fresh.doc.sections.map((s) => s.id)).toContain('riskResults')
    expect(json(fresh)).toContain('가정')
    expect(info(fresh, 'riskTargets').status).toBe('fresh')

    store().setRiskSeed(99) // 결과를 만든 조건과 달라진다
    const stale = build('risk')
    expect(info(stale, 'riskResults').status).toBe('stale')
    expect(stale.doc.sections.map((s) => s.id)).not.toContain('riskResults')
    const forced = build('risk', { sections: { riskResults: true }, includeStale: true })
    expect(forced.doc.sections.map((s) => s.id)).toContain('riskResults')
  })

  it('"필요한 결과 만들기"가 위험 분석과 민감도를 채우고 다시 만들 필요가 없으면 실행하지 않는다', async () => {
    store().setRiskIterations(30)
    store().addRiskInput('nominal_productivity')
    expect(await makeMissingResults('risk')).toEqual([])
    const r = build('risk')
    expect(info(r, 'riskResults').status).toBe('fresh')
    expect(info(r, 'riskSensitivity').status).toBe('fresh')
    const calls = ctl.mcCalls.length
    expect(await makeMissingResults('risk')).toEqual([])
    expect(ctl.mcCalls.length).toBe(calls)
    expect(makeable('risk', r.sections)).toBe(false)
  })

  it('불확실한 입력이 없으면 만들기가 이유를 알려 준다', async () => {
    expect((await makeMissingResults('risk'))[0]).toMatch(/불확실한 입력/)
  })

  it('HTML로 그려도 오류 없이 위험 절 제목이 들어간다', async () => {
    store().setRiskIterations(30)
    store().addRiskInput('nominal_productivity')
    await store().runRisk()
    const html = renderReportHtml(build('risk').doc)
    expect(html).toContain('<svg')
    expect(html).toContain('위험 분석')
  })
})

describe('상태 보고서 (RPT-05)', () => {
  it('채택·실적이 없으면 지표·재예측·조치 절은 해당 없음/없음이다', () => {
    const r = build('status')
    expect(r.doc.title).toContain('상태')
    expect(['missing', 'na']).toContain(info(r, 'statusIndicators').status)
    expect(info(r, 'statusActions').status).not.toBe('fresh')
    expect(makeable('status', r.sections)).toBe(false)
  })

  it('채택 + 실적이 있으면 지표·차트·경고가 최신으로 나오고 계획대로면 재예측은 기준일에 맞춘다', async () => {
    await store().newProject('integrated-project')
    await settle()
    await store().runScenarios('missing')
    expect(store().adoptScenario('@base')).toBeNull()
    store().setActuals(planRows([25, 50, 75, 100]))
    const r = build('status')
    expect(info(r, 'statusIndicators').status).toBe('fresh')
    expect(info(r, 'statusCharts').status).toBe('fresh')
    expect(json(r)).toContain('CPI')
    expect(await store().runReforecast(100)).toBeNull()
    const r2 = build('status')
    expect(info(r2, 'statusForecast').status).toBe('fresh')
    store().setActuals(planRows([25, 50, 75, 100, 110])) // 실적이 바뀌면 재예측은 오래된 결과
    expect(info(build('status'), 'statusForecast').status).toBe('stale')
  })

  it('보고일을 고르면 그 날의 지표를 쓴다', async () => {
    await store().newProject('integrated-project')
    await settle()
    await store().runScenarios('missing')
    store().adoptScenario('@base')
    store().setActuals(planRows([25, 50, 75]))
    expect(json(build('status', { reportDay: 50 }))).toContain('50')
    const html = renderReportHtml(build('status', { reportDay: 50 }).doc)
    expect(html).toContain('<svg')
  })

  it('모든 종류가 REPORT_KINDS에 등록되어 있고 빌드가 던지지 않는다', () => {
    for (const k of REPORT_KINDS) expect(() => build(k.kind)).not.toThrow()
    expect(REPORT_KINDS.map((k) => k.kind)).toEqual(['plan', 'scenarios', 'risk', 'status'])
  })
})

describe('모델 검증 절 (RPT-06)', () => {
  const kinds = REPORT_KINDS.map((k) => k.kind)

  it('아무것도 하지 않았으면 모든 종류에서 "없음"이고 기본으로 꺼진다', () => {
    for (const k of kinds) {
      const r = build(k)
      expect(info(r, 'validation').status).toBe('missing')
      expect(info(r, 'validation').enabled).toBe(false)
      expect(r.doc.sections.map((s) => s.id)).not.toContain('validation')
    }
  })

  it('구조 점검과 체크리스트가 있으면 기본으로 켜지고 확인하지 못한 것을 항상 싣는다', () => {
    expect(store().runStructure()).toBeNull()
    store().setChecklistEntry('dimensional-consistency', { status: 'ok', note: '단위 확인' })
    const r = build('plan')
    expect(info(r, 'validation').status).toBe('fresh')
    const sec = r.doc.sections.find((s) => s.id === 'validation')!
    const t = JSON.stringify(sec)
    expect(t).toContain('합격·불합격을 판정하지 않습니다')
    expect(t).toContain('확인하지 못한 것')
    expect(t).toContain('극단 조건 시험: 실행하지 않았습니다')
    expect(t).toContain('단위 확인')
    expect(t).toContain('구조 점검')
    expect(renderReportHtml(r.doc)).toContain('모델 검증')
  })

  it('입력이 바뀌어 구조 점검이 오래되면 싣지 않고 그 사실을 적는다', () => {
    store().runStructure()
    store().setParam('extra_people', 3)
    const r = build('scenarios')
    const t = JSON.stringify(r.doc.sections.find((s) => s.id === 'validation') ?? '')
    expect(t).not.toContain('구조 점검 —')
    expect(info(r, 'validation').status === 'missing' || t.includes('오래되었습니다')).toBe(true)
  })
})
