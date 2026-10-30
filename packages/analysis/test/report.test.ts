import { describe, expect, it } from 'vitest'
import { brooksModel } from '@spd/models'
import { compileModel, runModel } from '@spd/sd-engine'
import {
  buildValidationRecord,
  CHECKLIST_ITEMS,
  checklistCounts,
  checklistItem,
  checkTolerances,
  completionError,
  computeMetrics,
  entryFor,
  finiteOrNull,
  lastOf,
  planExtremes,
  recordModelNote,
  recordToCsv,
  recordToMarkdown,
  runExtremeCase,
  runStructureChecks,
  weightedNrmse,
  withChecklistEntry,
  type ChecklistEntry,
  type DataInput,
  type KpiSpec,
  type RecordInput
} from '../src'

describe('체크리스트 정의', () => {
  it('책의 세 표(목적 적합성·현실 일치·유용성)를 모두 다루고 id가 겹치지 않는다', () => {
    expect(CHECKLIST_ITEMS.length).toBeGreaterThanOrEqual(15)
    expect(new Set(CHECKLIST_ITEMS.map((i) => i.id)).size).toBe(CHECKLIST_ITEMS.length)
    for (const g of ['suitability', 'reality', 'utility'] as const) expect(CHECKLIST_ITEMS.some((i) => i.group === g)).toBe(true)
    for (const f of ['structure', 'behavior'] as const) expect(CHECKLIST_ITEMS.some((i) => i.focus === f)).toBe(true)
  })
  it('id는 파일 스키마의 형식(소문자·숫자·하이픈)을 따르고, 모든 항목에 기준과 확인 방법이 있다', () => {
    for (const i of CHECKLIST_ITEMS) {
      expect(i.id).toMatch(/^[a-z0-9-]{1,40}$/)
      expect(i.title.length).toBeGreaterThan(2)
      expect(i.criterion.length).toBeGreaterThan(10)
      expect(i.help.length).toBeGreaterThan(10)
    }
  })
  it('자동 점검과 이어지는 항목이 있다(단위, 극단 조건, 기준 행동, 통계)', () => {
    for (const id of ['dimensional-consistency', 'extreme-equations', 'reference-modes', 'statistical-tests']) expect(checklistItem(id), id).toBeDefined()
    expect(checklistItem('nope')).toBeUndefined()
  })
})

describe('체크리스트 기록', () => {
  it('저장하지 않은 항목은 미확인·메모 없음이다', () => {
    expect(entryFor([], 'face-validity')).toEqual({ id: 'face-validity', status: 'unchecked', note: '' })
  })
  it('상태나 메모를 바꾸면 목록에 들어가고, 처음 상태로 되돌리면 빠진다', () => {
    let e: ChecklistEntry[] = []
    e = withChecklistEntry(e, 'face-validity', { status: 'ok' })
    expect(e).toEqual([{ id: 'face-validity', status: 'ok', note: '' }])
    e = withChecklistEntry(e, 'face-validity', { note: '전문가 검토 완료' })
    expect(e).toEqual([{ id: 'face-validity', status: 'ok', note: '전문가 검토 완료' }])
    e = withChecklistEntry(e, 'face-validity', { status: 'unchecked', note: '' })
    expect(e).toEqual([])
    expect(withChecklistEntry([], 'audience-fit', { note: '메모만' })).toEqual([{ id: 'audience-fit', status: 'unchecked', note: '메모만' }]) // 메모만 있어도 남는다
  })
  it('목록은 정의 순서를 유지하고 입력 배열을 바꾸지 않는다', () => {
    const a = withChecklistEntry([], 'generates-insight', { status: 'ok' })
    const b = withChecklistEntry(a, 'dimensional-consistency', { status: 'problem' })
    expect(b.map((x) => x.id)).toEqual(['dimensional-consistency', 'generates-insight'])
    expect(a).toHaveLength(1)
  })
  it('상태별 개수는 정의된 모든 항목 기준이다', () => {
    const e = withChecklistEntry(withChecklistEntry([], 'face-validity', { status: 'ok' }), 'audience-fit', { status: 'problem' })
    const c = checklistCounts(e)
    expect(c.ok).toBe(1)
    expect(c.problem).toBe(1)
    expect(c.unchecked).toBe(CHECKLIST_ITEMS.length - 2)
  })
})

// ---------- 검증 기록 ----------

const model = compileModel(brooksModel)
const doneDay: KpiSpec = { id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, 'requirements') <= 1e-6 ? lastOf(r, 'completion_time') : null) }
const effort: KpiSpec = { id: 'totalEffort', label: '총 공수', unit: '맨데이', better: 'lower', group: 'cost', decimals: 0, compute: (r) => lastOf(r, 'cum_effort') }
const baseParams = Object.fromEntries(Object.entries(brooksModel.constants).map(([k, c]) => [k, (c as { value: number }).value]))

function sampleInput(over: Partial<RecordInput> = {}): RecordInput {
  const sim = runModel(model, {})
  const actual = runModel(model, { overrides: { extra_people: 10 } })
  const observed = Array.from({ length: 20 }, (_, i) => actual.series['total_personnel']![(i + 1) * 28] as number)
  const simulated = Array.from({ length: 20 }, (_, i) => sim.series['total_personnel']![(i + 1) * 28] as number)
  const metrics = computeMetrics(observed, simulated)
  const data: DataInput = {
    dataset: { name: '실제 A', fileName: 'a.csv', timeUnit: 'week', offsetDay: 3 },
    columns: [{ name: 'hr', variable: 'total_personnel', metrics, status: checkTolerances(metrics, { nrmse: 0.05 }), outOfRange: 2, invalid: 1 }],
    unmapped: 1,
    overall: weightedNrmse([{ nrmse: metrics.nrmse }]),
    completion: { ...completionError(274.1, 300), simulated: 274.1, actual: 300 }
  }
  const cases = planExtremes([{ name: 'extra_people', min: 0, max: 500, integer: true }, { name: 'hire_day', min: 0, max: 400, integer: true }], baseParams)
  const cells = cases.map((c) => runExtremeCase({ model, base: baseParams, options: {}, kpis: [doneDay, effort] }, c))
  const structure = runStructureChecks({ model, params: baseParams, options: {}, kpis: [doneDay] }).findings
  return {
    generatedAt: '2026-10-22T09:00:00.000Z',
    model: { id: 'brooks', version: 1 },
    target: { id: '@base', name: '기준' },
    run: { end: 400, dt: 0.25, seed: 1 },
    tolerances: { nrmse: 0.05 },
    data: [data],
    extremes: { cells, total: cells.length },
    structure,
    presets: [{ name: '팀 A 보정', dataset: '실제 A', params: { nominal_productivity: 0.13 }, objective: 0.0012, valObjective: 0.0031, split: 0.7, at: '2026-10-22T08:00:00.000Z' }],
    checklist: withChecklistEntry(withChecklistEntry([], 'face-validity', { status: 'ok', note: '팀 리뷰 완료' }), 'extreme-equations', { status: 'problem', note: '일부 극단 값 이상|파이프 문자' }),
    ...over
  }
}
const labels = { variable: (n: string) => (n === 'total_personnel' ? '총 인원' : n), param: (n: string) => (n === 'extra_people' ? '추가 투입 인원' : n) }

describe('검증 기록 만들기', () => {
  it('필요한 요약만 담고 JSON으로 왕복한다(시계열·셀 전체는 없다)', () => {
    const rec = buildValidationRecord(sampleInput())
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec)
    const text = JSON.stringify(rec)
    expect(text).not.toContain('series')
    expect(text).not.toContain('negativeLevels')
    expect(rec.data[0]).toMatchObject({ name: '실제 A', fileName: 'a.csv', timeUnit: 'week', offsetDay: 3, unmapped: 1 })
    expect(rec.data[0]!.columns[0]).toMatchObject({ name: 'hr', variable: 'total_personnel', skipped: 3, n: 20 })
    expect(rec.data[0]!.columns[0]!.status).toEqual({ nrmse: 'out' }) // 인원을 적게 본 시뮬레이션은 기준 밖
    expect(rec.extremes!.counts.fail).toBe(0)
    expect(rec.extremes!.total).toBe(rec.extremes!.counts.pass + rec.extremes!.counts.warn + rec.extremes!.counts.fail + rec.extremes!.counts.info)
    expect(rec.structure!.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
    expect(rec.checklist).toHaveLength(2)
  })

  it('알 수 없는 값(NaN)은 null로 바꾼다', () => {
    expect(finiteOrNull(NaN)).toBeNull()
    expect(finiteOrNull(Infinity)).toBeNull()
    expect(finiteOrNull(undefined)).toBeNull()
    expect(finiteOrNull(1.5)).toBe(1.5)
    const input = sampleInput()
    input.data[0]!.columns[0]!.metrics = computeMetrics([], [])
    input.data[0]!.overall = { j: NaN, used: 0, skipped: 1 }
    const rec = buildValidationRecord(input)
    expect(rec.data[0]!.columns[0]!.rmse).toBeNull()
    expect(rec.data[0]!.overall).toBeNull()
    expect(() => JSON.stringify(rec)).not.toThrow()
    expect(JSON.stringify(rec)).not.toContain('NaN')
  })

  it('실행하지 않은 영역은 비어 있다', () => {
    const rec = buildValidationRecord(sampleInput({ data: [], extremes: null, structure: null }))
    expect(rec).toMatchObject({ data: [], extremes: null, structure: null })
  })

  it('실패한 극단 조건 값은 이유와 함께 담는다(상한 안에서)', () => {
    const input = sampleInput()
    const cell = input.extremes!.cells[0]!
    input.extremes = { total: 1, cells: [{ ...cell, status: 'fail', error: { message: '0으로 나누기' }, reasons: ['허용 범위 안의 값에서 오류'] }] }
    const rec = buildValidationRecord(input)
    expect(rec.extremes!.failures).toEqual([{ param: cell.case.name, value: cell.case.value, reason: '0으로 나누기' }])
  })

  it('만든 기록은 입력과 떨어져 있다(복사)', () => {
    const input = sampleInput()
    const rec = buildValidationRecord(input)
    input.checklist[0]!.note = '바뀜'
    input.run.end = 1
    expect(rec.checklist[0]!.note).not.toBe('바뀜')
    expect(rec.run.end).toBe(400)
  })
})

describe('보정 프리셋 요약', () => {
  it('기록에 담기고 이전 기록(프리셋 없음)은 빈 목록이다', () => {
    const rec = buildValidationRecord(sampleInput())
    expect(rec.presets).toEqual([{ name: '팀 A 보정', dataset: '실제 A', params: { nominal_productivity: 0.13 }, objective: 0.0012, valObjective: 0.0031, split: 0.7, at: '2026-10-22T08:00:00.000Z' }])
    expect(buildValidationRecord(sampleInput({ presets: undefined })).presets).toEqual([])
  })
  it('마크다운: 프리셋 표(파라미터 이름·J·비율), 없으면 "보정한 프리셋이 없습니다"', () => {
    const md = recordToMarkdown(buildValidationRecord(sampleInput()), { ...labels, param: (n) => (n === 'nominal_productivity' ? '공칭 생산성' : n) })
    expect(md).toContain('## 5. 보정 프리셋')
    expect(md).toContain('| 팀 A 보정 | 실제 A | 공칭 생산성 = 0.13 | 0.0012 | 0.0031 | 70% |')
    expect(md).toContain('맞는 값"을 약속하지 않습니다')
    expect(recordToMarkdown(buildValidationRecord(sampleInput({ presets: [] })), labels)).toContain('보정한 프리셋이 없습니다.')
  })
  it('CSV: 프리셋 행', () => {
    const csv = recordToCsv(buildValidationRecord(sampleInput()), labels).split('\r\n')
    expect(csv).toContain('보정 프리셋,팀 A 보정,데이터,실제 A')
    expect(csv).toContain('보정 프리셋,팀 A 보정,nominal_productivity,0.13')
    expect(csv).toContain('보정 프리셋,팀 A 보정,검증 구간 J,0.0031')
  })
})

describe('모델 버전 표시', () => {
  const rec = buildValidationRecord(sampleInput())
  it('같으면 빈 문자열, 버전이 다르면 알리고, 다른 모델이면 알린다', () => {
    expect(recordModelNote(rec, { id: 'brooks', version: 1 })).toBe('')
    expect(recordModelNote(rec, { id: 'brooks', version: 2 })).toContain('다른 모델 버전(기록 v1, 현재 v2)')
    expect(recordModelNote(rec, { id: 'integrated-project', version: 1 })).toContain("다른 모델('brooks')")
  })
})

describe('마크다운 내보내기', () => {
  const rec = buildValidationRecord(sampleInput())
  const md = recordToMarkdown(rec, labels)

  it('맨 위에 "검증은 증명이 아니며 합격·불합격을 판정하지 않는다"고 적는다', () => {
    expect(md.split('\n')[0]).toBe('# 모델 검증 기록')
    expect(md).toContain('증명이 아니라 신뢰를 쌓는 활동')
    expect(md).toContain('합격·불합격을 판정하지 않습니다')
  })
  it('네 영역이 모두 들어 있다', () => {
    for (const h of ['## 1. 실제 데이터와의 비교', '## 2. 극단 조건 시험', '## 3. 구조 점검', '## 4. 수동 체크리스트']) expect(md).toContain(h)
  })
  it('데이터 비교: 열 → 변수 이름, 지표 표, 기준 안/밖, 완료 시점 오차', () => {
    expect(md).toContain('### 실제 A (a.csv)')
    expect(md).toContain('hr → 총 인원')
    expect(md).toContain('정규화 RMSE 기준 밖')
    expect(md).toContain('허용 기준: 정규화 RMSE 0.05')
    expect(md).toMatch(/완료 시점 오차: 시뮬레이션 274\.1일 − 실제 300일 = -25\.9일 \(-8\.6%\)/)
    expect(md).toContain('| 열 → 변수 | n | 뺀 점 |')
  })
  it('극단 조건: 개수와 "기계적 결함만 찾는다"는 한계', () => {
    expect(md).toMatch(/값 \d+개: 통과 \d+, 주의 \d+, 실패 0, 정보 \d+/)
    expect(md).toContain('허용 범위 안의 값에서 수치 오류는 없었습니다')
    expect(md).toContain('기계적 결함만 찾습니다')
  })
  it('구조 점검: 결과 표와 확인하지 못한 것', () => {
    expect(md).toContain('| S1 단위 일관성 | 통과 |')
    expect(md).toContain('확인하지 못한 것:')
    expect(md).toContain('S1: 숫자 리터럴은 단위 미정')
  })
  it('체크리스트: 모든 항목이 나오고 상태·메모가 맞으며 표를 깨는 | 는 이스케이프한다', () => {
    for (const i of CHECKLIST_ITEMS) expect(md).toContain(`| ${i.title} |`)
    expect(md).toContain('| 구조의 현실성(얼굴 타당성) | 확인 | 팀 리뷰 완료 |')
    expect(md).toContain('| 수식의 극단 조건 | 문제 있음 | 일부 극단 값 이상\\|파이프 문자 |')
    expect(md).toContain('| 새로운 통찰 | 미확인 |  |')
  })
  it('현재 모델 버전이 다르면 경고 줄을 넣는다', () => {
    expect(md).not.toContain('⚠')
    expect(recordToMarkdown(rec, { ...labels, currentModel: { id: 'brooks', version: 2 } })).toContain('⚠ 다른 모델 버전(기록 v1, 현재 v2)')
    expect(recordToMarkdown(rec, { ...labels, currentModel: { id: 'brooks', version: 1 } })).not.toContain('⚠')
  })
  it('실행하지 않은 영역은 "실행하지 않았습니다"/"비교하지 않았습니다"로 적는다', () => {
    const empty = recordToMarkdown(buildValidationRecord(sampleInput({ data: [], extremes: null, structure: null })), labels)
    expect(empty).toContain('비교하지 않았습니다.')
    expect(empty.match(/실행하지 않았습니다\./g)).toHaveLength(2)
  })
  it('실패한 극단 조건 값은 모델 결함 후보로 나열한다', () => {
    const input = sampleInput()
    const cell = input.extremes!.cells[0]!
    input.extremes = { total: 1, cells: [{ ...cell, status: 'fail', error: { message: '0으로 나누기' }, reasons: [] }] }
    const text = recordToMarkdown(buildValidationRecord(input), labels)
    expect(text).toContain('모델 결함 후보')
    expect(text).toContain('0으로 나누기')
  })
})

describe('CSV 내보내기', () => {
  const rec = buildValidationRecord(sampleInput())
  const csv = recordToCsv(rec, labels)
  const lines = csv.trimEnd().split('\r\n')

  it('머리글과 긴 형식(구분, 대상, 항목, 값)의 행', () => {
    expect(lines[0]).toBe('구분,대상,항목,값')
    expect(lines).toContain('기본,모델,id,brooks')
    expect(lines).toContain('기본,모델,버전,1')
    expect(lines.some((l) => l.startsWith('데이터 비교,실제 A/hr → 총 인원,RMSE,'))).toBe(true)
    expect(lines).toContain('데이터 비교,실제 A/hr → 총 인원,기준: 정규화 RMSE,기준 밖')
    expect(lines).toContain('구조 점검,S1 단위 일관성,결과,통과')
    expect(lines).toContain('체크리스트,구조의 현실성(얼굴 타당성),상태,확인')
    expect(lines).toContain('체크리스트,구조의 현실성(얼굴 타당성),메모,팀 리뷰 완료')
  })
  it('모든 행의 열 수가 같다(쉼표·따옴표가 든 값도 올바르게 감쌈)', () => {
    const tricky = buildValidationRecord(sampleInput({ checklist: withChecklistEntry([], 'face-validity', { status: 'ok', note: '쉼표, "따옴표"\n줄바꿈' }) }))
    const out = recordToCsv(tricky, labels)
    expect(out).toContain('"쉼표, ""따옴표""\n줄바꿈"')
    // 단순 분할이 아니라 따옴표를 존중해 열 수를 센다
    const parse = (text: string): string[][] => {
      const rows: string[][] = []
      let row: string[] = []
      let cur = ''
      let q = false
      for (let i = 0; i < text.length; i++) {
        const ch = text[i]!
        if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
        else if (ch === '"') q = true
        else if (ch === ',') { row.push(cur); cur = '' }
        else if (ch === '\r') { /* \n에서 처리 */ }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
        else cur += ch
      }
      return rows
    }
    const rows = parse(out)
    expect(rows.every((r) => r.length === 4)).toBe(true)
    expect(rows.find((r) => r[2] === '메모')![3]).toBe('쉼표, "따옴표"\n줄바꿈')
  })
  it('모든 체크리스트 항목이 상태 행을 가진다', () => {
    expect(lines.filter((l) => l.startsWith('체크리스트,') && l.includes(',상태,'))).toHaveLength(CHECKLIST_ITEMS.length)
  })
  it('알 수 없는 값은 빈 칸', () => {
    const input = sampleInput()
    input.data[0]!.columns[0]!.metrics = computeMetrics([], [])
    const out = recordToCsv(buildValidationRecord(input), labels)
    expect(out).toContain('데이터 비교,실제 A/hr → 총 인원,RMSE,\r\n')
  })
})
