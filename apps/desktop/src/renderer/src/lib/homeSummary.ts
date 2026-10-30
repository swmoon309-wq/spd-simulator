import { computeKpis, type KpiGroup, type KpiSpec } from '@spd/analysis'
import type { ModelEntry } from '../catalog'
import type { RunRecord } from '../stores/appStore'

/** 홈의 요약 카드에 보이는 지표 하나 */
export interface SummaryItem {
  /** `일정`, `공수`, `결함`, `인력` */
  heading: string
  label: string
  /** 표시할 값(계산할 수 없으면 `–`, 종료 시각 안에 끝나지 않은 완료일은 `미완료`) */
  value: string
  unit: string
}

export interface LastRunSummary {
  name: string
  items: SummaryItem[]
}

const HEADINGS: [KpiGroup, string][] = [
  ['schedule', '일정'],
  ['cost', '공수'],
  ['quality', '결함']
]

function format(spec: KpiSpec, value: number | null): string {
  if (value === null) return spec.id === 'completionDay' ? '미완료' : '–'
  return value.toLocaleString('ko-KR', { minimumFractionDigits: spec.decimals, maximumFractionDigits: spec.decimals })
}

/**
 * 마지막 실행의 요약(PRJ-04): 일정·공수·결함은 모델의 지표 정의에서 그룹마다 첫 지표를, 인력은 최대 인원을 쓴다.
 * 모델에 없는 그룹은 건너뛴다. 실행 기록이 없으면 null.
 */
export function summarizeLastRun(entry: ModelEntry, runs: Pick<RunRecord, 'name' | 'params' | 'result' | 'kpis'>[]): LastRunSummary | null {
  const run = runs[runs.length - 1]
  if (!run) return null
  const values = computeKpis(entry.kpiSpecs, run.result, run.params)
  const items: SummaryItem[] = []
  for (const [group, heading] of HEADINGS) {
    const spec = entry.kpiSpecs.find((s) => s.group === group)
    if (spec) items.push({ heading, label: spec.label, value: format(spec, values[spec.id] ?? null), unit: spec.unit })
  }
  items.push({ heading: '인력', label: '최대 인원', value: Math.round(run.kpis.peakStaff).toLocaleString('ko-KR'), unit: '명' })
  return { name: run.name, items }
}
