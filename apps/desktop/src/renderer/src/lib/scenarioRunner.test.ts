import { describe, expect, it } from 'vitest'
import type { RunResult } from '@spd/sd-engine'
import {
  allTasks,
  BASE_ID,
  createControl,
  executeBatch,
  planBatch,
  ResultCache,
  rowStatus,
  taskFor,
  type BatchDeps,
  type RunHandle,
  type RunTask,
  type ScenarioInputs,
  type ScenarioRun
} from './scenarioRunner'
import { defaultParams } from './params'
import { defaultRunSettings } from './runSettings'
import { getEntry } from '../catalog'

const result = (tag: number, completed = true): RunResult => ({
  time: Float64Array.of(0, tag),
  series: { x: Float64Array.of(0, tag) },
  meta: { model: 't', version: 1, dt: 1, seed: 1, completed }
})
const task = (id: string, key = `k-${id}`): RunTask => ({ id, key, modelId: 'brooks', params: { who: id.length }, settings: { end: 1, dt: 1, seed: 1 } })
const done = (key: string, tag = 1): ScenarioRun => ({ phase: 'idle', progress: 0, result: result(tag), resultKey: key })

describe('ResultCache', () => {
  it('저장한 결과를 돌려주고 없는 키는 undefined', () => {
    const c = new ResultCache()
    const r = result(1)
    c.set('a', r)
    expect(c.get('a')).toBe(r)
    expect(c.get('b')).toBeUndefined()
  })
  it('한도를 넘으면 가장 오래 쓰지 않은 것부터 버린다', () => {
    const c = new ResultCache(2)
    c.set('a', result(1))
    c.set('b', result(2))
    c.get('a') // a를 최근으로
    c.set('c', result(3))
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBeDefined()
    expect(c.get('c')).toBeDefined()
    expect(c.size).toBe(2)
  })
  it('같은 키를 다시 넣으면 값이 바뀌고 개수는 늘지 않는다', () => {
    const c = new ResultCache(3)
    c.set('a', result(1))
    const r2 = result(2)
    c.set('a', r2)
    expect(c.get('a')).toBe(r2)
    expect(c.size).toBe(1)
  })
  it('clear', () => {
    const c = new ResultCache()
    c.set('a', result(1))
    c.clear()
    expect(c.size).toBe(0)
  })
})

describe('rowStatus', () => {
  const key = 'now'
  it.each<[string, ScenarioRun | undefined, string]>([
    ['행이 없음', undefined, 'none'],
    ['실행 전', { phase: 'idle', progress: 0 }, 'none'],
    ['대기', { phase: 'queued', progress: 0 }, 'queued'],
    ['실행 중', { phase: 'running', progress: 0.4 }, 'running'],
    ['최신 결과', done('now'), 'done'],
    ['입력이 바뀜', done('old'), 'stale'],
    ['같은 입력의 오류', { phase: 'idle', progress: 0, error: { message: '실패', key: 'now' } }, 'error'],
    ['입력이 바뀐 뒤의 옛 오류', { phase: 'idle', progress: 0, error: { message: '실패', key: 'old' } }, 'none'],
    ['옛 오류와 옛 결과', { ...done('older'), error: { message: '실패', key: 'old' } }, 'stale']
  ])('%s → %s', (_n, run, kind) => {
    expect(rowStatus(run, key).kind).toBe(kind)
  })
  it('실행 중에는 진행률을, 오류에는 메시지를 담는다', () => {
    expect(rowStatus({ phase: 'running', progress: 0.4 }, key)).toEqual({ kind: 'running', progress: 0.4 })
    expect(rowStatus({ phase: 'idle', progress: 0, error: { message: '수치 오류', key } }, key)).toEqual({ kind: 'error', message: '수치 오류' })
  })
  it('실행 중·대기 상태가 결과보다 우선한다', () => {
    expect(rowStatus({ ...done('now'), phase: 'running', progress: 0.1 }, key).kind).toBe('running')
    expect(rowStatus({ ...done('now'), phase: 'queued' }, key).kind).toBe('queued')
  })
  it('같은 입력의 오류가 있으면 오래된 결과보다 오류를 보인다', () => {
    expect(rowStatus({ ...done('old'), error: { message: 'x', key } }, key).kind).toBe('error')
  })
})

describe('taskFor / allTasks', () => {
  const entry = getEntry('brooks')
  const inputs = (over: Partial<ScenarioInputs> = {}): ScenarioInputs => ({
    modelId: 'brooks',
    params: defaultParams(entry),
    settings: { ...defaultRunSettings(entry) },
    scenarios: [
      { id: 's1', name: 'a', overrides: { extra_people: 5 } },
      { id: 's2', name: 'b', overrides: {} }
    ],
    ...over
  })

  it('기준은 기본 설정, 시나리오는 기본 설정 + overrides로 입력을 만든다', () => {
    const i = inputs()
    expect(taskFor(i, BASE_ID)?.params['extra_people']).toBe(0)
    expect(taskFor(i, 's1')?.params['extra_people']).toBe(5)
    expect(taskFor(i, 's1')?.params['hire_day']).toBe(110)
  })
  it('목록 순서(기준 먼저)로 모든 행을 돌려주고 없는 시나리오는 null', () => {
    expect(allTasks(inputs()).map((t) => t.id)).toEqual([BASE_ID, 's1', 's2'])
    expect(taskFor(inputs(), 'zzz')).toBeNull()
  })
  it('override가 없는 시나리오는 기준과 입력 키가 같다', () => {
    const i = inputs()
    expect(taskFor(i, 's2')?.key).toBe(taskFor(i, BASE_ID)?.key)
    expect(taskFor(i, 's1')?.key).not.toBe(taskFor(i, BASE_ID)?.key)
  })
  it('기본 설정이나 실행 설정이 바뀌면 키가 바뀐다', () => {
    const a = taskFor(inputs(), 's1')?.key
    expect(taskFor(inputs({ params: { ...defaultParams(entry), hire_day: 100 } }), 's1')?.key).not.toBe(a)
    expect(taskFor(inputs({ settings: { ...defaultRunSettings(entry), seed: 9 } }), 's1')?.key).not.toBe(a)
  })
  it('시나리오의 값을 기본 설정과 같게 하면 키가 기준과 같아진다', () => {
    const i = inputs({ params: { ...defaultParams(entry), extra_people: 5 } })
    expect(taskFor(i, 's1')?.key).toBe(taskFor(i, BASE_ID)?.key)
  })
})

describe('planBatch', () => {
  const tasks = [task('a'), task('b'), task('c')]
  const noRows = {}

  it('missing: 결과가 없는 행은 모두 실행한다', () => {
    const p = planBatch(tasks, noRows, new ResultCache(), 'missing')
    expect(p.groups.map((g) => g.ids)).toEqual([['a'], ['b'], ['c']])
    expect(p.skipped).toEqual([])
  })
  it('missing: 최신 결과가 있는 행은 건너뛰고 오래된 행만 실행한다', () => {
    const rows = { a: done('k-a'), b: done('old-b') }
    const p = planBatch(tasks, rows, new ResultCache(), 'missing')
    expect(p.skipped).toEqual(['a'])
    expect(p.groups.map((g) => g.ids)).toEqual([['b'], ['c']])
  })
  it('missing: 같은 입력에서 이미 실패한 행은 다시 실행하지 않는다', () => {
    const rows: Record<string, ScenarioRun> = { b: { phase: 'idle', progress: 0, error: { message: 'x', key: 'k-b' } } }
    const p = planBatch(tasks, rows, new ResultCache(), 'missing')
    expect(p.skipped).toEqual(['b'])
    expect(p.groups.map((g) => g.ids)).toEqual([['a'], ['c']])
  })
  it('missing: 입력이 바뀐 뒤에는 옛 실패를 무시하고 다시 실행한다', () => {
    const rows: Record<string, ScenarioRun> = { b: { phase: 'idle', progress: 0, error: { message: 'x', key: 'older' } } }
    expect(planBatch(tasks, rows, new ResultCache(), 'missing').groups.map((g) => g.ids)).toEqual([['a'], ['b'], ['c']])
  })
  it('missing: 캐시에 있으면 실행하지 않고 가져온다', () => {
    const cache = new ResultCache()
    const r = result(7)
    cache.set('k-b', r)
    const p = planBatch(tasks, noRows, cache, 'missing')
    expect(p.fromCache).toEqual([{ ids: ['b'], key: 'k-b', result: r, params: { who: 1 } }])
    expect(p.groups.map((g) => g.ids)).toEqual([['a'], ['c']])
  })
  it('같은 입력의 행은 한 번만 실행하고 결과를 나눠 갖는다', () => {
    const same = [task('a', 'K'), task('b', 'K'), task('c', 'K2')]
    const p = planBatch(same, noRows, new ResultCache(), 'missing')
    expect(p.groups.map((g) => [g.key, g.ids])).toEqual([['K', ['a', 'b']], ['K2', ['c']]])
  })
  it('같은 입력의 행이 캐시에 있으면 한 번만 가져와 모두 채운다', () => {
    const cache = new ResultCache()
    cache.set('K', result(1))
    const p = planBatch([task('a', 'K'), task('b', 'K')], noRows, cache, 'missing')
    expect(p.fromCache).toHaveLength(1)
    expect(p.fromCache[0]?.ids).toEqual(['a', 'b'])
    expect(p.groups).toEqual([])
  })
  it('all: 최신 결과와 캐시와 이전 실패를 무시하고 모두 다시 실행한다', () => {
    const cache = new ResultCache()
    cache.set('k-a', result(1))
    const rows: Record<string, ScenarioRun> = { a: done('k-a'), b: { phase: 'idle', progress: 0, error: { message: 'x', key: 'k-b' } } }
    const p = planBatch(tasks, rows, cache, 'all')
    expect(p.skipped).toEqual([])
    expect(p.fromCache).toEqual([])
    expect(p.groups.map((g) => g.ids)).toEqual([['a'], ['b'], ['c']])
  })
  it('all: 같은 입력은 그래도 한 번만 실행한다', () => {
    const p = planBatch([task('a', 'K'), task('b', 'K')], noRows, new ResultCache(), 'all')
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]?.ids).toEqual(['a', 'b'])
  })
  it('모두 최신이면 할 일이 없다', () => {
    const rows = { a: done('k-a'), b: done('k-b'), c: done('k-c') }
    const p = planBatch(tasks, rows, new ResultCache(), 'missing')
    expect(p.groups).toEqual([])
    expect(p.skipped).toEqual(['a', 'b', 'c'])
  })
})

/** 제어 가능한 가짜 실행기: 호출 순서, 동시 실행 수, 진행률, 실패, 취소를 시험한다. */
function harness(opts: { fail?: (t: RunTask) => string | null; holdOn?: string } = {}) {
  const rows: Record<string, ScenarioRun> = {}
  const log: string[] = []
  const cache = new ResultCache()
  let running = 0
  let maxRunning = 0
  const pending: { release(): void; id: string }[] = []
  let calls = 0

  const deps: BatchDeps = {
    cache,
    update(ids, patch) {
      for (const id of ids) rows[id] = { ...(rows[id] ?? { phase: 'idle', progress: 0 }), ...patch }
    },
    start(t, onProgress): RunHandle {
      calls++
      log.push(`start:${t.id}`)
      running++
      maxRunning = Math.max(maxRunning, running)
      let resolve!: (r: RunResult) => void
      let reject!: (e: Error) => void
      const promise = new Promise<RunResult>((res, rej) => ((resolve = res), (reject = rej)))
      const finish = () => {
        running--
        const message = opts.fail?.(t)
        if (message) reject(new Error(message))
        else resolve(result(calls))
      }
      const hold = opts.holdOn === t.id
      onProgress(0.5)
      if (hold) {
        pending.push({ id: t.id, release: finish })
        return {
          promise,
          cancel() {
            running--
            log.push(`cancel:${t.id}`)
            resolve(result(0, false))
          }
        }
      }
      queueMicrotask(finish)
      return { promise, cancel() {} }
    }
  }
  return { rows, log, cache, deps, pending, maxRunning: () => maxRunning, calls: () => calls }
}
const planFor = (ids: string[]) => planBatch(ids.map((i) => task(i)), {}, new ResultCache(), 'all')

describe('executeBatch', () => {
  it('목록 순서대로 하나씩 실행하고 동시에 둘 이상 실행하지 않는다', async () => {
    const h = harness()
    const out = await executeBatch(planFor(['a', 'b', 'c']), h.deps, createControl())
    expect(h.log).toEqual(['start:a', 'start:b', 'start:c'])
    expect(h.maxRunning()).toBe(1)
    expect(out).toEqual({ completed: 3, failed: 0, canceled: false })
  })

  it('끝난 행에 결과와 입력 키를 남기고 진행·오류를 정리한다', async () => {
    const h = harness()
    await executeBatch(planFor(['a']), h.deps, createControl())
    expect(h.rows['a']).toMatchObject({ phase: 'idle', progress: 0, resultKey: 'k-a' })
    expect(h.rows['a']?.result?.meta.completed).toBe(true)
    expect(h.rows['a']?.error).toBeUndefined()
  })

  it('결과와 함께 그 결과를 만든 파라미터를 행에 남긴다(캐시에서 가져온 행도)', async () => {
    const h = harness()
    const cached = result(9)
    h.cache.set('k-a', cached)
    const plan = planBatch([{ ...task('a'), params: { x: 1 } }, { ...task('b'), params: { x: 2 } }], {}, h.cache, 'missing')
    await executeBatch(plan, h.deps, createControl())
    expect(h.rows['a']?.resultParams).toEqual({ x: 1 })
    expect(h.rows['b']?.resultParams).toEqual({ x: 2 })
  })

  it('실행 전에 모든 대상이 대기 상태가 되고, 진행률이 실행 중인 행에 전달된다', async () => {
    const h = harness({ holdOn: 'a' })
    const p = executeBatch(planFor(['a', 'b']), h.deps, createControl())
    await Promise.resolve()
    expect(h.rows['a']).toMatchObject({ phase: 'running', progress: 0.5 })
    expect(h.rows['b']).toMatchObject({ phase: 'queued' })
    h.pending[0]?.release()
    await p
    expect(h.rows['b']?.phase).toBe('idle')
  })

  it('한 입력이 실패해도 나머지는 계속하고 실패한 행에 오류와 입력 키를 남긴다', async () => {
    const h = harness({ fail: (t) => (t.id === 'b' ? '수치 오류: x' : null) })
    const out = await executeBatch(planFor(['a', 'b', 'c']), h.deps, createControl())
    expect(h.log).toEqual(['start:a', 'start:b', 'start:c'])
    expect(out).toEqual({ completed: 2, failed: 1, canceled: false })
    expect(h.rows['b']?.error).toEqual({ message: '수치 오류: x', key: 'k-b' })
    expect(h.rows['b']?.result).toBeUndefined()
    expect(h.rows['a']?.result).toBeDefined()
    expect(h.rows['c']?.result).toBeDefined()
    expect(h.rows['b']?.phase).toBe('idle')
  })

  it('실패해도 이전에 성공한 결과는 지우지 않는다(오래됨으로 남는다)', async () => {
    const h = harness({ fail: () => '실패' })
    h.rows['a'] = done('old-key', 5)
    await executeBatch(planFor(['a']), h.deps, createControl())
    expect(h.rows['a']?.result).toBeDefined()
    expect(h.rows['a']?.resultKey).toBe('old-key')
    expect(h.rows['a']?.error?.key).toBe('k-a')
  })

  it('성공하면 이전 오류를 지운다', async () => {
    const h = harness()
    h.rows['a'] = { phase: 'idle', progress: 0, error: { message: '옛 오류', key: 'k-a' } }
    await executeBatch(planFor(['a']), h.deps, createControl())
    expect(h.rows['a']?.error).toBeUndefined()
  })

  it('성공한 결과는 캐시에 들어가고 같은 입력의 행들이 나눠 갖는다', async () => {
    const h = harness()
    const plan = planBatch([task('a', 'K'), task('b', 'K')], {}, h.cache, 'missing')
    await executeBatch(plan, h.deps, createControl())
    expect(h.calls()).toBe(1)
    expect(h.cache.get('K')).toBeDefined()
    expect(h.rows['a']?.result).toBe(h.rows['b']?.result)
  })

  it('캐시에서 가져올 행은 실행하지 않고 바로 채운다', async () => {
    const h = harness()
    const cached = result(9)
    h.cache.set('k-a', cached)
    const plan = planBatch([task('a'), task('b')], {}, h.cache, 'missing')
    await executeBatch(plan, h.deps, createControl())
    expect(h.log).toEqual(['start:b'])
    expect(h.rows['a']?.result).toBe(cached)
    expect(h.rows['a']?.resultKey).toBe('k-a')
  })

  it('실행 중에 취소하면 그 실행을 멈추고 대기 중인 입력은 시작하지 않으며 끝난 결과는 유지한다', async () => {
    const h = harness({ holdOn: 'b' })
    const control = createControl()
    h.rows['c'] = done('old-c', 3) // 대기 중인 행의 이전 결과
    const p = executeBatch(planFor(['a', 'b', 'c', 'd']), h.deps, control)
    await vi_waitFor(() => h.pending.length === 1)
    control.cancel()
    const out = await p
    expect(h.log).toEqual(['start:a', 'start:b', 'cancel:b'])
    expect(out.canceled).toBe(true)
    expect(out.completed).toBe(1)
    expect(h.rows['a']?.result).toBeDefined() // 끝난 것은 유지
    expect(h.rows['b']).toMatchObject({ phase: 'idle', progress: 0 })
    expect(h.rows['b']?.result).toBeUndefined()
    expect(h.rows['c']).toMatchObject({ phase: 'idle', resultKey: 'old-c' }) // 이전 결과 유지
    expect(h.rows['d']?.phase).toBe('idle')
    expect(h.cache.get('k-b')).toBeUndefined() // 중단된 실행은 캐시하지 않는다
  })

  it('시작하기 전에 취소하면 아무것도 실행하지 않고 모든 행이 대기에서 풀린다', async () => {
    const h = harness()
    const control = createControl()
    control.cancel()
    const out = await executeBatch(planFor(['a', 'b']), h.deps, control)
    expect(h.calls()).toBe(0)
    expect(out).toEqual({ completed: 0, failed: 0, canceled: true })
    expect(h.rows['a']?.phase).toBe('idle')
    expect(h.rows['b']?.phase).toBe('idle')
  })

  it('실패 뒤에 취소해도 앞서 끝난 결과와 오류를 모두 유지한다', async () => {
    const h = harness({ fail: (t) => (t.id === 'a' ? '실패' : null), holdOn: 'b' })
    const control = createControl()
    const p = executeBatch(planFor(['a', 'b', 'c']), h.deps, control)
    await vi_waitFor(() => h.pending.length === 1)
    control.cancel()
    await p
    expect(h.rows['a']?.error?.message).toBe('실패')
    expect(h.rows['c']?.phase).toBe('idle')
  })

  it('입력 하나가 끝날 때마다(성공·실패·취소 모두) 알린다', async () => {
    const h = harness({ fail: (t) => (t.id === 'b' ? '실패' : null), holdOn: 'c' })
    const finished: string[] = []
    const control = createControl()
    const p = executeBatch(planFor(['a', 'b', 'c', 'd']), { ...h.deps, onGroupFinished: (g) => finished.push(g.ids.join()) }, control)
    await vi_waitFor(() => h.pending.length === 1)
    control.cancel()
    await p
    expect(finished).toEqual(['a', 'b', 'c']) // 시작하지 못한 d는 알리지 않는다
  })

  it('작업이 없으면 바로 끝난다', async () => {
    const h = harness()
    expect(await executeBatch({ groups: [], fromCache: [], skipped: [] }, h.deps, createControl())).toEqual({ completed: 0, failed: 0, canceled: false })
  })

  it('완료 수는 같은 입력을 나눠 가진 행을 모두 센다', async () => {
    const h = harness()
    const out = await executeBatch(planBatch([task('a', 'K'), task('b', 'K'), task('c')], {}, h.cache, 'all'), h.deps, createControl())
    expect(out.completed).toBe(3)
    expect(h.calls()).toBe(2)
  })
})

async function vi_waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error('조건이 충족되지 않았습니다')
}
