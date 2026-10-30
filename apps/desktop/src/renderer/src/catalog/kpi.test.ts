import { describe, expect, it } from 'vitest'
import { compareToBase, computeKpis, normalizeForRadar, RADAR_MAX } from '@spd/analysis'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { getEntry, catalog } from '.'
import { defaultParams } from '../lib/params'

const kpisOf = (modelId: string, overrides: Record<string, number> = {}, end?: number) => {
  const entry = getEntry(modelId)
  const params = { ...defaultParams(entry), ...overrides }
  const result: RunResult = runModel(compileModel(entry.def), { overrides: params, ...(end ? { end } : {}) })
  return computeKpis(entry.kpiSpecs, result, params)
}

describe.each(catalog.map((m) => [m.id, m] as const))('지표 정의 공통 검사: %s', (_id, entry) => {
  it('지표 id가 겹치지 않고 모든 지표에 라벨과 올바른 자릿수가 있다', () => {
    expect(new Set(entry.kpiSpecs.map((k) => k.id)).size).toBe(entry.kpiSpecs.length)
    for (const k of entry.kpiSpecs) {
      expect(k.label, k.id).toBeTruthy()
      expect(k.decimals, k.id).toBeGreaterThanOrEqual(0)
      expect(['schedule', 'cost', 'quality', 'risk']).toContain(k.group)
    }
  })

  it('레이더 축은 존재하고 방향이 있는 지표를 가리키며 축 id가 겹치지 않는다', () => {
    expect(new Set(entry.radarAxes.map((a) => a.id)).size).toBe(entry.radarAxes.length)
    for (const axis of entry.radarAxes) {
      const spec = entry.kpiSpecs.find((k) => k.id === axis.kpiId)
      expect(spec, axis.id).toBeDefined()
      expect(spec?.better, axis.id).not.toBe('none')
    }
  })

  it('실행 표용 kpis()와 같은 완료일·최대 인원을 낸다', () => {
    const params = defaultParams(entry)
    const result = runModel(compileModel(entry.def), { overrides: params })
    const legacy = entry.kpis(result)
    const values = computeKpis(entry.kpiSpecs, result, params)
    expect(values['completionDay']).toBe(legacy.completionDay)
    expect(values['peakStaff']).toBeCloseTo(legacy.peakStaff, 9)
  })

  it('완료하지 못한 실행은 완료 시점 지표가 null이다', () => {
    const params = defaultParams(entry)
    const result = runModel(compileModel(entry.def), { overrides: params, end: 100 })
    const values = computeKpis(entry.kpiSpecs, result, params)
    expect(values['completionDay']).toBeNull()
    expect(values['totalEffort']).toBeNull()
    expect(values['peakStaff']).not.toBeNull()
  })
})

describe('Brooks 법칙 지표', () => {
  it('기준선: 274.1일, 20명 × 274.1일 ≈ 5,482 맨데이, 최대 20명', () => {
    const k = kpisOf('brooks')
    expect(k['completionDay']).toBeCloseTo(274.12, 1)
    expect(k['totalEffort']).toBeCloseTo(5482.5, 0)
    expect(k['peakStaff']).toBeCloseTo(20, 9)
  })

  it('5명 추가: 일정은 줄고 공수는 늘며 최대 인원은 25명', () => {
    const base = kpisOf('brooks')
    const plus5 = kpisOf('brooks', { extra_people: 5 })
    const entry = getEntry('brooks')
    const d = compareToBase(entry.kpiSpecs, base, plus5)
    expect(plus5['completionDay']).toBeCloseTo(272.0, 1)
    expect(d['completionDay']?.verdict).toBe('better')
    expect(d['totalEffort']?.verdict).toBe('worse')
    expect(d['peakStaff']?.verdict).toBe('n/a')
    expect(plus5['peakStaff']).toBeCloseTo(25, 9)
  })

  it('레이더 축이 둘뿐이라 3축 미만이다(화면은 레이더 대신 안내를 보인다)', () => {
    expect(getEntry('brooks').radarAxes.length).toBeLessThan(3)
  })
})

describe('통합 프로젝트 모델 지표', () => {
  const entry = getEntry('integrated-project')

  it('기본 설정: 314.3일(계획 200일 대비 +57%), 약 1,224 맨데이', () => {
    const k = kpisOf('integrated-project')
    expect(k['completionDay']).toBeCloseTo(314.25, 1)
    expect(k['scheduleSlip']).toBeCloseTo(57.1, 0)
    expect(k['totalEffort']).toBeCloseTo(1224, -1)
    expect(k['residualDefects']).toBeGreaterThan(5)
    expect(k['residualDefects']).toBeLessThan(12)
    expect(k['residualDensity']).toBeCloseTo((k['residualDefects'] as number) / (400 * 0.06), 9)
    expect(k['maxPressure']).toBeGreaterThan(1)
    expect(k['exhaustionNearness']).toBeGreaterThan(0.9)
    expect(k['exhaustionNearness']).toBeLessThanOrEqual(1.01)
    expect(k['peakStaff']).toBeCloseTo(8.4, 1)
  })

  it('계획 대비 지연은 완료일과 계획 일정에서 계산한다', () => {
    const k = kpisOf('integrated-project', { planned_duration_days: 150 })
    expect(k['scheduleSlip']).toBeCloseTo((100 * ((k['completionDay'] as number) - 150)) / 150, 9)
  })

  it('과소추정이 없으면 완료일·공수·잔존 결함이 모두 나아진다(기준 대비 "좋음")', () => {
    const base = kpisOf('integrated-project')
    const known = kpisOf('integrated-project', { plan_known_fraction: 1 })
    expect(known['completionDay']).toBeCloseTo(266.0, 1)
    const d = compareToBase(entry.kpiSpecs, base, known)
    for (const id of ['completionDay', 'scheduleSlip', 'totalEffort', 'residualDefects', 'residualDensity']) {
      expect(d[id]?.verdict, id).toBe('better')
    }
    expect(d['peakStaff']?.verdict).toBe('n/a')
  })

  it('레이더: 기준 = 1, 개선은 1보다 크고 상한 2를 넘지 않는다', () => {
    const base = kpisOf('integrated-project')
    const known = kpisOf('integrated-project', { plan_known_fraction: 1 })
    const r = normalizeForRadar(entry.radarAxes, entry.kpiSpecs, base, [
      { id: 'base', kpis: base },
      { id: 'known', kpis: known }
    ])
    expect(r.axes.map((a) => a.id)).toEqual(['schedule', 'cost', 'quality', 'risk'])
    expect(r.series[0]?.values).toEqual([1, 1, 1, 1])
    const [schedule, cost, quality, risk] = r.series[1]?.values as number[]
    expect(schedule).toBeCloseTo(314.25 / 266, 2)
    expect(cost).toBeGreaterThan(1)
    expect(quality).toBe(RADAR_MAX) // 잔존 결함이 절반 아래로 줄어 상한에 닿는다
    expect(risk).toBeGreaterThan(0.9)
  })

  it('기준이 미완료이면 완료 시점 축은 제외되고 이유를 알린다', () => {
    const base = kpisOf('integrated-project', {}, 100)
    const r = normalizeForRadar(entry.radarAxes, entry.kpiSpecs, base, [{ id: 'base', kpis: base }])
    expect(r.axes.map((a) => a.id)).toEqual(['risk'])
    expect(r.skipped.map((s) => s.axis.id)).toEqual(['schedule', 'cost', 'quality'])
  })
})
