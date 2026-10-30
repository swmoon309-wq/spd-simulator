import { describe, expect, it } from 'vitest'
import { CsvError, detectDelimiter, formatCsv, parseCsv } from './csv'

describe('formatCsv', () => {
  it('BOM과 CRLF, 마지막 줄바꿈을 붙인다', () => {
    expect(formatCsv([['a', 'b'], [1, 2]])).toBe('﻿a,b\r\n1,2\r\n')
  })
  it('숫자는 전체 자릿수로, 유한하지 않은 수와 null은 빈 칸으로 쓴다', () => {
    expect(formatCsv([[0.1 + 0.2, 1e-7, -3, NaN, Infinity, null, undefined]])).toBe('﻿0.30000000000000004,1e-7,-3,,,,\r\n')
  })
  it('쉼표·따옴표·줄바꿈이 있는 문자열은 따옴표로 감싼다', () => {
    expect(formatCsv([['a,b', 'say "hi"', 'x\ny', 'plain']])).toBe('﻿"a,b","say ""hi""","x\ny",plain\r\n')
  })
  it('한글은 그대로 둔다', () => {
    expect(formatCsv([['#1 추가 투입 인원 5명']])).toContain('#1 추가 투입 인원 5명')
  })
})

describe('parseCsv', () => {
  it('기본 행렬', () => expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]))
  it.each([['LF', '\n'], ['CRLF', '\r\n'], ['CR', '\r']])('%s 줄 끝', (_n, eol) => {
    expect(parseCsv(`a,b${eol}1,2${eol}3,4`)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })
  it('BOM을 제거한다', () => expect(parseCsv('﻿a,b\n1,2')[0]).toEqual(['a', 'b']))
  it('마지막 줄바꿈이 없어도, 있어도 같은 결과', () => {
    expect(parseCsv('a\n1')).toEqual(parseCsv('a\n1\n'))
  })
  it('빈 줄은 건너뛴다', () => expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([['a', 'b'], ['1', '2']]))
  it('따옴표 필드: 쉼표, 이스케이프된 따옴표, 줄바꿈', () => {
    expect(parseCsv('"a,b","say ""hi""","x\ny"\n1,2,3')).toEqual([['a,b', 'say "hi"', 'x\ny'], ['1', '2', '3']])
  })
  it('빈 칸은 빈 문자열, 열 수가 달라도 그대로 돌려준다', () => {
    expect(parseCsv('a,,c\n1,2')).toEqual([['a', '', 'c'], ['1', '2']])
  })
  it('따옴표 안의 빈 문자열("")은 빈 칸이다', () => {
    expect(parseCsv('a,b\n"",2')).toEqual([['a', 'b'], ['', '2']])
  })
  it('닫히지 않은 따옴표는 행 번호와 함께 오류', () => {
    expect(() => parseCsv('a,b\n"1,2\n3,4')).toThrow(CsvError)
    try {
      parseCsv('a\n"x')
    } catch (e) {
      expect((e as CsvError).row).toBe(2)
    }
  })
  it('빈 입력', () => expect(parseCsv('')).toEqual([]))
  it('formatCsv와 왕복한다', () => {
    const rows = [['name', 'v'], ['a,b "c"\nd', '1.5'], ['한글', '-0.25'], ['', '1e-7']]
    expect(parseCsv(formatCsv(rows))).toEqual(rows)
  })
})

describe('detectDelimiter', () => {
  it('쉼표, 세미콜론, 탭을 구분한다', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
  })
  it('따옴표 안의 구분자는 세지 않고, 모호하면 쉼표', () => {
    expect(detectDelimiter('"a;b;c",d\n1,2')).toBe(',')
    expect(detectDelimiter('abc\n1')).toBe(',')
  })
  it('세미콜론 CSV를 파싱한다', () => {
    expect(parseCsv('t;x\n0;1,5\n1;2,5')).toEqual([['t', 'x'], ['0', '1,5'], ['1', '2,5']])
  })
})
