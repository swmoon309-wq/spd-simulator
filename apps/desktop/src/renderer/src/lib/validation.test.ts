import { describe, expect, it } from 'vitest'
import { CHECKLIST_ITEMS, MAX_RECORD_ITEMS } from '@spd/analysis'
import { getEntry } from '../catalog'
import type { ValidationFile } from '../../../shared/projectFile'
import * as shared from '../../../shared/projectFile'
import { parseReferenceCsv } from './referenceCsv'
import {
  datasetFromCsv,
  defaultValidationSettings,
  MAX_CHECKLIST_ENTRIES,
  MAX_CHECKLIST_NOTE,
  MAX_COLUMN_POINTS,
  MAX_DATASET_COLUMNS,
  MAX_DATASET_POINTS_TOTAL,
  MAX_DATASETS,
  nextDatasetId,
  sanitizeValidation,
  toleranceProblem,
  totalPoints,
  validationToFile,
  type Dataset
} from './validation'

const entry = getEntry('brooks')

const csv = (header: string[], rows: (number | string)[][]) => [header.join(','), ...rows.map((r) => r.join(','))].join('\n')
const parse = (header: string[], rows: (number | string)[][]) => parseReferenceCsv(csv(header, rows))
const ds = (patch: Partial<Dataset> = {}): Dataset => ({
  id: 'd1', name: 'A', fileName: 'a.csv', timeUnit: 'week', offsetDay: 0, actualCompletionDay: null,
  columns: [{ name: '총 인원', variable: 'total_personnel', scale: 1, points: [[1, 10], [2, 12]] }], ...patch
})

describe('한도가 스키마와 같다', () => {
  it('앱과 shared의 한도가 일치한다', () => {
    expect(MAX_DATASETS).toBe(shared.MAX_DATASETS)
    expect(MAX_DATASET_COLUMNS).toBe(shared.MAX_DATASET_COLUMNS)
    expect(MAX_COLUMN_POINTS).toBe(shared.MAX_COLUMN_POINTS)
    expect(MAX_DATASET_POINTS_TOTAL).toBe(shared.MAX_DATASET_POINTS_TOTAL)
    expect(MAX_CHECKLIST_NOTE).toBe(shared.MAX_CHECKLIST_NOTE)
    expect(MAX_CHECKLIST_ENTRIES).toBe(shared.MAX_CHECKLIST_ENTRIES)
    expect(CHECKLIST_ITEMS.length).toBeLessThanOrEqual(shared.MAX_CHECKLIST_ENTRIES)
    expect(MAX_RECORD_ITEMS).toBe(shared.MAX_RECORD_ITEMS)
  })
})

describe('CSV → 데이터셋', () => {
  it('열 이름이 변수와 맞으면 자동 연결하고 나머지는 비교에서 제외한다', () => {
    const r = datasetFromCsv(entry, parse(['week', '총 인원', '메모열', 'cum_effort'], [[1, 10, 5, 100], [2, 12, 6, 220]]), 'project-A.csv', [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dataset.columns.map((c) => [c.name, c.variable])).toEqual([['총 인원', 'total_personnel'], ['메모열', null], ['cum_effort', 'cum_effort']])
    expect(r.dataset).toMatchObject({ id: 'd1', name: 'project-A', fileName: 'project-A.csv', timeUnit: 'day', offsetDay: 0, actualCompletionDay: null })
    expect(r.dataset.columns.every((c) => c.scale === 1)).toBe(true)
    expect(r.warnings.join(' ')).toContain('메모열')
  })

  it('숫자가 없는 열은 알리고 빠진다', () => {
    const r = datasetFromCsv(entry, parse(['t', 'total_personnel', 'x'], [[1, 10, ''], [2, 12, '']]), 'a.csv', [])
    expect(r.ok && r.dataset.columns.map((c) => c.name)).toEqual(['total_personnel'])
    expect(r.ok && r.warnings.join(' ')).toContain('숫자 값이 없어')
  })

  it('다음 id는 비어 있는 가장 작은 번호', () => {
    expect(nextDatasetId([])).toBe('d1')
    expect(nextDatasetId([ds({ id: 'd1' }), ds({ id: 'd3' })])).toBe('d2')
  })

  it('한도를 넘으면 이유와 함께 거절한다', () => {
    const one = parse(['t', 'total_personnel'], [[1, 1], [2, 2]])
    expect((datasetFromCsv(entry, one, 'a.csv', Array.from({ length: 5 }, (_, i) => ds({ id: `d${i + 1}` }))) as { message: string }).message).toContain('최대 5개')

    const wide = parse(['t', ...Array.from({ length: 21 }, (_, i) => `c${i}`)], [[1, ...Array(21).fill(1)]])
    expect((datasetFromCsv(entry, wide, 'a.csv', []) as { message: string }).message).toContain('열이 너무 많습니다')

    const long = parse(['t', 'a'], Array.from({ length: MAX_COLUMN_POINTS + 1 }, (_, i) => [i, i]))
    expect((datasetFromCsv(entry, long, 'a.csv', []) as { message: string }).message).toContain('다운샘플')

    const filler = ds({ id: 'd1', columns: [{ name: 'x', variable: null, scale: 1, points: Array.from({ length: 48_000 }, (_, i) => [i, i] as [number, number]) }] })
    const three = parse(['t', 'a'], Array.from({ length: 3000 }, (_, i) => [i, i]))
    const r = datasetFromCsv(entry, three, 'a.csv', [filler])
    expect(!r.ok && r.message).toContain('모자랍니다')
    expect(totalPoints([filler])).toBe(48_000)
  })
})

describe('파일 형태', () => {
  it('처음 값이면 null, 아니면 데이터셋·기준·대상을 담는다', () => {
    expect(validationToFile(defaultValidationSettings())).toBeNull()
    const f = validationToFile({ ...defaultValidationSettings(), datasets: [ds()], tolerances: { nrmse: 0.15 }, targetScenarioId: 's1' }) as ValidationFile
    expect(f.datasets[0]).toMatchObject({ id: 'd1', timeUnit: 'week', columns: [{ name: '총 인원', variable: 'total_personnel', scale: 1 }] })
    expect(f.tolerances).toEqual({ nrmse: 0.15 })
    expect(f.targetScenarioId).toBe('s1')
  })
  it('저장한 것은 원본과 떨어져 있다(복사)', () => {
    const d = ds()
    const f = validationToFile({ ...defaultValidationSettings(), datasets: [d], tolerances: {}, targetScenarioId: '@base' }) as ValidationFile
    f.datasets[0]!.columns[0]!.points[0]![1] = 999
    expect(d.columns[0]!.points[0]![1]).toBe(10)
  })
})

describe('열 때 정리', () => {
  const file = (patch: Partial<ValidationFile> = {}): ValidationFile => ({ datasets: [validationToFile({ ...defaultValidationSettings(), datasets: [ds()] })!.datasets[0]!], tolerances: {}, targetScenarioId: '@base', checklist: [], presets: [], report: null, ...patch })

  it('null이면 처음 값', () => {
    expect(sanitizeValidation(entry, null, [])).toEqual({ settings: defaultValidationSettings(), warnings: [] })
  })
  it('올바른 설정은 그대로(경고 없음)', () => {
    const r = sanitizeValidation(entry, file({ tolerances: { nrmse: 0.2, nse: 0.5 }, targetScenarioId: 's1' }), ['s1'])
    expect(r.warnings).toEqual([])
    expect(r.settings.datasets[0]!.columns[0]).toMatchObject({ variable: 'total_personnel', scale: 1 })
    expect(r.settings.tolerances).toEqual({ nrmse: 0.2, nse: 0.5 })
    expect(r.settings.targetScenarioId).toBe('s1')
  })
  it('모델에 없는 변수는 연결만 풀고 데이터는 남긴다', () => {
    const f = file()
    f.datasets[0]!.columns[0]!.variable = 'gone'
    const r = sanitizeValidation(entry, f, [])
    expect(r.settings.datasets[0]!.columns[0]).toMatchObject({ variable: null, name: '총 인원' })
    expect(r.settings.datasets[0]!.columns[0]!.points).toHaveLength(2)
    expect(r.warnings.join(' ')).toContain("'gone'")
  })
  it('올바르지 않은 배율은 1로, 허용 기준은 버리고, 없는 대상은 기준으로', () => {
    const f = file({ tolerances: { nrmse: -1, trend: 2, mre: 0.1 }, targetScenarioId: 'gone' })
    f.datasets[0]!.columns[0]!.scale = 0
    const r = sanitizeValidation(entry, f, [])
    expect(r.settings.datasets[0]!.columns[0]!.scale).toBe(1)
    expect(r.settings.tolerances).toEqual({ mre: 0.1 })
    expect(r.settings.targetScenarioId).toBe('@base')
    expect(r.warnings).toHaveLength(4)
  })
  it('허용 기준의 범위 검사', () => {
    expect(toleranceProblem('nrmse', 0.1)).toBeNull()
    expect(toleranceProblem('nrmse', -0.1)).toContain('정규화 RMSE')
    expect(toleranceProblem('nse', -3)).toBeNull() // NSE는 음수 기준도 가능
    expect(toleranceProblem('nse', 1.5)).toContain('NSE')
    expect(toleranceProblem('trend', 1)).toBeNull()
    expect(toleranceProblem('mape', NaN)).not.toBeNull()
  })
})

describe('체크리스트·검증 기록의 파일 형태와 정리', () => {
  const rec = {
    generatedAt: '2026-10-22T09:00:00.000Z', model: { id: 'brooks', version: 1 }, target: { id: '@base', name: '기준' }, run: { end: 400, dt: 0.25, seed: 1 }, tolerances: {},
    data: [], extremes: { total: 42, counts: { pass: 30, warn: 10, fail: 0, info: 2 }, failures: [] }, structure: null, checklist: [], presets: []
  }
  const file = (patch: Partial<ValidationFile> = {}): ValidationFile => ({ datasets: [], tolerances: {}, targetScenarioId: '@base', checklist: [], presets: [], report: null, ...patch })

  it('체크리스트나 검증 기록만 있어도 파일에 저장한다(처음 값이 아니므로)', () => {
    expect(validationToFile({ ...defaultValidationSettings(), checklist: [{ id: 'face-validity', status: 'ok', note: '' }] })).not.toBeNull()
    expect(validationToFile({ ...defaultValidationSettings(), report: rec })).not.toBeNull()
  })
  it('저장한 체크리스트와 기록을 그대로 복원한다(경고 없음)', () => {
    const r = sanitizeValidation(entry, file({ checklist: [{ id: 'face-validity', status: 'ok', note: '검토' }, { id: 'audience-fit', status: 'problem', note: '' }], report: rec }), [])
    expect(r.warnings).toEqual([])
    expect(r.settings.checklist).toEqual([{ id: 'face-validity', status: 'ok', note: '검토' }, { id: 'audience-fit', status: 'problem', note: '' }])
    expect(r.settings.report).toEqual(rec)
  })
  it('알 수 없는 체크리스트 항목은 버리고 알리며, 정의 순서로 정렬한다', () => {
    const r = sanitizeValidation(entry, file({ checklist: [{ id: 'generates-insight', status: 'ok', note: '' }, { id: 'future-item', status: 'ok', note: '' }, { id: 'dimensional-consistency', status: 'problem', note: '' }] }), [])
    expect(r.settings.checklist.map((c) => c.id)).toEqual(['dimensional-consistency', 'generates-insight'])
    expect(r.warnings.join(' ')).toContain("'future-item'")
  })
  it('다른 모델 버전의 기록도 그대로 둔다(화면이 다른 버전임을 표시)', () => {
    const old = { ...rec, model: { id: 'brooks', version: 7 } }
    expect(sanitizeValidation(entry, file({ report: old }), []).settings.report!.model.version).toBe(7)
  })
  it('저장한 것은 원본과 떨어져 있다(복사)', () => {
    const settings = { ...defaultValidationSettings(), checklist: [{ id: 'face-validity', status: 'ok' as const, note: 'a' }], report: rec }
    const f = validationToFile(settings)!
    f.checklist[0]!.note = '바뀜'
    f.report!.extremes!.counts.pass = 0
    expect(settings.checklist[0]!.note).toBe('a')
    expect(settings.report!.extremes!.counts.pass).toBe(30)
  })
})
