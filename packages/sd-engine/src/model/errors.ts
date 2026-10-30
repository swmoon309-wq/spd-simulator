export type ModelErrorKind =
  | 'name'
  | 'expression'
  | 'flow'
  | 'cycle'
  | 'init-cycle'
  | 'output'
  | 'invariant'
  | 'option'

/** 모델 정의·컴파일·실행 옵션의 오류. 화면에 변수 이름과 함께 보여줄 수 있다. */
export class ModelError extends Error {
  readonly kind: ModelErrorKind
  readonly variable?: string
  readonly cycle?: string[]

  constructor(kind: ModelErrorKind, message: string, extra: { variable?: string; cycle?: string[] } = {}) {
    super(message)
    this.name = 'ModelError'
    this.kind = kind
    if (extra.variable !== undefined) this.variable = extra.variable
    if (extra.cycle !== undefined) this.cycle = extra.cycle
  }
}

/** 실행 중 발생한 수치 오류(NaN, 무한대 등). */
export class SimulationError extends Error {
  readonly variable: string
  readonly time: number
  readonly value: number

  constructor(variable: string, time: number, value: number) {
    super(`변수 '${variable}'의 값이 시각 ${time}에서 ${value}입니다 (0으로 나누기 등을 확인하세요)`)
    this.name = 'SimulationError'
    this.variable = variable
    this.time = time
    this.value = value
  }
}
