import { describe, expect, it } from 'vitest'
import {
  canAddScenario,
  copyScenarioName,
  diffFromBase,
  effectiveParams,
  MAX_SCENARIOS,
  MAX_SCENARIO_NAME,
  nextScenarioId,
  nextScenarioName,
  sanitizeOverrides,
  validateScenarioName,
  type ParamBound
} from '../src'

const base = { a: 1, b: 10, c: 0.5, n: 4 }
const bounds: ParamBound[] = [
  { name: 'a', min: 0, max: 5 },
  { name: 'b', min: 1, max: 100 },
  { name: 'c', min: 0, max: 1 },
  { name: 'n', min: 0, max: 20, integer: true }
]

describe('effectiveParams', () => {
  it('기본 설정에 overrides를 덮어쓴다', () => {
    expect(effectiveParams(base, { overrides: { b: 20 } })).toEqual({ a: 1, b: 20, c: 0.5, n: 4 })
  })
  it('overrides가 없으면 기본 설정과 같고 원본을 바꾸지 않는다', () => {
    const out = effectiveParams(base, { overrides: {} })
    expect(out).toEqual(base)
    expect(out).not.toBe(base)
    effectiveParams(base, { overrides: { a: 3 } })
    expect(base.a).toBe(1)
  })
  it('기본 설정에 없는 이름은 무시한다', () => {
    expect(effectiveParams(base, { overrides: { zzz: 9 } })).toEqual(base)
  })
  it('기본 설정이 바뀌면 overrides가 없는 항목이 따라 바뀐다', () => {
    const s = { overrides: { b: 20 } }
    expect(effectiveParams({ ...base, a: 3 }, s)).toEqual({ a: 3, b: 20, c: 0.5, n: 4 })
  })
})

describe('diffFromBase', () => {
  it('기본 설정의 키 순서로 달라진 항목만 돌려준다', () => {
    expect(diffFromBase(base, { overrides: { n: 6, a: 2, c: 0.5 } })).toEqual([
      { name: 'a', base: 1, value: 2 },
      { name: 'n', base: 4, value: 6 }
    ])
  })
  it('같은 값과 모르는 이름은 제외한다', () => {
    expect(diffFromBase(base, { overrides: { a: 1, zzz: 5 } })).toEqual([])
  })
})

describe('sanitizeOverrides', () => {
  it('기본값과 같아진 항목은 경고 없이 뺀다', () => {
    expect(sanitizeOverrides(base, { a: 1, b: 20 }, bounds)).toEqual({ overrides: { b: 20 }, warnings: [] })
  })
  it('모르는 이름을 버리고 개수와 이름으로 경고한다', () => {
    const r = sanitizeOverrides(base, { x: 1, y: 2, a: 2 }, bounds)
    expect(r.overrides).toEqual({ a: 2 })
    expect(r.warnings).toEqual([expect.stringContaining('2개')])
    expect(r.warnings[0]).toContain('x, y')
  })
  it('범위 밖·비유한·정수가 아닌 값은 버리고 항목마다 경고한다', () => {
    const r = sanitizeOverrides(base, { a: 99, b: NaN, n: 2.5, c: 0.9 }, bounds)
    expect(r.overrides).toEqual({ c: 0.9 })
    expect(r.warnings).toHaveLength(3)
    expect(r.warnings.join('\\n')).toContain('허용 범위(0 ~ 5)')
    expect(r.warnings.join('\\n')).toContain('유한한 수')
    expect(r.warnings.join('\\n')).toContain('정수가 아니어서')
  })
  it('범위의 끝값은 허용한다', () => {
    expect(sanitizeOverrides(base, { a: 0, b: 100 }, bounds).overrides).toEqual({ a: 0, b: 100 })
  })
  it('결과는 기본 설정의 키 순서이다', () => {
    expect(Object.keys(sanitizeOverrides(base, { n: 6, a: 2 }, bounds).overrides)).toEqual(['a', 'n'])
  })
  it('입력 객체를 바꾸지 않는다', () => {
    const input = { a: 2, zzz: 1 }
    sanitizeOverrides(base, input, bounds)
    expect(input).toEqual({ a: 2, zzz: 1 })
  })
})

describe('시나리오 이름', () => {
  const others = [
    { id: 's1', name: '채용 앞당기기' },
    { id: 's2', name: '일정 촉박' }
  ]
  it('빈 이름·공백만 있는 이름을 거부한다', () => {
    expect(validateScenarioName('', others)).toBeTruthy()
    expect(validateScenarioName('   ', others)).toBeTruthy()
  })
  it('길이 상한', () => {
    expect(validateScenarioName('가'.repeat(MAX_SCENARIO_NAME), others)).toBeNull()
    expect(validateScenarioName('가'.repeat(MAX_SCENARIO_NAME + 1), others)).toBeTruthy()
  })
  it('다른 시나리오와 같은 이름은 거부하되 자기 자신의 이름은 허용한다', () => {
    expect(validateScenarioName('일정 촉박', others)).toBe('같은 이름의 시나리오가 있습니다')
    expect(validateScenarioName('일정 촉박', others, 's2')).toBeNull()
    expect(validateScenarioName('  일정 촉박  ', others)).toBeTruthy() // 앞뒤 공백은 무시하고 비교
  })
  it('다른 이름은 통과', () => expect(validateScenarioName('새 대안', others)).toBeNull())

  it('새 이름은 쓰이지 않은 가장 작은 번호', () => {
    expect(nextScenarioName([])).toBe('시나리오 1')
    expect(nextScenarioName([{ name: '시나리오 1' }, { name: '시나리오 3' }])).toBe('시나리오 2')
  })
  it('복사 이름은 번호를 올려 중복을 피한다', () => {
    expect(copyScenarioName('A', [{ name: 'A' }])).toBe('A (복사)')
    expect(copyScenarioName('A', [{ name: 'A' }, { name: 'A (복사)' }])).toBe('A (복사 2)')
    expect(copyScenarioName('A', [{ name: 'A (복사)' }, { name: 'A (복사 2)' }])).toBe('A (복사 3)')
  })
  it('복사 이름이 길이 상한을 넘으면 원본 이름을 줄이고 그 결과도 유효하다', () => {
    const long = '가'.repeat(MAX_SCENARIO_NAME)
    const name = copyScenarioName(long, [{ name: long }])
    expect(name.length).toBeLessThanOrEqual(MAX_SCENARIO_NAME)
    expect(name.endsWith(' (복사)')).toBe(true)
    expect(validateScenarioName(name, [{ id: 'x', name: long }])).toBeNull()
  })
})

describe('nextScenarioId', () => {
  it('비어 있으면 s1, 가장 큰 번호 다음 번호를 쓴다', () => {
    expect(nextScenarioId([])).toBe('s1')
    expect(nextScenarioId([{ id: 's1' }, { id: 's2' }])).toBe('s3')
    expect(nextScenarioId([{ id: 's1' }, { id: 's5' }])).toBe('s6')
  })
  it('sN 형식이 아닌 id는 무시한다', () => {
    expect(nextScenarioId([{ id: 'custom' }, { id: 's-1' }, { id: 'x7' }])).toBe('s1')
  })
  it('유효한 id 형식(영문자·숫자·_·-, 40자 이하)을 만든다', () => {
    expect(nextScenarioId([{ id: 's99999999' }])).toMatch(/^[A-Za-z0-9_-]{1,40}$/)
  })
})

describe('개수 상한', () => {
  it('12개까지 만들 수 있다', () => {
    expect(MAX_SCENARIOS).toBe(12)
    expect(canAddScenario(11)).toBe(true)
    expect(canAddScenario(12)).toBe(false)
  })
})
