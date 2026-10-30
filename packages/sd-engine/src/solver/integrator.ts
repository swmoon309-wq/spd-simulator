/** 상태 벡터의 도함수(유입 − 유출)를 계산하는 함수. */
export type Derivative = (t: number, state: Float64Array, out: Float64Array) => void

export interface Integrator {
  /** `state`를 t에서 t+dt로 제자리 갱신한다. */
  step(derivative: Derivative, t: number, dt: number, state: Float64Array): void
}

/** Level(t) = Level(t − dt) + (inflow − outflow) · dt (Madachy 2.1.4). */
export class EulerIntegrator implements Integrator {
  private scratch = new Float64Array(0)

  step(derivative: Derivative, t: number, dt: number, state: Float64Array): void {
    if (this.scratch.length !== state.length) this.scratch = new Float64Array(state.length)
    derivative(t, state, this.scratch)
    for (let i = 0; i < state.length; i++) {
      state[i] = (state[i] as number) + (this.scratch[i] as number) * dt
    }
  }
}
