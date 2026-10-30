import { buildBaseline, diffFromBase, effectiveParams, type Params } from '@spd/analysis'
import type { AdoptedFile } from '../../../shared/projectFile'
import { BASE_SCENARIO_ID, MAX_SCENARIO_NAME, PLAN_CSV_SCENARIO_ID } from '../../../shared/projectFile'
import type { ModelEntry } from '../catalog'
import { controlUnsupported } from '../catalog/evm'
import { formatNumber } from './params'
import type { PlanCurve } from './planCurveCsv'
import { RUN_SETTING_FIELDS } from './runSettings'
import { rowStatus, type RunTask, type ScenarioInputs, type ScenarioRun } from './scenarioRunner'

export type Adopted = AdoptedFile
export { BASE_SCENARIO_ID, PLAN_CSV_SCENARIO_ID }
export type { PlanCurve } from './planCurveCsv'

export type CreateResult = { ok: true; adopted: Adopted } | { ok: false; message: string }

/**
 * 채택 계획(계획 기준선 스냅샷)을 만든다. 현재 입력으로 만든 최신 결과만 채택할 수 있고, 종료 시각 안에
 * 끝나지 않은 실행은 채택할 수 없다(PV의 총량을 정할 수 없다). 설계 04의 5장, 05의 3장.
 */
export function createAdoption(args: {
  entry: ModelEntry
  scenarioId: string
  scenarioName: string
  task: RunTask
  run: ScenarioRun | undefined
  now?: Date
}): CreateResult {
  const { entry, task, run } = args
  const status = rowStatus(run, task.key)
  if (!run?.result) return { ok: false, message: '결과가 없습니다. 먼저 이 시나리오를 실행하세요.' }
  if (status.kind !== 'done') return { ok: false, message: '입력이 바뀌어 결과가 오래되었습니다. 다시 실행한 뒤 채택하세요.' }

  const evm = entry.evm
  if (!evm) return { ok: false, message: controlUnsupported(entry) as string }
  const completion = evm.completion(run.result)
  if (completion === null) return { ok: false, message: '종료 시각 안에 끝나지 않아 채택할 수 없습니다. 종료 시각을 늘려 다시 실행하세요.' }

  try {
    const baseline = buildBaseline(run.result, {
      credits: evm.credits.map(({ variable, weight }) => ({ variable, weight })),
      totalTasks: evm.totalTasks(task.params),
      effortVariable: evm.effortVariable,
      completion
    })
    return {
      ok: true,
      adopted: {
        scenarioId: args.scenarioId,
        scenarioName: args.scenarioName,
        adoptedAt: (args.now ?? new Date()).toISOString(),
        revision: 0,
        model: { id: entry.id, version: entry.def.meta.version },
        params: { ...task.params },
        run: { ...task.settings },
        ...baseline
      }
    }
  } catch (e) {
    return { ok: false, message: `기준선을 만들 수 없습니다: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * 계획서의 계획 곡선(CSV)으로 채택 계획을 만든다(CTL-11). PV·진척 곡선과 총 예산·계획 완료일은 곡선에서 오고, 진척 인정 규칙과 총 태스크는
 * 지금 모델·파라미터의 것을 쓴다. 어느 시나리오에서 나온 것이 아니므로 `scenarioId`는 `PLAN_CSV_SCENARIO_ID`이다.
 */
export function createAdoptionFromPlan(args: {
  entry: ModelEntry
  params: Params
  settings: ScenarioInputs['settings']
  curve: PlanCurve
  fileName: string
  now?: Date
}): CreateResult {
  const { entry, curve } = args
  const evm = entry.evm
  if (!evm) return { ok: false, message: controlUnsupported(entry) as string }
  return {
    ok: true,
    adopted: {
      scenarioId: PLAN_CSV_SCENARIO_ID,
      scenarioName: `계획 곡선: ${args.fileName}`.slice(0, MAX_SCENARIO_NAME),
      adoptedAt: (args.now ?? new Date()).toISOString(),
      revision: 0,
      model: { id: entry.id, version: entry.def.meta.version },
      params: { ...args.params },
      run: { ...args.settings },
      credits: evm.credits.map(({ variable, weight }) => ({ variable, weight })),
      totalTasks: evm.totalTasks(args.params),
      bac: curve.bac,
      plannedCompletion: curve.plannedCompletion,
      series: { time: [...curve.series.time], progress: [...curve.series.progress], effort: [...curve.series.effort] }
    }
  }
}

export interface DriftChange {
  /** 변경된 항목의 이름(파라미터 이름 또는 `run:end` 등) */
  key: string
  label: string
  /** 채택 시점의 값 */
  adopted: string
  /** 지금의 값 */
  current: string
}

export interface AdoptionStatus {
  /** 채택한 시나리오(또는 기준)가 지금도 있다 */
  linked: boolean
  /** 채택 이후 달라진 항목. 비어 있으면 현재 입력이 스냅샷과 같다 */
  changes: DriftChange[]
}

/**
 * 채택 이후 입력이 바뀌었는지 판정한다. 채택한 시나리오의 현재 유효 파라미터, 실행 설정, 모델 버전을
 * 스냅샷과 비교한다. 스냅샷에는 없는 항목(모델에 나중에 생긴 파라미터)은 비교하지 않는다.
 */
export function adoptionStatus(adopted: Adopted, inputs: ScenarioInputs, entry: ModelEntry): AdoptionStatus {
  let current: Params
  // 계획 곡선(CSV)에서 만든 계획은 입력에서 나온 것이 아니라서 입력이 바뀐 것은 비교하지 않고 모델 버전만 본다.
  if (adopted.scenarioId === PLAN_CSV_SCENARIO_ID) {
    return { linked: true, changes: adopted.model.version !== entry.def.meta.version ? [{ key: 'model:version', label: '모델 버전', adopted: String(adopted.model.version), current: String(entry.def.meta.version) }] : [] }
  }
  if (adopted.scenarioId === BASE_SCENARIO_ID) current = inputs.params
  else {
    const scenario = inputs.scenarios.find((s) => s.id === adopted.scenarioId)
    if (!scenario) return { linked: false, changes: [] }
    current = effectiveParams(inputs.params, scenario)
  }

  const changes: DriftChange[] = diffFromBase(adopted.params, { overrides: current }).map((d) => {
    const c = entry.def.constants[d.name]
    return {
      key: d.name,
      label: c?.label ?? d.name,
      adopted: `${formatNumber(d.base)}${c?.unit ? ` ${c.unit}` : ''}`,
      current: `${formatNumber(d.value)}${c?.unit ? ` ${c.unit}` : ''}`
    }
  })
  for (const f of RUN_SETTING_FIELDS) {
    const was = adopted.run[f.key]
    const now = inputs.settings[f.key]
    if (was !== now) changes.push({ key: `run:${f.key}`, label: f.label, adopted: `${formatNumber(was)}${f.unit ? ` ${f.unit}` : ''}`, current: `${formatNumber(now)}${f.unit ? ` ${f.unit}` : ''}` })
  }
  if (adopted.model.version !== entry.def.meta.version) {
    changes.push({ key: 'model:version', label: '모델 버전', adopted: String(adopted.model.version), current: String(entry.def.meta.version) })
  }
  return { linked: true, changes }
}

/** 한 줄 요약: "계획 완료 314.3일 · 예산 1,224 맨데이". */
export function adoptionSummary(adopted: Adopted): string {
  return `계획 완료 ${formatNumber(Number(adopted.plannedCompletion.toFixed(1)))}일 · 예산 ${Math.round(adopted.bac).toLocaleString('ko-KR')} 맨데이`
}
