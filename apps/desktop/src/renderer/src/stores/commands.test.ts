import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPORT_MENU } from '../../../main/menuTemplate'
import { handleMenuCommand } from '../lib/commands'
import { REPORT_KINDS } from '../lib/report/model'
import { useAppStore } from './appStore'
import { useUiStore } from './uiStore'

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

const app = () => useAppStore.getState()
const ui = () => useUiStore.getState()
const settle = () => vi.waitFor(() => expect(app().status).toBe('idle'))

beforeEach(async () => {
  vi.stubGlobal('window', {}) // 브라우저: 파일 대화상자 없이 동작
  await app().newProject('brooks')
  await settle()
  useUiStore.setState({ tab: 'home', dialog: null })
})
afterEach(() => vi.unstubAllGlobals())

describe('보고서 메뉴 명령', () => {
  it('메뉴의 종류 이름은 renderer의 보고서 종류와 같다', () => {
    expect(REPORT_MENU.map((r) => r.kind)).toEqual(REPORT_KINDS.map((k) => k.kind))
    expect(REPORT_MENU.map((r) => r.label)).toEqual(REPORT_KINDS.map((k) => k.title)) // 메뉴 이름은 보고서 제목과 같다
  })

  it('종류 항목은 보고서 탭을 열고 그 종류를 고른다. 모르는 종류는 무시한다', () => {
    handleMenuCommand('report:scenarios')
    expect(ui().tab).toBe('report')
    expect(useAppStore.getState().reports.kind).toBe('scenarios')
    useUiStore.setState({ tab: 'home' })
    handleMenuCommand('report:없는종류')
    expect(ui().tab).toBe('home')
    expect(useAppStore.getState().reports.kind).toBe('scenarios')
  })
})

describe('메뉴 명령 처리 (COM-01)', () => {
  it('화면 이동', () => {
    handleMenuCommand('tab:risk')
    expect(ui().tab).toBe('risk')
    handleMenuCommand('tab:home')
    expect(ui().tab).toBe('home')
  })

  it('모르는 화면·모델·도움말 주제·명령은 무시한다', () => {
    handleMenuCommand('tab:없음' as never)
    handleMenuCommand('model:없는-모델')
    handleMenuCommand('help:없음' as never)
    handleMenuCommand('알 수 없는 명령' as never)
    expect(ui().tab).toBe('home')
    expect(ui().dialog).toBeNull()
    expect(app().modelId).toBe('brooks')
  })

  it('설정과 도움말 대화상자를 연다', () => {
    handleMenuCommand('settings')
    expect(ui().dialog).toEqual({ kind: 'settings' })
    handleMenuCommand('help:shortcuts')
    expect(ui().dialog).toEqual({ kind: 'help', topic: 'shortcuts' })
    ui().closeDialog()
    expect(ui().dialog).toBeNull()
  })

  it('모델을 고르면 그 모델로 새 프로젝트를 시작한다', async () => {
    handleMenuCommand('model:integrated-project')
    await vi.waitFor(() => expect(app().modelId).toBe('integrated-project'))
    await settle()
  })

  it('실행은 실험 화면으로 옮겨 실행한다', async () => {
    const before = app().runs.length
    handleMenuCommand('run')
    expect(ui().tab).toBe('experiment')
    await settle()
    expect(app().runs.length).toBe(before + 1)
  })

  it('스텝은 멈춘 실행을 시작하고, 일시정지/계속을 번갈아 누를 수 있으며, 중단하면 끝난다', async () => {
    handleMenuCommand('step')
    expect(ui().tab).toBe('experiment')
    expect(app().status).toBe('running')
    expect(app().paused).toBe(true)
    handleMenuCommand('togglePause')
    expect(app().paused).toBe(false)
    handleMenuCommand('togglePause')
    expect(app().paused).toBe(true)
    handleMenuCommand('cancel')
    await settle()
    expect(app().paused).toBe(false)
  })

  it('실행 중이 아닐 때 일시정지/계속은 아무것도 하지 않는다', () => {
    handleMenuCommand('togglePause')
    expect(app().status).toBe('idle')
    expect(app().paused).toBe(false)
  })

  it('리셋은 멈춘 새 실행을 시작한다', async () => {
    handleMenuCommand('reset')
    await vi.waitFor(() => expect(app().paused).toBe(true))
    handleMenuCommand('cancel')
    await settle()
  })

  it('입력값을 기본값으로 되돌린다', () => {
    app().setParam('extra_people', 9)
    handleMenuCommand('resetParams')
    expect(app().params['extra_people']).toBe(0)
    expect(ui().tab).toBe('experiment')
  })

  it('실행 취소·다시 실행은 입력 편집을 되돌린다', async () => {
    app().setParam('extra_people', 9)
    await Promise.resolve()
    handleMenuCommand('undo')
    expect(app().params['extra_people']).toBe(0)
    handleMenuCommand('redo')
    expect(app().params['extra_people']).toBe(9)
  })
})
