import { kpiDistribution, SUMMARY_PERCENTILES, type McResult } from '@spd/analysis'
import type { ModelEntry } from '../catalog'
import { formatCsv, type Cell } from '../../../shared/csv'

const withUnit = (label: string, unit: string): string => (unit ? `${label} (${unit})` : label)

/**
 * 반복별 입력 표본과 지표(설계 06의 7장): 한 줄이 반복 하나이다. 실패한 반복은 상태가 "실패"이고 지표는 빈 칸이다. 지표를 계산할 수 없는
 * 반복(예: 종료 시각 안에 끝나지 않음)도 그 지표만 빈 칸이다. 값은 전체 자릿수로 써서 다시 읽어도 같다(시드와 입력이 같으면 재현된다).
 */
export function riskIterationsCsv(result: McResult, entry: ModelEntry): string {
  const inputHeaders = result.inputNames.map((n) => withUnit(entry.def.constants[n]?.label ?? n, entry.def.constants[n]?.unit ?? ''))
  const kpiHeaders = result.kpiIds.map((id) => {
    const k = entry.kpiSpecs.find((s) => s.id === id)
    return withUnit(k?.label ?? id, k?.unit ?? '')
  })
  const rows: Cell[][] = [['반복', '상태', ...inputHeaders, ...kpiHeaders]]
  for (let i = 0; i < result.completed; i++) {
    const failed = result.status[i] === 1
    rows.push([i + 1, failed ? '실패' : '성공', ...result.inputs.map((col) => col[i] as number), ...result.kpis.map((col) => (failed ? null : (col[i] as number)))])
  }
  return formatCsv(rows)
}

/**
 * 지표별 요약 통계: 성공한 반복 수, 지표가 있는 반복 수와 없는 비율, 평균과 95% 신뢰구간, 표준편차, 최소·최대, 백분위수.
 * 완료일 같은 분포는 "끝난 것만의 분포"이므로 미완료 비율을 함께 적는다.
 */
export function riskSummaryCsv(result: McResult, entry: ModelEntry): string {
  const header: Cell[] = ['지표', '단위', '성공한 반복', '지표가 있는 반복', '지표 없는 비율', '평균', '평균 95% 하한', '평균 95% 상한', '표준편차', '최소', ...SUMMARY_PERCENTILES.map((p) => `P${Math.round(p * 100)}`), '최대']
  const rows: Cell[][] = [header]
  for (const id of result.kpiIds) {
    const k = entry.kpiSpecs.find((s) => s.id === id)
    const d = kpiDistribution(result, id)
    const s = d.summary
    rows.push([k?.label ?? id, k?.unit ?? '', d.nOk, s.n, d.undefinedRate, s.mean, d.meanCI.low, d.meanCI.high, s.sd, s.min, ...SUMMARY_PERCENTILES.map((p) => s.percentiles[String(p)] as number), s.max])
  }
  return formatCsv(rows)
}

export function riskCsvFileName(entry: ModelEntry, kind: 'iterations' | 'summary', result: Pick<McResult, 'seed' | 'completed'>): string {
  return `${entry.id}-위험분석-${kind === 'iterations' ? '반복별' : '요약'}-시드${result.seed}-${result.completed}회.csv`
}
