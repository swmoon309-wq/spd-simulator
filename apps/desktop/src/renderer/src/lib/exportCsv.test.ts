import { describe, expect, it } from 'vitest'
import { runModel, type RunResult } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { getEntry } from '../catalog'
import { parseCsv } from '../../../shared/csv'
import { comparisonFileName, comparisonToCsv, runFileName, runToCsv } from './exportCsv'

const entry = getEntry('brooks')
const variable = (name: string) => entry.variables.find((v) => v.name === name) as (typeof entry.variables)[number]
const run = (id: number, name: string, result: RunResult) => ({ id, name, result })

const tiny = (time: number[], x: number[]): RunResult => ({
  time: Float64Array.from(time),
  series: { x: Float64Array.from(x), y: Float64Array.from(x.map((v) => v * 2)) },
  meta: { model: 't', version: 1, dt: 1, seed: 1, completed: true }
})

describe('runToCsv', () => {
  it('time 열과 모든 변수 열을 쓴다', () => {
    const rows = parseCsv(runToCsv(run(1, 'a', tiny([0, 1, 2], [1, 2, 3]))))
    expect(rows[0]).toEqual(['time', 'x', 'y'])
    expect(rows.slice(1)).toEqual([['0', '1', '2'], ['1', '2', '4'], ['2', '3', '6']])
  })

  it('Brooks 실행 결과를 다시 읽으면 값이 정확히 같다', () => {
    const result = runModel(brooksModel, { overrides: { extra_people: 5 } })
    const rows = parseCsv(runToCsv(run(1, 'r', result)))
    const header = rows[0] as string[]
    expect(header[0]).toBe('time')
    expect(header).toContain('developed_software')
    expect(rows).toHaveLength(result.time.length + 1)
    for (const name of ['developed_software', 'software_development_rate', 'total_personnel']) {
      const col = header.indexOf(name)
      const series = result.series[name] as Float64Array
      for (const i of [0, 1, 439, 440, 441, 1000, result.time.length - 1]) {
        expect(Number((rows[i + 1] as string[])[col])).toBe(series[i])
        expect(Number((rows[i + 1] as string[])[0])).toBe(result.time[i])
      }
    }
  })

  it('Excel에서 한글이 깨지지 않도록 BOM으로 시작한다', () => {
    expect(runToCsv(run(1, 'a', tiny([0], [1]))).startsWith('﻿')).toBe(true)
  })
})

describe('comparisonToCsv', () => {
  it('같은 시간 눈금이면 실행마다 한 열', () => {
    const csv = comparisonToCsv(
      [run(1, '#1 기준', tiny([0, 1, 2], [1, 2, 3])), run(2, '#2 5명, 추가', tiny([0, 1, 2], [10, 20, 30]))],
      { name: 'x', label: 'X', unit: '' }
    )
    expect(parseCsv(csv)).toEqual([
      ['time', '#1 기준', '#2 5명, 추가'],
      ['0', '1', '10'],
      ['1', '2', '20'],
      ['2', '3', '30']
    ])
  })

  it('시간 눈금이 다르면 합집합 행에 빈 칸을 둔다', () => {
    const csv = comparisonToCsv(
      [run(1, 'a', tiny([0, 1, 2], [1, 2, 3])), run(2, 'b', tiny([0, 0.5, 1, 1.5, 2], [5, 6, 7, 8, 9]))],
      { name: 'x', label: 'X', unit: '' }
    )
    expect(parseCsv(csv)).toEqual([
      ['time', 'a', 'b'],
      ['0', '1', '5'],
      ['0.5', '', '6'],
      ['1', '2', '7'],
      ['1.5', '', '8'],
      ['2', '3', '9']
    ])
  })

  it('그 변수가 없는 실행은 열에서 뺀다', () => {
    const csv = comparisonToCsv([run(1, 'a', tiny([0, 1], [1, 2]))], { name: 'zzz', label: 'Z', unit: '' })
    expect(parseCsv(csv)).toEqual([['time']])
  })

  it('실제 모델: 기준과 5명 추가의 개발률', () => {
    const base = runModel(brooksModel)
    const plus5 = runModel(brooksModel, { overrides: { extra_people: 5 } })
    const rows = parseCsv(comparisonToCsv([run(1, '기준', base), run(2, '5명', plus5)], variable('software_development_rate')))
    expect(rows[0]).toEqual(['time', '기준', '5명'])
    expect(rows).toHaveLength(base.time.length + 1)
    const i = 440 + 8 // 110일 직후
    expect(Number((rows[i + 1] as string[])[1])).toBe((base.series['software_development_rate'] as Float64Array)[i])
    expect(Number((rows[i + 1] as string[])[2])).toBe((plus5.series['software_development_rate'] as Float64Array)[i])
  })
})

describe('파일 이름', () => {
  it('모델과 실행·변수 이름을 담는다', () => {
    expect(runFileName(entry, { id: 3 })).toBe('brooks-run3.csv')
    expect(comparisonFileName(entry, variable('total_personnel'))).toBe('brooks-total_personnel-비교.csv')
  })
})
