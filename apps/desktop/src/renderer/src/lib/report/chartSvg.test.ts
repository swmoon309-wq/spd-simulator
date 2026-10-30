import { describe, expect, it } from 'vitest'
import { compileModel, runModel } from '@spd/sd-engine'
import { getEntry } from '../../catalog'
import { modelDefs } from '../../engine/models'
import { defaultParams } from '../params'
import { barData, buildComparison, overlayRuns, radarData } from '../scenarioCompare'
import { kpiBarHeight, kpiBarOption, kpiBarSummary } from '../charts/kpiBarOption'
import { kpiRadarOption, kpiRadarSummary } from '../charts/kpiRadarOption'
import { timeSeriesOption } from '../charts/timeSeriesOption'
import { BASE_ID, type ScenarioRun } from '../scenarioRunner'
import { normalizeSvgIds, renderChartSvg } from './chartSvg'
import { safeSvg } from './escape'

/** 시나리오 일괄 실행을 흉내 낸 입력: 기준과 "추가 5명". */
function brooksComparison() {
  const entry = getEntry('brooks')
  const params = defaultParams(entry)
  const settings = { end: 400, dt: 0.25, seed: 1 }
  const scenarios = [{ id: 's1', name: '5명 추가', overrides: { extra_people: 5 } }]
  const run = (overrides: Record<string, number>): ScenarioRun => {
    const resultParams = { ...params, ...overrides }
    return { status: 'done', progress: 1, result: runModel(compileModel(modelDefs['brooks'] as never), { overrides: resultParams, end: settings.end, dt: settings.dt, seed: settings.seed }), resultParams, error: null } as unknown as ScenarioRun
  }
  const runs = { [BASE_ID]: run({}), s1: run({ extra_people: 5 }) }
  const comparison = buildComparison(entry, { modelId: 'brooks', params, settings, scenarios }, runs)
  return { entry, comparison, runs }
}

describe('차트 옵션 빌더 → SVG (설계 09의 R0)', () => {
  it('막대: 화면 옵션 그대로 SVG가 된다. 시나리오 이름과 지표가 들어 있다', () => {
    const { comparison } = brooksComparison()
    const bar = barData(comparison, 'completionDay')!
    const svg = renderChartSvg(kpiBarOption(bar, false), 640, kpiBarHeight(bar))
    expect(safeSvg(svg)).not.toBeNull()
    expect(svg).toContain('5명 추가')
    expect(svg).toContain('완료일')
    expect(kpiBarSummary(bar)).toContain('5명 추가')
  })

  it('막대: 완료하지 못한 항목은 "(미완료)"로 표시된다', () => {
    const { comparison } = brooksComparison()
    const bar = barData(comparison, 'completionDay')!
    const option = kpiBarOption({ ...bar, values: [bar.values[0] ?? null, null] }, false)
    expect(option.yAxis.data[1]).toContain('(미완료)')
  })

  it('레이더: 축이 3개 미만이면 그릴 수 없다는 판단은 데이터에서 나오고, 옵션은 기준 = 1 선을 가진다', () => {
    const { entry, comparison } = brooksComparison()
    const radar = radarData(entry, comparison)
    expect(radar.axes.length).toBeLessThan(3)
    const option = kpiRadarOption({ ...radar, axes: [{ id: 'a', label: '일정', kpiId: 'completionDay' }, { id: 'b', label: '비용', kpiId: 'totalEffort' }, { id: 'c', label: '품질', kpiId: 'x' }], series: [{ id: 's1', name: '대안', color: '#e69f00', values: [1.2, 0.9, 1] }] }, false)
    expect(option.series[0]?.data[0]?.value).toEqual([1, 1, 1])
    const svg = renderChartSvg(option, 480, 360)
    expect(safeSvg(svg)).not.toBeNull()
    expect(svg).toContain('일정')
    expect(kpiRadarSummary({ ...radar, axes: [{ id: 'a', label: '일정', kpiId: 'k' }], series: [{ id: 's1', name: '대안', color: '#fff', values: [1.2] }] })).toBe('대안: 일정 1.20')
  })

  it('시계열: 겹친 실행이 모두 그려지고, 보고서용(interactive=false)에는 확대·도구 상자가 없다', () => {
    const { entry, comparison, runs } = brooksComparison()
    const overlay = overlayRuns(entry, comparison, runs)
    const variable = entry.variables.find((v) => v.name === entry.defaultVariable)!
    const live = timeSeriesOption({ runs: overlay, references: [], live: null, variable }, false, true)
    const still = timeSeriesOption({ runs: overlay, references: [], live: null, variable }, false, false)
    expect(live).toHaveProperty('dataZoom')
    expect(live).toHaveProperty('toolbox')
    expect(still).not.toHaveProperty('dataZoom')
    expect(still).not.toHaveProperty('toolbox')
    expect(still.series).toHaveLength(2)
    const svg = renderChartSvg(still, 720, 360)
    expect(safeSvg(svg)).not.toBeNull()
    expect(svg).toContain('5명 추가')
  })

  it('같은 옵션은 같은 SVG를 낸다(결정적)', () => {
    const { comparison } = brooksComparison()
    const bar = barData(comparison, 'completionDay')!
    expect(renderChartSvg(kpiBarOption(bar, false), 640, 240)).toBe(renderChartSvg(kpiBarOption(bar, false), 640, 240))
  })

  it('화면용 옵션은 어두운 테마에서 글자색만 다르다(같은 구조)', () => {
    const { comparison } = brooksComparison()
    const bar = barData(comparison, 'completionDay')!
    const light = kpiBarOption(bar, false)
    const dark = kpiBarOption(bar, true)
    expect(Object.keys(dark)).toEqual(Object.keys(light))
    expect(dark.textStyle.color).not.toBe(light.textStyle.color)
  })
})

describe('normalizeSvgIds', () => {
  it('프로세스 번호가 다른 같은 차트도 같은 이름으로 다시 번호를 붙인다', () => {
    const a = '<path class="zr0-cls-0"/><path class="zr0-cls-1"/><g clip-path="url(#zr0-c0)"/><path class="zr0-cls-0"/>'
    const b = '<path class="zr7-cls-5"/><path class="zr7-cls-9"/><g clip-path="url(#zr7-c3)"/><path class="zr7-cls-5"/>'
    expect(normalizeSvgIds(a)).toBe(normalizeSvgIds(b))
    expect(normalizeSvgIds(a)).toBe('<path class="zr-cls-0"/><path class="zr-cls-1"/><g clip-path="url(#zr-c-0)"/><path class="zr-cls-0"/>')
  })
})
