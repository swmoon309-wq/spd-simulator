import type { RunResult } from '@spd/sd-engine'
import { valueAt } from '../scenario/kpi'
import { evmSeries, type ActualRow, type EvmPoint, type RowIssues } from './actuals'
import { evAt, pvAt, type Baseline, type EvmCredit } from './baseline'
import type { Cumulative } from './indicators'

export const MAX_REVISIONS = 20
export const MAX_REVISION_REASON = 200

/**
 * 기준선 개정 하나(설계 05의 8.3). 개정 시점(`day`) 이후에 쓰는 새 기준선을 담고, 과거 기준선(원 기준선과 이전 개정)은
 * 그대로 둔다. 진척 인정 규칙과 총 태스크는 원 기준선의 것을 이어 쓴다.
 */
export interface Revision {
  /** 1부터 이어지는 개정 번호 */
  number: number
  revisedAt: string
  /** 개정 시점(보고일, 일) */
  day: number
  /** 사유(필수) */
  reason: string
  /** 채택한 조치. 조치 없이 재예측만으로 개정하면 null */
  action: { kind: string; label: string; values: Record<string, number>; day: number } | null
  /** 후보를 계산할 때 쓴 생산성 보정 계수 */
  kappa: number
  before: { plannedCompletion: number; bac: number }
  after: { plannedCompletion: number; bac: number }
  /** 개정 시점의 획득 가치(= 새 계획 가치의 시작값)와 실제 공수 */
  ev0: number
  ac0: number
  /** 새 기준선. 시계열은 `day`에서 시작한다. */
  baseline: Pick<Baseline, 'bac' | 'plannedCompletion' | 'series'>
}

export class RevisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RevisionError'
  }
}

export interface BuildRevisionInput {
  /** 개정 직전에 쓰던 기준선(원 기준선 또는 이전 개정) */
  current: Baseline
  /** 채택한 후보의 이어 실행 결과(보고일부터 종료 시각까지) */
  tail: RunResult
  credits: EvmCredit[]
  totalTasks: number
  effortVariable: string
  /** 후보의 완료 시각. 끝나지 않는 후보로는 개정할 수 없다. */
  completion: number | null
  /** 개정 시점(보고일)과 그때의 실적 */
  day: number
  /** 그 보고일의 실적 진척률(실적의 단계별 누적 태스크로 만든 값) */
  progress: number
}

/**
 * 후보의 결과로 개정 기준선을 만든다(설계 05의 8.3).
 *
 *   BAC_rev   = 후보의 완료 시점 누적 공수(= AC + 후보의 남은 예상 공수)
 *   PV_rev(t) = EV(t_rev) + (BAC_rev − EV(t_rev)) × (후보의 이후 진척 비율)    (t ≥ t_rev)
 *
 * 개정 직후 PV = EV이므로 SPI가 1에서 다시 시작한다. 진척률 곡선은 후보의 실제 진척(인정 비율로 환산)이라 이후 EV는
 * 개정 기준선에서 "같은 진척에 도달할 때까지의 계획 공수"로 읽는다.
 */
export function buildRevisionBaseline(input: BuildRevisionInput): { baseline: Revision['baseline']; ev0: number } {
  const { current, tail, credits, totalTasks, effortVariable, completion, day, progress } = input
  if (completion === null) throw new RevisionError('끝나지 않는 후보로는 개정할 수 없습니다')
  const ev0 = evAt(current, progress)
  const bac = valueAt(tail, effortVariable, completion)
  if (!(bac > ev0)) throw new RevisionError(`후보의 총 공수(${Math.round(bac)})가 현재 획득 가치(${Math.round(ev0)}) 이하라 개정할 수 없습니다`)

  const p = (t: number) => credits.reduce((s, c) => s + c.weight * valueAt(tail, c.variable, t), 0) / totalTasks
  const pEnd = p(completion)
  const p0 = p(day)
  if (!(pEnd > p0 + 1e-9)) throw new RevisionError('후보에서 남은 진척이 없어 개정할 수 없습니다')

  const time: number[] = []
  const prog: number[] = []
  const effort: number[] = []
  const push = (t: number) => {
    const pt = Math.min(pEnd, Math.max(p0, p(t)))
    time.push(Number(t.toFixed(6)))
    prog.push(Number(pt.toFixed(6)))
    effort.push(Number((ev0 + ((bac - ev0) * (pt - p0)) / (pEnd - p0)).toFixed(6)))
  }
  push(day)
  for (let t = Math.floor(day) + 1; t < completion - 1e-9; t++) if (t > day) push(t)
  push(completion)
  return { baseline: { bac: Number(bac.toFixed(6)), plannedCompletion: Number(completion.toFixed(6)), series: { time, progress: prog, effort } }, ev0 }
}

/** 개정 기준선을 계산에 쓰는 `Baseline` 모양으로 만든다(진척 인정 규칙과 총 태스크는 원 기준선의 것). */
export function revisionAsBaseline(original: Baseline, rev: Pick<Revision, 'baseline'>): Baseline {
  return { credits: original.credits, totalTasks: original.totalTasks, bac: rev.baseline.bac, plannedCompletion: rev.baseline.plannedCompletion, series: rev.baseline.series }
}

/** 보고일에 쓰는 기준선: 그날보다 **앞선** 시점에 개정한 것 중 가장 최근 개정(개정일 당일은 이전 기준선). */
export function revisionIndexFor(revisions: Pick<Revision, 'day'>[], day: number): number {
  let idx = -1
  revisions.forEach((r, i) => {
    if (r.day < day) idx = i
  })
  return idx
}

/**
 * 개정을 반영한 보고일별 지표. 개정 시점 이후의 보고일은 그 개정 기준선으로, 그 전은 원래 기준선으로 계산한다(과거의 지표는
 * 바뀌지 않는다). 구간 지수는 같은 기준선 안에서만 세고, 개정 직후에는 개정 시점(PV = EV)에서 출발한다. `original`이 true이면
 * 개정을 무시하고 모든 보고일을 원 기준선으로 계산해 누적 지연을 보인다.
 */
export function evmSeriesRevised(
  original: Baseline,
  revisions: Revision[],
  rows: ActualRow[],
  issues: RowIssues[],
  k: number,
  useOriginal = false
): EvmPoint[] {
  if (useOriginal || revisions.length === 0) return evmSeries(original, rows, issues, k).map((p) => ({ ...p, revision: 0 }))
  const groups: number[][] = revisions.map(() => []).concat([[]]) // 마지막은 원 기준선(-1)
  const original_ = groups.length - 1
  rows.forEach((row, i) => {
    if ((issues[i]?.errors.length ?? 0) > 0) return
    const r = revisionIndexFor(revisions, row.day)
    ;(groups[r < 0 ? original_ : r] as number[]).push(i)
  })
  const out: EvmPoint[] = []
  const compute = (baseline: Baseline, indices: number[], revision: number, origin?: Cumulative) => {
    if (indices.length === 0) return
    const subRows = indices.map((i) => rows[i] as ActualRow)
    const subIssues = indices.map((i) => issues[i] as RowIssues)
    for (const p of evmSeries(baseline, subRows, subIssues, k, origin)) out.push({ ...p, index: indices[p.index] as number, revision })
  }
  compute(original, groups[original_] as number[], 0)
  revisions.forEach((rev, r) => {
    const b = revisionAsBaseline(original, rev)
    compute(b, groups[r] as number[], rev.number, { pv: rev.ev0, ev: rev.ev0, ac: rev.ac0 })
  })
  return out.sort((a, b) => a.day - b.day)
}

/** 점이 속한 기준선(원 기준선 또는 개정). */
export function baselineOfPoint(original: Baseline, revisions: Revision[], point: Pick<EvmPoint, 'revision'>, useOriginal = false): Baseline {
  const n = useOriginal ? 0 : (point.revision ?? 0)
  const rev = revisions.find((r) => r.number === n)
  return n === 0 || !rev ? original : revisionAsBaseline(original, rev)
}

/** 개정 시점의 PV 곡선 이음: 개정 기준선의 PV(`pvAt`)는 시작 전에도 시작값(EV)이므로 그대로 쓰면 된다. */
export function revisedPvAt(original: Baseline, revisions: Revision[], t: number): number {
  const r = revisionIndexFor(revisions, t)
  return r < 0 ? pvAt(original, t) : pvAt(revisionAsBaseline(original, revisions[r] as Revision), t)
}
