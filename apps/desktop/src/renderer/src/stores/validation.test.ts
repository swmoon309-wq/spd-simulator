import { beforeEach, describe, expect, it, vi } from 'vitest'
import { valueAt } from '@spd/analysis'
import { compileModel, runModel } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { getEntry } from '../catalog'
import { defaultValidationSettings, MAX_DATASETS, type Dataset } from '../lib/validation'
import { evaluateDataset } from '../lib/validationView'
import { BASE_ID, rowStatus, taskFor } from '../lib/scenarioRunner'
import { selectIsDirty, useAppStore } from './appStore'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {}
    })
  }
})

const store = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(store().status).toBe('idle'))

const ds = (id = 'd1', patch: Partial<Dataset> = {}): Dataset => ({
  id, name: `자료 ${id}`, fileName: `${id}.csv`, timeUnit: 'week', offsetDay: 0, actualCompletionDay: null,
  columns: [
    { name: 'cum_effort', variable: 'cum_effort', scale: 1, points: [[4, 100], [8, 300], [12, 600]] },
    { name: '메모', variable: null, scale: 1, points: [[1, 1]] }
  ],
  ...patch
})

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})

describe('데이터셋 관리', () => {
  it('처음에는 비어 있다', () => {
    expect(store().validation).toEqual(defaultValidationSettings())
    expect(store().validationActiveId).toBeNull()
  })

  it('데이터셋을 더하면 선택되고, 지우면 다음 것이 선택된다', () => {
    expect(store().addDataset(ds('d1'))).toBeNull()
    expect(store().addDataset(ds('d2'))).toBeNull()
    expect(store().validationActiveId).toBe('d2')
    store().removeDataset('d2')
    expect(store().validationActiveId).toBe('d1')
    store().removeDataset('d1')
    expect(store().validationActiveId).toBeNull()
    expect(store().validation.datasets).toEqual([])
  })

  it('개수·점 수·id 한도를 거절한다', () => {
    for (let i = 1; i <= MAX_DATASETS; i++) expect(store().addDataset(ds(`d${i}`))).toBeNull()
    expect(store().addDataset(ds('d9'))).toMatch(/최대 5개/)
    store().removeDataset('d5')
    expect(store().addDataset(ds('d1'))).toMatch(/겹칩니다/)
    const big = ds('d7', { columns: [{ name: 'x', variable: null, scale: 1, points: Array.from({ length: 50_000 }, (_, i) => [i, i] as [number, number]) }] })
    expect(store().addDataset(big)).toMatch(/합계/)
    expect(store().validation.datasets).toHaveLength(4)
  })

  it('이름·시간 단위·시간 이동·실제 완료일을 바꾼다(올바르지 않으면 바꾸지 않는다)', () => {
    store().addDataset(ds())
    expect(store().updateDataset('d1', { name: '새 이름', timeUnit: 'month', offsetDay: -14, actualCompletionDay: 280 })).toBeNull()
    expect(store().validation.datasets[0]).toMatchObject({ name: '새 이름', timeUnit: 'month', offsetDay: -14, actualCompletionDay: 280 })
    expect(store().updateDataset('d1', { name: '  ' })).toMatch(/이름/)
    expect(store().updateDataset('d1', { offsetDay: NaN })).toMatch(/시간 이동/)
    expect(store().updateDataset('d1', { actualCompletionDay: 0 })).toMatch(/실제 완료일/)
    expect(store().updateDataset('d1', { actualCompletionDay: null })).toBeNull()
    expect(store().validation.datasets[0]).toMatchObject({ name: '새 이름', offsetDay: -14, actualCompletionDay: null })
  })

  it('열의 변수와 배율을 바꾼다', () => {
    store().addDataset(ds())
    expect(store().setDatasetColumn('d1', 1, { variable: 'total_personnel' })).toBeNull()
    expect(store().validation.datasets[0]!.columns[1]!.variable).toBe('total_personnel')
    expect(store().setDatasetColumn('d1', 1, { variable: null })).toBeNull()
    expect(store().validation.datasets[0]!.columns[1]!.variable).toBeNull()
    expect(store().setDatasetColumn('d1', 0, { variable: 'nope' })).toMatch(/변수가 아닙니다/)
    expect(store().setDatasetColumn('d1', 0, { scale: 0 })).toMatch(/0보다/)
    expect(store().setDatasetColumn('d1', 0, { scale: 1000 })).toBeNull()
    expect(store().validation.datasets[0]!.columns[0]!.scale).toBe(1000)
  })

  it('허용 기준: 정하고 지우고, 올바르지 않으면 거절한다', () => {
    expect(store().setTolerance('nrmse', 0.15)).toBeNull()
    expect(store().validation.tolerances).toEqual({ nrmse: 0.15 })
    expect(store().setTolerance('nrmse', -1)).toMatch(/정규화 RMSE/)
    expect(store().validation.tolerances).toEqual({ nrmse: 0.15 })
    expect(store().setTolerance('nrmse', null)).toBeNull()
    expect(store().validation.tolerances).toEqual({})
  })

  it('비교 대상은 있는 시나리오만 고른다', () => {
    const id = store().addScenario()!
    store().setValidationTarget(id)
    expect(store().validation.targetScenarioId).toBe(id)
    store().setValidationTarget('gone')
    expect(store().validation.targetScenarioId).toBe(id)
    store().setValidationTarget(BASE_ID)
    expect(store().validation.targetScenarioId).toBe(BASE_ID)
  })
})

describe('저장·열기', () => {
  it('설정을 바꾸면 저장 안 됨, 저장하면 깨끗하고, 원래대로 되돌리면 다시 깨끗하다', () => {
    expect(selectIsDirty(store())).toBe(false)
    store().addDataset(ds())
    expect(selectIsDirty(store())).toBe(true)
    store().markSaved('a.spd.json')
    expect(selectIsDirty(store())).toBe(false)
    store().setTolerance('mre', 0.1)
    expect(selectIsDirty(store())).toBe(true)
    store().setTolerance('mre', null)
    expect(selectIsDirty(store())).toBe(false)
    store().setDatasetColumn('d1', 0, { scale: 2 })
    expect(selectIsDirty(store())).toBe(true)
  })

  it('활성 데이터셋을 바꾸는 것은 저장 안 됨이 아니다', () => {
    store().addDataset(ds('d1'))
    store().addDataset(ds('d2'))
    store().markSaved('a.spd.json')
    store().setValidationActive('d1')
    expect(selectIsDirty(store())).toBe(false)
  })

  it('저장했다가 열면 설정이 복원되고 첫 데이터셋이 선택된다', async () => {
    store().addDataset(ds('d1'))
    store().addDataset(ds('d2', { timeUnit: 'day', offsetDay: 5 }))
    store().setTolerance('nrmse', 0.2)
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    const saved = structuredClone(store().validation)
    await store().newProject('brooks')
    await settle()
    expect(store().validation).toEqual(defaultValidationSettings())
    expect(await store().loadProjectFile(file, 'v.spd.json')).toBe(true)
    await settle()
    expect(store().validation).toEqual(saved)
    expect(store().validationActiveId).toBe('d1')
    expect(selectIsDirty(store())).toBe(false)
    expect(store().notice).toBeNull()
  })

  it('고친 파일(모르는 변수)을 열면 연결만 풀고 경고한다', async () => {
    store().addDataset(ds())
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    file.validation.datasets[0].columns[0].variable = 'gone'
    expect(await store().loadProjectFile(file, 'v.spd.json')).toBe(true)
    await settle()
    expect(store().validation.datasets[0]!.columns[0]).toMatchObject({ variable: null, name: 'cum_effort' })
    expect(store().notice?.kind).toBe('warning')
    expect(store().notice?.details?.join(' ')).toContain("'gone'")
  })

  it('검증 도입 전 파일(validation 없음)은 처음 값으로 열린다', async () => {
    store().addDataset(ds())
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    delete file.validation
    expect(await store().loadProjectFile(file, 'v.spd.json')).toBe(true)
    await settle()
    expect(store().validation).toEqual(defaultValidationSettings())
    expect(store().validationActiveId).toBeNull()
  })

  it('새 프로젝트는 검증 설정을 비운다', async () => {
    store().addDataset(ds())
    await store().newProject('brooks')
    await settle()
    expect(store().validation).toEqual(defaultValidationSettings())
    expect(store().validationActiveId).toBeNull()
  })
})

describe('대상 시나리오 실행과 비교', () => {
  it('기준을 실행하면 같은 실행에서 뽑은 데이터가 완전 일치한다', async () => {
    const entry = getEntry('brooks')
    const base = runModel(compileModel(brooksModel), {})
    const points: [number, number][] = []
    for (let w = 1; w * 7 <= 200; w++) points.push([w, valueAt(base, 'cum_effort', w * 7)])
    store().addDataset(ds('d1', { columns: [{ name: 'cum_effort', variable: 'cum_effort', scale: 1, points }] }))

    await store().runScenarios('all', [BASE_ID])
    const s = store()
    const task = taskFor({ modelId: s.modelId, params: s.params, settings: s.runSettings, scenarios: s.scenarios }, BASE_ID)!
    expect(rowStatus(s.scenarioRuns[BASE_ID], task.key).kind).toBe('done')
    const result = s.scenarioRuns[BASE_ID]!.result!
    const ev = evaluateDataset(entry, result, s.validation.datasets[0]!, s.validation.tolerances, s.params)
    expect(ev.columns[0]!.metrics.rmse).toBeCloseTo(0, 6)
    expect(ev.columns[0]!.metrics.n).toBe(points.length)
  })

  it('시나리오를 대상으로 하면 그 시나리오의 유효 파라미터로 실행해 비교한다', async () => {
    const entry = getEntry('brooks')
    const actual = runModel(compileModel(brooksModel), { overrides: { extra_people: 10 } })
    const points: [number, number][] = []
    for (let w = 1; w * 7 <= 200; w++) points.push([w, valueAt(actual, 'total_personnel', w * 7)])
    store().addDataset(ds('d1', { columns: [{ name: 'p', variable: 'total_personnel', scale: 1, points }] }))
    const id = store().addScenario()!
    store().setScenarioOverride(id, 'extra_people', 10)

    store().setValidationTarget(BASE_ID)
    await store().runScenarios('all', [BASE_ID, id])
    const s = store()
    const onBase = evaluateDataset(entry, s.scenarioRuns[BASE_ID]!.result!, s.validation.datasets[0]!, {}, s.params).columns[0]!.metrics
    const onScenario = evaluateDataset(entry, s.scenarioRuns[id]!.result!, s.validation.datasets[0]!, {}, s.params).columns[0]!.metrics
    expect(onBase.rmse).toBeGreaterThan(1)
    expect(onScenario.rmse).toBeCloseTo(0, 6)
  })
})
