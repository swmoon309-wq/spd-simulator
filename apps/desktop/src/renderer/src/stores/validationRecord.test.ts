import { beforeEach, describe, expect, it, vi } from 'vitest'
import { valueAt } from '@spd/analysis'
import { compileModel, runModel } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { BASE_ID } from '../lib/scenarioRunner'
import { defaultValidationSettings, MAX_CHECKLIST_NOTE, type Dataset } from '../lib/validation'
import { selectIsDirty, selectStructureStale, useAppStore } from './appStore'

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

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})

/** 같은 실행에서 뽑은 데이터셋(완전 일치) */
function matchingDataset(): Dataset {
  const base = runModel(compileModel(brooksModel), {})
  const points: [number, number][] = []
  for (let w = 1; w * 7 <= 200; w++) points.push([w, valueAt(base, 'cum_effort', w * 7)])
  return { id: 'd1', name: '실제', fileName: 'a.csv', timeUnit: 'week', offsetDay: 0, actualCompletionDay: null, columns: [{ name: 'e', variable: 'cum_effort', scale: 1, points }] }
}

describe('구조 점검 실행', () => {
  it('Brooks는 여섯 점검이 모두 통과한다', () => {
    expect(store().runStructure()).toBeNull()
    const run = store().validationStructure!
    expect(run.report.runError).toBeNull()
    expect(run.report.findings.map((f) => [f.id, f.status])).toEqual([['S1', 'pass'], ['S2', 'pass'], ['S3', 'pass'], ['S4', 'pass'], ['S5', 'pass'], ['S6', 'pass']])
    expect(selectStructureStale(store())).toBe(false)
  })

  it('통합 모델: S4만 주의다 — 잔존 결함 지표가 dt에 1.3% 민감하다(완료일은 0.04%). 나머지는 통과하고 S5의 오탐이 없다', async () => {
    await store().newProject('integrated-project')
    await settle()
    expect(store().runStructure()).toBeNull()
    const f = store().validationStructure!.report.findings
    expect(f.map((x) => x.status)).toEqual(['pass', 'pass', 'pass', 'warn', 'pass', 'pass'])
    const s4 = f.find((x) => x.id === 'S4')!
    expect(s4.items.join('\n')).toContain('잔존 결함')
    expect(s4.items.join('\n')).not.toContain('완료일')
  })

  it('입력이 바뀌면 오래됨, 대상이 바뀌어도 오래됨', () => {
    store().runStructure()
    store().setParam('extra_people', 3)
    expect(selectStructureStale(store())).toBe(true)
    store().runStructure()
    expect(selectStructureStale(store())).toBe(false)
    const id = store().addScenario()!
    store().setScenarioOverride(id, 'initial_experienced', 40)
    store().setValidationTarget(id)
    expect(selectStructureStale(store())).toBe(true)
  })

  it('입력 오류가 있으면 실행하지 않는다', () => {
    store().setParamError('extra_people', '범위 밖')
    expect(store().runStructure()).toMatch(/입력 오류/)
    expect(store().validationStructure).toBeNull()
  })

  it('새 프로젝트는 비운다', async () => {
    store().runStructure()
    await store().newProject('brooks')
    await settle()
    expect(store().validationStructure).toBeNull()
  })
})

describe('체크리스트', () => {
  it('상태와 메모를 바꾸고, 처음 상태로 돌리면 목록에서 빠진다', () => {
    expect(store().setChecklistEntry('face-validity', { status: 'ok', note: '검토 완료' })).toBeNull()
    expect(store().validation.checklist).toEqual([{ id: 'face-validity', status: 'ok', note: '검토 완료' }])
    expect(store().setChecklistEntry('face-validity', { status: 'unchecked', note: '' })).toBeNull()
    expect(store().validation.checklist).toEqual([])
  })
  it('알 수 없는 항목과 너무 긴 메모는 거절한다', () => {
    expect(store().setChecklistEntry('nope', { status: 'ok' })).toMatch(/알 수 없는/)
    expect(store().setChecklistEntry('face-validity', { note: 'x'.repeat(MAX_CHECKLIST_NOTE + 1) })).toMatch(/500자/)
    expect(store().validation.checklist).toEqual([])
  })
  it('체크리스트를 바꾸면 저장 안 됨이 되고, 저장하면 깨끗하며, 원래대로 되돌리면 다시 깨끗하다', () => {
    expect(selectIsDirty(store())).toBe(false)
    store().setChecklistEntry('face-validity', { status: 'ok' })
    expect(selectIsDirty(store())).toBe(true)
    store().markSaved('a.spd.json')
    expect(selectIsDirty(store())).toBe(false)
    store().setChecklistEntry('face-validity', { note: '메모' })
    expect(selectIsDirty(store())).toBe(true)
    store().setChecklistEntry('face-validity', { status: 'unchecked', note: '' })
    expect(selectIsDirty(store())).toBe(true) // 저장한 상태(확인)와 다르다
  })
})

describe('검증 기록', () => {
  it('아무 내용이 없으면 만들지 않고 이유를 알린다', () => {
    const r = store().makeRecord()
    expect(r.reason).toMatch(/기록할 내용이 없습니다/)
    expect(store().validation.report).toBeNull()
  })

  it('구조 점검만으로도 만들 수 있고, 하지 않은 영역은 비어 있다', () => {
    store().runStructure()
    const r = store().makeRecord()
    expect(r.reason).toBeNull()
    expect(r.contents).toMatchObject({ structure: true, extremes: false, datasets: 0, checklist: 0 })
    const rec = store().validation.report!
    expect(rec.model).toEqual({ id: 'brooks', version: 1 })
    expect(rec.target).toEqual({ id: '@base', name: '기준' })
    expect(rec.run).toEqual({ end: 400, dt: 0.25, seed: 1 })
    expect(rec.structure).toHaveLength(6)
    expect(rec.extremes).toBeNull()
    expect(rec.data).toEqual([])
    expect(Date.parse(rec.generatedAt)).not.toBeNaN()
  })

  it('모든 영역을 담는다(데이터 비교·극단 조건·구조 점검·체크리스트)', async () => {
    store().addDataset(matchingDataset())
    store().setTolerance('nrmse', 0.05)
    await store().runScenarios('all', [BASE_ID])
    await store().runExtremes()
    store().runStructure()
    store().setChecklistEntry('face-validity', { status: 'ok', note: '검토' })
    const r = store().makeRecord()
    expect(r.contents).toEqual({ datasets: 1, dataMissing: false, extremes: true, extremesStale: false, structure: true, structureStale: false, checklist: 1, presets: 0 })
    const rec = store().validation.report!
    expect(rec.data[0]!.columns[0]).toMatchObject({ name: 'e', variable: 'cum_effort', status: { nrmse: 'in' } })
    expect(rec.data[0]!.columns[0]!.rmse!).toBeLessThan(1e-6)
    expect(rec.extremes).toMatchObject({ total: 42, counts: { fail: 0 } })
    expect(rec.checklist).toEqual([{ id: 'face-validity', status: 'ok', note: '검토' }])
    expect(rec.tolerances).toEqual({ nrmse: 0.05 })
    expect(selectIsDirty(store())).toBe(true) // 기록도 프로젝트에 남는다
  })

  it('오래된 결과는 기록에 넣지 않고 알린다', async () => {
    store().addDataset(matchingDataset())
    await store().runScenarios('all', [BASE_ID])
    await store().runExtremes()
    store().runStructure()
    store().setParam('extra_people', 3) // 입력이 바뀌어 셋 다 오래됨
    const r = store().makeRecord()
    expect(r.contents).toMatchObject({ datasets: 0, dataMissing: true, extremes: false, extremesStale: true, structure: false, structureStale: true })
    expect(r.reason).toMatch(/기록할 내용이 없습니다/) // 체크리스트도 없으므로
    expect(store().validation.report).toBeNull()
    store().setChecklistEntry('audience-fit', { status: 'ok' })
    expect(store().makeRecord().reason).toBeNull() // 체크리스트만이라도 기록은 만든다
    expect(store().validation.report!.structure).toBeNull()
  })

  it('다시 만들면 이전 기록을 대체하고, 지울 수 있다', () => {
    store().runStructure()
    store().makeRecord()
    const first = store().validation.report!.generatedAt
    store().setChecklistEntry('face-validity', { status: 'problem' })
    store().makeRecord()
    expect(store().validation.report!.checklist).toHaveLength(1)
    expect(store().validation.report!.generatedAt >= first).toBe(true)
    store().clearRecord()
    expect(store().validation.report).toBeNull()
  })

  it('비교 대상이 시나리오면 기록에 시나리오 이름을 쓴다', async () => {
    const id = store().addScenario()!
    store().setValidationTarget(id)
    store().runStructure()
    store().makeRecord()
    expect(store().validation.report!.target).toEqual({ id, name: '시나리오 1' })
  })
})

describe('저장·열기', () => {
  it('체크리스트와 검증 기록이 파일을 거쳐 복원되고, 구조 점검 결과는 담기지 않는다', async () => {
    store().runStructure()
    store().setChecklistEntry('face-validity', { status: 'ok', note: '검토' })
    store().makeRecord()
    const saved = structuredClone(store().validation)
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    expect(JSON.stringify(file)).not.toContain('"findings"')
    expect(JSON.stringify(file)).not.toContain('runError')
    await store().newProject('brooks')
    await settle()
    expect(store().validation).toEqual(defaultValidationSettings())
    expect(await store().loadProjectFile(file, 'r.spd.json')).toBe(true)
    await settle()
    expect(store().validation).toEqual(saved)
    expect(store().validationStructure).toBeNull()
    expect(selectIsDirty(store())).toBe(false)
    expect(store().notice).toBeNull()
  })

  it('다른 모델 버전의 기록도 열린다(경고 없이, 화면이 표시)', async () => {
    store().runStructure()
    store().makeRecord()
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    file.validation.report.model.version = 9
    expect(await store().loadProjectFile(file, 'r.spd.json')).toBe(true)
    await settle()
    expect(store().validation.report!.model.version).toBe(9)
  })

  it('고친 파일의 알 수 없는 체크리스트 항목은 버리고 알린다', async () => {
    store().setChecklistEntry('face-validity', { status: 'ok' })
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    file.validation.checklist.push({ id: 'future-item', status: 'ok', note: '' })
    expect(await store().loadProjectFile(file, 'r.spd.json')).toBe(true)
    await settle()
    expect(store().validation.checklist.map((c) => c.id)).toEqual(['face-validity'])
    expect(store().notice?.details?.join(' ')).toContain("'future-item'")
  })
})
