import { buildValidationRecord, type DataInput, type ValidationRecord } from '@spd/analysis'
import type { Scenario } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import type { ModelEntry } from '../catalog'
import { riskBaseParams } from './risk'
import type { RunSettings } from './runSettings'
import { BASE_ID, rowStatus, taskFor, type ScenarioRun } from './scenarioRunner'
import type { ValidationSettings } from './validation'
import { extremesKey, structureKey, type ExtremesRun, type StructureRun } from './validationRuns'
import { evaluateDataset } from './validationView'

export interface RecordSources {
  entry: ModelEntry
  params: Record<string, number>
  scenarios: Scenario[]
  runSettings: RunSettings
  validation: ValidationSettings
  scenarioRuns: Record<string, ScenarioRun>
  extremes: ExtremesRun | null
  structure: StructureRun | null
  now: Date
}

/** 기록에 무엇을 넣었고 무엇은 못 넣었는지(화면에서 보인다). */
export interface RecordContents {
  datasets: number
  /** 데이터셋은 있으나 대상 시뮬레이션이 최신이 아니라 넣지 못했는가 */
  dataMissing: boolean
  extremes: boolean
  /** 결과가 있으나 오래되어 넣지 못한 것 */
  extremesStale: boolean
  structure: boolean
  structureStale: boolean
  checklist: number
  /** 기록에 요약으로 넣은 보정 프리셋 수 */
  presets: number
}

export interface RecordResult {
  record: ValidationRecord
  contents: RecordContents
}

/**
 * 지금의 결과로 검증 기록을 만든다(설계 07의 6장). **오래된 결과(입력이 바뀐 뒤의 것)는 넣지 않고** 알린다 — 기록은 "이 모델·이 입력"의
 * 요약이어야 하기 때문이다. 데이터 비교는 대상 시뮬레이션이 최신일 때만 넣는다.
 */
export function buildRecordFromState(src: RecordSources): RecordResult {
  const { entry, validation: v } = src
  const targetId = v.targetScenarioId
  const base = riskBaseParams(src.params, src.scenarios, targetId) ?? src.params
  const target = { id: targetId, name: targetId === BASE_ID ? '기준' : (src.scenarios.find((s) => s.id === targetId)?.name ?? targetId) }

  // 데이터 비교: 대상 시뮬레이션이 최신일 때만
  const task = taskFor({ modelId: entry.id, params: src.params, settings: src.runSettings, scenarios: src.scenarios }, targetId)
  const run = src.scenarioRuns[targetId]
  const fresh = task !== null && rowStatus(run, task.key).kind === 'done' && run?.result
  const data: DataInput[] = []
  if (fresh && run?.result) {
    for (const d of v.datasets) {
      const ev = evaluateDataset(entry, run.result as RunResult, d, v.tolerances, run.resultParams ?? base)
      data.push({
        dataset: { name: d.name, fileName: d.fileName, timeUnit: d.timeUnit, offsetDay: d.offsetDay },
        columns: ev.columns.map((c) => ({ name: c.column.name, variable: c.variable, metrics: c.metrics, status: c.status, outOfRange: c.aligned.outOfRange, invalid: c.aligned.invalid })),
        unmapped: ev.unmapped,
        overall: ev.overall,
        completion: ev.completion
      })
    }
  }

  const exKey = extremesKey(entry, base, src.runSettings)
  const extremesFresh = src.extremes !== null && src.extremes.status !== 'running' && src.extremes.key === exKey
  const stKey = structureKey(entry, base, src.runSettings)
  const structureFresh = src.structure !== null && src.structure.key === stKey

  const record = buildValidationRecord({
    generatedAt: src.now.toISOString(),
    model: { id: entry.id, version: entry.def.meta.version },
    target,
    run: { end: src.runSettings.end, dt: src.runSettings.dt, seed: src.runSettings.seed },
    tolerances: v.tolerances,
    data,
    extremes: extremesFresh && src.extremes ? { cells: src.extremes.cells, total: src.extremes.total } : null,
    structure: structureFresh && src.structure ? src.structure.report.findings : null,
    checklist: v.checklist,
    presets: v.presets.filter((p) => p.modelId === entry.id).map((p) => ({ name: p.name, dataset: p.origin.dataset, params: p.params, objective: p.origin.objective, valObjective: p.origin.valObjective, split: p.origin.split, at: p.origin.at }))
  })
  return {
    record,
    contents: {
      datasets: data.length,
      dataMissing: v.datasets.length > 0 && data.length === 0,
      extremes: extremesFresh,
      extremesStale: src.extremes !== null && !extremesFresh && src.extremes.status !== 'running',
      structure: structureFresh,
      structureStale: src.structure !== null && !structureFresh,
      checklist: v.checklist.length,
      presets: record.presets.length
    }
  }
}

/** 기록에 넣을 내용이 하나도 없으면 이유, 있으면 null. */
export function emptyRecordReason(c: RecordContents): string | null {
  if (c.datasets > 0 || c.extremes || c.structure || c.checklist > 0 || c.presets > 0) return null
  return '기록할 내용이 없습니다. 구조 점검·극단 조건 시험·데이터 비교를 실행하거나 체크리스트를 적은 뒤 만드세요.'
}
