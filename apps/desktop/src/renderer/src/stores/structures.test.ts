import { beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog } from '../catalog'
import { structureEntries } from '../catalog/structures'
import { BASE_SCENARIO_ID } from '../lib/adoption'
import { useAppStore } from './appStore'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {},
      pause() {},
      resume() {},
      step() {}
    })
  }
})

const store = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(store().status).toBe('idle'))

/** 기본 구조 라이브러리(MDL-03)의 모델도 화면의 다른 기능(실행·시나리오·채택·검증)과 함께 동작한다. */
describe.each(structureEntries.map((e) => [e.id, e] as const))('구조 모델 %s', (id, entry) => {
  beforeEach(async () => {
    await store().newProject(id)
    await settle()
  })

  it('카탈로그의 분류와 규모 입력 정보가 맞다', () => {
    expect(entry.category).toBe('structure')
    expect(catalog.some((m) => m.id === id)).toBe(true)
    if (entry.size) expect(entry.def.constants[entry.size.param]?.unit).toBe(entry.size.unit)
  })

  it('새 프로젝트의 기준 실행이 끝나고 완료일이 있다', () => {
    expect(store().modelId).toBe(id)
    expect(store().runs).toHaveLength(1)
    expect(store().runs[0]?.kpis.completionDay).not.toBeNull()
  })

  it('프리셋을 시나리오로 만들어 일괄 실행하고 기준을 채택할 수 있다', async () => {
    for (const preset of entry.presets) {
      const sid = store().addScenario() as string
      for (const [name, value] of Object.entries(preset.overrides)) expect(store().setScenarioOverride(sid, name, value)).toBeNull()
    }
    const outcome = await store().runScenarios('all')
    expect(outcome).not.toBeNull()
    expect(store().adoptScenario(BASE_SCENARIO_ID)).toBeNull()
    expect(store().adopted?.model.id).toBe(id)
  })

  it('구조 점검(S1~S6)에 실패가 없다', () => {
    expect(store().runStructure()).toBeNull()
    const findings = store().validationStructure!.report.findings
    expect(findings.filter((f) => f.status === 'fail').map((f) => `${f.id} ${f.summary}`)).toEqual([])
  })

  it('극단 조건 시험에서 허용 범위 안의 값은 실패하지 않는다', async () => {
    expect(await store().runExtremes()).toBeNull()
    const run = store().validationExtremes!
    expect(run.status).toBe('done')
    expect(run.cells.filter((c) => c.status === 'fail' && c.case.inRange).map((c) => `${c.case.name}=${c.case.value}`)).toEqual([])
  })

  it('입력을 바꾸지 않은 Level 변화 점검과 위험 분석 입력을 만들 수 있다', () => {
    expect(store().runLevelCheck(50)).toBeNull()
    const first = entry.groups[0]!.params[0]!.name
    expect(store().addRiskInput(first)).toBeNull()
    expect(store().risk.inputs.map((i) => i.name)).toEqual([first])
  })
})

describe('통제 기능이 지원하지 않는 모델', () => {
  it('재예측을 지원하지 않는 모델은 이유를 알리고 실행하지 않는다', async () => {
    await store().newProject('production-rework')
    await settle()
    await store().runScenarios('all')
    store().adoptScenario(BASE_SCENARIO_ID)
    store().addActual()
    const reason = await store().runReforecast(7)
    expect(reason).toContain('지원하지 않습니다')
    expect(store().reforecast).toBeNull()
  })
})
