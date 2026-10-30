export interface RunMeta {
  model: string
  version: number
  dt: number
  seed: number
  /** 종료 시각까지 끝까지 실행했는지. 중단되면 false이고 결과는 그때까지의 값이다. */
  completed: boolean
}

export interface RunResult {
  time: Float64Array
  /** 기록한 변수별 시계열. 길이는 `time`과 같다. */
  series: Record<string, Float64Array>
  meta: RunMeta
}

export interface RunOptions {
  /** 상수 덮어쓰기(시나리오). 정의된 상수 이름만 허용한다. */
  overrides?: Record<string, number>
  seed?: number
  /** 모델의 `time.dt` 대신 쓸 적분 간격 */
  dt?: number
  /** 모델의 `time.end` 대신 쓸 종료 시각 */
  end?: number
  /** N 스텝마다 기록한다(마지막 스텝은 항상 기록). 기본 1 */
  recordEvery?: number
  /** 기록할 변수. 기본은 상수를 제외한 모든 변수 */
  record?: string[]
  /** N 스텝마다 진행 콜백을 호출한다. 기본은 전체의 약 1% */
  progressEvery?: number
}
