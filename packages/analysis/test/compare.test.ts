import { describe, expect, it } from 'vitest'
import type { RunResult } from '@spd/sd-engine'
import {
  compareToBase,
  compareValue,
  computeKpis,
  lastOf,
  maxOf,
  normalizeForRadar,
  RADAR_MAX,
  valueAt,
  type KpiSpec,
  type RadarAxis
} from '../src'

const result = (time: number[], series: Record<string, number[]>): RunResult => ({
  time: Float64Array.from(time),
  series: Object.fromEntries(Object.entries(series).map(([k, v]) => [k, Float64Array.from(v)])),
  meta: { model: 't', version: 1, dt: 1, seed: 1, completed: true }
})

describe('결과 도우미', () => {
  const r = result([0, 1, 2, 4], { x: [0, 10, 20, 60] })
  it('lastOf, maxOf', () => {
    expect(lastOf(r, 'x')).toBe(60)
    expect(maxOf(r, 'x')).toBe(60)
  })
  it('valueAt은 눈금 사이를 선형 보간하고 범위 밖은 끝값을 쓴다', () => {
    expect(valueAt(r, 'x', 1.5)).toBe(15)
    expect(valueAt(r, 'x', 3)).toBe(40)
    expect(valueAt(r, 'x', 2)).toBe(20)
    expect(valueAt(r, 'x', -5)).toBe(0)
    expect(valueAt(r, 'x', 99)).toBe(60)
  })
  it('없는 변수는 이름을 담아 오류', () => {
    expect(() => lastOf(r, 'nope')).toThrow(/nope/)
  })
})

describe('computeKpis', () => {
  const specs: KpiSpec[] = [
    { id: 'end', label: '끝', unit: '', better: 'lower', group: 'schedule', decimals: 1, compute: (res) => lastOf(res, 'x') },
    { id: 'none', label: 'N', unit: '', better: 'none', group: 'risk', decimals: 0, compute: () => null },
    { id: 'bad', label: 'B', unit: '', better: 'lower', group: 'cost', decimals: 0, compute: () => NaN }
  ]
  it('지표마다 계산하고 null·비유한 값은 null로 통일한다', () => {
    expect(computeKpis(specs, result([0, 1], { x: [0, 7] }), {})).toEqual({ end: 7, none: null, bad: null })
  })
  it('유효 파라미터를 지표 계산에 넘긴다', () => {
    const s: KpiSpec = { id: 'p', label: '', unit: '', better: 'none', group: 'risk', decimals: 0, compute: (_r, p) => (p['k'] as number) * 2 }
    expect(computeKpis([s], result([0], { x: [0] }), { k: 21 })).toEqual({ p: 42 })
  })
})

describe('compareValue', () => {
  it.each([
    ['lower', 100, 80, 'better'],
    ['lower', 100, 120, 'worse'],
    ['higher', 100, 120, 'better'],
    ['higher', 100, 80, 'worse'],
    ['lower', 100, 100, 'same'],
    ['none', 100, 80, 'n/a']
  ] as const)('%s: 기준 %d, 값 %d → %s', (better, base, value, verdict) => {
    expect(compareValue(better, base, value).verdict).toBe(verdict)
  })

  it('차이와 변화율을 계산한다', () => {
    const d = compareValue('lower', 200, 150)
    expect(d.diff).toBe(-50)
    expect(d.ratio).toBeCloseTo(-0.25, 12)
  })
  it('방향이 없어도 차이는 계산한다', () => {
    expect(compareValue('none', 10, 14)).toMatchObject({ diff: 4, verdict: 'n/a' })
  })
  it('null은 판정·차이 모두 n/a', () => {
    expect(compareValue('lower', null, 5)).toEqual({ value: 5, base: null, diff: null, ratio: null, verdict: 'n/a' })
    expect(compareValue('lower', 5, null)).toEqual({ value: null, base: 5, diff: null, ratio: null, verdict: 'n/a' })
  })
  it('기준이 0이면 변화율은 null이지만 차이와 판정은 있다', () => {
    expect(compareValue('lower', 0, 3)).toMatchObject({ diff: 3, ratio: null, verdict: 'worse' })
  })
  it('부동소수 잡음은 같다고 본다', () => {
    expect(compareValue('lower', 0.3, 0.1 + 0.2).verdict).toBe('same')
    expect(compareValue('lower', 1e6, 1e6 + 1e-6).verdict).toBe('same')
  })
  it('작지만 실제 차이는 구분한다', () => {
    expect(compareValue('lower', 100, 99.9).verdict).toBe('better')
  })
})

describe('compareToBase', () => {
  const specs: KpiSpec[] = [
    { id: 'a', label: '', unit: '', better: 'lower', group: 'schedule', decimals: 0, compute: () => 0 },
    { id: 'b', label: '', unit: '', better: 'higher', group: 'quality', decimals: 0, compute: () => 0 }
  ]
  it('지표별로 계산하고 없는 값은 null로 본다', () => {
    const r = compareToBase(specs, { a: 10, b: 5 }, { a: 12 })
    expect(r['a']).toMatchObject({ diff: 2, verdict: 'worse' })
    expect(r['b']).toMatchObject({ value: null, verdict: 'n/a' })
  })
})

describe('normalizeForRadar', () => {
  const spec = (id: string, better: KpiSpec['better']): KpiSpec => ({ id, label: id, unit: '', better, group: 'schedule', decimals: 0, compute: () => 0 })
  const specs = [spec('days', 'lower'), spec('effort', 'lower'), spec('quality', 'higher'), spec('staff', 'none')]
  const axes: RadarAxis[] = [
    { id: 'schedule', label: '일정', kpiId: 'days' },
    { id: 'cost', label: '비용', kpiId: 'effort' },
    { id: 'quality', label: '품질', kpiId: 'quality' }
  ]
  const base = { days: 300, effort: 1000, quality: 10, staff: 5 }

  it('기준 시나리오는 모든 축에서 1이다', () => {
    const r = normalizeForRadar(axes, specs, base, [{ id: 'base', kpis: base }])
    expect(r.series[0]?.values).toEqual([1, 1, 1])
    expect(r.skipped).toEqual([])
  })

  it('좋은 방향이 낮음이면 기준÷값, 높음이면 값÷기준 — 바깥일수록 좋다', () => {
    const r = normalizeForRadar(axes, specs, base, [{ id: 's', kpis: { days: 200, effort: 1250, quality: 15, staff: 9 } }])
    const [days, effort, quality] = r.series[0]?.values as number[]
    expect(days).toBeCloseTo(1.5, 12) // 300/200: 일정이 짧아져 좋아짐
    expect(effort).toBeCloseTo(0.8, 12) // 1000/1250: 공수가 늘어 나빠짐
    expect(quality).toBeCloseTo(1.5, 12)
  })

  it('상한 2로 제한하고 값이 0이면(낮음이 좋음) 상한', () => {
    const r = normalizeForRadar(axes, specs, base, [{ id: 's', kpis: { days: 10, effort: 0, quality: 1000, staff: 0 } }])
    expect(r.series[0]?.values).toEqual([RADAR_MAX, RADAR_MAX, RADAR_MAX])
  })

  it('높음이 좋은 지표가 0이면 0이다', () => {
    const r = normalizeForRadar(axes, specs, base, [{ id: 's', kpis: { days: 300, effort: 1000, quality: 0, staff: 0 } }])
    expect(r.series[0]?.values?.[2]).toBe(0)
  })

  it('시나리오 값이 null인 축은 null이고 다른 축은 그대로다', () => {
    const r = normalizeForRadar(axes, specs, base, [{ id: 's', kpis: { days: null, effort: 500, quality: 10, staff: 1 } }])
    expect(r.series[0]?.values).toEqual([null, 2, 1])
  })

  it('기준이 null·0 이하이거나 방향이 없는 축은 이유와 함께 제외한다', () => {
    const r = normalizeForRadar(
      [...axes, { id: 'risk', label: '위험', kpiId: 'staff' }, { id: 'ghost', label: '없음', kpiId: 'zzz' }],
      specs,
      { days: null, effort: 0, quality: 10, staff: 5 },
      [{ id: 's', kpis: { days: 100, effort: 100, quality: 20, staff: 3 } }]
    )
    expect(r.axes.map((a) => a.id)).toEqual(['quality'])
    expect(r.skipped.map((s) => [s.axis.id, s.reason])).toEqual([
      ['schedule', expect.stringContaining('기준 시나리오의 값이 없')],
      ['cost', expect.stringContaining('0 이하')],
      ['risk', expect.stringContaining('방향')],
      ['ghost', expect.stringContaining('정의가 없')]
    ])
    expect(r.series[0]?.values).toEqual([2])
  })

  it('시나리오가 여럿이어도 축 순서가 같다', () => {
    const r = normalizeForRadar(axes, specs, base, [
      { id: 'a', kpis: base },
      { id: 'b', kpis: { ...base, days: 150 } }
    ])
    expect(r.series.map((s) => s.id)).toEqual(['a', 'b'])
    expect(r.series[1]?.values?.[0]).toBe(2)
    expect(r.series[1]?.values?.[1]).toBe(1)
  })
})
