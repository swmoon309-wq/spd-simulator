import { describe, expect, it } from 'vitest'
import type { VariableInfo } from '../catalog'
import { buildDataTable, formatCell } from './dataTable'

const vars: VariableInfo[] = [
  { name: 'a', label: '가', unit: '명' },
  { name: 'b', label: '나', unit: '개' },
  { name: 'z', label: '없음', unit: '' }
]
// 0, 0.25, ... 10일(dt 0.25)
const time = Float64Array.from({ length: 41 }, (_, i) => i * 0.25)
const result = { time, series: { a: Float64Array.from(time, (t) => t * 2), b: Float64Array.from(time, (t) => t + 100) } }

describe('buildDataTable', () => {
  it('모든 시점은 기록한 점 전부', () => {
    const v = buildDataTable(result, vars, 0)
    expect(v.total).toBe(41)
    expect(v.rows).toHaveLength(41)
  })

  it('1일마다는 정수 시각만, 마지막 시점은 항상 넣는다', () => {
    const v = buildDataTable(result, vars, 1)
    expect(v.rows.map((r) => r.time)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const odd = { time: Float64Array.of(0, 0.5, 1, 1.5, 1.75), series: { a: Float64Array.of(1, 2, 3, 4, 5) } }
    expect(buildDataTable(odd, vars, 1).rows.map((r) => r.time)).toEqual([0, 1, 1.75])
  })

  it('1주마다는 7일의 배수와 마지막 시점', () => {
    expect(buildDataTable(result, vars, 7).rows.map((r) => r.time)).toEqual([0, 7, 10])
  })

  it('시작 시각이 0이 아니어도 시작에서 센다', () => {
    const shifted = { time: Float64Array.of(3, 4, 5, 10, 11), series: { a: Float64Array.of(1, 2, 3, 4, 5) } }
    expect(buildDataTable(shifted, vars, 7).rows.map((r) => r.time)).toEqual([3, 10, 11])
  })

  it('결과에 없는 변수는 열에서 빼고 값은 그 시점의 값', () => {
    const v = buildDataTable(result, vars, 7)
    expect(v.columns.map((c) => c.name)).toEqual(['a', 'b'])
    expect(v.rows[1]).toEqual({ time: 7, values: [14, 107] })
  })

  it('행 상한을 넘으면 앞부분만 담고 전체 개수는 알려 준다', () => {
    const v = buildDataTable(result, vars, 0, 10)
    expect(v.rows).toHaveLength(10)
    expect(v.total).toBe(41)
  })

  it('빈 결과', () => {
    const v = buildDataTable({ time: new Float64Array(), series: {} }, vars, 1)
    expect(v).toEqual({ columns: [], rows: [], total: 0 })
  })
})

describe('formatCell', () => {
  it('소수 셋째 자리까지', () => {
    expect(formatCell(1234.56789)).toBe('1,234.568')
    expect(formatCell(2)).toBe('2')
    expect(formatCell(Number.NaN)).toBe('NaN')
  })
})
