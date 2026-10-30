import type { ModelDef } from '../src'

/** 테스트용 모델 정의. 지정하지 않은 항목은 비어 있다. */
export function model(
  parts: {
    constants?: Record<string, number>
    levels?: Record<string, { init: string; inflows?: string[]; outflows?: string[] }>
    rates?: Record<string, string>
    auxiliaries?: Record<string, string>
    time?: Partial<ModelDef['time']>
    outputs?: string[]
    invariants?: ModelDef['invariants']
    tables?: ModelDef['tables']
  } = {}
): ModelDef {
  const flows = (m: Record<string, string> = {}) => Object.fromEntries(Object.entries(m).map(([k, expr]) => [k, { expr }]))
  return {
    meta: { id: 'test', name: 'test', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 10, dt: 0.25, ...parts.time },
    constants: Object.fromEntries(Object.entries(parts.constants ?? {}).map(([k, value]) => [k, { value }])),
    levels: Object.fromEntries(
      Object.entries(parts.levels ?? {}).map(([k, l]) => [k, { init: l.init, inflows: l.inflows ?? [], outflows: l.outflows ?? [] }])
    ),
    rates: flows(parts.rates),
    auxiliaries: flows(parts.auxiliaries),
    tables: parts.tables ?? {},
    outputs: parts.outputs ?? [],
    ...(parts.invariants ? { invariants: parts.invariants } : {})
  }
}
