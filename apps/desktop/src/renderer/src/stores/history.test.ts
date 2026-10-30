import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COALESCE_MS, MAX_HISTORY, redoEdit, setHistoryClock, undoEdit, useHistoryStore } from './history'
import { selectIsDirty, useAppStore } from './appStore'

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
const tick = () => Promise.resolve() // 같은 구간의 편집을 한 단계로 묶는 마이크로태스크가 끝나게 한다
const hist = () => useHistoryStore.getState()
let clock = 0
const later = (ms = COALESCE_MS + 1) => void (clock += ms)

beforeEach(async () => {
  setHistoryClock(() => clock)
  clock = 1_000_000
  await store().newProject('brooks')
  await settle()
})

describe('입력 편집 되돌리기', () => {
  it('파라미터 변경을 되돌리고 다시 실행한다', async () => {
    const before = store().params['extra_people'] as number
    store().setParam('extra_people', 7)
    await tick()
    expect(hist().undoCount).toBe(1)
    expect(hist().undoLabel).toMatch(/변경$/)
    expect(undoEdit()).toMatchObject({ ok: true })
    expect(store().params['extra_people']).toBe(before)
    expect(hist().undoCount).toBe(0)
    expect(hist().redoCount).toBe(1)
    expect(redoEdit()).toMatchObject({ ok: true })
    expect(store().params['extra_people']).toBe(7)
    expect(hist().redoCount).toBe(0)
  })

  it('끝까지 되돌리면 저장한 상태와 같아져 수정 표시가 사라진다', async () => {
    expect(selectIsDirty(store())).toBe(false)
    store().setParam('extra_people', 7)
    later()
    store().setParam('extra_hire_day', 40)
    await tick()
    expect(selectIsDirty(store())).toBe(true)
    undoEdit()
    undoEdit()
    expect(selectIsDirty(store())).toBe(false)
  })

  it('실행 취소 없이 변경하면 다시 실행 기록이 사라진다', async () => {
    store().setParam('extra_people', 7)
    await tick()
    undoEdit()
    expect(hist().redoCount).toBe(1)
    later()
    store().setParam('extra_people', 9)
    await tick()
    expect(hist().redoCount).toBe(0)
    expect(redoEdit()).toMatchObject({ ok: false })
  })

  it('같은 값을 다시 넣은 것은 기록하지 않는다', async () => {
    store().setParam('extra_people', store().params['extra_people'] as number)
    await tick()
    expect(hist().undoCount).toBe(0)
  })

  it('기록이 없으면 이유를 돌려준다', () => {
    expect(undoEdit()).toEqual({ ok: false, message: '되돌릴 변경이 없습니다.' })
    expect(redoEdit()).toEqual({ ok: false, message: '다시 실행할 변경이 없습니다.' })
  })

  it('같은 항목을 1초 안에 거푸 고치면 한 단계로 합친다', async () => {
    const before = store().params['extra_people'] as number
    store().setParam('extra_people', 1)
    await tick()
    later(300)
    store().setParam('extra_people', 12)
    await tick()
    later(300)
    store().setParam('extra_people', 123)
    await tick()
    expect(hist().undoCount).toBe(1)
    undoEdit()
    expect(store().params['extra_people']).toBe(before)
    redoEdit()
    expect(store().params['extra_people']).toBe(123)
  })

  it('다른 항목이거나 1초가 지나면 따로 쌓는다', async () => {
    store().setParam('extra_people', 1)
    await tick()
    later(100)
    store().setParam('extra_hire_day', 40)
    await tick()
    expect(hist().undoCount).toBe(2)
    later()
    store().setParam('extra_hire_day', 50)
    await tick()
    expect(hist().undoCount).toBe(3)
  })

  it('합치다가 처음 값으로 돌아오면 단계가 남지 않는다', async () => {
    const before = store().params['extra_people'] as number
    store().setParam('extra_people', 5)
    await tick()
    later(100)
    store().setParam('extra_people', before)
    await tick()
    expect(hist().undoCount).toBe(0)
  })

  it('한 번의 동작이 부른 여러 변경은 한 단계다(프리셋을 시나리오로 적용)', async () => {
    store().addScenario()
    await tick()
    later()
    store().renameScenario('s1', '내 시나리오')
    store().setScenarioOverride('s1', 'extra_people', 5)
    store().setScenarioNote('s1', '메모')
    await tick()
    expect(hist().undoCount).toBe(2) // 만들기, 그리고 이름·값·메모
    undoEdit()
    expect(store().scenarios[0]).toMatchObject({ id: 's1', name: '시나리오 1', overrides: {} })
    expect(store().scenarios[0]?.note).toBeUndefined()
  })

  it('시나리오를 지운 것을 되돌리면 돌아오고, 선택이 어긋나지 않는다', async () => {
    store().addScenario()
    await tick()
    later()
    store().addScenario()
    await tick()
    later()
    store().setActiveScenario('s2')
    store().deleteScenario('s2')
    await tick()
    expect(store().activeScenarioId).toBeNull()
    undoEdit()
    expect(store().scenarios.map((s) => s.id)).toEqual(['s1', 's2'])
    // 만든 것을 되돌리면 선택하고 있던 시나리오가 없어지므로 선택을 푼다.
    store().setActiveScenario('s2')
    undoEdit()
    expect(store().scenarios.map((s) => s.id)).toEqual(['s1'])
    expect(store().activeScenarioId).toBeNull()
  })

  it('실행 결과나 보기 설정은 되돌리지 않는다', async () => {
    await store().run({ extra_people: 5 })
    await settle()
    const runs = store().runs.length
    store().setChartVariable('cum_effort')
    await tick()
    expect(hist().undoCount).toBe(0)
    expect(store().runs).toHaveLength(runs)
  })

  it('실행 중에는 되돌릴 수 없고 이유를 알려 준다', async () => {
    store().setParam('extra_people', 5)
    await tick()
    void store().run()
    const r = undoEdit()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('끝난 뒤')
    await settle()
    expect(undoEdit()).toMatchObject({ ok: true })
  })

  it(`최대 ${MAX_HISTORY}단계만 기억한다`, async () => {
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      later()
      store().setParam('extra_people', i % 2 === 0 ? 1 : 2)
      await tick()
    }
    expect(hist().undoCount).toBe(MAX_HISTORY)
  })
})

describe('프로젝트를 바꾸면 기록을 비운다', () => {
  it('새 프로젝트', async () => {
    store().setParam('extra_people', 5)
    await tick()
    await store().newProject('brooks')
    await settle()
    expect(hist().undoCount).toBe(0)
    expect(hist().redoCount).toBe(0)
  })

  it('프로젝트 열기', async () => {
    store().setParam('extra_people', 5)
    await tick()
    const file = store().buildProjectFile()
    store().setParam('extra_people', 9)
    later()
    await tick()
    expect(hist().undoCount).toBe(2)
    await store().loadProjectFile(file, 'a.spd.json')
    await settle()
    expect(hist().undoCount).toBe(0)
    expect(store().params['extra_people']).toBe(5)
  })
})

describe('되돌린 뒤 정리', () => {
  it('채택 계획을 되돌리면 그에 매인 재예측·조치 시험 결과를 지운다', async () => {
    await store().runScenarios('all')
    store().adoptScenario('@base')
    later()
    await tick()
    // 조치 시험 결과가 있는 것처럼 둔다(값은 쓰이지 않는다).
    useAppStore.setState({ actionRun: { key: 'k', day: 1, kappa: 1, status: 'done', entries: [], error: null } })
    expect(store().adopted).not.toBeNull()
    undoEdit()
    expect(store().adopted).toBeNull()
    expect(store().actionRun).toBeNull()
    redoEdit()
    expect(store().adopted).not.toBeNull()
  })
})
