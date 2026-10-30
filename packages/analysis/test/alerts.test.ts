import { describe, expect, it } from 'vitest'
import { cloneEvmSettings, DEFAULT_EVM_SETTINGS, evaluateAlerts, statusAt, validateEvmSettings, type EvmPoint } from '../src'

const pt = (day: number, o: Partial<EvmPoint> = {}): EvmPoint => ({
  day, index: 0, pv: 100, ev: 100, ac: 100, progress: 0.1, cv: 0, sv: 0, cpi: 1, spi: 1, cpiK: 1, spiK: 1, ...o
})
const S = DEFAULT_EVM_SETTINGS

describe('경계값(0.9, 0.8)', () => {
  it.each([
    [0.9, 'none'],
    [0.9001, 'none'],
    [0.8999, 'warn'],
    [0.8, 'warn'],
    [0.7999, 'critical']
  ])('CPI %s → %s', (cpi, level) => {
    const ev = evaluateAlerts([pt(7, { cpi, progress: 0.01 })], S).filter((e) => e.rule === 'cpi')
    expect(ev.length === 0 ? 'none' : ev[0]!.level).toBe(level)
  })
  it('SPI도 같은 규칙이고 CPI와 따로 센다', () => {
    const ev = evaluateAlerts([pt(7, { cpi: 0.5, spi: 0.85, progress: 0.01 })], S)
    expect(ev.find((e) => e.rule === 'cpi')?.level).toBe('critical')
    expect(ev.find((e) => e.rule === 'spi')?.level).toBe('warn')
  })
  it('계산 불가(null) 지수는 경고를 만들지 않는다', () => {
    expect(evaluateAlerts([pt(0, { cpi: null, spi: null })], S)).toEqual([])
  })
})

describe('연속 하락', () => {
  const falling = [1, 0.97, 0.94, 0.91].map((v, i) => pt((i + 1) * 7, { cpiK: v, cpi: 1, progress: 0.01 }))
  it('3번 연속 하락한 보고일에 주의가 생긴다', () => {
    const ev = evaluateAlerts(falling, S).filter((e) => e.rule === 'trend')
    expect(ev.map((e) => e.day)).toEqual([28])
    expect(ev[0]!.message).toContain('CPI')
  })
  it('횟수를 바꾸면 더 일찍 알린다', () => {
    const s = cloneEvmSettings(S)
    s.alerts.trend = 2
    expect(evaluateAlerts(falling, s).filter((e) => e.rule === 'trend').map((e) => e.day)).toEqual([21, 28])
  })
})

describe('조기 경고', () => {
  it('진척률 15% 이상이고 CPI가 임계 미만이면 위험', () => {
    const e = evaluateAlerts([pt(30, { cpi: 0.85, progress: 0.15 })], S).filter((x) => x.rule === 'early')
    expect(e).toHaveLength(1)
    expect(e[0]!.level).toBe('critical')
    expect(e[0]!.message).toContain('회복이 어렵습니다')
  })
  it('진척률이 15% 미만이거나 CPI가 충분하면 아니다', () => {
    expect(evaluateAlerts([pt(30, { cpi: 0.85, progress: 0.149 })], S).some((x) => x.rule === 'early')).toBe(false)
    expect(evaluateAlerts([pt(30, { cpi: 0.9, progress: 0.5 })], S).some((x) => x.rule === 'early')).toBe(false)
  })
})

describe('상태', () => {
  const points = [pt(7), pt(14, { cpi: 0.85, progress: 0.01 }), pt(21, { cpi: 0.7, progress: 0.01 })]
  const events = evaluateAlerts(points, S)
  it('보고일의 가장 심각한 수준', () => {
    expect(statusAt(events, points, 7)).toBe('normal')
    expect(statusAt(events, points, 14)).toBe('warn')
    expect(statusAt(events, points, 21)).toBe('critical')
  })
  it('보고가 없는 날은 none', () => {
    expect(statusAt(events, points, 99)).toBe('none')
    expect(statusAt([], [], 0)).toBe('none')
  })
})

describe('validateEvmSettings', () => {
  const bad = (f: (s: ReturnType<typeof cloneEvmSettings>) => void) => {
    const s = cloneEvmSettings(S)
    f(s)
    return validateEvmSettings(s)
  }
  it('기본값은 통과', () => expect(validateEvmSettings(S)).toBeNull())
  it.each([
    ['구간 0', (s: typeof S) => (s.k = 0), '구간 수'],
    ['구간 소수', (s: typeof S) => (s.k = 2.5), '구간 수'],
    ['위험 > 주의', (s: typeof S) => (s.alerts.critical = 0.95), '위험 임계값'],
    ['임계 NaN', (s: typeof S) => (s.alerts.warn = NaN), '유한'],
    ['임계 0', (s: typeof S) => (s.alerts.critical = 0), '0보다'],
    ['추세 1', (s: typeof S) => (s.alerts.trend = 1), '연속 하락'],
    ['진척률 1.5', (s: typeof S) => (s.alerts.early.progress = 1.5), '진척률'],
    ['조기 CPI 0', (s: typeof S) => (s.alerts.early.cpi = 0), '조기 경고 CPI']
  ])('%s', (_n, f, msg) => expect(bad(f as never)).toContain(msg))
})
