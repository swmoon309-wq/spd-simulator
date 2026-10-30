import { describe, expect, it } from 'vitest'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { runApplyGate } from './apply'
import { deleteVariable, setField, setSpec, type EditResult } from './commands'

const NOW = new Date('2026-10-23T00:00:00.000Z')
const docOf = (id: string): ModelDoc => {
  const v = validateModelDoc(docFromBuiltin(catalog.find((m) => m.id === id)!, { now: NOW, random: () => 0.3 }))
  if (!v.ok) throw new Error(v.message)
  return v.doc
}
const must = (r: EditResult): ModelDoc => {
  if (!r.ok) throw new Error(r.message)
  return r.doc
}
const step = (g: ReturnType<typeof runApplyGate>, id: string) => g.steps.find((s) => s.id === id)!

describe('적용 게이트 (설계 08의 8.1)', () => {
  it('Brooks 사본: 막는 단계가 모두 통과하고 구조 점검 결과가 나온다', () => {
    const g = runApplyGate(docOf('brooks'))
    expect(g.canApply).toBe(true)
    expect(g.steps.map((s) => s.id)).toEqual(['lint', 'spec', 'trial', 'units', 'structure'])
    expect(step(g, 'lint').status).not.toBe('fail')
    expect(step(g, 'spec').status).toBe('pass')
    expect(step(g, 'trial').status).toBe('pass')
    expect(['pass', 'info']).toContain(step(g, 'units').status)
    expect(step(g, 'units').blocking).toBe(false)
    expect(g.unitErrors).toBe(0)
    expect(g.structure?.map((f) => f.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
    expect(g.validated?.hash).toHaveLength(16)
  })

  it.each(catalog.filter((m) => m.category !== 'user').map((m) => [m.id] as const))('내장 %s의 사본도 적용할 수 있다', (id) => {
    expect(runApplyGate(docOf(id)).canApply).toBe(true)
  })

  it('내장 7개 사본에는 단위 오류가 없다', () => {
    for (const m of catalog.filter((x) => x.category !== 'user')) expect(runApplyGate(docOf(m.id)).unitErrors, m.id).toBe(0)
  })

  it('단위 오류는 적용을 막지 않고 확인을 요구한다(D5): 오류 개수와 이유, 안내 문구', () => {
    const d = must(setField(docOf('brooks'), 'software_development_rate', { field: 'expr', value: 'MIN(potential_development_rate, requirements / DT) + DT' }))
    const g = runApplyGate(d)
    expect(g.canApply).toBe(true)
    expect(g.unitErrors).toBeGreaterThan(0)
    const units = step(g, 'units')
    expect(units).toMatchObject({ status: 'fail', blocking: false })
    expect(units.details[0]).toContain("'software_development_rate'")
    expect(units.details.join(' ')).toContain('확인이 필요합니다')
  })

  it('단위를 추론하지 못한 곳은 경고(정보 상태)일 뿐이다', () => {
    const d = docOf('brooks')
    const noUnit = must(setField(docOf('brooks'), 'initial_new', { field: 'unit', value: '' }))
    const g = runApplyGate(noUnit)
    expect(g.canApply).toBe(true)
    expect(g.unitErrors).toBe(0)
    expect(d).toBeDefined()
    expect(['pass', 'info']).toContain(step(g, 'units').status)
  })

  it('구조 오류가 있으면 막고 나머지 막는 단계는 건너뛴다(위치가 든 이유)', () => {
    const d = must(setField(docOf('brooks'), 'software_development_rate', { field: 'expr', value: 'productivity_typo * 2' }))
    const g = runApplyGate(d)
    expect(g.canApply).toBe(false)
    expect(g.validated).toBeNull()
    expect(step(g, 'lint')).toMatchObject({ status: 'fail', blocking: true })
    expect(step(g, 'lint').details[0]).toContain("'software_development_rate'")
    expect(step(g, 'lint').details[0]).toContain('productivity_typo')
    expect(step(g, 'spec').status).toBe('skipped')
    expect(step(g, 'trial').status).toBe('skipped')
    expect(step(g, 'units').status).toBe('skipped')
    expect(step(g, 'structure').status).toBe('skipped')
    expect(g.unitErrors).toBe(0)
  })

  it('앱 연결(spec)이 맞지 않으면 막는다', () => {
    const d = docOf('brooks')
    const bad = setSpec(d, { ...d.spec, params: d.spec.params.slice(1) })
    const g = runApplyGate(bad)
    expect(g.canApply).toBe(false)
    expect(step(g, 'lint').status).not.toBe('fail')
    expect(step(g, 'spec')).toMatchObject({ status: 'fail', blocking: true })
    expect(step(g, 'spec').details[0]).toMatch(/파라미터 정의/)
    expect(step(g, 'trial').status).toBe('skipped')
  })

  it('기본값으로 실행하면 수치 오류(0으로 나누기)가 나는 모델은 막는다', () => {
    const d = must(setField(docOf('brooks'), 'software_development_rate', { field: 'expr', value: '1 / (TIME - TIME)' }))
    const g = runApplyGate(d)
    expect(g.canApply).toBe(false)
    expect(step(g, 'lint').status).not.toBe('fail')
    expect(step(g, 'spec').status).toBe('pass')
    expect(step(g, 'trial')).toMatchObject({ status: 'fail', blocking: true })
    expect(step(g, 'trial').details[0]).toMatch(/software_development_rate|0으로/)
  })

  it('종료 시각 안에 완료하지 못하면 막지 않고 알린다', () => {
    const d = docOf('brooks')
    const short = { ...d, def: { ...d.def, time: { ...d.def.time, end: 50 } } }
    const g = runApplyGate(short)
    expect(g.canApply).toBe(true)
    expect(step(g, 'trial')).toMatchObject({ status: 'info' })
    expect(step(g, 'trial').details[0]).toMatch(/완료 조건/)
  })

  it('경고(쓰이지 않는 상수)는 막지 않고 알린다', () => {
    const d = docOf('brooks')
    const withUnused = { ...d, def: { ...d.def, constants: { ...d.def.constants, spare: { value: 1 } } }, spec: { ...d.spec, params: [...d.spec.params, { name: 'spare', group: '기타', min: 0, max: 5, step: 1 }] } }
    const g = runApplyGate(withUnused)
    expect(g.canApply).toBe(true)
    expect(step(g, 'lint').status).toBe('info')
    expect(step(g, 'lint').details[0]).toContain('spare')
  })

  it('구조 점검에 실패 항목이 있어도 적용을 막지 않는다(D3)', () => {
    // Level이 음수가 되는 모델: 유출이 항상 유입보다 크다
    const d = docOf('brooks')
    const odd = must(setField(d, 'requirements', { field: 'init', value: '-5' }))
    const g = runApplyGate(odd)
    expect(g.canApply).toBe(true)
    expect(step(g, 'structure').blocking).toBe(false)
    expect(['pass', 'info', 'fail']).toContain(step(g, 'structure').status)
  })

  it('변수를 지운 뒤 남은 참조 때문에 막힌 사례를 되돌리면 통과한다', () => {
    const d = docOf('brooks')
    expect(deleteVariable(d, 'requirements').ok).toBe(false)
    expect(runApplyGate(d).canApply).toBe(true)
  })
})
