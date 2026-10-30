import { CHECKLIST_ITEMS, CHECKLIST_STATUS_LABEL, checklistItem, entryFor, type ToleranceKey, type ToleranceStatus, type ValidationRecord } from '@spd/analysis'
import type { Block, Cell } from '../../../../shared/reportDoc'
import { unitNote } from '../modelEdit/unitStatus'
import type { ReportState } from './model'
import { unavailable, type Built } from './sections'
import type { RecordContents } from '../validationRecord'

/** 보고서의 "모델 검증" 절에 쓰는 자료: 지금의 결과로 만든 검증 기록과, 기록에 넣은 것·못 넣은 것. */
export interface ValidationReportState {
  record: ValidationRecord
  contents: RecordContents
}

const TOL_LABEL: Record<ToleranceKey, string> = { nrmse: '정규화 RMSE', mre: 'MRE', mape: 'MAPE', nse: 'NSE', trend: '추세 일치율' }
const TOL_MARK: Record<ToleranceStatus, string> = { in: '기준 안', out: '기준 밖', na: '알 수 없음' }
const STRUCT_LABEL = { pass: '통과', warn: '주의', fail: '실패', info: '정보' } as const
const UNIT_LABEL = { day: '일', week: '주', month: '월' } as const

const num = (v: number | null, digits = 3): string => (v === null ? '–' : v.toFixed(digits))
const pct = (v: number | null, digits = 1): string => (v === null ? '–' : `${(v * 100).toFixed(digits)}%`)
const statusText = (s: Partial<Record<ToleranceKey, ToleranceStatus>>): string => (Object.keys(s) as ToleranceKey[]).map((k) => `${TOL_LABEL[k]} ${TOL_MARK[s[k] as ToleranceStatus]}`).join(' · ') || '기준 없음'

/** 기록에 아무것도 넣지 못했으면 true. */
export function validationEmpty(c: RecordContents): boolean {
  return !(c.datasets > 0 || c.extremes || c.structure || c.checklist > 0 || c.presets > 0)
}

/**
 * 모델 검증 절(RPT-06, 설계 09의 3장). 검증 기록(설계 07의 6장)의 요약이며, **수행한 것과 하지 않은 것을 모두** 싣는다.
 * 오래된 결과(입력이 바뀐 뒤의 것)는 기록에 들어가지 않으므로 "확인하지 못한 것"에 이유와 함께 적는다. 합격·불합격은 판정하지 않는다.
 */
export function validationSection(state: ReportState): Built {
  const v = state.validation
  if (!v) return unavailable('missing', '검증 기록을 만들 자료가 없습니다.')
  const { record, contents } = v
  if (validationEmpty(contents)) {
    return unavailable('missing', '기록할 검증 내용이 없습니다. 모델 검증 탭에서 구조 점검·극단 조건 시험·데이터 비교를 실행하거나 체크리스트를 적으세요.')
  }
  const { entry } = state
  const variableLabel = (n: string) => entry.variables.find((x) => x.name === n)?.label ?? n
  const paramLabel = (n: string) => entry.def.constants[n]?.label ?? n
  const blocks: Block[] = []

  blocks.push({
    kind: 'callout',
    tone: 'note',
    title: '검증은 증명이 아닙니다',
    text: '아래는 지표와 점검 결과를 있는 그대로 적은 것이며 합격·불합격을 판정하지 않습니다. 모델이 목적에 맞는지는 사람이 판단합니다.'
  })
  blocks.push({
    kind: 'keyValues',
    rows: [
      ['모델', `${record.model.id} (버전 ${record.model.version})`],
      ['대상', record.target.name],
      ['실행 설정', `종료 ${record.run.end}일, dt ${record.run.dt}일, 시드 ${record.run.seed}`]
    ]
  })

  // 1. 실제 데이터와의 비교
  for (const d of record.data) {
    const tols = (Object.keys(record.tolerances) as ToleranceKey[]).map((k) => `${TOL_LABEL[k]} ${record.tolerances[k]}`)
    const lines = [
      `데이터 시간 단위 ${UNIT_LABEL[d.timeUnit]}, 시간 이동 ${d.offsetDay}일${d.unmapped > 0 ? `, 변수에 연결하지 않아 비교하지 않은 열 ${d.unmapped}개` : ''}`,
      `종합 J = Σ w·NRMSE² : ${num(d.overall, 4)}`,
      `허용 기준: ${tols.length > 0 ? tols.join(', ') : '정하지 않음'}`
    ]
    if (d.completion) {
      const c = d.completion
      lines.push(c.days === null ? `완료 시점 오차: 계산할 수 없음(실제 ${c.actual}일)` : `완료 시점 오차: 시뮬레이션 ${num(c.simulated, 1)}일 − 실제 ${c.actual}일 = ${c.days >= 0 ? '+' : ''}${c.days.toFixed(1)}일`)
    }
    blocks.push({ kind: 'paragraph', text: `실제 데이터와의 비교 — ${d.name} (${d.fileName})` }, { kind: 'list', items: lines })
    if (d.columns.length > 0) {
      blocks.push({
        kind: 'table',
        caption: `${d.name}: 열별 지표`,
        columns: [{ label: '열 → 변수' }, { label: 'n', align: 'right' }, { label: '뺀 점', align: 'right' }, { label: '정규화 RMSE', align: 'right' }, { label: 'MRE', align: 'right' }, { label: 'NSE', align: 'right' }, { label: '추세', align: 'right' }, { label: '기준' }],
        rows: d.columns.map((c): Cell[] => [`${c.name} → ${variableLabel(c.variable)}`, String(c.n), String(c.skipped), num(c.nrmse), pct(c.mre), num(c.nse), pct(c.trend, 0), statusText(c.status)])
      })
    }
  }

  // 2. 극단 조건
  if (record.extremes) {
    const c = record.extremes.counts
    const items = [`값 ${record.extremes.total}개: 통과 ${c.pass}, 주의 ${c.warn}, 실패 ${c.fail}, 정보 ${c.info}`]
    if (record.extremes.failures.length === 0) items.push('허용 범위 안의 값에서 수치 오류는 없었습니다.')
    for (const f of record.extremes.failures) items.push(`오류(모델 결함 후보): ${paramLabel(f.param)} = ${f.value} — ${f.reason}`)
    blocks.push({ kind: 'paragraph', text: '극단 조건 시험' }, { kind: 'list', items }, { kind: 'paragraph', text: '이 시험은 기계적 결함만 찾습니다. 거동이 말이 되는지는 사람이 지표와 그래프를 보고 판단해야 합니다.', tone: 'note' })
  }

  // 3. 구조 점검
  if (record.structure) {
    blocks.push({
      kind: 'table',
      caption: '구조 점검',
      columns: [{ label: '점검' }, { label: '결과' }, { label: '요약' }],
      rows: record.structure.map((s): Cell[] => [`${s.id} ${s.title}`, STRUCT_LABEL[s.status], s.summary])
    })
    for (const s of record.structure.filter((x) => x.items.length > 0)) blocks.push({ kind: 'paragraph', text: `${s.id} ${s.title} — 확인할 항목` }, { kind: 'list', items: s.items })
  }

  // 4. 체크리스트
  if (record.checklist.length > 0) {
    const rows: Cell[][] = CHECKLIST_ITEMS.map((item) => {
      const e = entryFor(record.checklist, item.id)
      return [item.title, CHECKLIST_STATUS_LABEL[e.status], e.note || '–']
    })
    for (const e of record.checklist.filter((x) => !checklistItem(x.id))) rows.push([e.id, CHECKLIST_STATUS_LABEL[e.status], e.note || '–'])
    blocks.push({ kind: 'table', caption: '수동 체크리스트(사람이 적은 판단)', columns: [{ label: '항목' }, { label: '상태' }, { label: '메모' }], rows })
  }

  // 5. 보정 프리셋
  if (record.presets.length > 0) {
    blocks.push({
      kind: 'table',
      caption: '보정 프리셋',
      note: '보정은 "맞는 값"을 약속하지 않습니다. 목적함수는 J = Σ w·NRMSE²이며, 검증 구간은 보정에 쓰지 않은 뒤쪽 구간입니다.',
      columns: [{ label: '프리셋' }, { label: '데이터' }, { label: '파라미터' }, { label: '보정 구간 J', align: 'right' }, { label: '검증 구간 J', align: 'right' }, { label: '보정 구간 비율', align: 'right' }],
      rows: record.presets.map((p): Cell[] => [p.name, p.dataset, Object.entries(p.params).map(([k, x]) => `${paramLabel(k)} = ${Number(x.toPrecision(6))}`).join(', '), num(p.objective, 4), num(p.valObjective, 4), pct(p.split, 0)])
    })
  }

  // 확인하지 못한 것(항상 싣는다)
  const notChecked: string[] = []
  if (contents.dataMissing) notChecked.push('실제 데이터와의 비교: 대상 시뮬레이션이 최신이 아니거나 없어 싣지 못했습니다.')
  else if (record.data.length === 0) notChecked.push('실제 데이터와의 비교: 데이터를 가져오지 않았습니다.')
  if (!contents.extremes) notChecked.push(contents.extremesStale ? '극단 조건 시험: 결과가 있으나 입력이 바뀌어 오래되었습니다(싣지 않음).' : '극단 조건 시험: 실행하지 않았습니다.')
  if (!contents.structure) notChecked.push(contents.structureStale ? '구조 점검: 결과가 있으나 입력이 바뀌어 오래되었습니다(싣지 않음).' : '구조 점검: 실행하지 않았습니다.')
  for (const s of record.structure ?? []) for (const n of s.notChecked) notChecked.push(`구조 점검 ${s.id}: ${n}`)
  const unchecked = CHECKLIST_ITEMS.filter((i) => entryFor(record.checklist, i.id).status === 'unchecked').length
  if (unchecked > 0) notChecked.push(`수동 체크리스트: ${CHECKLIST_ITEMS.length}개 중 ${unchecked}개가 아직 확인되지 않았습니다.`)
  if (state.entry.id === 'integrated-project') notChecked.push('통합 프로젝트 모델은 실제 프로젝트 자료로 보정되지 않았습니다.')
  if (state.entry.id === 'integrated-project-ai') notChecked.push('통합 프로젝트 + AI 보조 모델은 실제 프로젝트 자료로 보정되지 않았고, AI 항목의 값은 문헌 범위의 가정입니다.')
  const units = unitNote(state.entry)
  if (units) notChecked.push(`이 모델에는 ${units}이 있습니다. 단위가 맞지 않는 수식이 있는 채로 적용된 모델입니다.`)
  if (state.entry.category === 'user') notChecked.push('사용자 모델은 보정·검증되지 않았을 수 있습니다. 위에 적은 점검과 비교가 이 모델에 대해 한 전부입니다.')
  blocks.push({ kind: 'callout', tone: 'warning', title: '확인하지 못한 것', text: notChecked.length > 0 ? notChecked.map((n) => `· ${n}`).join('\n') : '표시할 미확인 항목이 없습니다. 그래도 검증은 모델이 맞다는 증명이 아닙니다.' })

  return { status: 'fresh', reason: null, blocks }
}
