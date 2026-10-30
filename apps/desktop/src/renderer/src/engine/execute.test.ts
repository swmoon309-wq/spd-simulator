import { describe, expect, it } from 'vitest'
import type { RunResult } from '@spd/sd-engine'
import { getEntry } from '../catalog'
import { runMonteCarlo, type InputSpec } from '@spd/analysis'
import { applyControl, executeMonteCarlo, executeReforecast, executeRun, newRunControl, type ExecuteDeps } from './execute'
import { getCompiledModel } from './models'
import type { WorkerOut } from './protocol'

function harness(opts: { cancelAfterMessages?: number; clock?: () => number } = {}) {
  const messages: WorkerOut[] = []
  let yields = 0
  const deps: ExecuteDeps = {
    post: (m) => void messages.push(m),
    isCancelled: () => opts.cancelAfterMessages !== undefined && messages.length >= opts.cancelAfterMessages,
    yieldToEventLoop: async () => void yields++,
    now: opts.clock ?? (() => 0)
  }
  return { messages, deps, yields: () => yields }
}

const done = (messages: WorkerOut[]) => messages.find((m) => m.type === 'done') as Extract<WorkerOut, { type: 'done' }>

describe('executeRun', () => {
  it('진행 메시지를 보내고 마지막에 결과를 보낸다', async () => {
    const h = harness()
    await executeRun({ id: 7, modelId: 'brooks', overrides: {} }, h.deps)
    const types = h.messages.map((m) => m.type)
    expect(types[0]).toBe('progress')
    expect(types[types.length - 1]).toBe('done')
    expect(types.filter((t) => t === 'done')).toHaveLength(1)
    expect(h.messages.every((m) => m.id === 7)).toBe(true)

    const fractions = h.messages.flatMap((m) => (m.type === 'progress' ? [m.fraction] : []))
    expect(fractions[0]).toBe(0)
    expect(fractions[fractions.length - 1]).toBe(1)
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1] as number)
  })

  it('Brooks 기준 실행 결과가 책 값(274일)이다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'brooks', overrides: {} }, h.deps)
    const result = done(h.messages).result
    expect(result.meta.completed).toBe(true)
    expect(getEntry('brooks').kpis(result).completionDay).toBeCloseTo(274.1, 1)
  })

  it('통합 프로젝트 모델도 같은 경로로 실행된다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'integrated-project', overrides: {} }, h.deps)
    const result = done(h.messages).result
    const k = getEntry('integrated-project').kpis(result)
    expect(result.meta.completed).toBe(true)
    expect(result.meta.model).toBe('integrated-project')
    expect(k.completionDay).toBeGreaterThan(250)
    expect(k.completionDay).toBeLessThan(400)
    expect(k.peakStaff).toBeGreaterThan(4)
    const progress = h.messages.flatMap((m) => (m.type === 'progress' ? [m] : []))
    expect(progress[0]?.values).toHaveProperty('hr_total') // 모델의 outputs가 진행 값으로 온다
  })

  it('덮어쓴 파라미터가 결과에 반영된다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'brooks', overrides: { extra_people: 10 } }, h.deps)
    const day = getEntry('brooks').kpis(done(h.messages).result).completionDay as number
    expect(day).toBeGreaterThan(290)
  })

  it('실행 설정(종료 시각·dt)이 반영된다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'brooks', overrides: {}, options: { end: 100, dt: 0.5 } }, h.deps)
    const result = done(h.messages).result
    expect(result.meta.dt).toBe(0.5)
    expect(result.time[result.time.length - 1]).toBe(100)
    expect(result.time).toHaveLength(201)
    expect(getEntry('brooks').kpis(result).completionDay).toBeNull() // 100일에는 아직 끝나지 않는다
  })

  it('취소하면 그때까지의 결과를 completed=false로 보낸다', async () => {
    const h = harness({ cancelAfterMessages: 5 })
    await executeRun({ id: 1, modelId: 'brooks', overrides: {} }, h.deps)
    const result: RunResult = done(h.messages).result
    expect(result.meta.completed).toBe(false)
    expect(result.time.length).toBeGreaterThan(1)
    expect(result.time.length).toBeLessThan(1601)
  })

  it('계산이 오래 걸리면 이벤트 루프에 양보한다', async () => {
    let t = 0
    const h = harness({ clock: () => (t += 20) }) // 호출할 때마다 20ms 경과
    await executeRun({ id: 1, modelId: 'brooks', overrides: {} }, h.deps)
    expect(h.yields()).toBeGreaterThan(0)
    expect(done(h.messages).result.meta.completed).toBe(true)
  })

  it('잘못된 덮어쓰기는 error 메시지로 알린다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'brooks', overrides: { nope: 1 } }, h.deps)
    expect(h.messages).toHaveLength(1)
    expect(h.messages[0]).toMatchObject({ type: 'error', id: 1 })
    expect((h.messages[0] as Extract<WorkerOut, { type: 'error' }>).message).toContain('nope')
  })

  it('알 수 없는 모델은 error로 알린다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'zzz', overrides: {} }, h.deps)
    expect(h.messages[0]).toMatchObject({ type: 'error' })
  })
})

describe('executeReforecast (E5)', () => {
  const run = (req: Partial<Parameters<typeof executeReforecast>[0]> = {}) => {
    const messages: WorkerOut[] = []
    executeReforecast(
      {
        id: 7,
        modelId: 'integrated-project',
        overrides: {},
        observed: { day: 100, cum: { prod_tasks_developed: 300, prod_tasks_qaed: 250, prod_tasks_tested: 200 }, effort: 600, headcount: 8 },
        kappas: [{ name: 'cum', kappa: 0.9 }, { name: 'recent', kappa: 1.1 }],
        ...req
      },
      { post: (m) => void messages.push(m) }
    )
    return messages
  }
  it('결과를 reforecastDone으로 보낸다(κ마다 한 번씩)', () => {
    const m = run()
    expect(m).toHaveLength(1)
    const msg = m[0] as Extract<WorkerOut, { type: 'reforecastDone' }>
    expect(msg.type).toBe('reforecastDone')
    expect(msg.id).toBe(7)
    expect(msg.outcome.atDay).toBe(100)
    expect(msg.outcome.runs.map((r) => r.name)).toEqual(['cum', 'recent'])
    expect(msg.outcome.runs[0]!.result.time[0]).toBe(100)
  })
  it('재예측을 지원하지 않는 모델·잘못된 입력은 error로 알린다', () => {
    expect(run({ modelId: 'zzz' })[0]).toMatchObject({ type: 'error', id: 7 })
    const bad = run({ observed: { day: 0, cum: {}, effort: 0 } })[0] as Extract<WorkerOut, { type: 'error' }>
    expect(bad.type).toBe('error')
    expect(bad.message).toContain('보고일')
    expect((run({ kappas: [] })[0] as Extract<WorkerOut, { type: 'error' }>).message).toContain('보정 계수')
  })
  it('Brooks도 지원한다', () => {
    const m = run({ modelId: 'brooks', observed: { day: 60, cum: { developed_software: 110 }, effort: 1200, headcount: 20 }, kappas: [{ name: 'k', kappa: 1 }] })
    expect(m[0]!.type).toBe('reforecastDone')
  })
})

describe('executeMonteCarlo (E6)', () => {
  const prod: InputSpec = { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 }, min: 0.001, max: 10 }
  const req = (over: Partial<Parameters<typeof executeMonteCarlo>[0]> = {}) => ({ id: 3, modelId: 'brooks', overrides: {}, options: {}, inputs: [prod], n: 60, seed: 4, ...over })
  const done = (m: WorkerOut[]) => m.find((x) => x.type === 'mcDone') as Extract<WorkerOut, { type: 'mcDone' }>
  /** 호출할 때마다 20ms가 흐르는 가짜 시계 */
  const ticking = () => {
    let t = 0
    return () => (t += 20)
  }
  const direct = (n: number) => runMonteCarlo({ model: getCompiledModel('brooks'), baseParams: {}, options: {}, inputs: [prod], n, seed: 4, kpis: getEntry('brooks').kpiSpecs })

  it('끝까지 실행하면 mcDone을 한 번 보내고 직접 실행한 결과와 같다', async () => {
    const h = harness()
    await executeMonteCarlo(req(), h.deps)
    expect(h.messages.filter((m) => m.type === 'mcDone')).toHaveLength(1)
    const d = done(h.messages)
    expect(d.canceled).toBe(false)
    expect(d.result.completed).toBe(60)
    const full = direct(60)
    expect(Array.from(d.result.kpis[0] as Float64Array)).toEqual(Array.from(full.kpis[0] as Float64Array))
    expect(d.result.kpiIds).toEqual(getEntry('brooks').kpiSpecs.map((k) => k.id))
  })

  it('진행 메시지는 0에서 시작하고 늘기만 하며 모든 메시지가 같은 id를 가진다', async () => {
    const h = harness({ clock: ticking() })
    await executeMonteCarlo(req({ n: 80 }), h.deps)
    const p = h.messages.flatMap((m) => (m.type === 'mcProgress' ? [m] : []))
    expect(p[0]).toMatchObject({ completed: 0, total: 80 })
    for (let i = 1; i < p.length; i++) expect(p[i]!.completed).toBeGreaterThanOrEqual(p[i - 1]!.completed)
    expect(p.length).toBeGreaterThan(2)
    expect(h.messages.every((m) => m.id === 3)).toBe(true)
  })

  it('가끔 중간 결과(snapshot)를 붙이고, 그 내용은 그 시점까지 끝난 반복과 같다', async () => {
    const h = harness({ clock: ticking() })
    await executeMonteCarlo(req({ n: 100 }), h.deps)
    const withSnap = h.messages.flatMap((m) => (m.type === 'mcProgress' && m.snapshot ? [m] : []))
    expect(withSnap.length).toBeGreaterThan(0)
    expect(withSnap.length).toBeLessThan(h.messages.length / 2) // 매번 붙이지 않는다
    const full = direct(100)
    for (const m of withSnap) {
      expect(m.snapshot!.completed).toBe(m.completed)
      expect(Array.from(m.snapshot!.kpis[0] as Float64Array)).toEqual(Array.from(full.kpis[0] as Float64Array).slice(0, m.completed))
    }
  })

  it('계산이 오래 걸리면 이벤트 루프에 양보한다', async () => {
    const h = harness({ clock: ticking() })
    await executeMonteCarlo(req(), h.deps)
    expect(h.yields()).toBeGreaterThan(5)
  })

  it('취소하면 끝난 반복의 결과를 canceled=true로 보낸다(전체의 앞부분과 같다)', async () => {
    const h = harness({ clock: ticking(), cancelAfterMessages: 6 })
    await executeMonteCarlo(req({ n: 200 }), h.deps)
    const d = done(h.messages)
    expect(d.canceled).toBe(true)
    expect(d.result.completed).toBeGreaterThan(0)
    expect(d.result.completed).toBeLessThan(200)
    expect(d.result.n).toBe(200)
    expect((d.result.kpis[0] as Float64Array).length).toBe(d.result.completed)
    expect(Array.from(d.result.kpis[0] as Float64Array)).toEqual(Array.from(direct(200).kpis[0] as Float64Array).slice(0, d.result.completed))
  })

  it('시계열 띠를 요청하면 결과에 담는다', async () => {
    const h = harness()
    await executeMonteCarlo(req({ n: 10, band: { variable: 'developed_software' } }), h.deps)
    const d = done(h.messages)
    expect(d.result.band?.variable).toBe('developed_software')
    expect(d.result.band?.time.length).toBe(401)
    expect(d.result.band?.values.length).toBe(10 * 401)
  })

  it('통합 모델도 실행한다', async () => {
    const h = harness()
    await executeMonteCarlo(
      req({ modelId: 'integrated-project', n: 8, inputs: [{ name: 'pro_prod', dist: { kind: 'uniform', min: 0.8, max: 1.2 }, min: 0.1, max: 3 }] }),
      h.deps
    )
    expect(done(h.messages).result.completed).toBe(8)
  })

  it.each([
    ['반복 0', { n: 0 }, '반복 수'],
    ['반복 상한 초과', { n: 5001 }, '반복 수'],
    ['입력 없음', { inputs: [] }, '하나 이상'],
    ['상수가 아닌 입력', { inputs: [{ ...prod, name: 'requirements' }] }, '상수가 아닙니다'],
    ['분포가 허용 범위 밖', { inputs: [{ ...prod, dist: { kind: 'uniform' as const, min: 0.0001, max: 1 } }] }, '허용 범위'],
    ['알 수 없는 모델', { modelId: 'zzz' }, '알 수 없는 모델'],
    ['없는 시계열 변수', { band: { variable: 'nope' } }, '모델에 없습니다']
  ])('error로 알린다: %s', async (_n, over, msg) => {
    const h = harness()
    await executeMonteCarlo(req(over as never), h.deps)
    expect(h.messages).toHaveLength(1)
    expect(h.messages[0]).toMatchObject({ type: 'error', id: 3 })
    expect((h.messages[0] as Extract<WorkerOut, { type: 'error' }>).message).toContain(msg)
  })
})

describe('executeRun 일시정지·스텝 (SIM-05)', () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0))
  const progressOf = (messages: WorkerOut[]) => messages.flatMap((m) => (m.type === 'progress' ? [m] : []))

  it('멈춘 채 시작하면 시각 0만 알리고 기다린다', async () => {
    const h = harness()
    const control = newRunControl()
    const p = executeRun({ id: 1, modelId: 'brooks', overrides: {}, startPaused: true }, { ...h.deps, control })
    await tick()
    expect(h.messages.map((m) => m.type)).toEqual(['progress'])
    expect(progressOf(h.messages)[0]?.fraction).toBe(0)
    applyControl(control, 'resume')
    await p
    expect(done(h.messages).result.meta.completed).toBe(true)
  })

  it('스텝은 요청한 만큼만 진행하고 그 시점을 알린 뒤 다시 멈춘다', async () => {
    const h = harness()
    const control = newRunControl()
    const p = executeRun({ id: 1, modelId: 'brooks', overrides: {}, options: { dt: 0.25 }, startPaused: true }, { ...h.deps, control })
    await tick()
    applyControl(control, 'step', 4) // 1일
    await tick()
    const seen = progressOf(h.messages)
    expect(seen).toHaveLength(2)
    expect(seen[1]?.time).toBeCloseTo(1, 12)
    expect(h.messages.some((m) => m.type === 'done')).toBe(false)
    applyControl(control, 'step', 4)
    await tick()
    expect(progressOf(h.messages).map((m) => m.time)).toEqual([0, 1, 2])
    applyControl(control, 'resume')
    await p
  })

  it('스텝과 계속을 섞어도 한 번에 끝까지 실행한 결과와 비트 단위로 같다', async () => {
    const whole = harness()
    await executeRun({ id: 1, modelId: 'brooks', overrides: {} }, whole.deps)
    const h = harness()
    const control = newRunControl()
    const p = executeRun({ id: 1, modelId: 'brooks', overrides: {}, startPaused: true }, { ...h.deps, control })
    await tick()
    applyControl(control, 'step', 7)
    await tick()
    applyControl(control, 'step', 1)
    await tick()
    applyControl(control, 'resume')
    await p
    const a = done(whole.messages).result
    const b = done(h.messages).result
    expect(Array.from(b.time)).toEqual(Array.from(a.time))
    for (const name of Object.keys(a.series)) expect(Array.from(b.series[name] as Float64Array)).toEqual(Array.from(a.series[name] as Float64Array))
  })

  it('실행 중에 일시정지하면 진행을 멈추고 계속하면 끝낸다', async () => {
    let tickNow = 0
    const h = harness({ clock: () => (tickNow += 20) }) // 청크마다 양보한다
    const control = newRunControl()
    let yielded = 0
    const deps: ExecuteDeps = {
      ...h.deps,
      control,
      yieldToEventLoop: async () => {
        if (++yielded === 3) applyControl(control, 'pause')
      }
    }
    const p = executeRun({ id: 1, modelId: 'brooks', overrides: {} }, deps)
    await tick()
    const count = h.messages.length
    expect(h.messages.some((m) => m.type === 'done')).toBe(false)
    const last = progressOf(h.messages).at(-1) as { fraction: number }
    expect(last.fraction).toBeGreaterThan(0)
    expect(last.fraction).toBeLessThan(1)
    await tick()
    expect(h.messages).toHaveLength(count) // 멈춘 동안 더 진행하지 않는다
    applyControl(control, 'resume')
    await p
    expect(done(h.messages).result.meta.completed).toBe(true)
  })

  it('멈춰 있을 때 취소하면 그때까지의 결과를 completed=false로 돌려준다', async () => {
    const h = harness()
    const control = newRunControl()
    let cancelled = false
    const p = executeRun({ id: 1, modelId: 'brooks', overrides: {}, options: { dt: 0.25 }, startPaused: true }, { ...h.deps, control, isCancelled: () => cancelled })
    await tick()
    applyControl(control, 'step', 8)
    await tick()
    cancelled = true
    control.wake?.()
    await p
    const result = done(h.messages).result
    expect(result.meta.completed).toBe(false)
    expect(result.time.at(-1)).toBeCloseTo(2, 12)
  })

  it('끝까지 스텝으로 진행하면 완료된다', async () => {
    const h = harness()
    const control = newRunControl()
    const p = executeRun({ id: 1, modelId: 'brooks', overrides: {}, options: { end: 5, dt: 1 }, startPaused: true }, { ...h.deps, control })
    await tick()
    applyControl(control, 'step', 100)
    await p
    expect(done(h.messages).result.meta.completed).toBe(true)
    expect(Array.from(done(h.messages).result.time)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('control이 없으면 지금처럼 멈추지 않는다', async () => {
    const h = harness()
    await executeRun({ id: 1, modelId: 'brooks', overrides: {}, startPaused: true }, h.deps)
    expect(done(h.messages).result.meta.completed).toBe(true)
  })
})

describe('사용자 모델 등록 (Worker 쪽 카탈로그)', () => {
  it('registerModel만으로 Monte Carlo·실행이 된다(화면이 아니라 Worker처럼 카탈로그에 항목이 없는 상태에서)', async () => {
    const { docFromBuiltin } = await import('../catalog/exportDoc')
    const { validateModelDoc } = await import('../lib/modelDoc')
    const { applyRegisterModel } = await import('./registerModel')
    const { catalog } = await import('../catalog')
    const { unregisterEntry } = await import('../catalog')
    const { unregisterUserModel } = await import('./models')
    const v = validateModelDoc(docFromBuiltin(getEntry('brooks'), { name: 'Worker 시험', random: () => 0.6 }))
    if (!v.ok) throw new Error(v.message)
    const id = v.doc.def.meta.id
    expect(catalog.some((m) => m.id === id)).toBe(false)
    try {
      expect(applyRegisterModel({ id, hash: v.hash, doc: v.doc })).toBe(true)
      expect(applyRegisterModel({ id, hash: v.hash, doc: v.doc })).toBe(false) // 같은 해시는 다시 하지 않는다

      const h = harness()
      await executeRun({ id: 1, modelId: id, overrides: {} }, h.deps)
      expect(done(h.messages).result.meta.completed).toBe(true)

      const prod: InputSpec = { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 }, min: 0.001, max: 10 }
      const m = harness()
      await executeMonteCarlo({ id: 2, modelId: id, overrides: {}, options: {}, inputs: [prod], n: 20, seed: 4 }, m.deps)
      expect(m.messages.find((x) => x.type === 'error')).toBeUndefined()
      const mc = m.messages.find((x) => x.type === 'mcDone') as Extract<WorkerOut, { type: 'mcDone' }>
      expect(mc.result.completed).toBe(20)
      expect(mc.result.kpiIds).toEqual(['completionDay', 'totalEffort', 'peakStaff'])
    } finally {
      unregisterEntry(id)
      unregisterUserModel(id)
    }
  })

  it('등록하지 않은 모델은 알 수 없는 모델 오류로 알린다', async () => {
    const m = harness()
    await executeMonteCarlo({ id: 2, modelId: 'user-nobody-00000000', overrides: {}, options: {}, inputs: [], n: 5, seed: 1 }, m.deps)
    expect(m.messages.find((x) => x.type === 'error')).toMatchObject({ message: expect.stringContaining('알 수 없는 모델') })
  })
})
