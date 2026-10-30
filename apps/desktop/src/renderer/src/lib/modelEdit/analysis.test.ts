import { describe, expect, it } from 'vitest'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import { analyze } from './analysis'
import { setField, type EditResult } from './commands'

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

describe('편집 분석: 구조 문제와 단위 문제를 함께 센다', () => {
  it('내장 모델 사본: 오류·경고·단위 오류가 모두 0이다', () => {
    for (const m of catalog.filter((x) => x.category !== 'user')) {
      const a = analyze(docOf(m.id))
      expect(a.errors, m.id).toBe(0)
      expect(a.unitErrors, m.id).toBe(0)
    }
  })

  it('단위 오류는 오류·단위 오류 양쪽에 세고 변수별로 모인다(구조 오류는 단위 오류가 아니다)', () => {
    const d = must(setField(docOf('brooks'), 'software_development_rate', { field: 'expr', value: 'MIN(potential_development_rate, requirements / DT) + DT' }))
    const a = analyze(d)
    expect(a.unitErrors).toBe(1)
    expect(a.errors).toBe(1)
    const issue = a.byVariable.get('software_development_rate')!.find((i) => i.code === 'unit-mismatch')!
    expect(issue.severity).toBe('error')
    expect(issue.range).toBeDefined()
    expect(a.start).not.toBeNull() // 단위 오류는 실행을 막지 않는다
    const lint = analyze(must(setField(docOf('brooks'), 'software_development_rate', { field: 'expr', value: 'nothing' })))
    expect(lint.errors).toBeGreaterThan(0)
    expect(lint.unitErrors).toBe(0)
    expect(lint.start).toBeNull() // 구조 오류가 있으면 시각 0 값을 만들지 않는다
  })

  it('단위 선언이 없으면 정보와 제안이 나온다(오류·경고로 세지 않는다)', () => {
    const d = must(setField(docOf('brooks'), 'software_development_rate', { field: 'unit', value: '' }))
    const a = analyze(d)
    expect(a.errors).toBe(0)
    expect(a.infos).toBeGreaterThan(0)
    const s = a.byVariable.get('software_development_rate')!.find((i) => i.code === 'unit-suggest')!
    expect(s).toMatchObject({ severity: 'info', suggestion: 'FP/일' })
  })

  it('선언한 단위가 수식과 다르면 추론한 단위를 제안한다', () => {
    const d = must(setField(docOf('brooks'), 'software_development_rate', { field: 'unit', value: '명' }))
    const i = analyze(d).byVariable.get('software_development_rate')!.find((x) => x.code === 'unit-declared')!
    expect(i).toMatchObject({ severity: 'error', field: 'unit', suggestion: 'FP/일' })
  })
})
