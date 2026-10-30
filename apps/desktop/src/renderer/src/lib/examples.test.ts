import { describe, expect, it } from 'vitest'
import { catalog } from '../catalog'
import { docFromBuiltin } from '../catalog/exportDoc'
import { installUserModel, removeUserModel } from './modelRegistry'
import { projectFileSchema } from '../../../shared/projectFile'
import { applyProjectFile } from './projectApply'
import { defaultParams } from './params'
import { builtInExamples, exampleFor } from './examples'

const NOW = new Date('2026-10-22T00:00:00.000Z')

describe('내장 예제', () => {
  it('사용자 모델이 올라와 있어도 내장 예제에는 들어가지 않는다', () => {
    const r = installUserModel(docFromBuiltin(catalog.find((m) => m.id === 'brooks')!, { now: NOW, name: '예제 시험', random: () => 0.8 }))
    if (!r.ok) throw new Error(r.message)
    try {
      expect(builtInExamples(NOW).map((e) => e.modelId)).not.toContain(r.entry.id)
    } finally {
      removeUserModel(r.entry.id)
    }
  })

  it('모델마다 하나씩 있고 프로젝트 파일 형식에 맞는다', () => {
    const list = builtInExamples(NOW)
    expect(list.map((e) => e.modelId)).toEqual(catalog.filter((m) => m.category !== 'user').map((m) => m.id))
    for (const e of list) expect(projectFileSchema.safeParse(e.file).success).toBe(true)
  })

  it('경고 없이 열린다(값이 모두 허용 범위 안)', () => {
    for (const e of builtInExamples(NOW)) {
      const r = applyProjectFile(e.file)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.warnings).toEqual([])
    }
  })

  it('Brooks 예제는 인원 추가 프리셋을 시나리오로 가진다(기본값과 같은 "추가 없음"은 뺀다)', () => {
    const e = exampleFor(catalog.find((m) => m.id === 'brooks')!, NOW)
    expect(e.file.scenarios.map((s) => [s.id, s.name, s.overrides])).toEqual([
      ['s1', '5명 추가', { extra_people: 5 }],
      ['s2', '10명 추가', { extra_people: 10 }]
    ])
    expect(e.runPresets).toBe(true)
    expect(e.summary).toContain('5명 추가')
  })

  it('기본 설정에서 시작하고 이름과 설명이 들어 있다', () => {
    const entry = catalog[0]!
    const e = exampleFor(entry, NOW)
    expect(e.file.params).toEqual(defaultParams(entry))
    expect(e.file.meta.name).toBe(`${entry.title} 예제`)
    expect(e.file.meta.description).toBe(entry.description)
    expect(e.file.adopted).toBeNull()
  })

  it('만들 때마다 새 객체라 한 번 열어도 원본이 바뀌지 않는다', () => {
    const a = builtInExamples(NOW)[0]!
    a.file.scenarios[0]!.overrides['extra_people'] = 99
    expect(builtInExamples(NOW)[0]!.file.scenarios[0]!.overrides['extra_people']).toBe(5)
  })
})
