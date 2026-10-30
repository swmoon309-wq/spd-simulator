import { describe, expect, it } from 'vitest'
import { checkInvariants, compileModel, runModel, type ModelDef } from '@spd/sd-engine'
import { brooksModel, integratedProjectModel } from '../src'

/**
 * 모델 JSON에 선언한 불변식(설계 07의 4.3 S2)이 다양한 조건에서 성립한다. 2차에서 시험 코드로 박아 둔 보존 법칙을
 * 데이터로 꺼낸 것이므로 구조 점검 화면이 같은 점검을 쓴다. 선언은 결과를 바꾸지 않으므로 모델 version은 1 그대로다.
 */
const INTEGRATED: Record<string, number>[] = [
  {},
  { plan_known_fraction: 1 },
  { planned_duration_days: 120 },
  { initial_pros: 4, initial_new: 12 },
  { max_boost: 0 },
  { planned_duration_days: 120, hiring_delay: 10, assim_delay: 20 },
  { total_tasks: 20 },
  { total_tasks: 1500 },
  { max_staff: 1 },
  { initial_pros: 0 },
  { plan_known_fraction: 0.3 }
]
const BROOKS: Record<string, number>[] = [{}, { extra_people: 10 }, { extra_people: 10, hire_day: 350 }, { initial_requirements: 50 }, { initial_requirements: 5000 }, { initial_experienced: 1 }]

const check = (def: ModelDef, overrides: Record<string, number>) => {
  const result = runModel(compileModel(def), { overrides, end: 400 })
  return checkInvariants(def, result, overrides)
}

describe('선언한 불변식', () => {
  it('두 모델에 선언되어 있고 모델 version은 그대로다', () => {
    expect((brooksModel.invariants ?? []).map((i) => i.name)).toEqual(['requirements_conservation'])
    expect((integratedProjectModel.invariants ?? []).map((i) => i.name)).toEqual(['dev_tasks_conservation', 'error_conservation', 'qa_found_conservation', 'job_size_conservation'])
    expect(brooksModel.meta.version).toBe(1)
    expect(integratedProjectModel.meta.version).toBe(1)
  })

  it.each(BROOKS.map((o) => [JSON.stringify(o), o] as const))('Brooks %s', (_l, overrides) => {
    for (const c of check(brooksModel, overrides)) {
      expect(c.missing, c.name).toEqual([])
      expect(c.violated, `${c.name} 최대 위반 ${c.maxViolation}`).toBe(false)
    }
  })

  it.each(INTEGRATED.map((o) => [JSON.stringify(o), o] as const))('통합 모델 %s', (_l, overrides) => {
    const checks = check(integratedProjectModel, overrides)
    expect(checks).toHaveLength(4)
    for (const c of checks) {
      expect(c.missing, c.name).toEqual([])
      expect(c.violated, `${c.name} 최대 위반 ${c.maxViolation}`).toBe(false)
    }
  })

  it('모든 선언은 라벨이 있고 변수는 모델에 있다(컴파일이 확인)', () => {
    for (const def of [brooksModel, integratedProjectModel]) {
      expect(() => compileModel(def)).not.toThrow()
      for (const inv of def.invariants ?? []) expect(inv.label.length).toBeGreaterThan(5)
    }
  })

  it('상수 덮어쓰기를 알려 주지 않으면(총 태스크 1500을 모르면) 인식 합계 불변식은 위반으로 나온다', () => {
    const result = runModel(compileModel(integratedProjectModel), { overrides: { total_tasks: 1500 }, end: 400 })
    const wrong = checkInvariants(integratedProjectModel, result).find((c) => c.name === 'job_size_conservation')!
    expect(wrong.violated).toBe(true)
    expect(wrong.maxViolation).toBeCloseTo(1100, 6)
  })
})
