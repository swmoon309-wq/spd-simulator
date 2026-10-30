import { beforeEach, describe, expect, it, vi } from 'vitest'
import { valueAt } from '@spd/analysis'
import { compileModel, runModel } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { serializePresets } from '../../../shared/presetFile'
import { presetsToExport } from '../lib/presets'
import { MAX_PRESETS } from '../lib/presets'
import type { CalibrationRequest } from '../lib/validationRuns'
import type { Dataset } from '../lib/validation'
import { selectCalibrationStale, selectIsDirty, useAppStore } from './appStore'

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

/** 공칭 생산성 0.13으로 만든 합성 데이터(주 단위 28점) */
function dataset(over: Partial<Dataset> = {}): Dataset {
  const actual = runModel(compileModel(brooksModel), { overrides: { nominal_productivity: 0.13 } })
  const points = (v: string): [number, number][] => Array.from({ length: 28 }, (_, i) => [i + 1, valueAt(actual, v, (i + 1) * 7)] as [number, number])
  return {
    id: 'd1', name: '합성 A', fileName: 'a.csv', timeUnit: 'week', offsetDay: 0, actualCompletionDay: null,
    columns: [
      { name: 'dev', variable: 'developed_software', scale: 1, points: points('developed_software') },
      { name: '메모', variable: null, scale: 1, points: [[1, 1]] },
      { name: 'eff', variable: 'cum_effort', scale: 1, points: points('cum_effort') }
    ],
    ...over
  }
}
const request = (over: Partial<CalibrationRequest> = {}): CalibrationRequest => ({ datasetId: 'd1', params: [{ name: 'nominal_productivity', min: 0.01, max: 1 }], columns: [{ index: 0, weight: 1 }], split: true, ...over })

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
  store().addDataset(dataset())
})

describe('보정 실행', () => {
  it('합성 데이터에서 공칭 생산성 0.13을 회수한다', async () => {
    expect(await store().runCalibration(request())).toBeNull()
    const run = store().validationCalibration!
    expect(run.status).toBe('done')
    expect(run.result!.names).toEqual(['nominal_productivity'])
    expect(Math.abs(run.result!.best[0]! - 0.13) / 0.13).toBeLessThan(0.01)
    expect(run.result!.split).not.toBeNull()
    expect(run.result!.canceled).toBe(false)
    expect(selectCalibrationStale(store())).toBe(false)
  })

  it('여러 열과 가중치를 쓰고, 연결하지 않은 열은 쓰지 않는다', async () => {
    expect(await store().runCalibration(request({ columns: [{ index: 0, weight: 3 }, { index: 1, weight: 1 }, { index: 2, weight: 1 }] }))).toBeNull()
    const r = store().validationCalibration!.result!
    expect(r.columns.map((c) => c.variable)).toEqual(['developed_software', 'cum_effort']) // 메모(연결 안 함)는 빠진다
    expect(r.columns.map((c) => c.weight)).toEqual([0.75, 0.25])
  })

  it('입력이 바뀌면 오래됨(파라미터·데이터 값·요청이 달라도)', async () => {
    await store().runCalibration(request())
    expect(selectCalibrationStale(store())).toBe(false)
    store().setParam('extra_people', 3)
    expect(selectCalibrationStale(store())).toBe(true)
    await store().runCalibration(request())
    expect(selectCalibrationStale(store())).toBe(false)
    store().setDatasetColumn('d1', 0, { scale: 2 })
    expect(selectCalibrationStale(store())).toBe(true)
  })

  it('올바르지 않은 요청은 이유를 돌려주고 실행하지 않는다', async () => {
    const bad = async (r: CalibrationRequest, m: RegExp) => {
      expect(await store().runCalibration(r)).toMatch(m)
      expect(store().validationCalibration?.status).not.toBe('running')
    }
    await bad(request({ datasetId: 'x' }), /데이터셋을 고르세요/)
    await bad(request({ columns: [] }), /열을 하나 이상/)
    await bad(request({ columns: [{ index: 1, weight: 1 }] }), /열을 하나 이상/) // 연결 안 한 열만
    await bad(request({ columns: [{ index: 0, weight: 0 }] }), /가중치/)
    await bad(request({ params: [] }), /하나 이상/)
    await bad(request({ params: [{ name: 'nope', min: 0, max: 1 }] }), /상수가 아닙니다/)
    await bad(request({ params: ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => ({ name: n, min: 0, max: 1 })) }), /최대 5개/)
    expect(store().validationCalibration!.status).toBe('error') // 입력 오류는 상태에도 남는다
    store().setParamError('extra_people', '범위 밖')
    expect(await store().runCalibration(request())).toMatch(/입력 오류/)
  })

  it('실행 중에는 다시 시작하지 않고 진행을 알리며, 취소하면 그때까지의 최선이 남는다', async () => {
    const req = request({ params: ['nominal_productivity', 'experienced_productivity_factor', 'new_productivity_factor'].map((n, i) => ({ name: n, min: [0.01, 0.1, 0.1][i]!, max: [1, 5, 3][i]! })) })
    const done = store().runCalibration(req)
    expect(store().validationCalibration?.status).toBe('running')
    expect(await store().runCalibration(req)).toMatch(/실행 중/)
    await vi.waitFor(() => expect(store().validationCalibration!.progress).not.toBeNull())
    expect(store().validationCalibration!.progress!.evaluations).toBeGreaterThan(0)
    store().cancelCalibration()
    await done
    const run = store().validationCalibration!
    expect(run.status).toBe('canceled')
    expect(run.result!.canceled).toBe(true)
    expect(run.result!.jAfter).toBeLessThanOrEqual(run.result!.jBefore)
    // 취소 뒤 다시 실행할 수 있다
    expect(await store().runCalibration(request())).toBeNull()
    expect(store().validationCalibration!.status).toBe('done')
  })

  it('새 프로젝트는 실행 중인 보정을 취소하고 결과를 비운다', async () => {
    const done = store().runCalibration(request({ params: ['nominal_productivity', 'experienced_productivity_factor', 'new_productivity_factor'].map((n, i) => ({ name: n, min: [0.01, 0.1, 0.1][i]!, max: [1, 5, 3][i]! })) }))
    await vi.waitFor(() => expect(store().validationCalibration!.progress).not.toBeNull())
    await store().newProject('brooks')
    await settle()
    await done
    expect(store().validationCalibration).toBeNull()
    expect(store().validation.presets).toEqual([])
  })
})

describe('프리셋 저장·관리', () => {
  it('결과가 없으면 저장하지 않는다', () => {
    expect(store().savePreset('x')).toMatch(/저장할 보정 결과가 없습니다/)
    expect(store().validation.presets).toEqual([])
  })

  it('보정 결과를 프리셋으로 저장하고 출처를 남긴다', async () => {
    await store().runCalibration(request())
    expect(store().savePreset('팀 A 보정')).toBeNull()
    const p = store().validation.presets[0]!
    expect(p).toMatchObject({ id: 'p1', name: '팀 A 보정', modelId: 'brooks', modelVersion: 1 })
    expect(Object.keys(p.params)).toEqual(['nominal_productivity'])
    expect(p.origin).toMatchObject({ dataset: '합성 A', columns: ['developed_software'], split: 0.7 })
    expect(p.origin.objective!).toBeLessThan(1e-4)
    expect(selectIsDirty(store())).toBe(true)
  })

  it('입력이 바뀌어 오래된 결과는 저장하지 않는다', async () => {
    await store().runCalibration(request())
    store().setParam('extra_people', 3)
    expect(store().savePreset('x')).toMatch(/오래되었습니다/)
  })

  it('같은 이름은 번호를 붙이고, 이름 바꾸기는 중복·빈 이름을 거절한다', async () => {
    await store().runCalibration(request())
    store().savePreset('프리셋')
    store().savePreset('프리셋')
    expect(store().validation.presets.map((p) => p.name)).toEqual(['프리셋', '프리셋 (2)'])
    expect(store().renamePreset('p2', '프리셋')).toMatch(/같은 이름/)
    expect(store().renamePreset('p2', '  ')).toMatch(/1~100자/)
    expect(store().renamePreset('p2', ' 새 이름 ')).toBeNull()
    expect(store().validation.presets[1]!.name).toBe('새 이름')
  })

  it('최대 20개까지, 지우면 다시 저장할 수 있다', async () => {
    await store().runCalibration(request())
    for (let i = 0; i < MAX_PRESETS; i++) expect(store().savePreset(`p${i}`)).toBeNull()
    expect(store().savePreset('초과')).toMatch(/최대 20개/)
    store().deletePreset('p5')
    expect(store().savePreset('다시')).toBeNull()
    expect(store().validation.presets).toHaveLength(MAX_PRESETS)
  })
})

describe('프리셋 적용', () => {
  async function withPreset() {
    await store().runCalibration(request({ params: [{ name: 'nominal_productivity', min: 0.01, max: 1 }, { name: 'hire_day', min: 0, max: 400, integer: true }] }))
    store().savePreset('보정 A')
    return store().validation.presets[0]!
  }

  it('새 시나리오로 적용하면 기본 설정과 다른 값만 덮어쓰고 이름·메모가 붙는다(기본 설정은 그대로)', async () => {
    const p = await withPreset()
    const before = { ...store().params }
    const r = store().applyPresetAsScenario(p.id)
    expect(r.message).toBeNull()
    const sc = store().scenarios.find((s) => s.id === r.scenarioId)!
    expect(sc.name).toBe('보정 A')
    expect(sc.overrides['nominal_productivity']).toBeCloseTo(p.params['nominal_productivity']!, 12)
    expect(Object.keys(sc.overrides).every((k) => before[k] !== sc.overrides[k])).toBe(true) // 같은 값은 덮어쓰지 않는다
    expect(sc.note).toContain("보정 프리셋 '보정 A'(합성 A)")
    expect(store().params).toEqual(before)
    expect(store().activeScenarioId).toBe(r.scenarioId)
  })

  it('시나리오 이름이 겹치면 기본 이름을 그대로 둔다', async () => {
    const p = await withPreset()
    const id = store().addScenario()!
    store().renameScenario(id, '보정 A')
    const r = store().applyPresetAsScenario(p.id)
    expect(r.scenarioId).not.toBeNull()
    expect(store().scenarios.find((s) => s.id === r.scenarioId)!.name).not.toBe('보정 A')
  })

  it('시나리오가 12개면 적용하지 못하고 이유를 알린다', async () => {
    const p = await withPreset()
    while (store().addScenario() !== null);
    expect(store().applyPresetAsScenario(p.id)).toMatchObject({ scenarioId: null, message: expect.stringContaining('최대 12개') })
  })

  it('기본 설정에 적용하면 입력값이 바뀐다', async () => {
    const p = await withPreset()
    expect(store().applyPresetToBase(p.id)).toBeNull()
    expect(store().params['nominal_productivity']).toBeCloseTo(p.params['nominal_productivity']!, 12)
    expect(selectIsDirty(store())).toBe(true)
  })

  it('없는 프리셋·다른 모델의 프리셋은 적용하지 않는다', async () => {
    expect(store().applyPresetToBase('zz')).toMatch(/찾을 수 없습니다/)
    expect(store().applyPresetAsScenario('zz').message).toMatch(/찾을 수 없습니다/)
    const p = await withPreset()
    useAppStore.setState((s) => ({ validation: { ...s.validation, presets: s.validation.presets.map((x) => (x.id === p.id ? { ...x, modelId: 'integrated-project' } : x)) } }))
    expect(store().applyPresetToBase(p.id)).toMatch(/다른 모델/)
    expect(store().applyPresetAsScenario(p.id).message).toMatch(/다른 모델/)
  })
})

describe('프리셋 가져오기', () => {
  const body = (name: string, params: Record<string, number>, over: Record<string, unknown> = {}) => ({ name, modelId: 'brooks', modelVersion: 1, params, origin: { dataset: 'd', columns: [], objective: 0.01, valObjective: null, split: null, at: '2026-10-22T09:00:00.000Z' }, ...over })
  const text = (items: ReturnType<typeof body>[]) => serializePresets(items as never, '2026-10-22T09:00:00.000Z')

  it('내보낸 파일을 가져와 더한다', () => {
    const r = store().importPresetText(text([body('a', { nominal_productivity: 0.13 }), body('b', { hire_day: 90 })]))
    expect(r).toEqual({ added: 2, warnings: [], error: null })
    expect(store().validation.presets.map((p) => [p.id, p.name])).toEqual([['p1', 'a'], ['p2', 'b']])
  })

  it('읽지 못하면 이유를 알리고 바꾸지 않는다', () => {
    expect(store().importPresetText('not json').error).toContain('JSON 형식이 아니어서')
    expect(store().importPresetText('{"kind":"x"}').error).toContain('프리셋 파일이 아닙니다')
    expect(store().validation.presets).toEqual([])
  })

  it('호환 검사: 다른 모델은 건너뛰고 모르는 파라미터는 버린다', () => {
    const r = store().importPresetText(text([body('다른', { x: 1 }, { modelId: 'integrated-project' }), body('섞임', { nominal_productivity: 0.13, nope: 1 })]))
    expect(r.added).toBe(1)
    expect(r.warnings.join('\n')).toContain('다른 모델')
    expect(r.warnings.join('\n')).toContain("'nope'")
    expect(store().validation.presets[0]!.params).toEqual({ nominal_productivity: 0.13 })
  })

  it('가져온 것이 하나도 없으면 목록을 바꾸지 않는다', () => {
    const before = store().validation
    store().importPresetText(text([body('다른', { x: 1 }, { modelId: 'integrated-project' })]))
    expect(store().validation).toBe(before)
  })

  it('프리셋을 내보낸 파일 형태로 되돌릴 수 있다(id 없음)', async () => {
    store().importPresetText(text([body('a', { hire_day: 90 })]))
    const exported = presetsToExport(store().validation.presets)
    expect(exported[0]).not.toHaveProperty('id')
    expect(exported[0]!.params).toEqual({ hire_day: 90 })
  })
})

describe('저장·열기와 검증 기록', () => {
  it('프리셋이 파일을 거쳐 복원되고 보정 결과는 저장하지 않는다', async () => {
    await store().runCalibration(request())
    store().savePreset('팀 A')
    const saved = structuredClone(store().validation.presets)
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    expect(JSON.stringify(file)).not.toContain('evaluations')
    expect(JSON.stringify(file)).not.toContain('diagnostics')
    await store().newProject('brooks')
    await settle()
    expect(await store().loadProjectFile(file, 'p.spd.json')).toBe(true)
    await settle()
    expect(store().validation.presets).toEqual(saved)
    expect(store().validationCalibration).toBeNull()
    expect(selectIsDirty(store())).toBe(false)
  })

  it('고친 파일의 맞지 않는 프리셋은 정리하고 알린다', async () => {
    await store().runCalibration(request())
    store().savePreset('팀 A')
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    file.validation.presets[0].params.nope = 1
    file.validation.presets.push({ ...file.validation.presets[0], id: 'p9', name: '다른 모델', modelId: 'integrated-project' })
    expect(await store().loadProjectFile(file, 'p.spd.json')).toBe(true)
    await settle()
    expect(store().validation.presets.map((p) => p.name)).toEqual(['팀 A'])
    expect(Object.keys(store().validation.presets[0]!.params)).toEqual(['nominal_productivity'])
    expect(store().notice?.details?.join(' ')).toContain("'nope'")
    expect(store().notice?.details?.join(' ')).toContain("프리셋 '다른 모델'")
  })

  it('프리셋만 있어도 검증 기록을 만들 수 있고, 기록에는 보정 요약이 들어간다', async () => {
    await store().runCalibration(request())
    store().savePreset('팀 A')
    const r = store().makeRecord()
    expect(r.reason).toBeNull()
    expect(r.contents).toMatchObject({ presets: 1 })
    const rec = store().validation.report!
    expect(rec.presets).toHaveLength(1)
    expect(rec.presets[0]).toMatchObject({ name: '팀 A', dataset: '합성 A', split: 0.7 })
    expect(rec.presets[0]!.objective!).toBeLessThan(1e-4)
    expect(rec.presets[0]!.valObjective).not.toBeNull()
  })
})
