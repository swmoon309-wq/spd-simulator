import { CHECKLIST_ITEMS, CHECKLIST_STATUS_LABEL, checklistItem, entryFor, type ChecklistEntry } from './checklist'
import type { ExtremeCell } from './extremes'
import type { Metrics, ToleranceKey, Tolerances, ToleranceStatus, WeightedNrmse, CompletionError } from './metrics'
import type { StructureFinding, StructureStatus } from './structure'

/**
 * 검증 기록(설계 07의 6장, VAL-07): 수행한 점검·비교의 **요약**(전체 시계열은 저장하지 않음)을 프로젝트에 남기고 표(CSV)와 마크다운으로
 * 내보낸다. 4차 보고서의 재료가 된다. 기록에는 합격·불합격이 없다 — 지표와, 사용자가 정한 기준의 안/밖과, 사람이 적은 체크리스트만 담는다.
 */

/** JSON에 쓸 수 있도록 유한하지 않은 값은 null로 둔다. */
export const finiteOrNull = (v: number | null | undefined): number | null => (v !== null && v !== undefined && Number.isFinite(v) ? v : null)

export interface RecordColumn {
  name: string
  variable: string
  n: number
  /** 시뮬레이션 범위 밖이거나 무효라 비교에서 뺀 점 수 */
  skipped: number
  me: number | null
  rmse: number | null
  nrmse: number | null
  mre: number | null
  nse: number | null
  theilM: number | null
  theilS: number | null
  theilC: number | null
  trend: number | null
  /** 사용자가 기준을 정한 지표의 안/밖 */
  status: Partial<Record<ToleranceKey, ToleranceStatus>>
}

export interface RecordDataset {
  name: string
  fileName: string
  timeUnit: 'day' | 'week' | 'month'
  offsetDay: number
  /** 변수에 연결하지 않아 비교하지 않은 열 수 */
  unmapped: number
  columns: RecordColumn[]
  /** 종합 J = Σ w·NRMSE² (알 수 없으면 null) */
  overall: number | null
  completion: { simulated: number | null; actual: number; days: number | null; percent: number | null } | null
}

export interface RecordExtremes {
  total: number
  counts: { pass: number; warn: number; fail: number; info: number }
  /** 허용 범위 안의 값에서 수치 오류가 난 값(모델 결함 후보) */
  failures: { param: string; value: number; reason: string }[]
}

export interface RecordStructure {
  id: string
  title: string
  status: StructureStatus
  summary: string
  items: string[]
  /** 확인하지 못한 것 */
  notChecked: string[]
}

/** 기록을 만들 때 있던 보정 프리셋의 요약(설계 07의 6장: 보정에 쓴 프리셋과 시간 분할 결과). */
export interface RecordPreset {
  name: string
  /** 보정에 쓴 데이터셋 이름 */
  dataset: string
  params: Record<string, number>
  /** 보정 구간의 목적함수 J, 검증 구간의 J(시간 분할을 썼을 때), 보정 구간 비율 */
  objective: number | null
  valObjective: number | null
  split: number | null
  at: string
}

export interface ValidationRecord {
  generatedAt: string
  model: { id: string; version: number }
  target: { id: string; name: string }
  run: { end: number; dt: number; seed: number }
  tolerances: Tolerances
  data: RecordDataset[]
  /** 극단 조건 시험을 실행하지 않았으면 null */
  extremes: RecordExtremes | null
  /** 구조 점검을 실행하지 않았으면 null */
  structure: RecordStructure[] | null
  checklist: ChecklistEntry[]
  /** 보정 프리셋 요약. 이전 기록에는 없다(빈 목록) */
  presets: RecordPreset[]
}

export const MAX_RECORD_ITEMS = 30

export interface DataInput {
  dataset: { name: string; fileName: string; timeUnit: 'day' | 'week' | 'month'; offsetDay: number }
  columns: { name: string; variable: string; metrics: Metrics; status: Partial<Record<ToleranceKey, ToleranceStatus>>; outOfRange: number; invalid: number }[]
  unmapped: number
  overall: WeightedNrmse
  completion: (CompletionError & { simulated: number | null; actual: number }) | null
}

export interface RecordInput {
  generatedAt: string
  model: { id: string; version: number }
  target: { id: string; name: string }
  run: { end: number; dt: number; seed: number }
  tolerances: Tolerances
  data: DataInput[]
  extremes: { cells: ExtremeCell[]; total: number } | null
  structure: StructureFinding[] | null
  checklist: ChecklistEntry[]
  presets?: RecordPreset[]
}

/** 현재의 결과들에서 검증 기록을 만든다. 실행하지 않은 영역은 비어 있다(null·빈 목록). */
export function buildValidationRecord(input: RecordInput): ValidationRecord {
  return {
    generatedAt: input.generatedAt,
    model: { ...input.model },
    target: { ...input.target },
    run: { ...input.run },
    tolerances: { ...input.tolerances },
    data: input.data.map((d) => ({
      name: d.dataset.name,
      fileName: d.dataset.fileName,
      timeUnit: d.dataset.timeUnit,
      offsetDay: d.dataset.offsetDay,
      unmapped: d.unmapped,
      columns: d.columns.map((c) => ({
        name: c.name,
        variable: c.variable,
        n: c.metrics.n,
        skipped: c.outOfRange + c.invalid,
        me: finiteOrNull(c.metrics.me),
        rmse: finiteOrNull(c.metrics.rmse),
        nrmse: finiteOrNull(c.metrics.nrmse),
        mre: finiteOrNull(c.metrics.mre),
        nse: finiteOrNull(c.metrics.nse),
        theilM: finiteOrNull(c.metrics.theilM),
        theilS: finiteOrNull(c.metrics.theilS),
        theilC: finiteOrNull(c.metrics.theilC),
        trend: finiteOrNull(c.metrics.trend),
        status: { ...c.status }
      })),
      overall: finiteOrNull(d.overall.j),
      completion: d.completion ? { simulated: finiteOrNull(d.completion.simulated), actual: d.completion.actual, days: finiteOrNull(d.completion.days), percent: finiteOrNull(d.completion.percent) } : null
    })),
    extremes: input.extremes
      ? (() => {
          const counts = { pass: 0, warn: 0, fail: 0, info: 0 }
          for (const c of input.extremes.cells) counts[c.status]++
          return {
            total: input.extremes.total,
            counts,
            failures: input.extremes.cells
              .filter((c) => c.status === 'fail')
              .slice(0, MAX_RECORD_ITEMS)
              .map((c) => ({ param: c.case.name, value: c.case.value, reason: c.error?.message ?? c.reasons[0] ?? '' }))
          }
        })()
      : null,
    structure: input.structure ? input.structure.map((f) => ({ id: f.id, title: f.title, status: f.status, summary: f.summary, items: f.items.slice(0, MAX_RECORD_ITEMS), notChecked: [...f.notChecked] })) : null,
    checklist: input.checklist.map((e) => ({ ...e })),
    presets: (input.presets ?? []).map((p) => ({ ...p, params: { ...p.params } }))
  }
}

/** 기록의 모델 버전이 지금 모델과 다르면 안내 문구, 같으면 빈 문자열(설계 07의 6장). */
export function recordModelNote(record: Pick<ValidationRecord, 'model'>, current: { id: string; version: number }): string {
  if (record.model.id !== current.id) return `다른 모델('${record.model.id}')로 만든 기록입니다.`
  if (record.model.version !== current.version) return `다른 모델 버전(기록 v${record.model.version}, 현재 v${current.version})으로 만든 기록입니다. 지금 모델의 결과와 다를 수 있습니다.`
  return ''
}

// ---------- 내보내기 ----------

export interface RecordLabels {
  /** 모델 변수 → 표시 이름 */
  variable(name: string): string
  /** 상수(파라미터) → 표시 이름 */
  param(name: string): string
  /** 현재 모델(없으면 모델 버전 표시를 생략) */
  currentModel?: { id: string; version: number }
}

const STATUS_LABEL: Record<StructureStatus, string> = { pass: '통과', warn: '주의', fail: '실패', info: '정보' }
const TOL_LABEL: Record<ToleranceKey, string> = { nrmse: '정규화 RMSE', mre: 'MRE', mape: 'MAPE', nse: 'NSE', trend: '추세 일치율' }
const TIME_UNIT_LABEL = { day: '일', week: '주', month: '월' } as const
const TOL_MARK: Record<ToleranceStatus, string> = { in: '기준 안', out: '기준 밖', na: '알 수 없음' }

const num = (v: number | null, digits = 3): string => (v === null ? '–' : v.toFixed(digits))
const pct = (v: number | null, digits = 1): string => (v === null ? '–' : `${(v * 100).toFixed(digits)}%`)
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
const statusText = (s: Partial<Record<ToleranceKey, ToleranceStatus>>): string =>
  (Object.keys(s) as ToleranceKey[]).map((k) => `${TOL_LABEL[k]} ${TOL_MARK[s[k] as ToleranceStatus]}`).join(' · ') || '기준 없음'

/** 검증 기록을 마크다운 문서로. 합격·불합격을 선언하지 않는다는 문구를 맨 위에 둔다. */
export function recordToMarkdown(record: ValidationRecord, labels: RecordLabels): string {
  const L: string[] = []
  L.push('# 모델 검증 기록', '')
  L.push('> 검증은 증명이 아니라 신뢰를 쌓는 활동입니다. 이 기록은 지표와 점검 결과를 있는 그대로 적은 것이며 합격·불합격을 판정하지 않습니다. 모델이 목적에 맞는지는 사람이 판단합니다.', '')
  L.push(`- 작성: ${record.generatedAt}`)
  L.push(`- 모델: ${record.model.id} (버전 ${record.model.version})`)
  const note = labels.currentModel ? recordModelNote(record, labels.currentModel) : ''
  if (note) L.push(`- ⚠ ${note}`)
  L.push(`- 대상: ${record.target.name}`)
  L.push(`- 실행 설정: 종료 ${record.run.end}일, dt ${record.run.dt}일, 시드 ${record.run.seed}`, '')

  L.push('## 1. 실제 데이터와의 비교', '')
  if (record.data.length === 0) L.push('비교하지 않았습니다.', '')
  const tols = (Object.keys(record.tolerances) as ToleranceKey[]).map((k) => `${TOL_LABEL[k]} ${record.tolerances[k]}`)
  if (record.data.length > 0) L.push(`허용 기준: ${tols.length > 0 ? tols.join(', ') : '정하지 않음'}`, '')
  for (const d of record.data) {
    L.push(`### ${d.name} (${d.fileName})`, '')
    L.push(`- 데이터 시간 단위 ${TIME_UNIT_LABEL[d.timeUnit]}, 시간 이동 ${d.offsetDay}일${d.unmapped > 0 ? `, 변수에 연결하지 않아 비교하지 않은 열 ${d.unmapped}개` : ''}`)
    L.push(`- 종합 J = Σ w·NRMSE²: ${num(d.overall, 4)}`)
    if (d.completion) L.push(`- 완료 시점 오차: ${d.completion.days === null ? `계산할 수 없음(실제 ${d.completion.actual}일)` : `시뮬레이션 ${num(d.completion.simulated, 1)}일 − 실제 ${d.completion.actual}일 = ${d.completion.days >= 0 ? '+' : ''}${d.completion.days.toFixed(1)}일${d.completion.percent === null ? '' : ` (${d.completion.percent >= 0 ? '+' : ''}${d.completion.percent.toFixed(1)}%)`}`}`)
    L.push('')
    if (d.columns.length > 0) {
      L.push('| 열 → 변수 | n | 뺀 점 | ME | RMSE | 정규화 RMSE | MRE | NSE | U^M | U^S | U^C | 추세 | 기준 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|')
      for (const c of d.columns) {
        L.push(`| ${cell(c.name)} → ${cell(labels.variable(c.variable))} | ${c.n} | ${c.skipped} | ${num(c.me)} | ${num(c.rmse)} | ${num(c.nrmse)} | ${pct(c.mre)} | ${num(c.nse)} | ${num(c.theilM)} | ${num(c.theilS)} | ${num(c.theilC)} | ${pct(c.trend, 0)} | ${statusText(c.status)} |`)
      }
      L.push('')
    }
  }

  L.push('## 2. 극단 조건 시험', '')
  if (!record.extremes) L.push('실행하지 않았습니다.', '')
  else {
    const c = record.extremes.counts
    L.push(`값 ${record.extremes.total}개: 통과 ${c.pass}, 주의 ${c.warn}, 실패 ${c.fail}, 정보 ${c.info}`, '')
    if (record.extremes.failures.length === 0) L.push('허용 범위 안의 값에서 수치 오류는 없었습니다.', '')
    else {
      L.push('허용 범위 안의 값에서 오류가 난 경우(모델 결함 후보):', '')
      for (const f of record.extremes.failures) L.push(`- ${labels.param(f.param)} = ${f.value}: ${f.reason}`)
      L.push('')
    }
    L.push('이 시험은 기계적 결함만 찾습니다. 거동이 말이 되는지는 사람이 지표와 그래프를 보고 판단해야 합니다.', '')
  }

  L.push('## 3. 구조 점검', '')
  if (!record.structure) L.push('실행하지 않았습니다.', '')
  else {
    L.push('| 점검 | 결과 | 요약 |', '|---|---|---|')
    for (const s of record.structure) L.push(`| ${s.id} ${cell(s.title)} | ${STATUS_LABEL[s.status]} | ${cell(s.summary)} |`)
    L.push('')
    for (const s of record.structure.filter((x) => x.items.length > 0)) {
      L.push(`**${s.id} ${s.title}** — 확인할 항목:`, '')
      for (const i of s.items) L.push(`- ${i}`)
      L.push('')
    }
    L.push('확인하지 못한 것:', '')
    for (const s of record.structure) for (const n of s.notChecked) L.push(`- ${s.id}: ${n}`)
    L.push('')
  }

  L.push('## 4. 수동 체크리스트', '')
  L.push('| 항목 | 상태 | 메모 |', '|---|---|---|')
  for (const item of CHECKLIST_ITEMS) {
    const e = entryFor(record.checklist, item.id)
    L.push(`| ${cell(item.title)} | ${CHECKLIST_STATUS_LABEL[e.status]} | ${cell(e.note)} |`)
  }
  for (const e of record.checklist.filter((x) => !checklistItem(x.id))) L.push(`| ${cell(e.id)} | ${CHECKLIST_STATUS_LABEL[e.status]} | ${cell(e.note)} |`)
  L.push('')

  L.push('## 5. 보정 프리셋', '')
  if (record.presets.length === 0) L.push('보정한 프리셋이 없습니다.', '')
  else {
    L.push('보정은 "맞는 값"을 약속하지 않습니다. 목적함수는 J = Σ w·NRMSE²이며, 검증 구간은 보정에 쓰지 않은 뒤쪽 구간입니다.', '')
    L.push('| 프리셋 | 데이터 | 파라미터 | 보정 구간 J | 검증 구간 J | 보정 구간 비율 | 보정 시각 |', '|---|---|---|---:|---:|---:|---|')
    for (const p of record.presets) {
      const params = Object.entries(p.params).map(([k, v]) => `${labels.param(k)} = ${Number(v.toPrecision(6))}`).join(', ')
      L.push(`| ${cell(p.name)} | ${cell(p.dataset)} | ${cell(params)} | ${num(p.objective, 4)} | ${num(p.valObjective, 4)} | ${pct(p.split, 0)} | ${p.at.slice(0, 16).replace('T', ' ')} |`)
    }
    L.push('')
  }
  return L.join('\n')
}

const csvCell = (v: string | number | null): string => {
  const s = v === null ? '' : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 검증 기록을 긴 형식(구분, 대상, 항목, 값)의 CSV로. 맨 앞의 BOM은 내보내는 쪽에서 붙인다. */
export function recordToCsv(record: ValidationRecord, labels: RecordLabels): string {
  const rows: (string | number | null)[][] = [['구분', '대상', '항목', '값']]
  rows.push(['기본', '모델', 'id', record.model.id], ['기본', '모델', '버전', record.model.version], ['기본', '대상', '이름', record.target.name], ['기본', '작성', '시각', record.generatedAt])
  rows.push(['기본', '실행 설정', '종료(일)', record.run.end], ['기본', '실행 설정', 'dt(일)', record.run.dt], ['기본', '실행 설정', '시드', record.run.seed])
  for (const d of record.data) {
    for (const c of d.columns) {
      const who = `${d.name}/${c.name} → ${labels.variable(c.variable)}`
      const metrics: [string, number | null][] = [['n', c.n], ['뺀 점', c.skipped], ['ME', c.me], ['RMSE', c.rmse], ['정규화 RMSE', c.nrmse], ['MRE', c.mre], ['NSE', c.nse], ['U^M', c.theilM], ['U^S', c.theilS], ['U^C', c.theilC], ['추세 일치율', c.trend]]
      for (const [k, v] of metrics) rows.push(['데이터 비교', who, k, v])
      for (const k of Object.keys(c.status) as ToleranceKey[]) rows.push(['데이터 비교', who, `기준: ${TOL_LABEL[k]}`, TOL_MARK[c.status[k] as ToleranceStatus]])
    }
    rows.push(['데이터 비교', d.name, '종합 J', d.overall])
    if (d.completion) rows.push(['데이터 비교', d.name, '완료 시점 오차(일)', d.completion.days])
  }
  if (record.extremes) {
    rows.push(['극단 조건', '값', '전체', record.extremes.total])
    for (const k of ['pass', 'warn', 'fail', 'info'] as const) rows.push(['극단 조건', '판정', STATUS_LABEL[k], record.extremes.counts[k]])
    for (const f of record.extremes.failures) rows.push(['극단 조건', `${labels.param(f.param)} = ${f.value}`, '실패', f.reason])
  }
  for (const s of record.structure ?? []) {
    rows.push(['구조 점검', `${s.id} ${s.title}`, '결과', STATUS_LABEL[s.status]], ['구조 점검', `${s.id} ${s.title}`, '요약', s.summary])
    for (const i of s.items) rows.push(['구조 점검', `${s.id} ${s.title}`, '확인할 항목', i])
  }
  for (const item of CHECKLIST_ITEMS) {
    const e = entryFor(record.checklist, item.id)
    rows.push(['체크리스트', item.title, '상태', CHECKLIST_STATUS_LABEL[e.status]])
    if (e.note !== '') rows.push(['체크리스트', item.title, '메모', e.note])
  }
  for (const p of record.presets) {
    rows.push(['보정 프리셋', p.name, '데이터', p.dataset])
    for (const [k, v] of Object.entries(p.params)) rows.push(['보정 프리셋', p.name, labels.param(k), v])
    rows.push(['보정 프리셋', p.name, '보정 구간 J', p.objective], ['보정 프리셋', p.name, '검증 구간 J', p.valObjective], ['보정 프리셋', p.name, '보정 구간 비율', p.split])
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
