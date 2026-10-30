import type { ExtremeCell, ExtremeInput, ExtremeParam, LevelChange, PerturbSpec, ResponseSummary } from '@spd/analysis'
import type { ConstantChange } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import type { ModelEntry } from '../catalog'
import { paramSpecs } from './params'
import type { RunSettings } from './runSettings'
import type { Dataset } from './validation'

/** 실행 결과의 식별 키. 모델·버전, 대상의 유효 파라미터, 실행 설정(+ 시험 내용)이 같으면 같은 결과다. */
const sorted = (p: Record<string, number>) => Object.fromEntries(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

export function extremesKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>): string {
  return JSON.stringify(['extremes', entry.id, entry.def.meta.version, sorted(base), run.end, run.dt, run.seed])
}

export function perturbKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, spec: PerturbSpec, variables: string[]): string {
  return JSON.stringify(['perturb', entry.id, entry.def.meta.version, sorted(base), run.end, run.dt, run.seed, spec, variables])
}

export function levelsKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, days: number): string {
  return JSON.stringify(['levels', entry.id, entry.def.meta.version, sorted(base), run.dt, run.seed, days])
}

/** 폼의 파라미터와 허용 범위를 극단 조건 계획의 입력으로. */
export function extremeParams(entry: ModelEntry): ExtremeParam[] {
  return paramSpecs(entry).map((s) => ({ name: s.name, min: s.min, max: s.max, ...(s.integer ? { integer: true } : {}) }))
}

/** 극단 조건 실행의 입력. 실행 설정의 종료 시각·dt·시드를 쓴다. */
export function extremeInputFor(model: ExtremeInput['model'], entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>): ExtremeInput {
  return { model, base, options: { end: run.end, dt: run.dt, seed: run.seed }, kpis: entry.kpiSpecs }
}

/** 극단 조건 실행 상태(파일에 저장하지 않는다). */
export interface ExtremesRun {
  key: string
  status: 'running' | 'done' | 'canceled' | 'error'
  done: number
  total: number
  /** 끝난 셀(계획 순서) */
  cells: ExtremeCell[]
  error: string | null
}

/** 교란 시험 결과(파일에 저장하지 않는다). 기준·교란 실행의 시계열은 그래프에 쓰므로 들고 있는다. */
export interface PerturbRun {
  key: string
  spec: PerturbSpec
  variables: string[]
  changes: ConstantChange[]
  base: RunResult
  perturbed: RunResult
  summaries: ResponseSummary[]
}

/** Level 변화 점검 결과. */
export interface LevelCheckRun {
  key: string
  days: number
  rows: LevelChange[]
}

export function structureKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>): string {
  return JSON.stringify(['structure', entry.id, entry.def.meta.version, sorted(base), run.end, run.dt, run.seed])
}

/**
 * 화면과 지표가 읽는 변수. 구조 점검 S5(쓰이지 않는 변수)에서 제외한다: 차트 변수, Earned Value 어댑터가 읽는 변수. 지표 계산 함수가 읽는
 * 변수는 함수 안에 있어 알 수 없으므로, 그런 변수는 모델의 출력(outputs)으로 선언해 두어야 쓰이는 것으로 본다.
 */
export function externallyUsedVariables(entry: ModelEntry): string[] {
  return [...new Set([...entry.variables.map((v) => v.name), ...(entry.evm?.credits.map((c) => c.variable) ?? []), ...(entry.evm ? [entry.evm.effortVariable] : [])])]
}

/** 구조 점검 결과(파일에 저장하지 않는다). */
export interface StructureRun {
  key: string
  report: import('@spd/analysis').StructureReport
}

/** 보정 요청: 어떤 데이터셋의 어떤 열(가중치)을 어떤 파라미터(범위)로 맞출지, 시간 분할을 쓸지. */
export interface CalibrationRequest {
  datasetId: string
  params: import('@spd/analysis').CalibParam[]
  /** 데이터셋의 열 위치와 가중치 */
  columns: { index: number; weight: number }[]
  split: boolean
}

/** 보정 실행 상태와 결과(파일에 저장하지 않는다. 프리셋만 저장한다). */
export interface CalibrationRun {
  key: string
  request: CalibrationRequest
  status: 'running' | 'done' | 'canceled' | 'error'
  progress: import('@spd/analysis').CalibProgress | null
  result: import('@spd/analysis').CalibrationResult | null
  error: string | null
}


/**
 * 보정 결과의 식별 키: 모델·버전, 대상의 유효 파라미터, 실행 설정, 데이터(요약 지문), 요청. 지금 입력의 키와 다르면 결과는 오래된 것이다.
 * 데이터는 점 전체 대신 열별 점 수와 값의 합으로 지문을 만든다.
 */
export function calibrationKey(entry: ModelEntry, base: Record<string, number>, run: Pick<RunSettings, 'end' | 'dt' | 'seed'>, dataset: Dataset | undefined, request: CalibrationRequest): string {
  const fingerprint = dataset
    ? [dataset.id, dataset.timeUnit, dataset.offsetDay, request.columns.map(({ index }) => { const c = dataset.columns[index]; return c ? [c.name, c.variable, c.scale, c.points.length, c.points.reduce((s, [t, v]) => s + t * 31 + v, 0)] : null })]
    : null
  return JSON.stringify(['calibration', entry.id, entry.def.meta.version, sorted(base), run.end, run.dt, run.seed, fingerprint, request])
}
