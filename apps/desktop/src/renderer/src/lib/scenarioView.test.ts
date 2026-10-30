import { describe, expect, it } from 'vitest'
import { getEntry } from '../catalog'
import { defaultParams } from './params'
import { scenarioColor, RUN_COLORS, colorFor } from './palette'
import { diffRows } from './scenarioView'

const brooks = getEntry('brooks')
const integrated = getEntry('integrated-project')

describe('diffRows', () => {
  it('라벨·단위와 함께 기준값과 시나리오값을 보인다', () => {
    const rows = diffRows(brooks, defaultParams(brooks), { overrides: { extra_people: 8, hire_day: 90 } })
    expect(rows).toEqual([
      { name: 'extra_people', label: '추가 투입 인원', unit: '명', base: '0', value: '8' },
      { name: 'hire_day', label: '추가 투입 시점', unit: '일', base: '110', value: '90' }
    ])
  })
  it('기본 설정과 같은 값은 나열하지 않는다', () => {
    expect(diffRows(brooks, defaultParams(brooks), { overrides: { extra_people: 0, hire_day: 110 } })).toEqual([])
  })
  it('기본 설정이 바뀌면 기준값이 따라 바뀌고, 같아진 항목은 사라진다', () => {
    const base = { ...defaultParams(brooks), hire_day: 90 }
    const rows = diffRows(brooks, base, { overrides: { extra_people: 8, hire_day: 90 } })
    expect(rows.map((r) => r.name)).toEqual(['extra_people'])
  })
  it('소수는 부동소수 잡음 없이 쓰고 모델의 라벨을 따른다', () => {
    const rows = diffRows(integrated, defaultParams(integrated), { overrides: { plan_known_fraction: 1, hiring_delay: 10 } })
    expect(rows.map((r) => [r.label, r.base, r.value])).toEqual([
      ['알려진 태스크 비율', '0.67', '1'],
      ['채용 지연', '40', '10']
    ])
  })
  it('기본 설정의 키 순서(폼 순서)를 따른다', () => {
    const rows = diffRows(brooks, defaultParams(brooks), { overrides: { hire_day: 90, extra_people: 8 } })
    expect(rows.map((r) => r.name)).toEqual(['extra_people', 'hire_day'])
  })
})

describe('scenarioColor', () => {
  it('같은 id는 항상 같은 색이고 s1은 첫 색이다', () => {
    expect(scenarioColor('s1')).toBe(colorFor(0))
    expect(scenarioColor('s3')).toBe(scenarioColor('s3'))
  })
  it('번호가 팔레트 크기를 넘으면 돌아간다', () => {
    expect(scenarioColor(`s${RUN_COLORS.length + 1}`)).toBe(scenarioColor('s1'))
  })
  it('12개 시나리오 중 앞 8개는 서로 다른 색이다', () => {
    expect(new Set(Array.from({ length: RUN_COLORS.length }, (_, i) => scenarioColor(`s${i + 1}`))).size).toBe(RUN_COLORS.length)
  })
  it('sN 형식이 아닌 id도 팔레트 안의 같은 색을 낸다', () => {
    expect(RUN_COLORS).toContain(scenarioColor('custom-id'))
    expect(scenarioColor('custom-id')).toBe(scenarioColor('custom-id'))
  })
})
