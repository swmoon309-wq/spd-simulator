import { recordToCsv, recordToMarkdown } from '@spd/analysis'
import { serializePresets } from '../../../shared/presetFile'
import { presetsToExport } from './presets'
import { getEntry } from '../catalog'
import { controlUnsupported } from '../catalog/evm'
import { actualsFileName, actualsToCsv, ActualsCsvError, parseActualsCsv, type ParsedActuals } from './actualsCsv'
import { buildControlView } from './control'
import { comparisonFileName, comparisonToCsv, runFileName, runToCsv } from './exportCsv'
import { parsePlanCurveCsv, PlanCurveCsvError, type PlanCurve } from './planCurveCsv'
import { parseReferenceCsv, ReferenceCsvError } from './referenceCsv'
import { datasetFromCsv } from './validation'
import { riskCsvFileName, riskIterationsCsv, riskSummaryCsv } from './riskCsv'
import { useAppStore, type RunRecord } from '../stores/appStore'

const store = () => useAppStore.getState()

function desktopOnly(): boolean {
  if (window.spd) return false
  store().setNotice({ kind: 'error', text: 'CSV 내보내기와 가져오기는 데스크톱 앱에서만 사용할 수 있습니다.' })
  return true
}

async function exportCsv(suggestedName: string, content: string): Promise<void> {
  if (desktopOnly() || !window.spd) return
  const r = await window.spd.files.exportCsv({ suggestedName, content })
  if (r.status === 'saved') store().setNotice({ kind: 'info', text: `CSV를 저장했습니다: ${r.fileName}` })
  else if (r.status === 'error') store().setNotice({ kind: 'error', text: r.message })
}

/** 한 실행의 모든 변수를 CSV로 저장한다. */
export function exportRunCsv(run: RunRecord): Promise<void> {
  return exportCsv(runFileName(getEntry(store().modelId), run), runToCsv(run))
}

/** 보이는 실행들의 그래프 변수를 한 표로 저장한다. */
export function exportComparisonCsv(): Promise<void> {
  const s = store()
  const entry = getEntry(s.modelId)
  const variable = entry.variables.find((v) => v.name === s.chartVariable) ?? (entry.variables[0] as (typeof entry.variables)[number])
  const visible = s.runs.filter((r) => r.visible)
  if (visible.length === 0) {
    s.setNotice({ kind: 'error', text: '내보낼 실행 결과가 없습니다. 표시 중인 실행이 있어야 합니다.' })
    return Promise.resolve()
  }
  return exportCsv(comparisonFileName(entry, variable), comparisonToCsv(visible, variable))
}

/** 외부 기준 행동 CSV를 가져와 그래프에 겹쳐 표시할 수 있게 한다. */
export async function importReferenceCsv(): Promise<void> {
  if (desktopOnly() || !window.spd) return
  const r = await window.spd.files.importCsv()
  if (r.status === 'canceled') return
  if (r.status === 'error') {
    store().setNotice({ kind: 'error', text: r.message })
    return
  }
  try {
    const parsed = parseReferenceCsv(r.content)
    const linked = store().addReferences(r.fileName, parsed)
    const unlinked = parsed.columns.length - linked
    const details: string[] = []
    if (unlinked > 0) details.push(`변수와 이름이 맞지 않는 열 ${unlinked}개는 표시되지 않습니다. 아래 기준 행동 목록에서 변수를 직접 고르세요.`)
    if (parsed.emptyColumns.length > 0) details.push(`숫자 값이 없어 제외한 열: ${parsed.emptyColumns.join(', ')}`)
    store().setNotice({
      kind: details.length > 0 ? 'warning' : 'info',
      text: `'${r.fileName}'에서 ${parsed.columns.length}개 열을 가져왔습니다(변수에 연결된 열 ${linked}개).`,
      ...(details.length > 0 ? { details } : {})
    })
  } catch (e) {
    if (!(e instanceof ReferenceCsvError)) throw e
    store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${e.message}` })
  }
}

/** 실적 CSV를 고르고 읽는다. 오류는 알림으로 보이고 null을 돌려준다. 합치는 방법은 호출한 쪽이 정한다. */
export async function readActualsCsv(): Promise<(ParsedActuals & { fileName: string }) | null> {
  if (desktopOnly() || !window.spd) return null
  const r = await window.spd.files.importCsv()
  if (r.status === 'canceled') return null
  if (r.status === 'error') {
    store().setNotice({ kind: 'error', text: r.message })
    return null
  }
  try {
    return { ...parseActualsCsv(r.content, getEntry(store().modelId)), fileName: r.fileName }
  } catch (e) {
    if (!(e instanceof ActualsCsvError)) throw e
    store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${e.message}` })
    return null
  }
}

/** 계획 곡선 CSV를 고르고 읽는다(CTL-11). 오류는 알림으로 보이고 null을 돌려준다. */
export async function readPlanCurveCsv(): Promise<{ curve: PlanCurve; fileName: string } | null> {
  if (desktopOnly() || !window.spd) return null
  const r = await window.spd.files.importCsv()
  if (r.status === 'canceled') return null
  if (r.status === 'error') {
    store().setNotice({ kind: 'error', text: r.message })
    return null
  }
  try {
    return { curve: parsePlanCurveCsv(r.content), fileName: r.fileName }
  } catch (e) {
    if (!(e instanceof PlanCurveCsvError)) throw e
    store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${e.message}` })
    return null
  }
}

/** 실적 표(입력 + 계산 열)를 CSV로 저장한다. */
export function exportActualsCsv(): Promise<void> {
  const s = store()
  const entry = getEntry(s.modelId)
  if (s.actuals.length === 0) {
    s.setNotice({ kind: 'error', text: '내보낼 실적이 없습니다.' })
    return Promise.resolve()
  }
  const evm = entry.evm
  if (!evm) {
    s.setNotice({ kind: 'error', text: controlUnsupported(entry) as string })
    return Promise.resolve()
  }
  const view = buildControlView(s.adopted, s.actuals, { credits: evm.credits, totalTasks: evm.totalTasks(s.params) }, s.evm)
  return exportCsv(actualsFileName(entry), actualsToCsv(entry, s.actuals, view.points))
}

/** 검증용 실제 데이터 CSV를 가져와 데이터셋으로 만든다(설계 07의 2장). 열 이름이 모델 변수와 맞으면 자동으로 연결한다. */
export async function importDatasetCsv(): Promise<void> {
  if (desktopOnly() || !window.spd) return
  const r = await window.spd.files.importCsv()
  if (r.status === 'canceled') return
  if (r.status === 'error') {
    store().setNotice({ kind: 'error', text: r.message })
    return
  }
  try {
    const parsed = parseReferenceCsv(r.content)
    const made = datasetFromCsv(getEntry(store().modelId), parsed, r.fileName, store().validation.datasets)
    if (!made.ok) {
      store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${made.message}` })
      return
    }
    const problem = store().addDataset(made.dataset)
    if (problem) {
      store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${problem}` })
      return
    }
    const mapped = made.dataset.columns.filter((c) => c.variable !== null).length
    store().setNotice({
      kind: made.warnings.length > 0 ? 'warning' : 'info',
      text: `'${r.fileName}'에서 ${made.dataset.columns.length}개 열을 가져왔습니다(변수에 연결된 열 ${mapped}개).`,
      ...(made.warnings.length > 0 ? { details: made.warnings } : {})
    })
  } catch (e) {
    if (!(e instanceof ReferenceCsvError)) throw e
    store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${e.message}` })
  }
}

/** 마지막으로 만든 검증 기록을 마크다운(`md`) 또는 CSV(`csv`)로 저장한다(설계 07의 6장). 기록이 없으면 알린다. */
export async function exportValidationRecord(kind: 'md' | 'csv'): Promise<void> {
  const s = store()
  const record = s.validation.report
  if (!record) {
    s.setNotice({ kind: 'error', text: '내보낼 검증 기록이 없습니다. 먼저 "기록 만들기"를 누르세요.' })
    return
  }
  if (!window.spd) {
    s.setNotice({ kind: 'error', text: '내보내기는 데스크톱 앱에서만 사용할 수 있습니다.' })
    return
  }
  const entry = getEntry(s.modelId)
  const labels = {
    variable: (n: string) => entry.variables.find((v) => v.name === n)?.label ?? n,
    param: (n: string) => entry.def.constants[n]?.label ?? n,
    currentModel: { id: entry.id, version: entry.def.meta.version }
  }
  const stamp = record.generatedAt.slice(0, 10)
  const name = `검증 기록 ${record.model.id} ${stamp}`
  const r =
    kind === 'md'
      ? await window.spd.files.exportMarkdown({ suggestedName: name, content: recordToMarkdown(record, labels) })
      : await window.spd.files.exportCsv({ suggestedName: name, content: '﻿' + recordToCsv(record, labels) })
  if (r.status === 'saved') s.setNotice({ kind: 'info', text: `검증 기록을 저장했습니다: ${r.fileName}` })
  else if (r.status === 'error') s.setNotice({ kind: 'error', text: r.message })
}

/** 보정 프리셋 전체를 JSON 파일로 내보낸다(다른 프로젝트에서 가져와 쓸 수 있다, 설계 07의 5.4). */
export async function exportPresetsFile(): Promise<void> {
  const s = store()
  const presets = s.validation.presets
  if (presets.length === 0) {
    s.setNotice({ kind: 'error', text: '내보낼 프리셋이 없습니다.' })
    return
  }
  if (!window.spd) {
    s.setNotice({ kind: 'error', text: '내보내기는 데스크톱 앱에서만 사용할 수 있습니다.' })
    return
  }
  const r = await window.spd.files.exportJson({ suggestedName: `보정 프리셋 ${s.modelId}`, content: serializePresets(presetsToExport(presets), new Date().toISOString()) })
  if (r.status === 'saved') s.setNotice({ kind: 'info', text: `프리셋 ${presets.length}개를 저장했습니다: ${r.fileName}` })
  else if (r.status === 'error') s.setNotice({ kind: 'error', text: r.message })
}

/** 내보낸 프리셋 JSON 파일을 골라 가져온다. 다른 모델·맞지 않는 파라미터는 건너뛰고 이유를 알린다. */
export async function importPresetsFile(): Promise<void> {
  if (!window.spd) {
    store().setNotice({ kind: 'error', text: '가져오기는 데스크톱 앱에서만 사용할 수 있습니다.' })
    return
  }
  const r = await window.spd.files.importJson()
  if (r.status === 'canceled') return
  if (r.status === 'error') {
    store().setNotice({ kind: 'error', text: r.message })
    return
  }
  const out = store().importPresetText(r.content)
  if (out.error) {
    store().setNotice({ kind: 'error', text: `'${r.fileName}'을(를) 가져올 수 없습니다. ${out.error}` })
    return
  }
  store().setNotice({
    kind: out.warnings.length > 0 || out.added === 0 ? 'warning' : 'info',
    text: out.added === 0 ? `'${r.fileName}'에서 가져온 프리셋이 없습니다.` : `'${r.fileName}'에서 프리셋 ${out.added}개를 가져왔습니다.`,
    ...(out.warnings.length > 0 ? { details: out.warnings } : {})
  })
}

/** 위험 분석 결과를 CSV로 저장한다: 반복별 입력·지표(`iterations`) 또는 지표별 요약 통계(`summary`). 결과가 없으면 알린다(설계 06의 7장). */
export function exportRiskCsv(kind: 'iterations' | 'summary'): Promise<void> {
  const s = store()
  const result = s.riskRun?.result ?? null
  if (!result || result.completed === 0) {
    s.setNotice({ kind: 'error', text: '내보낼 위험 분석 결과가 없습니다. 먼저 실행하세요.' })
    return Promise.resolve()
  }
  const entry = getEntry(s.modelId)
  return exportCsv(riskCsvFileName(entry, kind, result), kind === 'iterations' ? riskIterationsCsv(result, entry) : riskSummaryCsv(result, entry))
}
