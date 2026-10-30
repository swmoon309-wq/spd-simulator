import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './appStore'

// 실제 Worker 대신 같은 실행 루프(executeRun)와 제어(RunControl)를 한 스레드에서 돌린다.
vi.mock('../engine/engineClient', async () => {
  const { applyControl, executeRun, newRunControl } = await import('../engine/execute')
  return {
    startRun: (
      req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number>; startPaused?: boolean },
      onProgress: (p: { time: number; fraction: number; values: Record<string, number> }) => void = () => {}
    ) => {
      const control = newRunControl()
      let cancelled = false
      const promise = new Promise((resolve, reject) => {
        void executeRun(
          { id: 1, ...req },
          {
            post: (m) => {
              if (m.type === 'progress') onProgress({ time: m.time, fraction: m.fraction, values: m.values })
              else if (m.type === 'done') resolve(m.result)
              else if (m.type === 'error') reject(new Error(m.message))
            },
            isCancelled: () => cancelled,
            yieldToEventLoop: () => new Promise<void>((r) => setTimeout(r, 0)),
            now: () => performance.now(),
            control
          }
        )
      })
      return {
        promise,
        cancel() {
          cancelled = true
          control.wake?.()
        },
        pause: () => applyControl(control, 'pause'),
        resume: () => applyControl(control, 'resume'),
        step: (n: number) => applyControl(control, 'step', n)
      }
    }
  }
})

const store = () => useAppStore.getState()
const settle = () => vi.waitFor(() => expect(store().status).toBe('idle'))
const lastTime = () => store().live?.time.at(-1)

beforeEach(async () => {
  await store().newProject('brooks')
  await settle()
})

describe('스텝 실행 (SIM-05)', () => {
  it('실행 중이 아닐 때 스텝은 시각 0에서 멈춘 실행을 시작해 1일 진행한다', async () => {
    expect(store().paused).toBe(false)
    store().step()
    expect(store().status).toBe('running')
    expect(store().paused).toBe(true)
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
    expect(store().runs).toHaveLength(1) // 끝나기 전에는 기록이 늘지 않는다(새 프로젝트의 기준 실행 하나뿐)
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(2, 9))
    expect(store().status).toBe('running')
    expect(store().paused).toBe(true)
  })

  it('스텝으로 따라간 뒤 계속하면 한 번에 실행한 것과 같은 결과가 기록된다', async () => {
    const whole = store().runs[0]! // 새 프로젝트가 한 번에 실행한 기준 실행
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(2, 9))
    store().resume()
    expect(store().paused).toBe(false)
    await settle()
    expect(store().runs).toHaveLength(2)
    const stepped = store().runs[1]!
    expect(stepped.kpis).toEqual(whole.kpis)
    expect(Array.from(stepped.result.time)).toEqual(Array.from(whole.result.time))
    expect(store().paused).toBe(false)
    expect(store().live).toBeNull()
  })

  it('멈춘 실행을 취소하면 기록 없이 끝난다', async () => {
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
    store().cancel()
    await settle()
    expect(store().runs).toHaveLength(1)
    expect(store().paused).toBe(false)
    expect(store().error).toBeNull()
  })

  it('리셋은 진행 중인 실행을 버리고 시각 0에서 멈춘 새 실행을 시작한다', async () => {
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
    await store().reset()
    expect(store().status).toBe('running')
    expect(store().paused).toBe(true)
    await vi.waitFor(() => expect(store().live?.time).toEqual([0]))
    expect(store().runs).toHaveLength(1)
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
  })

  it('실행 중이 아닐 때 리셋하면 시각 0에서 멈춘 실행이 시작된다', async () => {
    await store().reset()
    expect(store().status).toBe('running')
    expect(store().paused).toBe(true)
    store().cancel()
    await settle()
  })

  it('일시정지·계속은 실행 중이 아니면 아무것도 하지 않는다', () => {
    store().pause()
    store().resume()
    expect(store().status).toBe('idle')
    expect(store().paused).toBe(false)
  })

  it('입력 오류가 있으면 스텝도 시작하지 않는다', () => {
    store().setParamError('extra_people', '범위를 벗어났습니다')
    store().step()
    expect(store().status).toBe('idle')
    expect(store().paused).toBe(false)
  })

  it('멈춘 실행이 있어도 새 프로젝트를 만들면 정리된다', async () => {
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
    await store().newProject('brooks')
    await settle()
    expect(store().paused).toBe(false)
    expect(store().runs).toHaveLength(1) // 새 프로젝트의 기준 실행뿐
  })

  it('멈춘 동안에는 다른 실행을 시작할 수 없다', async () => {
    store().step()
    await vi.waitFor(() => expect(lastTime()).toBeCloseTo(1, 9))
    expect(await store().runScenarios('all')).toBeNull()
    store().cancel()
    await settle()
  })
})
