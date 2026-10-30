import type { VariableInfo, ModelEntry } from '../catalog'
import { formatCsv, type Cell } from '../../../shared/csv'
import type { RunRecord } from '../stores/appStore'

/** 한 실행의 모든 기록 변수: `time` 열과 변수 이름 열. 값은 전체 자릿수로 써서 다시 읽어도 같다. */
export function runToCsv(run: Pick<RunRecord, 'result'>): string {
  const { time, series } = run.result
  const names = Object.keys(series)
  const rows: Cell[][] = [['time', ...names]]
  for (let i = 0; i < time.length; i++) {
    rows.push([time[i] as number, ...names.map((n) => (series[n] as Float64Array)[i] as number)])
  }
  return formatCsv(rows)
}

/**
 * 보이는 실행들의 같은 변수를 한 표에 담는다. 시간 눈금이 다른 실행(dt가 다른 경우)은
 * 시각의 합집합을 행으로 쓰고 값이 없는 칸은 비워 둔다.
 */
export function comparisonToCsv(runs: Pick<RunRecord, 'name' | 'result'>[], variable: VariableInfo): string {
  const key = (t: number) => Math.round(t * 1e9)
  const withSeries = runs.filter((r) => r.result.series[variable.name])
  const table = new Map<number, { t: number; values: Cell[] }>()
  withSeries.forEach((run, col) => {
    const { time } = run.result
    const y = run.result.series[variable.name] as Float64Array
    for (let i = 0; i < time.length; i++) {
      const t = time[i] as number
      let row = table.get(key(t))
      if (!row) {
        row = { t, values: new Array<Cell>(withSeries.length).fill(null) }
        table.set(key(t), row)
      }
      row.values[col] = y[i] as number
    }
  })
  const sorted = [...table.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => [row.t, ...row.values] as Cell[])
  return formatCsv([['time', ...withSeries.map((r) => r.name)], ...sorted])
}

export function runFileName(entry: ModelEntry, run: Pick<RunRecord, 'id'>): string {
  return `${entry.id}-run${run.id}.csv`
}

export function comparisonFileName(entry: ModelEntry, variable: VariableInfo): string {
  return `${entry.id}-${variable.name}-비교.csv`
}
