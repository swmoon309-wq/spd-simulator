import { rangeOf, valueAt, type ActualRow, type ReforecastOutcome, type ReforecastRun } from '@spd/analysis'
import type { ModelEntry } from '../catalog'
import { evmOf } from '../catalog/evm'
import type { Adopted } from './adoption'

export const KAPPA_LABEL: Record<string, string> = { cum: '누적 CPI', recent: '최근 구간 CPI' }

export interface ReforecastRunView {
  name: string
  label: string
  requested: number
  kappa: number
  clamped: boolean
  /** 예상 완료일. 끝나지 않으면 null */
  completionDay: number | null
  /** 완료 시점의 총 공수(EAC). 끝나지 않으면 null */
  eac: number | null
  /** 보고일부터의 누적 공수 곡선(1일 간격) */
  ac: [number, number][]
}

export interface AssumptionRow {
  name: string
  label: string
  kind: 'observed' | 'derived'
  baseline: number
  value: number
  note: string
}

export interface ReforecastView {
  atDay: number
  runs: ReforecastRunView[]
  completion: { low: number; high: number } | null
  eac: { low: number; high: number } | null
  assumptions: AssumptionRow[]
  /** 기준선 값을 그대로 쓴 Level 이름 */
  estimatedLevels: string[]
}

/** 재예측 입력의 식별 키. 채택·실적 행·구간 수가 같으면 결과를 다시 쓸 수 있다. */
export function reforecastKey(adopted: Adopted, row: ActualRow, k: number): string {
  return JSON.stringify([adopted.scenarioId, adopted.adoptedAt, adopted.revision, row, k])
}

function runView(entry: ModelEntry, run: ReforecastRun): ReforecastRunView {
  const evm = evmOf(entry)
  const completion = evm.completion(run.result)
  const effort = run.result.series[evm.effortVariable] as Float64Array
  const time = run.result.time
  const ac: [number, number][] = []
  const end = completion ?? (time[time.length - 1] as number)
  let nextDay = Math.ceil(time[0] as number)
  for (let i = 0; i < time.length; i++) {
    const t = time[i] as number
    if (t > end + 1e-9) break
    if (i === 0 || t >= nextDay - 1e-9) {
      ac.push([t, effort[i] as number])
      nextDay = Math.floor(t) + 1
    }
  }
  // 완료 시각의 공수는 기준선의 BAC와 같은 방식(시각 보간)으로 읽는다.
  const eac = completion === null ? null : valueAt(run.result, evm.effortVariable, completion)
  // 곡선은 완료 시각의 정확한 값에서 끝난다.
  if (completion !== null && eac !== null && (ac[ac.length - 1] as [number, number])[0] < completion - 1e-9) ac.push([completion, eac])
  return { name: run.name, label: KAPPA_LABEL[run.name] ?? run.name, requested: run.requested, kappa: run.kappa, clamped: run.clamped, completionDay: completion, eac, ac }
}

/** 재예측 결과를 화면에 쓰기 좋게 요약한다: 완료일·EAC 범위, 가정 목록, 누적 공수 곡선. */
export function summarizeReforecast(entry: ModelEntry, outcome: ReforecastOutcome): ReforecastView {
  const runs = outcome.runs.map((r) => runView(entry, r))
  const labelOf = (name: string) => entry.def.constants[name]?.label ?? name
  return {
    atDay: outcome.atDay,
    runs,
    completion: rangeOf(runs[0]?.completionDay ?? null, runs[1]?.completionDay ?? runs[0]?.completionDay ?? null),
    eac: rangeOf(runs[0]?.eac ?? null, runs[1]?.eac ?? runs[0]?.eac ?? null),
    assumptions: outcome.overwrites.map((o) => ({ name: o.name, label: labelOf(o.name), kind: o.kind, baseline: o.baseline, value: o.value, note: o.note })),
    estimatedLevels: outcome.estimatedLevels
  }
}
