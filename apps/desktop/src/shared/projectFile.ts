import { z } from 'zod'
import { isUserModelId, modelDocSchema } from './modelDoc'

/**
 * 프로젝트 파일 스키마 버전.
 *  - 1: MVP(모델, 파라미터, 실행 설정)
 *  - 2: 시나리오(`scenarios`)와 채택 계획(`adopted`, 계획 기준선 스냅샷), 실적(`actuals`), 경고 설정(`evm`), 기준선 개정 이력(`revisions`),
 *    위험 분석 설정(`risk`, 결과는 저장하지 않는다), 모델 검증 설정(`validation`: 데이터셋·허용 기준) 추가.
 *  - 3: 사용자 모델을 담는 `model.custom`(모델 문서). 내장 모델 프로젝트는 2와 같은 내용이다.
 */
export const PROJECT_SCHEMA_VERSION = 3
export const PROJECT_EXTENSION = '.spd.json'

/** 시나리오 한도. `@spd/analysis`의 값과 같아야 하며 시험으로 확인한다(이 파일은 zod만 쓴다). */
/** 프로젝트 설명의 최대 길이 */
export const MAX_DESCRIPTION = 1000
export const MAX_SCENARIOS = 12
export const MAX_SCENARIO_NAME = 60
export const MAX_SCENARIO_NOTE = 500

const finite = z.number().refine(Number.isFinite, '유한한 수여야 합니다')

const scenarioSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, '영문자·숫자·_·-로 1~40자여야 합니다'),
  name: z
    .string()
    .refine((n) => n === n.trim(), '이름 앞뒤에 공백이 없어야 합니다')
    .refine((n) => n.length >= 1 && n.length <= MAX_SCENARIO_NAME, `이름은 1~${MAX_SCENARIO_NAME}자여야 합니다`),
  note: z.string().max(MAX_SCENARIO_NOTE).optional(),
  /** 기본 설정과 달라지는 파라미터만 */
  overrides: z.record(z.string(), finite)
})

export type ScenarioFile = z.infer<typeof scenarioSchema>

/** 채택 계획이 "기준"(기본 설정)일 때의 시나리오 id. 일반 시나리오 id는 `@`를 쓸 수 없어 겹치지 않는다. */
export const BASE_SCENARIO_ID = '@base'
/** 계획서의 계획 곡선(CSV)으로 만든 채택 계획의 `scenarioId`(CTL-11). 어느 시나리오에서 나온 것이 아니다. */
export const PLAN_CSV_SCENARIO_ID = '@plan-csv'

export const MAX_BASELINE_POINTS = 5000

const creditSchema = z.object({
  variable: z.string().min(1),
  weight: finite.refine((w) => w >= 0 && w <= 1, '0 이상 1 이하여야 합니다')
})

/**
 * 채택 계획: 채택 시점에 만든 계획 기준선의 스냅샷(설계 05, 3.1). 이후 시나리오나 기본 설정을 고쳐도 바뀌지 않는다.
 * PV(t) = bac × progress(t).
 */
export const adoptedSchema = z
  .object({
    /** 채택한 시나리오 id, `@base`(기준), 또는 `@plan-csv`(계획서의 계획 곡선, CTL-11) */
    scenarioId: z.string().regex(/^(@base|@plan-csv|[A-Za-z0-9_-]{1,40})$/, '시나리오 id 형식이 올바르지 않습니다'),
    /** 채택 당시의 이름(시나리오를 지우거나 이름을 바꿔도 알아볼 수 있게) */
    scenarioName: z.string().min(1).max(MAX_SCENARIO_NAME),
    adoptedAt: z.string(),
    /** 기준선 개정 번호. 채택은 0이다(개정은 설계 05, 8.3) */
    revision: z.number().int().min(0),
    model: z.object({ id: z.string().min(1), version: z.number().int().positive() }),
    /** 채택 시점의 유효 파라미터 */
    params: z.record(z.string(), finite),
    run: z.object({ end: finite, dt: finite, seed: z.number().int() }),
    /** 진척 인정 규칙: 단계별 누적 태스크 변수와 비율(합 1) */
    credits: z.array(creditSchema).min(1),
    totalTasks: finite.refine((n) => n > 0, '0보다 커야 합니다'),
    /** 총 예산: 완료 시점의 누적 투입 공수(맨데이) */
    bac: finite.refine((n) => n > 0, '0보다 커야 합니다'),
    /** 계획 완료 시각(일) */
    plannedCompletion: finite.refine((n) => n > 0, '0보다 커야 합니다'),
    series: z.object({
      time: z.array(finite).min(2).max(MAX_BASELINE_POINTS),
      progress: z.array(finite).min(2).max(MAX_BASELINE_POINTS),
      effort: z.array(finite).min(2).max(MAX_BASELINE_POINTS)
    })
  })
  .superRefine((a, ctx) => {
    const n = a.series.time.length
    if (a.series.progress.length !== n || a.series.effort.length !== n) {
      ctx.addIssue({ code: 'custom', path: ['series'], message: 'time, progress, effort의 길이가 같아야 합니다' })
    }
    for (let i = 1; i < n; i++) {
      if (!((a.series.time[i] as number) > (a.series.time[i - 1] as number))) {
        ctx.addIssue({ code: 'custom', path: ['series', 'time', i], message: '시각은 엄격히 증가해야 합니다' })
        break
      }
    }
    if (a.series.progress.some((p) => p < 0) || a.series.effort.some((e) => e < 0)) {
      ctx.addIssue({ code: 'custom', path: ['series'], message: '진척률과 공수는 음수일 수 없습니다' })
    }
    const sum = a.credits.reduce((s, c) => s + c.weight, 0)
    if (Math.abs(sum - 1) > 1e-6) ctx.addIssue({ code: 'custom', path: ['credits'], message: `비율의 합이 1이어야 합니다(현재 ${sum})` })
    if (new Set(a.credits.map((c) => c.variable)).size !== a.credits.length) {
      ctx.addIssue({ code: 'custom', path: ['credits'], message: '같은 변수가 겹칩니다' })
    }
  })

export type AdoptedFile = z.infer<typeof adoptedSchema>

export const MAX_ACTUAL_ROWS = 400
export const MAX_ACTUAL_NOTE = 200

/**
 * 실적 한 줄(설계 05, 4.1). 값은 누적이다. 구조(유한한 수)만 검사하고, 음수·순서 같은 내용 오류는 앱이 행마다
 * 표시한다(오류 행은 계산에서 제외하지만 입력한 데이터를 잃지 않도록 저장은 허용한다).
 */
const actualRowSchema = z.object({
  day: finite,
  cum: z.record(z.string(), finite),
  effort: finite,
  headcount: finite.optional(),
  defects: finite.optional(),
  note: z.string().max(MAX_ACTUAL_NOTE).optional()
})

export type ActualRowFile = z.infer<typeof actualRowSchema>

export const MAX_REVISIONS = 20
export const MAX_REVISION_REASON = 200

/**
 * 기준선 개정 하나(설계 05, 8.3). 개정 시점 이후에 쓰는 새 기준선을 담고 원 기준선(`adopted`)과 이전 개정은 그대로 둔다.
 * 진척 인정 규칙과 총 태스크는 `adopted`의 것을 이어 쓴다.
 */
const revisionSchema = z
  .object({
    number: z.number().int().min(1),
    revisedAt: z.string(),
    day: finite.refine((d) => d > 0, '0보다 커야 합니다'),
    reason: z
      .string()
      .refine((r) => r.trim().length >= 1, '사유를 입력해야 합니다')
      .refine((r) => r.length <= MAX_REVISION_REASON, `사유는 ${MAX_REVISION_REASON}자 이하여야 합니다`),
    action: z.object({ kind: z.string().min(1), label: z.string(), values: z.record(z.string(), finite), day: finite }).nullable(),
    kappa: finite,
    before: z.object({ plannedCompletion: finite, bac: finite }),
    after: z.object({ plannedCompletion: finite, bac: finite }),
    ev0: finite.refine((x) => x >= 0, '음수일 수 없습니다'),
    ac0: finite.refine((x) => x >= 0, '음수일 수 없습니다'),
    baseline: z.object({
      bac: finite.refine((n) => n > 0, '0보다 커야 합니다'),
      plannedCompletion: finite.refine((n) => n > 0, '0보다 커야 합니다'),
      series: z.object({
        time: z.array(finite).min(2).max(MAX_BASELINE_POINTS),
        progress: z.array(finite).min(2).max(MAX_BASELINE_POINTS),
        effort: z.array(finite).min(2).max(MAX_BASELINE_POINTS)
      })
    })
  })
  .superRefine((r, ctx) => {
    const { time, progress, effort } = r.baseline.series
    if (progress.length !== time.length || effort.length !== time.length) {
      ctx.addIssue({ code: 'custom', path: ['baseline', 'series'], message: 'time, progress, effort의 길이가 같아야 합니다' })
    }
    for (let i = 1; i < time.length; i++) {
      if (!((time[i] as number) > (time[i - 1] as number))) {
        ctx.addIssue({ code: 'custom', path: ['baseline', 'series', 'time', i], message: '시각은 엄격히 증가해야 합니다' })
        break
      }
    }
    if (progress.some((p) => p < 0) || effort.some((e) => e < 0)) {
      ctx.addIssue({ code: 'custom', path: ['baseline', 'series'], message: '진척률과 공수는 음수일 수 없습니다' })
    }
    if (time[0] !== r.day) ctx.addIssue({ code: 'custom', path: ['baseline', 'series', 'time', 0], message: '새 기준선의 시계열은 개정 시점에서 시작해야 합니다' })
  })

export type RevisionFile = z.infer<typeof revisionSchema>

/** 경고 임계값과 구간 설정(설계 05의 5.3). 기본값은 `@spd/analysis`의 `DEFAULT_EVM_SETTINGS`와 같아야 한다(시험으로 확인). */
export const DEFAULT_EVM_FILE = { k: 3, alerts: { warn: 0.9, critical: 0.8, trend: 3, early: { progress: 0.15, cpi: 0.9 } } }
const evmSchema = z.object({
  k: finite,
  alerts: z.object({
    warn: finite,
    critical: finite,
    trend: finite,
    early: z.object({ progress: finite, cpi: finite })
  })
})

/** 위험 분석 설정 한도. 앱의 `lib/risk.ts`와 같아야 하며 시험으로 확인한다(이 파일은 zod만 쓴다). */
export const MAX_RISK_INPUTS = 12
export const MAX_RISK_TARGETS = 20
export const MAX_RISK_COMPARE = 3

/** 입력 분포(설계 06의 2.1). 구조만 검사하고 값의 범위·순서는 앱이 열 때 검사한다. */
const distSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uniform'), min: finite, max: finite }),
  z.object({ kind: z.literal('triangular'), min: finite, mode: finite, max: finite }),
  z.object({ kind: z.literal('pert'), min: finite, mode: finite, max: finite }),
  z.object({ kind: z.literal('normal'), mean: finite, sd: finite, lo: finite.optional(), hi: finite.optional() })
])

/**
 * 위험 분석 설정(설계 06의 8장). 입력과 시드만 저장하고 결과는 저장하지 않는다(같은 입력·시드는 항상 같은 결과, NFR-05).
 * 값의 내용(범위, 모델에 있는 이름)은 앱이 열 때 검사해 잘못된 항목을 버리고 경고한다.
 */
const riskSchema = z.object({
  /** 대상: `@base`(기준) 또는 시나리오 id */
  scenarioId: z.string().regex(/^(@base|[A-Za-z0-9_-]{1,40})$/, '시나리오 id 형식이 올바르지 않습니다'),
  n: finite,
  seed: finite,
  inputs: z.array(z.object({ name: z.string().min(1), dist: distSchema })).max(MAX_RISK_INPUTS),
  targets: z.array(z.object({ kpi: z.string().min(1), op: z.enum(['<=', '>=']), value: finite })).max(MAX_RISK_TARGETS),
  bandVariable: z.string().min(1).nullable().default(null),
  /** 시나리오 간 비교에 고른 대상 */
  compareIds: z.array(z.string().regex(/^(@base|[A-Za-z0-9_-]{1,40})$/)).max(MAX_RISK_COMPARE).default([])
})

export type RiskFile = z.infer<typeof riskSchema>

/** 모델 검증 한도(설계 07의 2장). 앱의 `lib/validation.ts`와 같아야 하며 시험으로 확인한다. */
export const MAX_DATASETS = 5
export const MAX_DATASET_COLUMNS = 20
export const MAX_COLUMN_POINTS = 5000
export const MAX_DATASET_POINTS_TOTAL = 50_000

export const MAX_PRESETS = 20
export const MAX_PRESET_PARAMS = 100
export const MAX_CHECKLIST_ENTRIES = 50
export const MAX_CHECKLIST_NOTE = 500
export const MAX_RECORD_ITEMS = 30

const checklistEntrySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/, '소문자·숫자·하이픈으로 1~40자여야 합니다'),
  status: z.enum(['unchecked', 'ok', 'problem']),
  note: z.string().max(MAX_CHECKLIST_NOTE)
})

export type ChecklistEntryFile = z.infer<typeof checklistEntrySchema>

const nullableNumber = finite.nullable()
const toleranceStatusSchema = z.enum(['in', 'out', 'na'])

/**
 * 보정 프리셋(설계 07의 5.4): 보정한 파라미터 값과 출처. 프로젝트 파일(`validation.presets`)과 내보내기 파일이 같은 형태를 쓴다.
 * 값의 내용(모델에 있는 파라미터, 허용 범위)은 앱이 열거나 가져올 때 검사해 맞지 않는 항목을 버리고 경고한다.
 */
export const presetBodySchema = z.object({
  name: z.string().refine((n) => n.trim().length >= 1 && n.length <= 100, '이름은 1~100자여야 합니다'),
  modelId: z.string().min(1),
  modelVersion: z.number().int().positive(),
  /** 보정한 파라미터만 */
  params: z.record(z.string(), finite).refine((p) => Object.keys(p).length >= 1 && Object.keys(p).length <= MAX_PRESET_PARAMS, '파라미터가 1~100개여야 합니다'),
  origin: z.object({
    dataset: z.string().max(100),
    /** 비교한 열의 모델 변수 */
    columns: z.array(z.string().max(100)).max(MAX_DATASET_COLUMNS),
    /** 보정 구간의 목적함수 J, 검증 구간의 J(시간 분할을 썼을 때), 보정 구간 비율 */
    objective: finite.nullable(),
    valObjective: finite.nullable(),
    split: finite.nullable(),
    /** 보정한 시각(ISO) */
    at: z.string().max(40)
  })
})

export const presetSchema = presetBodySchema.extend({ id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, '영문자·숫자·_·-로 1~40자여야 합니다') })

export type PresetFile = z.infer<typeof presetSchema>
export type PresetBodyFile = z.infer<typeof presetBodySchema>

/**
 * 검증 기록(설계 07의 6장): 수행한 점검·비교의 요약. 전체 시계열은 저장하지 않는다. 지표·판정만 담고 합격·불합격은 없다.
 * 알 수 없는 지표는 null이다(JSON에는 NaN을 쓸 수 없다).
 */
const recordColumnSchema = z.object({
  name: z.string().max(200),
  variable: z.string().max(100),
  n: z.number().int().min(0),
  skipped: z.number().int().min(0),
  me: nullableNumber,
  rmse: nullableNumber,
  nrmse: nullableNumber,
  mre: nullableNumber,
  nse: nullableNumber,
  theilM: nullableNumber,
  theilS: nullableNumber,
  theilC: nullableNumber,
  trend: nullableNumber,
  status: z.object({ nrmse: toleranceStatusSchema.optional(), mre: toleranceStatusSchema.optional(), mape: toleranceStatusSchema.optional(), nse: toleranceStatusSchema.optional(), trend: toleranceStatusSchema.optional() })
})

const recordDatasetSchema = z.object({
  name: z.string().max(100),
  fileName: z.string().max(200),
  timeUnit: z.enum(['day', 'week', 'month']),
  offsetDay: finite,
  unmapped: z.number().int().min(0),
  columns: z.array(recordColumnSchema).max(MAX_DATASET_COLUMNS),
  overall: nullableNumber,
  completion: z.object({ simulated: nullableNumber, actual: finite, days: nullableNumber, percent: nullableNumber }).nullable()
})

const structureStatusSchema = z.enum(['pass', 'warn', 'fail', 'info'])

const reportSchema = z.object({
  generatedAt: z.string().max(40),
  model: z.object({ id: z.string().min(1), version: z.number().int().positive() }),
  target: z.object({ id: z.string().regex(/^(@base|[A-Za-z0-9_-]{1,40})$/), name: z.string().max(100) }),
  run: z.object({ end: finite, dt: finite, seed: finite }),
  tolerances: z.object({ nrmse: finite.optional(), mre: finite.optional(), mape: finite.optional(), nse: finite.optional(), trend: finite.optional() }),
  data: z.array(recordDatasetSchema).max(MAX_DATASETS),
  extremes: z
    .object({
      total: z.number().int().min(0),
      counts: z.object({ pass: z.number().int().min(0), warn: z.number().int().min(0), fail: z.number().int().min(0), info: z.number().int().min(0) }),
      failures: z.array(z.object({ param: z.string().max(100), value: finite, reason: z.string().max(500) })).max(MAX_RECORD_ITEMS)
    })
    .nullable(),
  structure: z
    .array(
      z.object({
        id: z.string().max(10),
        title: z.string().max(100),
        status: structureStatusSchema,
        summary: z.string().max(500),
        items: z.array(z.string().max(500)).max(MAX_RECORD_ITEMS),
        notChecked: z.array(z.string().max(500)).max(MAX_RECORD_ITEMS)
      })
    )
    .max(10)
    .nullable(),
  checklist: z.array(checklistEntrySchema).max(MAX_CHECKLIST_ENTRIES),
  /** 기록을 만들 때 있던 보정 프리셋의 요약(보정에 쓴 데이터·목적함수·시간 분할 결과). 이전 기록에는 없다 */
  presets: z
    .array(z.object({ name: z.string().max(100), dataset: z.string().max(100), params: z.record(z.string(), finite), objective: finite.nullable(), valObjective: finite.nullable(), split: finite.nullable(), at: z.string().max(40) }))
    .max(MAX_PRESETS)
    .default([])
})

export type ReportFile = z.infer<typeof reportSchema>

const datasetColumnSchema = z.object({
  /** CSV의 열 이름 */
  name: z.string().min(1).max(200),
  /** 비교할 모델 변수. 없으면(null) 비교에서 제외 */
  variable: z.string().min(1).nullable(),
  /** 값 배율(단위 변환). 관측 값에 곱한다 */
  scale: finite,
  /** [데이터 시각, 값] */
  points: z.array(z.tuple([finite, finite])).max(MAX_COLUMN_POINTS)
})

const datasetSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, '영문자·숫자·_·-로 1~40자여야 합니다'),
  name: z.string().min(1).max(100),
  fileName: z.string().max(200),
  timeUnit: z.enum(['day', 'week', 'month']),
  /** 실제 프로젝트 시작일 − 시뮬레이션 0일(일) */
  offsetDay: finite,
  /** 실제 완료일(데이터 시각 단위가 아니라 시뮬레이션 일). 없으면 null */
  actualCompletionDay: finite.nullable().default(null),
  columns: z.array(datasetColumnSchema).max(MAX_DATASET_COLUMNS)
})

export type DatasetFile = z.infer<typeof datasetSchema>

/**
 * 모델 검증 설정(설계 07의 8장). 데이터셋과 허용 기준, 비교 대상을 저장한다. 값의 내용(모델에 있는 변수, 배율의 부호)은
 * 앱이 열 때 검사해 잘못된 항목을 정리하고 경고한다. 허용 기준은 사용자가 정한 것만 담는다(기본값 없음).
 */
const validationSchema = z
  .object({
    datasets: z.array(datasetSchema).max(MAX_DATASETS),
    tolerances: z.object({ nrmse: finite.optional(), mre: finite.optional(), mape: finite.optional(), nse: finite.optional(), trend: finite.optional() }).default({}),
    /** 비교 대상: `@base`(기준) 또는 시나리오 id */
    targetScenarioId: z.string().regex(/^(@base|[A-Za-z0-9_-]{1,40})$/, '시나리오 id 형식이 올바르지 않습니다').default('@base'),
    /** 수동 체크리스트(처음 상태가 아닌 항목만). 내용(알려진 항목 id)은 앱이 열 때 검사한다 */
    checklist: z.array(checklistEntrySchema).max(MAX_CHECKLIST_ENTRIES).default([]),
    /** 보정 프리셋(최대 20개). 없으면 빈 목록 */
    presets: z.array(presetSchema).max(MAX_PRESETS).default([]),
    /** 검증 기록(마지막으로 만든 것 하나). 없으면 null */
    report: reportSchema.nullable().default(null)
  })
  .superRefine((v, ctx) => {
    const presetIds = new Set<string>()
    v.presets.forEach((p, i) => {
      if (presetIds.has(p.id)) ctx.addIssue({ code: 'custom', path: ['presets', i, 'id'], message: `프리셋 id '${p.id}'가 겹칩니다` })
      presetIds.add(p.id)
    })
    const checkIds = new Set<string>()
    v.checklist.forEach((c, i) => {
      if (checkIds.has(c.id)) ctx.addIssue({ code: 'custom', path: ['checklist', i, 'id'], message: `체크리스트 항목 '${c.id}'가 겹칩니다` })
      checkIds.add(c.id)
    })
    const ids = new Set<string>()
    let total = 0
    v.datasets.forEach((d, i) => {
      if (ids.has(d.id)) ctx.addIssue({ code: 'custom', path: ['datasets', i, 'id'], message: `id '${d.id}'가 겹칩니다` })
      ids.add(d.id)
      total += d.columns.reduce((s, c) => s + c.points.length, 0)
    })
    if (total > MAX_DATASET_POINTS_TOTAL) ctx.addIssue({ code: 'custom', path: ['datasets'], message: `데이터 점이 너무 많습니다(합계 ${total}, 최대 ${MAX_DATASET_POINTS_TOTAL})` })
  })

export type ValidationFile = z.infer<typeof validationSchema>

/** 보고서 설정(RPT-07): 종류·제목·작성자·절 선택·차트 크기. 결과는 저장하지 않는다. 내용 검사는 앱이 한다(모르는 값은 버리고 경고). */
const reportsSchema = z.object({
  kind: z.string().max(40),
  title: z.string().max(200),
  author: z.string().max(100),
  sections: z.record(z.string().max(40), z.boolean()).refine((r) => Object.keys(r).length <= 40, '절 선택이 너무 많습니다'),
  includeStale: z.boolean(),
  chartSize: z.enum(['normal', 'large'])
})
export type ReportsFile = z.infer<typeof reportsSchema>

/** 프로젝트 파일(*.spd.json). 사람이 읽을 수 있는 JSON이며 `schemaVersion`으로 마이그레이션한다. */
export const projectFileSchema = z
  .object({
    schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
    meta: z.object({
      name: z.string().min(1).max(200),
      /** 프로젝트 설명(PRJ-01). 없으면 설명이 없는 것 */
      description: z.string().max(MAX_DESCRIPTION).optional(),
      createdAt: z.string(),
      updatedAt: z.string()
    }),
    model: z.object({
      id: z.string().min(1),
      version: z.number().int().positive(),
      /** 사용자 모델의 문서(설계 08의 4.1). 모델 id가 `user-`로 시작하면 반드시 있다. 구조만 여기서 보고 엔진 검증은 앱이 한다. */
      custom: modelDocSchema.optional()
    }),
    /** 모델 상수 덮어쓰기(폼 입력). 시나리오의 기준이 되는 기본 설정이다. */
    params: z.record(z.string(), finite),
    /** 실행 설정 */
    run: z.object({
      end: finite.optional(),
      dt: finite.optional(),
      seed: z.number().int().optional()
    }),
    ui: z.object({ chartVariable: z.string().optional() }).optional(),
    scenarios: z.array(scenarioSchema).max(MAX_SCENARIOS),
    /** 채택 계획(기준선 스냅샷). 없으면 null. */
    adopted: adoptedSchema.nullable(),
    /** 실적(보고일별 누적값). 없으면 빈 목록 */
    actuals: z.array(actualRowSchema).max(MAX_ACTUAL_ROWS).default([]),
    /** 경고 임계값·구간 설정. 내용 검사는 앱이 한다(잘못되면 기본값으로 돌리고 경고) */
    evm: evmSchema.default(DEFAULT_EVM_FILE),
    /** 기준선 개정 이력(오래된 것부터). 없으면 빈 목록 */
    revisions: z.array(revisionSchema).max(MAX_REVISIONS).default([]),
    /** 위험 분석 설정. 없으면 null(설정 없음) */
    risk: riskSchema.nullable().default(null),
    /** 모델 검증 설정(데이터셋·허용 기준). 없으면 null */
    validation: validationSchema.nullable().default(null),
    /** 보고서 설정. 없으면 null(처음 값) */
    reports: reportsSchema.nullable().default(null)
  })
  .superRefine((file, ctx) => {
    if (isUserModelId(file.model.id) && !file.model.custom) {
      ctx.addIssue({ code: 'custom', path: ['model', 'custom'], message: `사용자 모델('${file.model.id}')의 정의가 파일에 없습니다` })
    }
    const ids = new Set<string>()
    const names = new Set<string>()
    file.scenarios.forEach((s, i) => {
      if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['scenarios', i, 'id'], message: `id '${s.id}'가 겹칩니다` })
      if (names.has(s.name)) ctx.addIssue({ code: 'custom', path: ['scenarios', i, 'name'], message: `이름 '${s.name}'이(가) 겹칩니다` })
      ids.add(s.id)
      names.add(s.name)
    })
    file.revisions.forEach((r, i) => {
      if (r.number !== i + 1) ctx.addIssue({ code: 'custom', path: ['revisions', i, 'number'], message: `개정 번호는 ${i + 1}이어야 합니다` })
      if (i > 0 && !(r.day > (file.revisions[i - 1] as { day: number }).day)) {
        ctx.addIssue({ code: 'custom', path: ['revisions', i, 'day'], message: '개정 시점은 이전 개정보다 늦어야 합니다' })
      }
    })
    if (file.revisions.length > 0 && file.adopted === null) {
      ctx.addIssue({ code: 'custom', path: ['revisions'], message: '채택 계획이 없으면 개정 이력을 둘 수 없습니다' })
    }
  })

export type ProjectFile = z.infer<typeof projectFileSchema>

type Raw = Record<string, unknown>

/** 버전 N → N+1 변환. 순수 함수이며 검증은 하지 않는다(변환 뒤 최신 스키마가 검증한다). */
const MIGRATIONS: Record<number, (raw: Raw) => Raw> = {
  // 1 → 2: 시나리오 없음, 채택 계획 없음
  1: (raw) => ({ ...raw, schemaVersion: 2, scenarios: [], adopted: null }),
  // 2 → 3: 사용자 모델 내장(`model.custom`)이 생겼을 뿐 기존 필드는 그대로다
  2: (raw) => ({ ...raw, schemaVersion: 3 })
}

/**
 * 오래된 파일을 최신 버전으로 올린다. 버전을 알 수 없으면(없음, 정수 아님, 변환 정의 없음) 그대로 돌려주어
 * 최신 스키마 검증이 오류로 알리게 한다. `from`은 변환을 시작한 버전이고, 변환하지 않았으면 `undefined`.
 */
export function migrateProject(raw: Raw): { raw: Raw; from?: number } {
  const start = raw['schemaVersion']
  if (typeof start !== 'number' || !Number.isInteger(start) || start >= PROJECT_SCHEMA_VERSION) return { raw }
  let current = raw
  let version = start
  while (version < PROJECT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) return { raw }
    current = step(current)
    version++
  }
  return { raw: current, from: start }
}

export type ParseResult =
  | { ok: true; project: ProjectFile; migratedFrom?: number }
  | { ok: false; message: string }

/** 파일 내용을 읽어 검증한다. 오류는 사용자에게 보여줄 한국어 메시지로 돌려준다. */
export function parseProjectJson(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'JSON 형식이 아니어서 프로젝트 파일로 읽을 수 없습니다.' }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: '프로젝트 파일 형식이 아닙니다.' }
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion
  if (typeof version === 'number' && version > PROJECT_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `이 파일은 더 새로운 버전(스키마 ${version})에서 만들어졌습니다. 이 앱은 스키마 ${PROJECT_SCHEMA_VERSION}까지 읽을 수 있습니다.`
    }
  }
  const { raw: migrated, from } = migrateProject(raw as Raw)
  const parsed = projectFileSchema.safeParse(migrated)
  if (parsed.success) return { ok: true, project: parsed.data, ...(from !== undefined ? { migratedFrom: from } : {}) }
  const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(최상위)'}: ${i.message}`)
  return { ok: false, message: `프로젝트 파일 내용이 올바르지 않습니다. ${issues.join('; ')}` }
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(project, null, 2) + '\n'
}
