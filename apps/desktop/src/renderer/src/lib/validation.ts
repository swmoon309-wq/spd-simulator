import { CHECKLIST_ITEMS, checklistItem, MAX_CHECKLIST_NOTE as ANALYSIS_NOTE_MAX, type ChecklistEntry, type Tolerances, type TimeUnit, type ValidationRecord } from '@spd/analysis'
import type { DatasetFile, ValidationFile } from '../../../shared/projectFile'
import type { ModelEntry } from '../catalog'
import { sanitizePresets, type Preset } from './presets'
import { matchVariable, type ParsedReference } from './referenceCsv'
import { BASE_ID } from './scenarioRunner'

/** 한도. `shared/projectFile.ts`와 같아야 하며 시험으로 확인한다. */
export const MAX_DATASETS = 5
export const MAX_DATASET_COLUMNS = 20
export const MAX_COLUMN_POINTS = 5000
export const MAX_DATASET_POINTS_TOTAL = 50_000
/** 체크리스트 메모 길이. `shared/projectFile.ts`와 `@spd/analysis`의 값과 같아야 하며 시험으로 확인한다. */
export const MAX_CHECKLIST_NOTE = ANALYSIS_NOTE_MAX
export const MAX_CHECKLIST_ENTRIES = 50
const CHECKLIST_ORDER = CHECKLIST_ITEMS.map((i) => i.id)

/** 데이터셋의 열 하나: 관측 점과 비교할 모델 변수. */
export interface DatasetColumn {
  name: string
  /** 비교할 모델 변수. null이면 비교에서 제외 */
  variable: string | null
  /** 값 배율(단위 변환, 기본 1) */
  scale: number
  points: [number, number][]
}

export interface Dataset {
  id: string
  name: string
  fileName: string
  timeUnit: TimeUnit
  /** 시간 이동: 실제 프로젝트 시작일 − 시뮬레이션 0일(일) */
  offsetDay: number
  /** 실제 완료일(시뮬레이션 일). 없으면 null */
  actualCompletionDay: number | null
  columns: DatasetColumn[]
}

/** 모델 검증 설정. 결과(지표)는 저장하지 않고 열 때마다 시뮬레이션과 다시 비교한다. */
export interface ValidationSettings {
  datasets: Dataset[]
  /** 허용 기준: 사용자가 정한 지표만. 기본값은 없다(설계 07의 0장) */
  tolerances: Tolerances
  /** 비교 대상: `BASE_ID`(기준) 또는 시나리오 id */
  targetScenarioId: string
  /** 수동 체크리스트(처음 상태가 아닌 항목만, 정의 순서) */
  checklist: ChecklistEntry[]
  /** 보정 프리셋(최대 20개) */
  presets: Preset[]
  /** 마지막으로 만든 검증 기록(요약). 없으면 null */
  report: ValidationRecord | null
}

export function defaultValidationSettings(): ValidationSettings {
  return { datasets: [], tolerances: {}, targetScenarioId: BASE_ID, checklist: [], presets: [], report: null }
}

export const pointCount = (d: Pick<Dataset, 'columns'>): number => d.columns.reduce((s, c) => s + c.points.length, 0)
export const totalPoints = (datasets: Dataset[]): number => datasets.reduce((s, d) => s + pointCount(d), 0)

export function nextDatasetId(datasets: Dataset[]): string {
  let n = 1
  const used = new Set(datasets.map((d) => d.id))
  while (used.has(`d${n}`)) n++
  return `d${n}`
}

const stripExtension = (fileName: string): string => fileName.replace(/\.[^./\\]+$/, '') || fileName

export type DatasetResult = { ok: true; dataset: Dataset; warnings: string[] } | { ok: false; message: string }

/**
 * 읽은 CSV로 데이터셋을 만든다. 열 이름이 모델 변수와 맞으면 자동으로 연결하고 나머지는 연결하지 않은 채 둔다(사용자가 고른다).
 * 열 수·점 수·전체 점 수 한도를 넘으면 이유와 함께 거절한다(더 큰 데이터는 요약·다운샘플해서 가져온다).
 */
export function datasetFromCsv(entry: ModelEntry, parsed: ParsedReference, fileName: string, existing: Dataset[]): DatasetResult {
  if (existing.length >= MAX_DATASETS) return { ok: false, message: `데이터셋은 최대 ${MAX_DATASETS}개입니다. 하나를 지운 뒤 가져오세요.` }
  if (parsed.columns.length > MAX_DATASET_COLUMNS) {
    return { ok: false, message: `열이 너무 많습니다(${parsed.columns.length}개, 최대 ${MAX_DATASET_COLUMNS}개). 필요한 열만 남긴 CSV를 가져오세요.` }
  }
  const tooLong = parsed.columns.find((c) => c.points.length > MAX_COLUMN_POINTS)
  if (tooLong) {
    return { ok: false, message: `'${tooLong.name}' 열의 점이 너무 많습니다(${tooLong.points.length}개, 최대 ${MAX_COLUMN_POINTS}개). 일 단위 이상으로 요약하거나 다운샘플한 CSV를 가져오세요.` }
  }
  const added = parsed.columns.reduce((s, c) => s + c.points.length, 0)
  const used = totalPoints(existing)
  if (used + added > MAX_DATASET_POINTS_TOTAL) {
    return { ok: false, message: `저장할 수 있는 데이터 점이 모자랍니다(지금 ${used}개 + 새 ${added}개 > 최대 ${MAX_DATASET_POINTS_TOTAL}개). 다른 데이터셋을 지우거나 요약한 CSV를 가져오세요.` }
  }
  const columns: DatasetColumn[] = parsed.columns.map((c) => ({ name: c.name, variable: matchVariable(entry, c.name), scale: 1, points: c.points.map(([t, v]) => [t, v] as [number, number]) }))
  const warnings: string[] = []
  const unmapped = columns.filter((c) => c.variable === null)
  if (unmapped.length > 0) warnings.push(`변수와 이름이 맞지 않는 열 ${unmapped.length}개는 비교에서 제외했습니다. 화면에서 변수를 직접 고르세요: ${unmapped.map((c) => c.name).join(', ')}`)
  if (parsed.emptyColumns.length > 0) warnings.push(`숫자 값이 없어 제외한 열: ${parsed.emptyColumns.join(', ')}`)
  return {
    ok: true,
    warnings,
    dataset: { id: nextDatasetId(existing), name: stripExtension(fileName), fileName, timeUnit: 'day', offsetDay: 0, actualCompletionDay: null, columns }
  }
}

/** 저장하는 설정. 처음 값과 같으면 null. 저장 여부 비교와 파일이 같은 형태를 쓴다. */
export function validationToFile(settings: ValidationSettings): ValidationFile | null {
  if (JSON.stringify(settings) === JSON.stringify(defaultValidationSettings())) return null
  return {
    datasets: settings.datasets.map((d) => ({
      id: d.id,
      name: d.name,
      fileName: d.fileName,
      timeUnit: d.timeUnit,
      offsetDay: d.offsetDay,
      actualCompletionDay: d.actualCompletionDay,
      columns: d.columns.map((c) => ({ name: c.name, variable: c.variable, scale: c.scale, points: c.points.map(([t, v]) => [t, v] as [number, number]) }))
    })),
    tolerances: { ...settings.tolerances },
    targetScenarioId: settings.targetScenarioId,
    checklist: settings.checklist.map((c) => ({ ...c })),
    presets: settings.presets.map((p) => ({ ...p, params: { ...p.params }, origin: { ...p.origin, columns: [...p.origin.columns] } })),
    report: settings.report ? structuredClone(settings.report) : null
  }
}

const TOLERANCE_RULES: Record<keyof Tolerances, { min: number; max: number; label: string }> = {
  nrmse: { min: 0, max: Infinity, label: '정규화 RMSE' },
  mre: { min: 0, max: Infinity, label: 'MRE' },
  mape: { min: 0, max: Infinity, label: 'MAPE' },
  nse: { min: -Infinity, max: 1, label: 'NSE' },
  trend: { min: 0, max: 1, label: '추세 일치율' }
}
export const TOLERANCE_KEYS = Object.keys(TOLERANCE_RULES) as (keyof Tolerances)[]
export const toleranceLabel = (key: keyof Tolerances): string => TOLERANCE_RULES[key].label

/** 허용 기준 하나가 올바른지. 문제가 없으면 null. */
export function toleranceProblem(key: keyof Tolerances, value: number): string | null {
  const r = TOLERANCE_RULES[key]
  if (!Number.isFinite(value) || value < r.min || value > r.max) {
    return `${r.label} 기준은 ${Number.isFinite(r.min) ? r.min : '−∞'} ~ ${Number.isFinite(r.max) ? r.max : '∞'}의 수여야 합니다.`
  }
  return null
}

/**
 * 파일의 검증 설정을 앱 설정으로 바꾼다. 모델에 없는 변수는 연결을 풀어(데이터는 남김) 비교에서 제외하고, 배율이 올바르지
 * 않으면 1로, 올바르지 않은 허용 기준은 버리고, 없는 대상 시나리오는 기준으로 돌리며 항목마다 경고한다.
 */
export function sanitizeValidation(entry: ModelEntry, file: ValidationFile | null, scenarioIds: string[]): { settings: ValidationSettings; warnings: string[] } {
  const settings = defaultValidationSettings()
  const warnings: string[] = []
  if (!file) return { settings, warnings }
  const known = new Set(entry.variables.map((v) => v.name))

  settings.datasets = file.datasets.map((d: DatasetFile) => ({
    id: d.id,
    name: d.name,
    fileName: d.fileName,
    timeUnit: d.timeUnit,
    offsetDay: d.offsetDay,
    actualCompletionDay: d.actualCompletionDay,
    columns: d.columns.map((c) => {
      let variable = c.variable
      if (variable !== null && !known.has(variable)) {
        warnings.push(`데이터셋 '${d.name}'의 '${c.name}' 열이 연결된 변수 '${variable}'이(가) 이 모델에 없어 연결을 풀었습니다.`)
        variable = null
      }
      let scale = c.scale
      if (!(scale > 0)) {
        warnings.push(`데이터셋 '${d.name}'의 '${c.name}' 열의 배율 ${scale}을(를) 쓸 수 없어 1로 돌렸습니다(0보다 커야 합니다).`)
        scale = 1
      }
      return { name: c.name, variable, scale, points: c.points.map(([t, v]) => [t, v] as [number, number]) }
    })
  }))

  for (const key of TOLERANCE_KEYS) {
    const v = file.tolerances[key]
    if (v === undefined) continue
    const problem = toleranceProblem(key, v)
    if (problem) warnings.push(`허용 기준을 버렸습니다. ${problem}`)
    else settings.tolerances[key] = v
  }

  if (file.targetScenarioId === BASE_ID || scenarioIds.includes(file.targetScenarioId)) settings.targetScenarioId = file.targetScenarioId
  else warnings.push(`검증의 비교 대상 시나리오 '${file.targetScenarioId}'를 찾을 수 없어 기준으로 돌렸습니다.`)

  // 체크리스트: 이 앱이 아는 항목만 남긴다(처음 상태인 항목은 저장하지 않으므로 그대로 둔다).
  for (const c of file.checklist) {
    if (checklistItem(c.id)) settings.checklist.push({ id: c.id, status: c.status, note: c.note })
    else warnings.push(`체크리스트의 알 수 없는 항목 '${c.id}'를 버렸습니다.`)
  }
  const order = new Map(CHECKLIST_ORDER.map((id, i) => [id, i]))
  settings.checklist.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))

  // 보정 프리셋: 다른 모델의 것과 파라미터가 하나도 남지 않은 것은 버리고, 모델에 맞지 않는 파라미터는 뺀다.
  const sp = sanitizePresets(entry, file.presets)
  settings.presets = sp.presets
  warnings.push(...sp.warnings)

  // 검증 기록은 지난 시점의 요약이므로 그대로 둔다. 모델 버전이 다른지는 화면이 알린다.
  settings.report = file.report ? structuredClone(file.report) : null
  return { settings, warnings }
}
