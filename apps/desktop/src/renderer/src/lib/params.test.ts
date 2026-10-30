import { describe, expect, it } from 'vitest'
import { getEntry } from '../catalog'
import { defaultParams, describeRun, formatNumber, paramSpecs, parseParam } from './params'

const entry = getEntry('brooks')
const spec = (name: string) => paramSpecs(entry).find((s) => s.name === name) as ReturnType<typeof paramSpecs>[number]

describe('parseParam', () => {
  it('올바른 숫자를 받는다', () => {
    expect(parseParam('5', spec('extra_people'))).toEqual({ value: 5 })
    expect(parseParam(' 0.25 ', spec('training_overhead'))).toEqual({ value: 0.25 })
  })
  it.each([
    ['', '값을 입력'],
    ['abc', '숫자'],
    ['NaN', '숫자'],
    ['Infinity', '숫자']
  ])('"%s"은 거부한다', (text, message) => {
    expect(parseParam(text, spec('extra_people'))).toEqual({ error: expect.stringContaining(message) })
  })
  it('정수가 필요한 항목에서 소수를 거부한다', () => {
    expect(parseParam('2.5', spec('extra_people'))).toHaveProperty('error')
  })
  it('범위를 벗어나면 범위를 알려준다', () => {
    expect(parseParam('-1', spec('extra_people'))).toEqual({ error: expect.stringContaining('0 ~ 500') })
    expect(parseParam('501', spec('extra_people'))).toHaveProperty('error')
    expect(parseParam('0', spec('nominal_productivity'))).toHaveProperty('error')
  })
})

describe('defaultParams', () => {
  it('모델 상수의 기본값과 같고 모든 폼 항목이 모델 상수이다', () => {
    const d = defaultParams(entry)
    expect(d['initial_experienced']).toBe(20)
    expect(d['hire_day']).toBe(110)
    for (const s of paramSpecs(entry)) expect(entry.def.constants[s.name]).toBeDefined()
  })
  it('기본값은 각 항목의 허용 범위 안에 있다', () => {
    const d = defaultParams(entry)
    for (const s of paramSpecs(entry)) {
      expect(parseParam(String(d[s.name]), s)).toEqual({ value: d[s.name] })
    }
  })
})

describe('describeRun', () => {
  it('기본값이면 "기준"', () => expect(describeRun(entry, defaultParams(entry))).toBe('기준'))
  it('바뀐 항목만 라벨과 단위로 나열한다', () => {
    const p = { ...defaultParams(entry), extra_people: 5 }
    expect(describeRun(entry, p)).toBe('추가 투입 인원 5명')
    expect(describeRun(entry, { ...p, hire_day: 90 })).toBe('추가 투입 인원 5명 · 추가 투입 시점 90일')
  })
})

describe('describeRun: 통합 프로젝트 모델', () => {
  const integrated = getEntry('integrated-project')
  it('비율·배수에는 단위를 붙이지 않고 이름이 짧다', () => {
    const d = defaultParams(integrated)
    expect(describeRun(integrated, { ...d, plan_known_fraction: 1 })).toBe('알려진 태스크 비율 1')
    expect(describeRun(integrated, { ...d, planned_duration_days: 120 })).toBe('계획 일정 120일')
    expect(describeRun(integrated, { ...d, hiring_delay: 10, assim_delay: 20 })).toBe('채용 지연 10일 · 동화 기간 20일')
  })
})

describe('formatNumber', () => {
  it('부동소수 잡음을 제거한다', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
    expect(formatNumber(20)).toBe('20')
    expect(formatNumber(0.0006)).toBe('0.0006')
  })
})
