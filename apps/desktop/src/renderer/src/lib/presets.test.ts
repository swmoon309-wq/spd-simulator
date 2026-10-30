import { describe, expect, it } from 'vitest'
import type { CalibrationResult } from '@spd/analysis'
import { getEntry } from '../catalog'
import { parsePresetFile, serializePresets } from '../../../shared/presetFile'
import * as shared from '../../../shared/projectFile'
import { fitPresetParams, importPresets, makePreset, MAX_PRESETS, nextPresetId, presetOverrides, presetsToExport, sanitizePresets, uniquePresetName, type Preset } from './presets'

const entry = getEntry('brooks')
const NOW = new Date('2026-10-22T09:00:00.000Z')

const result = (over: Partial<CalibrationResult> = {}): CalibrationResult => ({
  names: ['nominal_productivity', 'initial_experienced'],
  initial: [0.1, 20],
  best: [0.13000000000000003, 28],
  jBefore: 0.2,
  jAfter: 0.0012,
  jValBefore: 0.3,
  jValAfter: 0.0031,
  split: { fraction: 0.7, cutoffTime: 140, nCal: 20, nVal: 8 },
  starts: [],
  evaluations: 100,
  columns: [],
  diagnostics: [],
  canceled: false,
  ...over
})
const preset = (id: string, name: string, params: Record<string, number> = { nominal_productivity: 0.13 }, over: Partial<Preset> = {}): Preset => ({
  id, name, modelId: 'brooks', modelVersion: 1, params, origin: { dataset: '실제 A', columns: ['developed_software'], objective: 0.001, valObjective: 0.002, split: 0.7, at: NOW.toISOString() }, ...over
})

describe('한도', () => {
  it('앱과 shared의 프리셋 한도가 같다', () => {
    expect(MAX_PRESETS).toBe(shared.MAX_PRESETS)
  })
})

describe('이름과 id', () => {
  it('id는 비어 있는 가장 작은 번호', () => {
    expect(nextPresetId([])).toBe('p1')
    expect(nextPresetId([preset('p1', 'a'), preset('p3', 'b')])).toBe('p2')
  })
  it('이름이 겹치면 번호를 붙이고, 비어 있으면 "프리셋"', () => {
    expect(uniquePresetName([], '  보정 A ')).toBe('보정 A')
    expect(uniquePresetName([{ name: '보정 A' }], '보정 A')).toBe('보정 A (2)')
    expect(uniquePresetName([{ name: '보정 A' }, { name: '보정 A (2)' }], '보정 A')).toBe('보정 A (3)')
    expect(uniquePresetName([], '   ')).toBe('프리셋')
  })
})

describe('보정 결과 → 프리셋', () => {
  it('보정한 파라미터 값과 출처를 담고 부동소수 잡음을 정리한다', () => {
    const p = makePreset({ entry, presets: [], name: '팀 A', result: result(), dataset: '실제 A', columns: ['developed_software'], now: NOW })
    expect(p).toEqual({
      id: 'p1', name: '팀 A', modelId: 'brooks', modelVersion: 1,
      params: { nominal_productivity: 0.13, initial_experienced: 28 },
      origin: { dataset: '실제 A', columns: ['developed_software'], objective: 0.0012, valObjective: 0.0031, split: 0.7, at: NOW.toISOString() }
    })
  })
  it('시간 분할을 쓰지 않았으면 검증 값과 비율은 null, 알 수 없는 J도 null', () => {
    const p = makePreset({ entry, presets: [], name: 'x', result: result({ split: null, jValAfter: null, jAfter: NaN }), dataset: 'd', columns: [], now: NOW })
    expect(p.origin).toMatchObject({ valObjective: null, split: null, objective: null })
  })
  it('이름이 겹치면 번호를 붙이고 id를 새로 매긴다', () => {
    const p = makePreset({ entry, presets: [preset('p1', '팀 A')], name: '팀 A', result: result(), dataset: 'd', columns: [], now: NOW })
    expect(p).toMatchObject({ id: 'p2', name: '팀 A (2)' })
  })
})

describe('호환 검사(설계 07의 5.4)', () => {
  it('모델에 없는 파라미터·범위 밖·정수가 아닌 값은 버리고 이유를 알린다', () => {
    const r = fitPresetParams(entry, '프', { nominal_productivity: 0.13, nope: 1, initial_experienced: 28.5, extra_people: 9999, hire_day: 100 })
    expect(r.params).toEqual({ nominal_productivity: 0.13, hire_day: 100 })
    const text = r.warnings.join('\n')
    expect(text).toContain("'nope'은(는) 이 모델의 입력 항목이 아니어서")
    expect(text).toContain('정수여야 하는데 28.5')
    expect(text).toContain('허용 범위(0 ~ 500)를 벗어나')
  })
  it('프로젝트 파일의 정리: 다른 모델의 프리셋과 쓸 수 있는 파라미터가 없는 프리셋은 버린다', () => {
    const r = sanitizePresets(entry, [
      preset('p1', '정상'),
      preset('p2', '다른 모델', { x: 1 }, { modelId: 'integrated-project' }),
      preset('p3', '빈 프리셋', { nope: 1 }),
      preset('p4', '일부', { nominal_productivity: 0.13, nope: 1 })
    ])
    expect(r.presets.map((p) => [p.id, Object.keys(p.params)])).toEqual([['p1', ['nominal_productivity']], ['p4', ['nominal_productivity']]])
    const text = r.warnings.join('\n')
    expect(text).toContain("프리셋 '다른 모델'은(는) 다른 모델('integrated-project')의 것이라 버렸습니다")
    expect(text).toContain("프리셋 '빈 프리셋'은(는) 쓸 수 있는 파라미터가 없어 버렸습니다")
  })
  it('모델 버전이 달라도 프로젝트 파일의 프리셋은 유지한다(경고는 가져올 때만)', () => {
    expect(sanitizePresets(entry, [preset('p1', 'a', undefined, { modelVersion: 9 })]).presets).toHaveLength(1)
  })
})

describe('내보내기와 가져오기', () => {
  it('내보내기에는 id가 없고, 파일을 거쳐 같은 내용으로 읽힌다', () => {
    const body = presetsToExport([preset('p1', 'a'), preset('p2', 'b', { hire_day: 90 })])
    expect(body.every((b) => !('id' in b))).toBe(true)
    const parsed = parsePresetFile(serializePresets(body, NOW.toISOString()))
    expect(parsed.ok && parsed.file.presets).toEqual(body)
    expect(parsed.ok && parsed.file.kind).toBe('spd-presets')
  })

  it('가져오면 새 id와 겹치지 않는 이름이 붙고 개수를 센다', () => {
    const file = { kind: 'spd-presets' as const, version: 1 as const, presets: presetsToExport([preset('x', 'a'), preset('y', 'b')]) }
    const r = importPresets(entry, file, [preset('p1', 'a')])
    expect(r.added).toBe(2)
    expect(r.presets.map((p) => [p.id, p.name])).toEqual([['p1', 'a'], ['p2', 'a (2)'], ['p3', 'b']])
    expect(r.warnings).toEqual([])
  })
  it('다른 모델은 건너뛰고, 버전이 다르면 알리되 가져오며, 파라미터를 정리한다', () => {
    const file = {
      kind: 'spd-presets' as const, version: 1 as const,
      presets: presetsToExport([preset('a', '다른 모델', { x: 1 }, { modelId: 'integrated-project' }), preset('b', '옛 버전', { nominal_productivity: 0.13, nope: 1 }, { modelVersion: 3 }), preset('c', '빈', { nope: 1 })])
    }
    const r = importPresets(entry, file, [])
    expect(r.added).toBe(1)
    expect(r.presets[0]).toMatchObject({ name: '옛 버전', modelVersion: 3, params: { nominal_productivity: 0.13 } })
    const text = r.warnings.join('\n')
    expect(text).toContain('다른 모델(\'integrated-project\')의 것이라 건너뛰었습니다')
    expect(text).toContain('다른 모델 버전(3)으로 보정되었습니다. 현재 모델은 1입니다')
    expect(text).toContain("프리셋 '빈'은(는) 쓸 수 있는 파라미터가 없어 건너뛰었습니다")
  })
  it('한도(20개)를 넘으면 그 뒤는 가져오지 않는다', () => {
    const existing = Array.from({ length: 19 }, (_, i) => preset(`p${i + 1}`, `n${i}`))
    const file = { kind: 'spd-presets' as const, version: 1 as const, presets: presetsToExport([preset('a', 'x'), preset('b', 'y')]) }
    const r = importPresets(entry, file, existing)
    expect(r.presets).toHaveLength(20)
    expect(r.added).toBe(1)
    expect(r.warnings.join()).toContain("'y'부터는 가져오지 않았습니다")
  })
  it('가져와도 기존 목록은 바뀌지 않는다', () => {
    const existing = [preset('p1', 'a')]
    importPresets(entry, { kind: 'spd-presets', version: 1, presets: presetsToExport([preset('z', 'b')]) }, existing)
    expect(existing).toHaveLength(1)
  })
})

describe('프리셋 파일 읽기 오류', () => {
  it('JSON이 아니거나 형식이 다르거나 새 버전이거나 내용이 틀리면 이유를 알린다', () => {
    const msg = (t: string) => {
      const r = parsePresetFile(t)
      if (r.ok) throw new Error('오류가 나야 합니다')
      return r.message
    }
    expect(msg('not json')).toContain('JSON 형식이 아니어서')
    expect(msg('[]')).toContain('형식이 아닙니다')
    expect(msg('{"kind":"other"}')).toContain('프리셋 파일이 아닙니다')
    expect(msg('{"kind":"spd-presets","version":2,"presets":[]}')).toContain('더 새로운 버전(2)')
    expect(msg('{"kind":"spd-presets","version":1,"presets":[]}')).toContain('presets')
    expect(msg(JSON.stringify({ kind: 'spd-presets', version: 1, presets: [{ name: 'a', modelId: 'brooks', modelVersion: 1, params: {}, origin: { dataset: '', columns: [], objective: null, valObjective: null, split: null, at: '' } }] }))).toContain('파라미터')
  })
})

describe('시나리오 덮어쓰기', () => {
  it('기본 설정과 다른 값만 담는다', () => {
    expect(presetOverrides({ nominal_productivity: 0.1, hire_day: 110 }, { params: { nominal_productivity: 0.13, hire_day: 110 } })).toEqual({ nominal_productivity: 0.13 })
    expect(presetOverrides({ hire_day: 110 }, { params: { hire_day: 110 } })).toEqual({})
  })
})
