import { describe, expect, it } from 'vitest'
import { kpiDistribution, runMonteCarlo, type InputSpec } from '@spd/analysis'
import { compileModel } from '@spd/sd-engine'
import { brooksModel } from '@spd/models'
import { getEntry } from '../catalog'
import { parseCsv } from '../../../shared/csv'
import { defaultParams } from './params'
import { riskCsvFileName, riskIterationsCsv, riskSummaryCsv } from './riskCsv'

const entry = getEntry('brooks')
const specs: InputSpec[] = [
  { name: 'nominal_productivity', dist: { kind: 'triangular', min: 0.08, mode: 0.1, max: 0.13 }, min: 0.001, max: 10 },
  { name: 'hire_day', dist: { kind: 'uniform', min: 60, max: 140 }, min: 0, max: 400, integer: true }
]
const run = (n = 40, end = 400) => runMonteCarlo({ model: compileModel(brooksModel), baseParams: defaultParams(entry), options: { end }, inputs: specs, n, seed: 7, kpis: entry.kpiSpecs })
const table = (csv: string) => parseCsv(csv.replace(/^﻿/, ''), ',')

describe('반복별 CSV', () => {
  const result = run()
  const rows = table(riskIterationsCsv(result, entry))

  it('BOM·머리글(입력은 라벨과 단위, 지표는 라벨과 단위)과 반복마다 한 줄', () => {
    expect(riskIterationsCsv(result, entry).charCodeAt(0)).toBe(0xfeff)
    expect(rows[0]).toEqual(['반복', '상태', '공칭 생산성 (FP/맨데이)', '추가 투입 시점 (일)', '완료일 (일)', '총 투입 공수 (맨데이)', '최대 인원 (명)'])
    expect(rows).toHaveLength(1 + 40)
    expect(rows.every((r) => r.length === 7)).toBe(true)
    expect(rows.slice(1).map((r) => r[0])).toEqual(Array.from({ length: 40 }, (_, i) => String(i + 1)))
  })

  it('값은 전체 자릿수로 쓰여 다시 읽어도 결과와 같다', () => {
    for (let i = 0; i < 40; i++) {
      const r = rows[i + 1]!
      expect(r[1]).toBe('성공')
      expect(Number(r[2])).toBe(result.inputs[0]![i])
      expect(Number(r[3])).toBe(result.inputs[1]![i])
      expect(Number(r[4])).toBe(result.kpis[0]![i])
    }
    expect(Number.isInteger(Number(rows[1]![3]))).toBe(true) // 정수 입력은 정수
  })

  it('지표를 계산할 수 없는 반복은 그 지표만 빈 칸이다(종료 시각 안에 끝나지 않음)', () => {
    const short = run(30, 150) // 150일 안에 끝나지 않는다
    const r = table(riskIterationsCsv(short, entry))
    expect(r.slice(1).every((row) => row[4] === '')).toBe(true) // 완료일 빈 칸
    expect(r.slice(1).every((row) => row[5] !== '')).toBe(false) // 총 공수도 완료 시점 값이라 빈 칸
    expect(r.slice(1).every((row) => row[6] !== '')).toBe(true) // 최대 인원은 있다
    expect(r.slice(1).every((row) => row[1] === '성공')).toBe(true)
  })

  it('실패한 반복은 상태가 "실패"이고 지표는 모두 빈 칸, 입력 표본은 남는다', () => {
    const failed = structuredClone({ ...result, status: Uint8Array.from(result.status), kpis: result.kpis.map((c) => Float64Array.from(c)), inputs: result.inputs.map((c) => Float64Array.from(c)) })
    failed.status[2] = 1
    const r = table(riskIterationsCsv(failed, entry))
    expect(r[3]).toEqual(['3', '실패', String(result.inputs[0]![2]), String(result.inputs[1]![2]), '', '', ''])
  })

  it('취소된 결과는 끝난 반복만 나온다', () => {
    const partial = { ...result, completed: 12 }
    expect(table(riskIterationsCsv(partial, entry))).toHaveLength(13)
  })
})

describe('요약 통계 CSV', () => {
  const result = run(200)
  const rows = table(riskSummaryCsv(result, entry))

  it('지표마다 한 줄이고 머리글에 백분위수가 있다', () => {
    expect(rows[0]).toEqual(['지표', '단위', '성공한 반복', '지표가 있는 반복', '지표 없는 비율', '평균', '평균 95% 하한', '평균 95% 상한', '표준편차', '최소', 'P10', 'P25', 'P50', 'P75', 'P80', 'P90', 'P95', '최대'])
    expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([['완료일', '일'], ['총 투입 공수', '맨데이'], ['최대 인원', '명']])
    expect(rows.every((r) => r.length === 18)).toBe(true)
  })

  it('값이 분석 계층의 요약과 같다(평균·신뢰구간·P50·P80·최대)', () => {
    const d = kpiDistribution(result, 'completionDay')
    const r = rows[1]!
    expect(Number(r[2])).toBe(200)
    expect(Number(r[3])).toBe(d.summary.n)
    expect(Number(r[5])).toBe(d.summary.mean)
    expect(Number(r[6])).toBe(d.meanCI.low)
    expect(Number(r[7])).toBe(d.meanCI.high)
    expect(Number(r[12])).toBe(d.summary.percentiles['0.5'])
    expect(Number(r[14])).toBe(d.summary.percentiles['0.8'])
    expect(Number(r[17])).toBe(d.summary.max)
    expect(Number(r[6])).toBeLessThan(Number(r[5]))
    expect(Number(r[5])).toBeLessThan(Number(r[7]))
  })

  it('지표 없는 비율: 끝나지 않는 반복이 있으면 0보다 크다', () => {
    const r = table(riskSummaryCsv(run(30, 150), entry))
    expect(Number(r[1]![4])).toBe(1)
    expect(Number(r[1]![3])).toBe(0)
    expect(r[1]![5]).toBe('') // 평균을 알 수 없으면 빈 칸
  })
})

describe('파일 이름', () => {
  it('모델·종류·시드·반복 수를 담는다', () => {
    const r = run(25)
    expect(riskCsvFileName(entry, 'iterations', r)).toBe('brooks-위험분석-반복별-시드7-25회.csv')
    expect(riskCsvFileName(entry, 'summary', r)).toBe('brooks-위험분석-요약-시드7-25회.csv')
  })
})
