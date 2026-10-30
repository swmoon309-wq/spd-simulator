import { describe, expect, it } from 'vitest'
import { buildBaseline, validateCredits } from '@spd/analysis'
import { compileModel, Rng, runModel } from '@spd/sd-engine'
import { catalog } from '.'
import { defaultParams, paramSpecs, parseParam } from '../lib/params'
import { evmOf } from './evm'

describe('카탈로그 공통 검사', () => {
  it('모델 id가 겹치지 않는다', () => {
    expect(new Set(catalog.map((m) => m.id)).size).toBe(catalog.length)
    expect(catalog.map((m) => m.id)).toEqual(expect.arrayContaining(['brooks', 'integrated-project']))
  })

  describe.each(catalog.map((m) => [m.id, m] as const))('%s', (_id, entry) => {
    const compiled = compileModel(entry.def)
    const specs = paramSpecs(entry)

    it('폼 항목은 모두 모델 상수이고 이름이 겹치지 않는다', () => {
      expect(new Set(specs.map((s) => s.name)).size).toBe(specs.length)
      for (const s of specs) expect(entry.def.constants[s.name], s.name).toBeDefined()
    })

    it('모델의 모든 상수가 폼에 있다(화면에서 모두 조절할 수 있다)', () => {
      expect(specs.map((s) => s.name).sort()).toEqual(Object.keys(entry.def.constants).sort())
    })

    it('기본값은 각 항목의 허용 범위 안이고 범위가 올바르다', () => {
      const d = defaultParams(entry)
      for (const s of specs) {
        expect(s.min, s.name).toBeLessThan(s.max)
        expect(s.step, s.name).toBeGreaterThan(0)
        expect(parseParam(String(d[s.name]), s), s.name).toEqual({ value: d[s.name] })
      }
    })

    it('그래프 변수는 모두 모델에서 기록되는 변수이고 기본 변수가 목록에 있다', () => {
      const names = new Set(compiled.names.filter((n) => compiled.kindOf.get(n) !== 'constant'))
      for (const v of entry.variables) {
        expect(names.has(v.name), v.name).toBe(true)
        expect(v.label).toBeTruthy()
      }
      expect(entry.variables.some((v) => v.name === entry.defaultVariable)).toBe(true)
    })

    it('프리셋은 폼 항목만 허용 범위 안의 값으로 덮어쓴다', () => {
      expect(entry.presets.length).toBeGreaterThan(0)
      for (const preset of entry.presets) {
        for (const [name, value] of Object.entries(preset.overrides)) {
          const spec = specs.find((s) => s.name === name)
          expect(spec, `${preset.label}: ${name}`).toBeDefined()
          expect(parseParam(String(value), spec as (typeof specs)[number]), `${preset.label}: ${name}`).toEqual({ value })
        }
      }
    })

    it('기본 실행의 KPI가 계산된다', () => {
      const k = entry.kpis(runModel(compiled, { overrides: defaultParams(entry) }))
      expect(k.completionDay).not.toBeNull()
      expect(k.completionDay as number).toBeGreaterThan(0)
      expect(k.peakStaff).toBeGreaterThan(0)
    })

    it('허용 범위의 양 끝값에서도 수치 오류(NaN·무한대) 없이 실행된다', () => {
      const base = defaultParams(entry)
      for (const s of specs) {
        for (const value of [s.min, s.max]) {
          expect(() => runModel(compiled, { overrides: { ...base, [s.name]: value } }), `${s.name}=${value}`).not.toThrow()
        }
      }
    })

    it('EVM 어댑터: 인정 비율의 합이 1이고 변수가 모델에 있으며 총 태스크가 파라미터와 같다', () => {
      const evm = evmOf(entry)
      expect(validateCredits(evm.credits)).toBeNull()
      const recorded = new Set(compiled.names.filter((n) => compiled.kindOf.get(n) !== 'constant'))
      for (const c of evm.credits) {
        expect(recorded.has(c.variable), c.variable).toBe(true)
        expect(c.label).toBeTruthy()
      }
      expect(recorded.has(evm.effortVariable)).toBe(true)
      const params = defaultParams(entry)
      expect(evm.totalTasks(params)).toBeGreaterThan(0)
    })

    it('EVM 어댑터: 완료 시각이 실행 표의 완료일과 같고 완료하지 못하면 null이다', () => {
      const params = defaultParams(entry)
      const result = runModel(compiled, { overrides: params })
      expect(evmOf(entry).completion(result)).toBe(entry.kpis(result).completionDay)
      expect(evmOf(entry).completion(runModel(compiled, { overrides: params, end: 100 }))).toBeNull()
    })

    it('EVM 어댑터: 기본 실행에서 기준선을 만들 수 있다(진척률 0 → 약 1, BAC > 0)', () => {
      const params = defaultParams(entry)
      const result = runModel(compiled, { overrides: params })
      const completion = evmOf(entry).completion(result) as number
      const b = buildBaseline(result, { credits: evmOf(entry).credits, totalTasks: evmOf(entry).totalTasks(params), effortVariable: evmOf(entry).effortVariable, completion })
      expect(b.bac).toBeGreaterThan(0)
      expect(b.series.progress[0]).toBe(0)
      expect(b.series.progress[Math.ceil(completion)]).toBeGreaterThan(0.99)
    })

    it('허용 범위 안의 무작위 조합 100개(끝값 포함)도 수치 오류 없이 실행된다', () => {
      const rng = new Rng(2026)
      const base = defaultParams(entry)
      for (let k = 0; k < 100; k++) {
        const overrides = { ...base }
        for (const s of specs) {
          const r = rng.next()
          const v = r < 0.17 ? s.min : r < 0.33 ? s.max : s.min + (s.max - s.min) * rng.next()
          overrides[s.name] = s.integer ? Math.round(v) : v
        }
        try {
          runModel(compiled, { overrides })
        } catch (e) {
          throw new Error(`${(e as Error).message}\n조합 #${k}: ${JSON.stringify(overrides)}`)
        }
      }
    })
  })
})
