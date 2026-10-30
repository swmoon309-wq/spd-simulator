import { describe, expect, it } from 'vitest'
import { DEFAULT_EVM_SETTINGS, evAt, type ActualRow } from '@spd/analysis'
import { getEntry } from '../catalog'
import { buildControlView, formatIndex, formatSigned } from './control'
import { createAdoption } from './adoption'
import { taskFor, EMPTY_RUN } from './scenarioRunner'
import { defaultParams } from './params'
import { defaultRunSettings } from './runSettings'
import { compileModel, runModel } from '@spd/sd-engine'
import { modelDefs } from '../engine/models'
import { evmOf } from '../catalog/evm'

const entry = getEntry('brooks')
const fallback = { credits: evmOf(entry).credits, totalTasks: 400 }

describe('buildControlView', () => {
  it('채택이 없으면 검사만 하고 지표는 없다', () => {
    const rows: ActualRow[] = [{ day: 7, cum: { developed_software: 5 }, effort: -1 }]
    const v = buildControlView(null, rows, fallback, DEFAULT_EVM_SETTINGS)
    expect(v.points).toEqual([])
    expect(v.issues[0]?.errors.length).toBeGreaterThan(0)
  })

  it('채택이 있으면 보고일별 지표를 계산하고 오류 행은 뺀다', () => {
    const params = defaultParams(entry)
    const settings = defaultRunSettings(entry)
    const task = taskFor({ modelId: 'brooks', params, settings, scenarios: [] }, '@base')!
    const result = runModel(compileModel(modelDefs['brooks'] as never), { overrides: task.params })
    const made = createAdoption({
      entry, scenarioId: '@base', scenarioName: '기준', task,
      run: { ...EMPTY_RUN, phase: 'done', result, resultKey: task.key } as never
    })
    if (!made.ok) throw new Error(made.message)
    const rows: ActualRow[] = [
      { day: 50, cum: { developed_software: 100 }, effort: 500 },
      { day: 40, cum: { developed_software: 90 }, effort: 450 },
      { day: 100, cum: { developed_software: 200 }, effort: 1000 }
    ]
    const v = buildControlView(made.adopted, rows, fallback, DEFAULT_EVM_SETTINGS)
    expect(v.points.map((p) => p.day)).toEqual([50, 100])
    expect(v.issues[1]?.errors).toHaveLength(1)
    expect(v.points[0]?.pv).toBeGreaterThan(0)
    // EV = 계획이 같은 진척에 도달할 때까지 쓴 공수(비용 정렬)
    expect(v.points[0]?.ev).toBeCloseTo(evAt(made.adopted, 100 / made.adopted.totalTasks), 6)
    expect(v.points[0]?.ev).toBeGreaterThan(0)
  })
})

describe('표시 형식', () => {
  it('지수는 소수 2자리, 계산 불가는 –', () => {
    expect(formatIndex(0.9567)).toBe('0.96')
    expect(formatIndex(null)).toBe('–')
  })
  it('편차는 부호를 붙인다', () => {
    expect(formatSigned(12.4)).toBe('+12')
    expect(formatSigned(-1234.6)).toBe('-1,235')
    expect(formatSigned(0)).toBe('0')
  })
})
