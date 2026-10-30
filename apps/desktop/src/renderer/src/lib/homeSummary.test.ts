import { describe, expect, it } from 'vitest'
import { compileModel, runModel } from '@spd/sd-engine'
import { catalog } from '../catalog'
import { modelDefs } from '../engine/models'
import { defaultParams } from './params'
import { summarizeLastRun } from './homeSummary'

function record(modelId: string, overrides: Record<string, number> = {}, end?: number) {
  const entry = catalog.find((m) => m.id === modelId)!
  const params = { ...defaultParams(entry), ...overrides }
  const result = runModel(compileModel(modelDefs[modelId] as never), { overrides: params, ...(end ? { end } : {}) })
  return { entry, run: { name: '#1 기준', params, result, kpis: entry.kpis(result) } }
}

describe('summarizeLastRun', () => {
  it('실행 기록이 없으면 null', () => {
    expect(summarizeLastRun(catalog[0]!, [])).toBeNull()
  })

  it('마지막 실행을 일정·공수·결함·인력으로 요약한다(통합 모델)', () => {
    const { entry, run } = record('integrated-project')
    const s = summarizeLastRun(entry, [run, { ...run, name: '#2 마지막' }])!
    expect(s.name).toBe('#2 마지막')
    expect(s.items.map((i) => i.heading)).toEqual(['일정', '공수', '결함', '인력'])
    expect(s.items[0]).toMatchObject({ label: '완료일', unit: '일' })
    expect(s.items[1]).toMatchObject({ label: '총 투입 공수', unit: '맨데이' })
    expect(Number(s.items[0]!.value.replace(',', ''))).toBeGreaterThan(250)
    expect(s.items[3]).toMatchObject({ label: '최대 인원', unit: '명' })
  })

  it('Brooks 모델은 모델에 있는 그룹만 보인다', () => {
    const { entry, run } = record('brooks')
    const s = summarizeLastRun(entry, [run])!
    const groups = new Set(entry.kpiSpecs.map((k) => k.group))
    expect(s.items.length).toBe([...groups].filter((g) => ['schedule', 'cost', 'quality'].includes(g)).length + 1)
    expect(s.items[0]!.value).toBe('274.1')
  })

  it('종료 시각 안에 끝나지 않으면 완료일은 미완료', () => {
    const { entry, run } = record('brooks', {}, 100)
    const s = summarizeLastRun(entry, [run])!
    expect(s.items[0]!.value).toBe('미완료')
  })
})
