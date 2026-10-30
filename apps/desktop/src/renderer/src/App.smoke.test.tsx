// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getEntry } from './catalog'
import { docFromBuiltin } from './catalog/exportDoc'
import { installUserModel, removeUserModel } from './lib/modelRegistry'
import { useAppStore } from './stores/appStore'
import { useUiStore } from './stores/uiStore'
import type { AppTab } from '../../shared/menuCommands'

vi.mock('./engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('./engine/models')
  return {
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {}
    }),
    registerModel: () => undefined,
    unregisterModel: () => undefined
  }
})

// jsdom에는 canvas가 없어 차트 그리기만 가짜로 바꾼다(그 밖의 화면 코드는 그대로 돈다).
vi.mock('echarts/core', () => {
  const chart = () => ({ setOption() {}, clear() {}, resize() {}, dispose() {}, on() {}, off() {}, getZr: () => ({ on() {}, off() {} }), dispatchAction() {}, renderToSVGString: () => '<svg/>', convertToPixel: () => [0, 0], convertFromPixel: () => [0, 0], isDisposed: () => false, getWidth: () => 100, getHeight: () => 100 })
  return { use() {}, init: chart, getInstanceByDom: () => undefined, graphic: {}, registerTheme() {} }
})

const TABS = ['홈', '실험', '시나리오', '통제', '위험 분석', '검증', '보고서', '모델']

let root: Root | null = null
let host: HTMLElement | null = null

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO
  window.matchMedia = (q: string) =>
    ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false, onchange: null }) as MediaQueryList
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

// 렌더 중 무한 갱신(selector가 매번 새 값을 돌려주는 경우 등)이나 던져진 오류가 탭을 비우는지 모든 탭을 눌러 본다.
describe('모든 탭을 그려 본다 (화면 스모크)', () => {
  it.each(TABS)('%s 탭이 오류 없이 그려진다', async (label) => {
    const { App } = await import('./App')
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      errors.push(String(a[0]).slice(0, 200))
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<App />)
    })
    const tab = [...host.querySelectorAll('[role=tab]')].find((t) => t.textContent?.trim() === label) as HTMLElement
    expect(tab).toBeTruthy()
    await act(async () => {
      tab.click()
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    spy.mockRestore()
    expect(host.querySelector('[role=alert] pre')?.textContent ?? '').toBe('')
    expect(host.querySelector('[role=tabpanel]')).toBeTruthy()
    expect(errors).toEqual([])
  })
})

describe('사용자 모델 상시 안내 (모델 편집기 설계 8.3)', () => {
  const NOTICE = '[aria-label="사용자 모델 안내"]'
  const show = async (tab: AppTab) => {
    const { App } = await import('./App')
    useUiStore.setState({ tab })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<App />)
    })
    return host
  }

  it('사용자 모델이면 시나리오·통제·위험 분석·검증 화면 머리에 보이고 그 밖의 화면에는 없다', async () => {
    const made = installUserModel(docFromBuiltin(getEntry('brooks'), { now: new Date('2026-10-23T00:00:00.000Z'), random: () => 0.3, name: '내 Brooks' }))
    expect(made.ok).toBe(true)
    const id = made.ok ? made.entry.id : ''
    useAppStore.setState({ modelId: id })
    try {
      for (const tab of ['scenarios', 'control', 'risk', 'validation'] as const) {
        const h = await show(tab)
        expect(h.querySelector(NOTICE)?.textContent, tab).toContain('보정·검증되지 않았을 수 있으며')
        act(() => root?.unmount())
        h.remove()
      }
      const h = await show('home')
      expect(h.querySelector(NOTICE)).toBeNull()
    } finally {
      useAppStore.setState({ modelId: 'brooks' })
      removeUserModel(id)
    }
  })

  it('내장 모델이면 어느 화면에도 보이지 않는다', async () => {
    useAppStore.setState({ modelId: 'brooks' })
    for (const tab of ['scenarios', 'control', 'risk', 'validation'] as const) {
      const h = await show(tab)
      expect(h.querySelector(NOTICE), tab).toBeNull()
      act(() => root?.unmount())
      h.remove()
    }
  })
})
