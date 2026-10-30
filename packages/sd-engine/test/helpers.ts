import { compile, createRuntime, StateStore, type Runtime, type Table } from '../src'

export interface Harness {
  rt: Runtime
  store: StateStore
  evalNow: () => number
}

/** 변수 맵과 수식 하나로 테스트용 실행 환경을 만든다. */
export function harness(
  source: string,
  opts: { vars?: Record<string, number>; tables?: Record<string, Table>; dt?: number; seed?: number } = {}
) {
  const names = Object.keys(opts.vars ?? {})
  const slot = new Map(names.map((n, i) => [n, i]))
  const store = new StateStore()
  const compiled = compile(source, {
    resolve: (n) => slot.get(n),
    state: store,
    ...(opts.tables ? { tables: opts.tables } : {})
  })
  const rt = createRuntime({ slots: names.length, store, dt: opts.dt ?? 0.25, seed: opts.seed ?? 1 })
  names.forEach((n, i) => {
    rt.values[i] = (opts.vars as Record<string, number>)[n] as number
  })
  return { compiled, rt, store }
}

/** 상수 수식을 한 번 평가한다. */
export function value(source: string, vars: Record<string, number> = {}, time = 0): number {
  const { compiled, rt } = harness(source, { vars })
  rt.time = time
  return compiled.eval(rt)
}

/** 변수 없는 수식을 정상 상태로 초기화한 뒤 end까지 실행해 시계열을 돌려준다. */
export function simulate(source: string, dt: number, end: number): { t: number[]; y: number[] } {
  const { compiled, rt, store } = harness(source, { dt })
  rt.initializing = true
  compiled.eval(rt)
  store.initAll(rt)
  rt.initializing = false
  const t: number[] = []
  const y: number[] = []
  const steps = Math.round(end / dt)
  for (let k = 0; k <= steps; k++) {
    rt.time = k * dt
    t.push(rt.time)
    y.push(compiled.eval(rt))
    store.updateAll(rt)
  }
  return { t, y }
}
