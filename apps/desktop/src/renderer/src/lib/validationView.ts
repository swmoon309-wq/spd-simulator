import { alignColumn, checkTolerances, completionError, computeMetrics, weightedNrmse, type AlignedPairs, type CompletionError, type Metrics, type Tolerances, type ToleranceKey, type ToleranceStatus, type WeightedNrmse } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import type { ModelEntry } from '../catalog'
import type { Dataset, DatasetColumn } from './validation'

/** 매핑한 열 하나의 비교 결과. */
export interface ColumnEval {
  /** 데이터셋의 열 위치 */
  index: number
  column: DatasetColumn
  variable: string
  aligned: AlignedPairs
  metrics: Metrics
  /** 사용자가 기준을 정한 지표의 안/밖 */
  status: Partial<Record<ToleranceKey, ToleranceStatus>>
  /** 잔차(시뮬레이션 − 관측)의 [시뮬레이션 시각, 값] */
  residuals: [number, number][]
}

export interface DatasetEval {
  columns: ColumnEval[]
  /** 변수가 연결되지 않아 비교하지 않은 열 수 */
  unmapped: number
  /** 열별 NRMSE의 가중 제곱합(보정 목적함수와 같은 정의) */
  overall: WeightedNrmse
  /** 실제 완료일이 있을 때의 완료 시점 오차 */
  completion: (CompletionError & { simulated: number | null; actual: number }) | null
}

/**
 * 데이터셋을 시뮬레이션 결과와 비교한다(설계 07의 3장). 변수가 연결된 열만 비교하고, 합격·불합격이 아니라 지표와 사용자가
 * 정한 기준의 안/밖만 낸다. 결과에 없는 변수(모델이 바뀐 경우)는 건너뛰고 `unmapped`에 센다.
 */
export function evaluateDataset(entry: ModelEntry, result: RunResult, dataset: Dataset, tolerances: Tolerances, params: Record<string, number>): DatasetEval {
  const columns: ColumnEval[] = []
  let unmapped = 0
  dataset.columns.forEach((column, index) => {
    if (column.variable === null || !(column.variable in result.series)) {
      unmapped++
      return
    }
    const aligned = alignColumn(result, { variable: column.variable, scale: column.scale, points: column.points }, { timeUnit: dataset.timeUnit, offsetDay: dataset.offsetDay })
    const metrics = computeMetrics(aligned.observed, aligned.simulated)
    columns.push({
      index,
      column,
      variable: column.variable,
      aligned,
      metrics,
      status: checkTolerances(metrics, tolerances),
      residuals: aligned.time.map((t, i) => [t, (aligned.simulated[i] as number) - (aligned.observed[i] as number)] as [number, number])
    })
  })
  const overall = weightedNrmse(columns.map((c) => ({ nrmse: c.metrics.nrmse })))
  let completion: DatasetEval['completion'] = null
  if (dataset.actualCompletionDay !== null) {
    const spec = entry.kpiSpecs.find((k) => k.id === 'completionDay')
    const simulated = spec ? spec.compute(result, params) : null
    completion = { ...completionError(simulated, dataset.actualCompletionDay), simulated, actual: dataset.actualCompletionDay }
  }
  return { columns, unmapped, overall, completion }
}

/** 지표 값 표시. 계산할 수 없으면 "–". */
export function fmt(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '–'
}

export const STATUS_MARK: Record<ToleranceStatus, string> = { in: '✓ 안', out: '✗ 밖', na: '– 알 수 없음' }

/** 기준을 정한 지표의 상태를 "정규화 RMSE ✓ 안 · MRE ✗ 밖"처럼. 정한 기준이 없으면 빈 문자열. */
export function statusText(status: Partial<Record<ToleranceKey, ToleranceStatus>>, labelOf: (k: ToleranceKey) => string): string {
  return (Object.keys(status) as ToleranceKey[]).map((k) => `${labelOf(k)} ${STATUS_MARK[status[k] as ToleranceStatus]}`).join(' · ')
}
