import { describe, expect, it } from 'vitest'
import { EulerIntegrator, parseModelDef } from '../src'

describe('EulerIntegrator', () => {
  it('지수 성장 dx/dt = r·x 가 해석해에 근접한다', () => {
    const r = 0.05
    const dt = 0.25
    const state = new Float64Array([100])
    const euler = new EulerIntegrator()
    const deriv = (_t: number, s: Float64Array, out: Float64Array) => {
      out[0] = r * (s[0] as number)
    }
    for (let t = 0; t < 40 - 1e-9; t += dt) euler.step(deriv, t, dt, state)
    const exact = 100 * Math.exp(r * 40)
    expect(Math.abs((state[0] as number) - exact) / exact).toBeLessThan(0.02)
  })

  it('dt가 작을수록 오차가 줄어든다', () => {
    const run = (dt: number) => {
      const s = new Float64Array([1])
      const e = new EulerIntegrator()
      for (let t = 0; t < 10 - 1e-9; t += dt) {
        e.step((_t, x, o) => void (o[0] = x[0] as number), t, dt, s)
      }
      return Math.abs((s[0] as number) - Math.exp(10))
    }
    expect(run(0.125)).toBeLessThan(run(0.5))
  })
})

describe('modelDefSchema', () => {
  const valid = {
    meta: { id: 'm', name: 'm', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 10, dt: 0.25 },
    constants: { k: { value: 1 } },
    levels: { x: { init: '0', inflows: ['r'], outflows: [] } },
    rates: { r: { expr: 'k' } },
    auxiliaries: {},
    tables: { g: { x: [0, 1], y: [0, 1] } },
    outputs: ['x']
  }

  it('올바른 모델을 통과시킨다', () => {
    expect(parseModelDef(valid).meta.id).toBe('m')
  })

  it('dt가 0 이하면 거부한다', () => {
    expect(() => parseModelDef({ ...valid, time: { start: 0, end: 10, dt: 0 } })).toThrow()
  })

  it('테이블 x가 오름차순이 아니면 거부한다', () => {
    expect(() => parseModelDef({ ...valid, tables: { g: { x: [1, 0], y: [0, 1] } } })).toThrow()
  })
})
