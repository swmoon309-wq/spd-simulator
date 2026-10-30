import { describe, expect, it } from 'vitest'
import { MAX_ACTUAL_ROWS, evmSeries, validateActuals, type ActualRow } from '@spd/analysis'
import { getEntry } from '../catalog'
import { actualsToCsv, applyIncrement, mergeActuals, parseActualsCsv, ActualsCsvError } from './actualsCsv'
import { evmOf } from '../catalog/evm'

const integrated = getEntry('integrated-project')
const brooks = getEntry('brooks')
const labels = evmOf(integrated).credits.map((c) => c.label)
const err = (text: string, entry = integrated) => {
  try {
    parseActualsCsv(text, entry)
  } catch (e) {
    if (e instanceof ActualsCsvError) return e.message
    throw e
  }
  throw new Error('오류가 나야 합니다')
}

describe('parseActualsCsv', () => {
  it('변수 이름 열과 effort를 읽는다', () => {
    const r = parseActualsCsv('day,prod_tasks_developed,prod_tasks_qaed,prod_tasks_tested,effort\n7,10,4,1,60\n14,25,12,5,130', integrated)
    expect(r.rows).toEqual([
      { day: 7, cum: { prod_tasks_developed: 10, prod_tasks_qaed: 4, prod_tasks_tested: 1 }, effort: 60 },
      { day: 14, cum: { prod_tasks_developed: 25, prod_tasks_qaed: 12, prod_tasks_tested: 5 }, effort: 130 }
    ])
    expect(r.ignored).toEqual([])
  })
  it('열 이름은 라벨·대소문자·공백·(단위)를 무시하고 맞춘다', () => {
    const csv = `Day,${labels[0]!.toUpperCase()} (태스크),${labels[1]},  누적  공수 ,인원,결함,메모\n7,10,4,60,5,3,첫 보고`
    const r = parseActualsCsv(csv, integrated)
    expect(r.rows[0]).toMatchObject({ day: 7, effort: 60, headcount: 5, defects: 3, note: '첫 보고' })
    expect(Object.keys(r.rows[0]!.cum).sort()).toEqual(['prod_tasks_developed', 'prod_tasks_qaed'])
  })
  it('세미콜론 구분과 소수점 쉼표', () => {
    const r = parseActualsCsv('day;prod_tasks_developed;effort\n7;10,5;60,25', integrated)
    expect(r.rows[0]).toMatchObject({ day: 7, effort: 60.25, cum: { prod_tasks_developed: 10.5 } })
  })
  it('맞지 않는 열은 무시하고 알린다', () => {
    const r = parseActualsCsv('day,prod_tasks_developed,effort,기타,\n7,10,60,x,y', integrated)
    expect(r.ignored).toEqual(['기타', '(이름 없음)'])
  })
  it('내보낸 계산 열(PV, EV, CPI …)은 조용히 건너뛴다', () => {
    const r = parseActualsCsv('day,prod_tasks_developed,effort,progress,PV,EV,CV,SV,CPI,SPI\n7,10,60,0.1,5,5,5,5,1,1', integrated)
    expect(r.ignored).toEqual([])
    expect(r.rows[0]!.effort).toBe(60)
  })
  it('BOM이 있어도 읽는다', () => {
    expect(parseActualsCsv('﻿day,prod_tasks_developed,effort\n1,2,3', integrated).rows).toHaveLength(1)
  })
  it('빈 단계 칸은 비워 둔다(검증이 경고)', () => {
    const r = parseActualsCsv('day,prod_tasks_developed,prod_tasks_qaed,effort\n7,10,,60', integrated)
    expect(r.rows[0]!.cum).toEqual({ prod_tasks_developed: 10 })
  })
  it('Brooks는 개발 완료 하나', () => {
    const r = parseActualsCsv(`day,${evmOf(brooks).credits[0]!.label},effort\n7,10,60`, brooks)
    expect(r.rows[0]!.cum).toEqual({ developed_software: 10 })
  })
  it.each([
    ['공수 열 없음', 'day,prod_tasks_developed\n7,1', '누적 공수 열'],
    ['단계 열 없음', 'day,effort\n7,1', '단계별 누적 태스크 열'],
    ['값 열 없음', 'day\n7', '값 열'],
    ['숫자가 아닌 값', 'day,prod_tasks_developed,effort\n7,abc,5', "데이터 1번째 행"],
    ['보고일이 숫자 아님', 'day,prod_tasks_developed,effort\nx,1,5', '보고일'],
    ['보고일이 빔', 'day,prod_tasks_developed,effort\n,1,5', '비어 있습니다'],
    ['공수가 빔', 'day,prod_tasks_developed,effort\n7,1,', '누적 공수가 비어'],
    ['같은 항목 열 중복', `day,prod_tasks_developed,${labels[0]},effort\n7,1,2,3`, '둘 이상'],
    ['데이터 없음', 'day,prod_tasks_developed,effort', '한 줄 이상']
  ])('거부: %s', (_n, csv, msg) => {
    expect(err(csv)).toContain(msg)
  })
  it('행이 너무 많으면 거부', () => {
    const csv = 'day,prod_tasks_developed,effort\n' + Array.from({ length: MAX_ACTUAL_ROWS + 1 }, (_, i) => `${i + 1},1,1`).join('\n')
    expect(err(csv)).toContain('너무 많습니다')
  })
})

describe('mergeActuals', () => {
  const row = (day: number, effort = 0): ActualRow => ({ day, cum: {}, effort })
  it('교체는 가져온 행만 남긴다', () => {
    expect(mergeActuals([row(1), row(2)], [row(5)], 'replace')).toEqual([row(5)])
  })
  it('덧붙이기는 같은 보고일을 새 값으로 덮고 보고일 순서로 정렬한다', () => {
    const out = mergeActuals([row(7, 1), row(21, 3)], [row(14, 2), row(7, 9)], 'append')!
    expect(out.map((r) => [r.day, r.effort])).toEqual([[7, 9], [14, 2], [21, 3]])
  })
  it('한도를 넘으면 null', () => {
    const many = Array.from({ length: MAX_ACTUAL_ROWS }, (_, i) => row(i + 1))
    expect(mergeActuals(many, [row(9999)], 'append')).toBeNull()
    expect(mergeActuals(many, [row(1)], 'append')).toHaveLength(MAX_ACTUAL_ROWS)
  })
})

describe('applyIncrement', () => {
  const credits = evmOf(integrated).credits
  it('첫 줄은 0에서 센다', () => {
    const r = applyIncrement(undefined, { days: 7, cum: { prod_tasks_developed: 10 }, effort: 50, headcount: 6 }, credits)
    expect(r).toEqual({ day: 7, cum: { prod_tasks_developed: 10, prod_tasks_qaed: 0, prod_tasks_tested: 0 }, effort: 50, headcount: 6 })
  })
  it('이전 누적에 더하고 인원은 더하지 않는다', () => {
    const last: ActualRow = { day: 7, cum: { prod_tasks_developed: 10, prod_tasks_qaed: 2, prod_tasks_tested: 0 }, effort: 50, headcount: 6, defects: 4 }
    const r = applyIncrement(last, { days: 7, cum: { prod_tasks_developed: 12, prod_tasks_qaed: 5 }, effort: 55, headcount: 7, defects: 3 }, credits)
    expect(r).toEqual({ day: 14, cum: { prod_tasks_developed: 22, prod_tasks_qaed: 7, prod_tasks_tested: 0 }, effort: 105, headcount: 7, defects: 7 })
  })
  it('증분을 연속으로 더한 결과는 누적을 직접 입력한 것과 같다', () => {
    let last: ActualRow | undefined
    for (let i = 0; i < 4; i++) last = applyIncrement(last, { days: 7, cum: { prod_tasks_developed: 5 }, effort: 30 }, credits)
    expect(last).toMatchObject({ day: 28, effort: 120, cum: { prod_tasks_developed: 20 } })
  })
})

describe('actualsToCsv', () => {
  it('내보낸 CSV를 다시 가져오면 입력이 같다(계산 열은 건너뜀)', () => {
    const rows: ActualRow[] = [
      { day: 7, cum: { prod_tasks_developed: 10, prod_tasks_qaed: 4, prod_tasks_tested: 1 }, effort: 60, headcount: 5, defects: 2, note: '메모, 쉼표' },
      { day: 14, cum: { prod_tasks_developed: 25, prod_tasks_qaed: 12, prod_tasks_tested: 5 }, effort: 130 }
    ]
    const csv = actualsToCsv(integrated, rows, [])
    const back = parseActualsCsv(csv, integrated)
    expect(back.rows).toEqual(rows)
    expect(back.ignored).toEqual([])
  })
  it('계산 열은 오류 행을 비우고 정상 행만 채운다', () => {
    const rows: ActualRow[] = [{ day: 7, cum: { developed_software: 10 }, effort: 60 }, { day: 3, cum: { developed_software: 12 }, effort: 70 }]
    const base = {
      credits: evmOf(brooks).credits.map(({ variable, weight }) => ({ variable, weight })), totalTasks: 100, bac: 1000, plannedCompletion: 100,
      series: { time: [0, 100], progress: [0, 1], effort: [0, 1000] }
    }
    const issues = validateActuals(rows, base.credits, 100)
    const points = evmSeries(base, rows, issues)
    const lines = actualsToCsv(brooks, rows, points).replace('﻿', '').trim().split('\r\n')
    expect(lines[0]).toContain('CPI')
    const cols = lines[1]!.split(',')
    expect(cols.at(-1)).not.toBe('')
    expect(lines[2]!.split(',').slice(-7).every((c) => c === '')).toBe(true)
  })
})
