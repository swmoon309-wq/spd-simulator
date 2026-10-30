import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planExtremes, type PerturbSpec } from '@spd/analysis'
import { getEntry } from '../catalog'
import { extremeParams } from '../lib/validationRuns'
import { BASE_ID } from '../lib/scenarioRunner'
import { selectExtremesStale, selectLevelsStale, selectPerturbStale, useAppStore } from './appStore'

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
const spec = (p: Partial<PerturbSpec> = {}): PerturbSpec => ({ kind: 'step', name: 'extra_people', mode: 'absolute', amount: 10, day: 90, width: 10, ...p })

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})

describe('극단 조건 시험 실행', () => {
  it('모든 값을 실행하고 요약을 낸다(Brooks: 범위 안 실패 0)', async () => {
    expect(await store().runExtremes()).toBeNull()
    const run = store().validationExtremes!
    const expected = planExtremes(extremeParams(getEntry('brooks')), store().params)
    expect(run.status).toBe('done')
    expect(run.total).toBe(expected.length)
    expect(run.cells).toHaveLength(expected.length)
    expect(run.done).toBe(expected.length)
    expect(run.cells.map((c) => [c.case.name, c.case.value])).toEqual(expected.map((c) => [c.name, c.value])) // 계획 순서
    expect(run.cells.filter((c) => c.status === 'fail')).toEqual([])
    expect(selectExtremesStale(store())).toBe(false)
  })

  it('실행 중에는 다시 시작하지 않고, 진행하는 동안 중간 결과가 쌓인다', async () => {
    await store().newProject('integrated-project')
    await settle()
    const done = store().runExtremes()
    expect(store().validationExtremes?.status).toBe('running')
    expect(await store().runExtremes()).toMatch(/실행 중/)
    await vi.waitFor(() => expect(store().validationExtremes!.done).toBeGreaterThan(0))
    expect(store().validationExtremes!.status).toBe('running')
    expect(store().validationExtremes!.cells.length).toBe(store().validationExtremes!.done)
    store().cancelExtremes()
    await done
  })

  it('취소하면 그때까지 끝난 셀이 남는다', async () => {
    await store().newProject('integrated-project')
    await settle()
    const done = store().runExtremes()
    await vi.waitFor(() => expect(store().validationExtremes!.done).toBeGreaterThan(0))
    store().cancelExtremes()
    await done
    const run = store().validationExtremes!
    expect(run.status).toBe('canceled')
    expect(run.cells.length).toBeGreaterThan(0)
    expect(run.cells.length).toBeLessThan(run.total)
    expect(run.done).toBe(run.cells.length)
    // 취소 뒤 다시 실행할 수 있다
    store().cancelExtremes()
    expect(await store().runExtremes()).toBeNull()
    expect(store().validationExtremes!.status).toBe('done')
  })

  it('입력이 바뀌면 오래됨', async () => {
    await store().runExtremes()
    expect(selectExtremesStale(store())).toBe(false)
    store().setParam('extra_people', 3)
    expect(selectExtremesStale(store())).toBe(true)
  })

  it('입력 오류·잘못된 실행 설정에서는 실행하지 않는다', async () => {
    store().setParamError('extra_people', '범위 밖')
    expect(await store().runExtremes()).toMatch(/입력 오류/)
    expect(store().validationExtremes).toBeNull()
  })

  it('비교 대상 시나리오의 유효 파라미터에서 출발한다', async () => {
    const id = store().addScenario()!
    store().setScenarioOverride(id, 'initial_experienced', 40) // 기준은 20명
    await store().runExtremes()
    const baseRun = store().validationExtremes!
    store().setValidationTarget(id)
    expect(selectExtremesStale(store())).toBe(true) // 대상이 바뀌면 오래됨
    await store().runExtremes()
    const scRun = store().validationExtremes!
    const pick = (r: typeof baseRun) => r.cells.find((c) => c.case.name === 'extra_people' && c.case.levels.includes('zero'))!.kpis!['completionDay']
    expect(pick(scRun)).not.toBe(pick(baseRun)) // 초기 숙련 인원이 다르면 완료일이 다르다
    expect(selectExtremesStale(store())).toBe(false)
    store().setValidationTarget(BASE_ID)
  })

  it('새 프로젝트는 결과를 비우고, 새 프로젝트 도중 실행 중이던 것은 끝나지 않은 채 버려진다', async () => {
    await store().newProject('integrated-project')
    await settle()
    const done = store().runExtremes()
    await vi.waitFor(() => expect(store().validationExtremes!.done).toBeGreaterThan(0))
    await store().newProject('brooks')
    await settle()
    await done
    expect(store().validationExtremes).toBeNull()
    expect(store().modelId).toBe('brooks')
  })
})

describe('교란 시험 실행', () => {
  it('Brooks 법칙: 인력을 더 투입하면 총 인원이 늘고 완료가 늦어진다', () => {
    expect(store().runPerturb(spec(), ['total_personnel', 'developed_software'])).toBeNull()
    const run = store().validationPerturb!
    expect(run.changes).toEqual([{ day: 90, name: 'extra_people', value: 10 }])
    const people = run.summaries.find((s) => s.variable === 'total_personnel')!
    expect(people.maxDeviation).toBeCloseTo(10, 6)
    expect(people.returnTime).toBeNull() // 복귀 안 함
    expect(run.perturbed.series['completion_time']![run.perturbed.time.length - 1]).toBeGreaterThan(run.base.series['completion_time']![run.base.time.length - 1] as number)
    expect(selectPerturbStale(store())).toBe(false)
  })

  it('펄스·램프 변경 목록을 만든다', () => {
    store().runPerturb(spec({ kind: 'pulse', width: 5 }), ['total_personnel'])
    expect(store().validationPerturb!.changes).toHaveLength(2)
    store().runPerturb(spec({ kind: 'ramp', width: 20, mode: 'percent', amount: 50 }), ['total_personnel'])
    expect(store().validationPerturb!.changes).toHaveLength(11)
  })

  it('잘못된 입력은 이유를 돌려주고 결과를 바꾸지 않는다', () => {
    store().runPerturb(spec(), ['total_personnel'])
    const before = store().validationPerturb
    expect(store().runPerturb(spec({ name: 'nope' }), ['total_personnel'])).toMatch(/상수가 아닙니다/)
    expect(store().runPerturb(spec({ day: 9999 }), ['total_personnel'])).toMatch(/시작 시각/)
    expect(store().runPerturb(spec({ kind: 'pulse', width: 0 }), ['total_personnel'])).toMatch(/폭/)
    expect(store().runPerturb(spec(), [])).toMatch(/변수를 하나 이상/)
    expect(store().runPerturb(spec(), ['nope'])).toMatch(/변수가 아닙니다/)
    expect(store().validationPerturb).toBe(before)
  })

  it('입력이 바뀌면 오래됨', () => {
    store().runPerturb(spec(), ['total_personnel'])
    store().setParam('hire_day', 120)
    expect(selectPerturbStale(store())).toBe(true)
  })

  it('프로젝트를 바꾸면 비운다', async () => {
    store().runPerturb(spec(), ['total_personnel'])
    store().runLevelCheck(40)
    await store().newProject('brooks')
    await settle()
    expect(store().validationPerturb).toBeNull()
    expect(store().validationLevels).toBeNull()
  })
})

describe('Level 변화 점검', () => {
  it('짧은 구간의 Level 변화를 변화량 순으로 낸다', () => {
    expect(store().runLevelCheck(40)).toBeNull()
    const run = store().validationLevels!
    expect(run.days).toBe(40)
    expect(run.rows.map((r) => r.name)).toContain('developed_software')
    for (let i = 1; i < run.rows.length; i++) expect(Math.abs(run.rows[i - 1]!.change)).toBeGreaterThanOrEqual(Math.abs(run.rows[i]!.change))
    expect(selectLevelsStale(store())).toBe(false)
    store().setParam('initial_requirements', 400)
    expect(selectLevelsStale(store())).toBe(true)
  })

  it('일수가 올바르지 않으면 거절', () => {
    expect(store().runLevelCheck(0)).toMatch(/0보다/)
    expect(store().runLevelCheck(NaN)).toMatch(/0보다/)
    expect(store().validationLevels).toBeNull()
  })
})
