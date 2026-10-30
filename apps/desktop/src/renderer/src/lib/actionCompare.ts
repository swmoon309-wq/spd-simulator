import { compareValue, computeKpis, type KpiDelta, type KpiSpec, type KpiValues } from '@spd/analysis'
import type { ModelEntry } from '../catalog'
import type { ActionRunState } from '../stores/appStore'

/** 조치 후보 비교 표에 쓰는 지표(설계 05의 8.2): 완료일, 예상 총 공수(EAC), 잔존 결함, 소진 근접도. 모델에 없으면 건너뛴다. */
export const ACTION_KPI_IDS = ['completionDay', 'totalEffort', 'residualDefects', 'exhaustionNearness']

/** 표의 행 이름을 조치 비교 맥락에 맞게 고친다. */
const ROW_LABEL: Record<string, string> = {
  completionDay: '예상 완료일',
  totalEffort: '예상 총 공수(EAC)',
  residualDefects: '잔존 결함 추정',
  exhaustionNearness: '소진 근접도(보고일 이후 최대)'
}

export interface ActionColumn {
  id: string
  label: string
  /** 완료하지 못하는 후보도 있다(지표가 null) */
  kpis: KpiValues
}

export interface ActionCell {
  value: number | null
  /** "조치 없음" 열은 null */
  delta: KpiDelta | null
}

export interface ActionComparison {
  columns: ActionColumn[]
  rows: { spec: KpiSpec; label: string; cells: Record<string, ActionCell> }[]
}

/**
 * 조치 후보 비교 표를 만든다. 열은 "조치 없음"과 후보들이고, 기준(조치 없음) 대비 차이와 좋음·나쁨을 낸다.
 * 지표는 보고일부터의 이어 실행 결과로 계산한다(최대값 지표는 보고일 이후 구간의 값).
 */
export function buildActionComparison(entry: ModelEntry, run: ActionRunState, params: Record<string, number>): ActionComparison {
  const specs = ACTION_KPI_IDS.map((id) => entry.kpiSpecs.find((s) => s.id === id)).filter((s): s is KpiSpec => s !== undefined)
  const columns: ActionColumn[] = run.entries.map((e) => ({
    id: e.id,
    label: e.label,
    kpis: computeKpis(specs, (e.outcome.runs[0] as { result: Parameters<typeof computeKpis>[1] }).result, params)
  }))
  const base = columns.find((c) => c.id === 'none') as ActionColumn
  const rows = specs.map((spec) => ({
    spec,
    label: ROW_LABEL[spec.id] ?? spec.label,
    cells: Object.fromEntries(
      columns.map((c): [string, ActionCell] => [
        c.id,
        { value: c.kpis[spec.id] ?? null, delta: c.id === 'none' ? null : compareValue(spec.better, base.kpis[spec.id] ?? null, c.kpis[spec.id] ?? null) }
      ])
    )
  }))
  return { columns, rows }
}
