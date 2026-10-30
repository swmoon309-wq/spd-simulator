import { describe, expect, it } from 'vitest'
import { getEntry } from '../catalog'
import { matchVariable, parseReferenceCsv, ReferenceCsvError } from './referenceCsv'

const err = (text: string) => {
  try {
    parseReferenceCsv(text)
  } catch (e) {
    expect(e).toBeInstanceOf(ReferenceCsvError)
    return (e as Error).message
  }
  throw new Error('오류가 나야 합니다')
}

describe('parseReferenceCsv', () => {
  it('시간 열과 값 열을 읽는다', () => {
    const r = parseReferenceCsv('day,developed_software,total_personnel\n0,0,20\n10,18,20\n20,36.5,22\n')
    expect(r.timeHeader).toBe('day')
    expect(r.columns.map((c) => c.name)).toEqual(['developed_software', 'total_personnel'])
    expect(r.columns[0]?.points).toEqual([[0, 0], [10, 18], [20, 36.5]])
    expect(r.columns[1]?.points[2]).toEqual([20, 22])
  })

  it('BOM·CRLF·따옴표·한글 열 이름을 처리한다', () => {
    const r = parseReferenceCsv('﻿"시간(일)","개발 완료 규모 (FP)"\r\n0,0\r\n5,9\r\n')
    expect(r.timeHeader).toBe('시간(일)')
    expect(r.columns[0]).toEqual({ name: '개발 완료 규모 (FP)', points: [[0, 0], [5, 9]] })
  })

  it('시간 순서가 뒤섞여 있어도 오름차순으로 정렬한다', () => {
    const r = parseReferenceCsv('t,x\n10,3\n0,1\n5,2')
    expect(r.columns[0]?.points.map((p) => p[0])).toEqual([0, 5, 10])
  })

  it('빈 칸은 그 점만 건너뛰고 열마다 독립이다', () => {
    const r = parseReferenceCsv('t,a,b\n0,1,\n1,,5\n2,3,6')
    expect(r.columns[0]?.points).toEqual([[0, 1], [2, 3]])
    expect(r.columns[1]?.points).toEqual([[1, 5], [2, 6]])
  })

  it('행의 칸이 모자라면 빈 칸으로 본다', () => {
    const r = parseReferenceCsv('t,a,b\n0,1\n1,2,3')
    expect(r.columns[1]?.points).toEqual([[1, 3]])
  })

  it('숫자 값이 없는 열은 제외하고 알린다', () => {
    const r = parseReferenceCsv('t,a,b\n0,1,\n1,2,')
    expect(r.columns.map((c) => c.name)).toEqual(['a'])
    expect(r.emptyColumns).toEqual(['b'])
  })

  it('빈 열 이름과 중복 이름을 구분한다', () => {
    const r = parseReferenceCsv('t,x,,x\n0,1,2,3')
    expect(r.columns.map((c) => c.name)).toEqual(['x', '열 3', 'x (2)'])
  })

  it('세미콜론 CSV와 소수점 쉼표를 읽는다', () => {
    const r = parseReferenceCsv('t;x\n0;1,5\n1;2,25')
    expect(r.columns[0]?.points).toEqual([[0, 1.5], [1, 2.25]])
  })

  it('지수 표기와 음수를 읽는다', () => {
    const r = parseReferenceCsv('t,x\n0,-1.5e-3\n1,+2')
    expect(r.columns[0]?.points).toEqual([[0, -0.0015], [1, 2]])
  })

  it('시간 값이 숫자가 아니면 행 번호와 함께 알린다', () => {
    expect(err('t,x\n0,1\nabc,2')).toContain('데이터 2번째 행')
    expect(err('t,x\n,1')).toContain("시간 값 ''")
  })

  it('값이 숫자가 아니면 행과 열 이름을 알린다', () => {
    const m = err('t,x,y\n0,1,2\n1,N/A,3')
    expect(m).toContain('데이터 2번째 행')
    expect(m).toContain("'x' 열")
    expect(m).toContain('N/A')
  })

  it.each([
    ['빈 입력', ''],
    ['헤더만', 't,x'],
    ['열이 하나', 't\n0\n1'],
    ['값이 전부 비어 있음', 't,x\n0,\n1,']
  ])('%s', (_n, text) => {
    expect(err(text)).toBeTruthy()
  })

  it('닫히지 않은 따옴표', () => {
    expect(err('t,x\n0,"1')).toContain('따옴표')
  })

  it('열 수 제한', () => {
    const header = ['t', ...Array.from({ length: 51 }, (_, i) => `c${i}`)].join(',')
    expect(err(`${header}\n${Array(52).fill(1).join(',')}`)).toContain('열이 너무 많습니다')
  })
})

describe('matchVariable', () => {
  const entry = getEntry('brooks')
  it.each([
    ['developed_software', 'developed_software'],
    ['DEVELOPED_SOFTWARE', 'developed_software'],
    ['개발 완료 규모', 'developed_software'],
    ['개발 완료 규모 (FP)', 'developed_software'],
    ['  개발   완료 규모(FP) ', 'developed_software'],
    ['개발률', 'software_development_rate'],
    ['총 인원 (명)', 'total_personnel'],
    ['total_personnel (people)', 'total_personnel']
  ])('"%s" → %s', (header, expected) => expect(matchVariable(entry, header)).toBe(expected))

  it('연결되지 않는 이름은 null', () => {
    expect(matchVariable(entry, 'actual_effort')).toBeNull()
    expect(matchVariable(entry, '')).toBeNull()
  })
})
