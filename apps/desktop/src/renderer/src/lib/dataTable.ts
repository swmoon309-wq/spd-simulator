import type { RunResult } from '@spd/sd-engine'
import type { VariableInfo } from '../catalog'

/** 표의 시간 간격. `0`이면 기록한 모든 시점(dt 간격), 아니면 그 일수마다의 시점 값. */
export type TableStep = 0 | 1 | 7

export const TABLE_STEPS: { value: TableStep; label: string }[] = [
  { value: 1, label: '1일마다' },
  { value: 7, label: '1주마다' },
  { value: 0, label: '모든 시점(dt)' }
]

/** 화면에 그리는 행 수 상한. 전체는 CSV로 저장한다. */
export const MAX_TABLE_ROWS = 1000

export interface DataTableView {
  columns: VariableInfo[]
  /** 한 행: 시각과 열마다의 값 */
  rows: { time: number; values: number[] }[]
  /** 간격으로 고른 전체 행 수(상한으로 잘렸으면 `rows.length`보다 크다) */
  total: number
}

/**
 * 한 실행의 시점별 값 표를 만든다. 간격이 있으면 시작 시각에서 그 간격의 배수가 되는 시점(과 마지막 시점)의 값을 그대로 쓴다.
 * 집계(평균·합)가 아니라 그 시각의 값이므로 Level은 "그 주 끝의 값", Rate는 "그 시점의 비율"이다.
 * 결과에 없는 변수는 열에서 뺀다.
 */
export function buildDataTable(result: Pick<RunResult, 'time' | 'series'>, variables: VariableInfo[], step: TableStep, limit = MAX_TABLE_ROWS): DataTableView {
  const columns = variables.filter((v) => result.series[v.name] !== undefined)
  const { time } = result
  const picked: number[] = []
  if (time.length > 0) {
    const start = time[0] as number
    const last = time.length - 1
    for (let i = 0; i <= last; i++) {
      if (step === 0 || i === last) {
        picked.push(i)
        continue
      }
      const k = ((time[i] as number) - start) / step
      if (Math.abs(k - Math.round(k)) < 1e-9) picked.push(i)
    }
  }
  const rows = picked.slice(0, limit).map((i) => ({
    time: time[i] as number,
    values: columns.map((c) => (result.series[c.name] as Float64Array)[i] as number)
  }))
  return { columns, rows, total: picked.length }
}

/** 표에 보이는 숫자 모양(소수 셋째 자리까지, 뒤의 0은 뗀다). */
export function formatCell(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 3 })
}
