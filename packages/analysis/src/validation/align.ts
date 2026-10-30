import type { RunResult } from '@spd/sd-engine'
import { valueAt } from '../scenario/kpi'

/**
 * 관측 데이터와 시뮬레이션 결과를 같은 시각에서 짝짓는다(설계 07의 2~3.1장).
 * 데이터 시각을 시뮬레이션 시각(일)로 바꾸고, 시뮬레이션 값은 기록 눈금 사이를 선형 보간해 읽는다.
 */

export type TimeUnit = 'day' | 'week' | 'month'

/** 시간 단위 → 일. 월은 평균 길이(365.25 / 12). */
export const TIME_UNIT_DAYS: Record<TimeUnit, number> = { day: 1, week: 7, month: 30.4375 }

export const TIME_UNIT_LABEL: Record<TimeUnit, string> = { day: '일', week: '주', month: '월' }

/** 관측 열 하나: 데이터의 [시각, 값] 점과 값 배율. 시각은 데이터의 단위이다. */
export interface ObservedColumn {
  /** 비교할 모델 변수 */
  variable: string
  /** 값 배율(단위 변환, 기본 1). 관측 값에 곱한다. */
  scale?: number
  points: readonly (readonly [number, number])[]
}

export interface AlignOptions {
  /** 데이터의 시간 단위(기본 일) */
  timeUnit?: TimeUnit
  /** 시간 이동: 실제 프로젝트 시작일 − 시뮬레이션 0일(일). 기본 0 */
  offsetDay?: number
}

/** 데이터 시각 → 시뮬레이션 시각: `t_sim = t_data × 단위 + 이동`. */
export function toSimTime(t: number, timeUnit: TimeUnit = 'day', offsetDay = 0): number {
  return t * TIME_UNIT_DAYS[timeUnit] + offsetDay
}

export interface AlignedPairs {
  variable: string
  /** 시뮬레이션 시각(오름차순) */
  time: number[]
  /** 관측(배율 적용) */
  observed: number[]
  /** 같은 시각의 시뮬레이션 값(선형 보간) */
  simulated: number[]
  /** 시뮬레이션 범위(처음~마지막 기록 시각) 밖이라 제외한 점 수 */
  outOfRange: number
  /** 시각이나 값이 유한한 수가 아니어서 제외한 점 수 */
  invalid: number
}

export class AlignError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlignError'
  }
}

/**
 * 열 하나를 시뮬레이션 결과와 짝짓는다. 시뮬레이션 범위 밖의 점과 유한하지 않은 점은 빼고 개수를 알린다.
 * 같은 시각이 여럿이면 모두 남긴다(순서는 입력 순서를 유지). 모델에 없는 변수나 배율이 유한하지 않으면 `AlignError`.
 */
export function alignColumn(result: RunResult, column: ObservedColumn, options: AlignOptions = {}): AlignedPairs {
  const { variable } = column
  if (!(variable in result.series)) throw new AlignError(`결과에 변수 '${variable}'이(가) 없습니다`)
  const scale = column.scale ?? 1
  if (!Number.isFinite(scale)) throw new AlignError('값 배율은 유한한 수여야 합니다')
  const unit = options.timeUnit ?? 'day'
  const offset = options.offsetDay ?? 0
  if (!Number.isFinite(offset)) throw new AlignError('시간 이동은 유한한 수여야 합니다')

  const first = result.time[0] as number
  const last = result.time[result.time.length - 1] as number
  const rows: { t: number; o: number; i: number }[] = []
  let outOfRange = 0
  let invalid = 0
  column.points.forEach(([td, v], i) => {
    const t = toSimTime(td, unit, offset)
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      invalid++
      return
    }
    if (t < first || t > last) {
      outOfRange++
      return
    }
    rows.push({ t, o: v * scale, i })
  })
  // 시간 순서로. 같은 시각은 입력 순서를 지킨다.
  rows.sort((a, b) => a.t - b.t || a.i - b.i)
  return {
    variable,
    time: rows.map((r) => r.t),
    observed: rows.map((r) => r.o),
    simulated: rows.map((r) => valueAt(result, variable, r.t)),
    outOfRange,
    invalid
  }
}
