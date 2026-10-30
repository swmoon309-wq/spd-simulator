import { cloneEvmSettings, DEFAULT_EVM_SETTINGS, sanitizeOverrides, validateEvmSettings, type ActualRow, type EvmSettings, type Revision, type Scenario } from '@spd/analysis'
import { catalog, type ModelEntry } from '../catalog'
import { buildEntry } from '../catalog/userModel'
import { validateModelDoc } from './modelDoc'
import type { ProjectFile } from '../../../shared/projectFile'
import { PROJECT_SCHEMA_VERSION } from '../../../shared/projectFile'
import { defaultParams, paramSpecs, parseParam } from './params'
import type { Adopted } from './adoption'
import { riskToFile, sanitizeRisk, type RiskSettings } from './risk'
import { defaultReportSettings, reportsToFile, sanitizeReports, type ReportSettings } from './reportSettings'
import { sanitizeValidation, validationToFile, type ValidationSettings } from './validation'
import { checkRunSettings, defaultRunSettings, RUN_SETTING_FIELDS, type RunSettings } from './runSettings'

export interface ProjectState {
  entry: ModelEntry
  params: Record<string, number>
  runSettings: RunSettings
  chartVariable: string
  createdAt: string
  /** 프로젝트 설명. 없으면 빈 문자열 */
  description: string
  scenarios: Scenario[]
  adopted: Adopted | null
  actuals: ActualRow[]
  evm: EvmSettings
  revisions: Revision[]
  risk: RiskSettings
  validation: ValidationSettings
  reports: ReportSettings
}

export interface ProjectToSave {
  entry: ModelEntry
  name: string
  /** 프로젝트 설명. 비어 있으면 파일에 넣지 않는다. */
  description?: string
  createdAt: string
  params: Record<string, number>
  runSettings: RunSettings
  chartVariable: string
  scenarios: Scenario[]
  adopted: Adopted | null
  actuals: ActualRow[]
  evm: EvmSettings
  revisions: Revision[]
  /** 위험 분석 설정. 없으면(처음 값) 파일에는 null */
  risk?: RiskSettings
  /** 모델 검증 설정. 없으면(처음 값) 파일에는 null */
  validation?: ValidationSettings
  /** 보고서 설정. 없으면(처음 값) 파일에는 null */
  reports?: ReportSettings
  now?: Date
}

export function buildProjectFile(p: ProjectToSave): ProjectFile {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    meta: { name: p.name, ...(p.description ? { description: p.description } : {}), createdAt: p.createdAt, updatedAt: (p.now ?? new Date()).toISOString() },
    model: { id: p.entry.id, version: p.entry.def.meta.version, ...(p.entry.custom ? { custom: p.entry.custom.doc } : {}) },
    // 폼에 있는 항목만 순서대로 저장한다.
    params: Object.fromEntries(paramSpecs(p.entry).map((s) => [s.name, p.params[s.name] as number])),
    run: { end: p.runSettings.end, dt: p.runSettings.dt, seed: p.runSettings.seed },
    ui: { chartVariable: p.chartVariable },
    scenarios: p.scenarios.map((sc) => ({
      id: sc.id,
      name: sc.name,
      ...(sc.note !== undefined && sc.note !== '' ? { note: sc.note } : {}),
      overrides: { ...sc.overrides }
    })),
    adopted: p.adopted ? structuredClone(p.adopted) : null,
    actuals: structuredClone(p.actuals),
    evm: cloneEvmSettings(p.evm),
    revisions: structuredClone(p.revisions),
    risk: p.risk ? riskToFile(p.risk) : null,
    validation: p.validation ? validationToFile(p.validation) : null,
    reports: p.reports ? reportsToFile(p.reports) : null
  }
}

export type ApplyResult =
  | { ok: true; state: ProjectState; warnings: string[] }
  | { ok: false; message: string }

/**
 * 프로젝트 파일을 화면 상태로 바꾼다. 모델을 알 수 없으면 실패하고, 값이 범위를 벗어나거나
 * 모르는 항목이 있으면 기본값을 쓰거나 무시하되 경고로 알린다.
 */
export function applyProjectFile(file: ProjectFile): ApplyResult {
  let entry: ModelEntry | undefined
  if (file.model.custom) {
    // 사용자 모델: 파일에 든 정의를 엔진까지 검증하고 컴파일해 본다. 모델 없이는 프로젝트를 열 수 없으므로 실패하면 열기를 거절한다.
    const v = validateModelDoc(file.model.custom)
    if (!v.ok) return { ok: false, message: `이 프로젝트에 내장된 모델을 쓸 수 없습니다. ${v.message}` }
    if (v.doc.def.meta.id !== file.model.id) return { ok: false, message: `프로젝트의 모델 id('${file.model.id}')와 내장된 모델의 id('${v.doc.def.meta.id}')가 다릅니다.` }
    if (v.doc.def.meta.version !== file.model.version) return { ok: false, message: `프로젝트의 모델 버전(${file.model.version})과 내장된 모델의 버전(${v.doc.def.meta.version})이 다릅니다.` }
    entry = buildEntry(v.doc, v.hash)
  } else {
    entry = catalog.find((m) => m.id === file.model.id)
  }
  if (!entry) return { ok: false, message: `지원하지 않는 모델입니다: '${file.model.id}'` }

  const warnings: string[] = []
  const current = entry.def.meta.version
  if (file.model.version > current) {
    warnings.push(`파일이 더 새로운 모델 버전(${file.model.version})으로 저장되어 결과가 다를 수 있습니다(이 앱: ${current}).`)
  } else if (file.model.version < current) {
    warnings.push(`파일이 이전 모델 버전(${file.model.version})으로 저장되었습니다. 현재 모델(${current})로 실행합니다.`)
  }

  const params = defaultParams(entry)
  const specs = paramSpecs(entry)
  for (const spec of specs) {
    const raw = file.params[spec.name]
    if (raw === undefined) continue
    const label = entry.def.constants[spec.name]?.label ?? spec.name
    const parsed = parseParam(String(raw), spec)
    if ('value' in parsed) params[spec.name] = parsed.value
    else warnings.push(`'${label}' 값 ${raw}을(를) 쓸 수 없어(${parsed.error}) 기본값 ${params[spec.name]}을(를) 사용합니다.`)
  }
  const known = new Set(specs.map((s) => s.name))
  const unknown = Object.keys(file.params).filter((k) => !known.has(k))
  if (unknown.length > 0) warnings.push(`알 수 없는 항목 ${unknown.length}개를 무시했습니다: ${unknown.join(', ')}`)

  const runSettings = defaultRunSettings(entry)
  for (const f of RUN_SETTING_FIELDS) {
    const raw = file.run[f.key]
    if (raw === undefined) continue
    const parsed = parseParam(String(raw), f.spec)
    if ('value' in parsed) runSettings[f.key] = parsed.value
    else warnings.push(`'${f.label}' 값 ${raw}을(를) 쓸 수 없어(${parsed.error}) 기본값 ${runSettings[f.key]}을(를) 사용합니다.`)
  }
  const combo = checkRunSettings(runSettings)
  if (combo) {
    Object.assign(runSettings, defaultRunSettings(entry))
    warnings.push(`실행 설정을 기본값으로 되돌렸습니다. ${combo}`)
  }

  // 시나리오의 overrides는 폼 항목만, 허용 범위 안의 값만, 기본 설정과 다른 것만 남긴다.
  const bounds = specs.map((sp) => ({ name: sp.name, min: sp.min, max: sp.max, ...(sp.integer ? { integer: true } : {}) }))
  const scenarios: Scenario[] = file.scenarios.map((sc) => {
    const cleaned = sanitizeOverrides(params, sc.overrides, bounds)
    for (const w of cleaned.warnings) warnings.push(`시나리오 '${sc.name}': ${w}`)
    return { id: sc.id, name: sc.name, ...(sc.note !== undefined ? { note: sc.note } : {}), overrides: cleaned.overrides }
  })

  // 채택 계획(기준선 스냅샷): 모델이 다르거나 인정 단계가 현재 모델과 맞지 않으면 버리고, 모델 버전만 다르면 경고하고 둔다.
  let adopted: Adopted | null = file.adopted ? structuredClone(file.adopted) : null
  if (adopted && !entry.evm) {
    warnings.push('이 모델에는 진척(Earned Value) 정의가 없어 채택 계획을 버렸습니다.')
    adopted = null
  }
  if (adopted) {
    const knownVars = new Set((entry.evm?.credits ?? []).map((c) => c.variable))
    if (adopted.model.id !== entry.id) {
      warnings.push(`채택 계획이 다른 모델('${adopted.model.id}')로 만들어져 버렸습니다.`)
      adopted = null
    } else if (adopted.credits.some((c) => !knownVars.has(c.variable))) {
      warnings.push('채택 계획의 진척 인정 단계가 현재 모델과 맞지 않아 버렸습니다.')
      adopted = null
    } else if (adopted.model.version !== entry.def.meta.version) {
      warnings.push(`채택 계획이 다른 모델 버전(${adopted.model.version})으로 만들어졌습니다. 현재 모델은 ${entry.def.meta.version}입니다. 다시 채택하면 현재 모델로 갱신됩니다.`)
    }
  }

  // 실적은 채택 계획의 단계 변수를 키로 쓴다. 다른 모델의 실적이면 의미가 없어 버린다.
  let actuals: ActualRow[] = structuredClone(file.actuals)
  const creditVars = new Set((entry.evm?.credits ?? []).map((c) => c.variable))
  if (actuals.length > 0 && actuals.some((r) => Object.keys(r.cum).some((k) => !creditVars.has(k)))) {
    warnings.push('실적이 현재 모델의 단계 변수와 맞지 않아 버렸습니다.')
    actuals = []
  }

  // 개정 이력은 채택 계획에 매여 있다. 채택 계획을 버렸으면 함께 버린다.
  let revisions: Revision[] = structuredClone(file.revisions)
  if (revisions.length > 0 && adopted === null) {
    warnings.push(`채택 계획을 버려 기준선 개정 이력 ${revisions.length}건도 버렸습니다.`)
    revisions = []
  }

  // 경고 설정: 잘못되면 기본값으로 돌리고 알린다.
  let evm: EvmSettings = cloneEvmSettings(file.evm)
  const evmProblem = validateEvmSettings(evm)
  if (evmProblem) {
    warnings.push(`경고 설정이 올바르지 않아 기본값으로 돌렸습니다: ${evmProblem}`)
    evm = cloneEvmSettings(DEFAULT_EVM_SETTINGS)
  }

  // 위험 분석 설정: 시나리오를 정리한 뒤의 id로 대상·비교 대상을 확인한다. 결과는 저장하지 않으므로 다시 실행해야 한다.
  const riskResult = sanitizeRisk(entry, file.risk, scenarios.map((sc) => sc.id))
  warnings.push(...riskResult.warnings)

  // 모델 검증 설정: 데이터는 남기고 모델에 없는 변수 연결만 푼다. 지표는 저장하지 않으므로 열 때 다시 비교한다.
  const validationResult = sanitizeValidation(entry, file.validation, scenarios.map((sc) => sc.id))
  warnings.push(...validationResult.warnings)

  // 보고서 설정: 모르는 종류·절은 버린다. 결과는 저장하지 않는다.
  const reportsResult = sanitizeReports(file.reports)
  warnings.push(...reportsResult.warnings)

  const wanted = file.ui?.chartVariable
  const chartVariable = entry.variables.some((v) => v.name === wanted) ? (wanted as string) : entry.defaultVariable

  return { ok: true, state: { entry, params, runSettings, chartVariable, createdAt: file.meta.createdAt, description: file.meta.description ?? '', scenarios, adopted, actuals, evm, revisions, risk: riskResult.settings, validation: validationResult.settings, reports: reportsResult.settings }, warnings }
}
