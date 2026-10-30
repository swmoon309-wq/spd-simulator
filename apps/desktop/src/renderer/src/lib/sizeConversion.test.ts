import { describe, expect, it } from 'vitest'
import { catalog, getEntry } from '../catalog'
import { paramSpecs } from './params'
import { parsePositive, SLOC_PER_TASK, sizeSpecOf, slocToUnits, unitsToSloc } from './sizeConversion'

const specOf = (modelId: string) => sizeSpecOf(getEntry(modelId))!.spec

describe('parsePositive', () => {
  it('쉼표와 공백을 허용하고 0 이하·글자는 null', () => {
    expect(parsePositive('24,000')).toBe(24000)
    expect(parsePositive(' 1 200 ')).toBe(1200)
    expect(parsePositive('0.5')).toBe(0.5)
    for (const bad of ['', '  ', '0', '-3', 'abc', '1e999', 'NaN']) expect(parsePositive(bad), bad).toBeNull()
  })
})

describe('slocToUnits', () => {
  it('통합 모델: 24,000 SLOC ÷ 60 = 400 태스크(정수)', () => {
    expect(slocToUnits(specOf('integrated-project'), '24000', '60')).toEqual({ value: 400 })
  })

  it('정수 파라미터는 반올림한다', () => {
    expect(slocToUnits(specOf('integrated-project'), '1480', '60')).toEqual({ value: 25 }) // 24.67
    expect(slocToUnits(specOf('integrated-project'), '1530', '60')).toEqual({ value: 26 }) // 25.5
  })

  it('정수가 아닌 파라미터(Brooks의 FP)는 소수를 그대로 둔다', () => {
    const r = slocToUnits(specOf('brooks'), '26500', '53')
    expect(r).toEqual({ value: 500 })
    expect(slocToUnits(specOf('brooks'), '1000', '3')).toEqual({ value: 333.333 })
  })

  it('허용 범위 밖이면 이유를 알리고 값을 내지 않는다', () => {
    const r = slocToUnits(specOf('integrated-project'), '60', '60') // 1태스크: 최소 20
    expect(r).toMatchObject({ error: expect.stringContaining('허용 범위') })
    expect('value' in r).toBe(false)
    expect(slocToUnits(specOf('integrated-project'), '999999999', '60')).toMatchObject({ error: expect.any(String) })
  })

  it('SLOC나 단위당 SLOC가 올바르지 않으면 어느 쪽인지 알린다', () => {
    expect(slocToUnits(specOf('brooks'), '', '53')).toEqual({ error: 'SLOC는 0보다 큰 수여야 합니다.' })
    expect(slocToUnits(specOf('brooks'), '1000', '')).toEqual({ error: '단위당 SLOC는 0보다 큰 수여야 합니다.' })
    expect(slocToUnits(specOf('brooks'), '1000', '0')).toEqual({ error: '단위당 SLOC는 0보다 큰 수여야 합니다.' })
  })
})

describe('unitsToSloc', () => {
  it('값 × 단위당 SLOC, 단위당 SLOC를 모르면 null', () => {
    expect(unitsToSloc(400, 60)).toBe(24000)
    expect(unitsToSloc(500, null)).toBeNull()
    expect(unitsToSloc(500, 0)).toBeNull()
  })
})

describe('모델의 규모 정보', () => {
  it('규모 입력이 있는 모델은 그 파라미터가 입력 항목이고, 환산 기준을 모르면 null이다', () => {
    for (const entry of catalog) {
      const found = sizeSpecOf(entry)
      if (!entry.size) continue
      expect(found, entry.id).not.toBeNull()
      expect(paramSpecs(entry).some((s) => s.name === entry.size!.param)).toBe(true)
      expect(entry.def.constants[entry.size.param]?.unit, entry.id).toBe(entry.size.unit)
    }
    expect(getEntry('integrated-project').size?.slocPerUnit).toBe(SLOC_PER_TASK)
    expect(getEntry('brooks').size?.slocPerUnit).toBeNull() // 책에 FP↔SLOC 기준이 없다
  })
})
