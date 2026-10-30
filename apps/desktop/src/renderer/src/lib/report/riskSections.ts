import { COARSE_ITERATIONS, rankTornado, SUMMARY_PERCENTILES, type KpiSpec, type McResult } from '@spd/analysis'
import type { Block, Cell } from '../../../../shared/reportDoc'
import type { ModelEntry } from '../../catalog'
import { compareCdfOption, confidenceLabel, confidenceOption, convergenceOption, histogramLabel, histogramOption, rankHeight, rankLabel, rankOption, tornadoHeight, tornadoLabel, tornadoOption } from '../charts/riskOptions'
import { formatNumber } from '../params'
import { scenarioColor } from '../palette'
import { compareSentence, compareView, convergenceView, distText, distributionView, oatBars, pct, requiredIterations, targetView, tornadoDisagreement } from '../riskView'
import { BASE_ID } from '../scenarioRunner'
import { formatValue } from '../scenarioCompare'
import { renderChartSvg } from './chartSvg'
import type { ReportOptions, ReportState } from './model'
import { unavailable, type Built } from './sections'

/** 결과 옆에 항상 붙는 가정 안내(설계 06의 0장, 설계 09의 0장). 위험 분석 절 머리에 고정이다. */
export const RISK_ASSUMPTION =
  '이 확률은 입력 분포를 가정했을 때 이 모델이 내는 값이며 실제 프로젝트의 확률이 아닙니다. 입력 분포는 사용자가 정한 가정입니다. 절대값보다 시나리오 사이의 상대 비교를 먼저 보세요.'

/** 위험 분석에서 대표로 보는 지표: 일정 그룹의 첫 지표(없으면 첫 지표). */
export function primaryKpi(entry: ModelEntry): KpiSpec {
  return entry.kpiSpecs.find((k) => k.group === 'schedule') ?? (entry.kpiSpecs[0] as KpiSpec)
}

const assumption = (entry: ModelEntry): Block => ({
  kind: 'callout',
  tone: 'warning',
  title: '가정입니다',
  text: `${RISK_ASSUMPTION}${entry.id === 'integrated-project' ? ' 통합 프로젝트 모델은 보정되지 않았습니다.' : entry.id === 'integrated-project-ai' ? ' 통합 프로젝트 + AI 보조 모델은 보정되지 않았고 AI 항목은 문헌 범위의 가정입니다.' : entry.category === 'user' ? ' 사용자 모델은 보정·검증되지 않았을 수 있습니다.' : ''}`
})

interface RunInfo {
  result: McResult | null
  status: 'fresh' | 'stale' | 'missing'
  reason: string | null
}

/** 위험 분석 실행 결과의 신선도: 없음, 오래됨(입력이 바뀜·취소됨), 최신. */
export function runInfo(state: ReportState): RunInfo {
  const { run, stale } = state.risk
  if (!run) return { result: null, status: 'missing', reason: '위험 분석을 실행하지 않았습니다. 위험 분석 탭에서 실행하거나 "필요한 결과 만들기"를 누르세요.' }
  if (run.status === 'running') return { result: null, status: 'missing', reason: '위험 분석이 실행 중입니다. 끝난 뒤에 다시 만드세요.' }
  if (run.status === 'error') return { result: null, status: 'missing', reason: `위험 분석을 실행하지 못했습니다: ${run.error ?? '알 수 없는 오류'}` }
  if (!run.result) return { result: null, status: 'missing', reason: '위험 분석 결과가 없습니다.' }
  if (stale.run) return { result: run.result, status: 'stale', reason: '입력이 바뀌어 위험 분석 결과가 오래되었습니다' }
  if (run.status === 'canceled') return { result: run.result, status: 'stale', reason: `취소되어 ${run.completed}/${run.total}회까지의 결과입니다` }
  return { result: run.result, status: 'fresh', reason: null }
}

/** 오래됨이면 숫자 없이 이유만(기본), `includeStale`이면 경고와 함께 진행한다. 진행해도 되면 null. */
function gate(info: { status: 'fresh' | 'stale' | 'missing'; reason: string | null }, options: ReportOptions, what: string): { stop: Built } | { callout: Block | null } {
  if (info.status === 'missing') return { stop: unavailable('missing', info.reason as string) }
  if (info.status === 'stale' && !options.includeStale) return { stop: unavailable('stale', `${info.reason}. ${what}을(를) 싣지 않았습니다(오래된 결과를 새것처럼 싣지 않습니다). "필요한 결과 만들기"로 다시 만들거나 "오래된 결과 포함"을 켜세요.`) }
  return { callout: info.status === 'stale' ? { kind: 'callout', tone: 'warning', title: '오래된 결과 포함', text: info.reason as string } : null }
}

const f1 = (spec: KpiSpec) => (v: number) => formatValue(spec, v)

// ---------- 불확실한 입력 ----------

export function riskInputsSection(state: ReportState): Built {
  const { settings } = state.risk
  const { entry, scenarios } = state
  if (settings.inputs.length === 0) return unavailable('na', '불확실한 입력이 없습니다. 위험 분석 탭에서 입력과 분포를 정하세요.')
  const target = settings.scenarioId === BASE_ID ? '기준' : (scenarios.find((s) => s.id === settings.scenarioId)?.name ?? settings.scenarioId)
  const rows: Cell[][] = settings.inputs.map((i) => {
    const c = entry.def.constants[i.name]
    return [c?.label ?? i.name, distText(i.dist), c?.unit ?? '']
  })
  return {
    status: 'fresh',
    reason: null,
    blocks: [
      assumption(entry),
      { kind: 'keyValues', rows: [['대상', target], ['반복 수', `${settings.n}회`], ['시드', String(settings.seed)]] },
      { kind: 'table', caption: '불확실한 입력과 분포(가정)', columns: [{ label: '입력' }, { label: '분포' }, { label: '단위' }], rows }
    ]
  }
}

// ---------- 결과 분포 ----------

export function riskResultsSection(state: ReportState, options: ReportOptions): Built {
  const info = runInfo(state)
  const g = gate(info, options, '위험 분석 결과')
  if ('stop' in g) return g.stop
  const result = info.result as McResult
  const { entry } = state
  const spec = primaryKpi(entry)
  const view = distributionView(result, spec.id)
  const f = f1(spec)
  const blocks: Block[] = [assumption(entry)]
  if (g.callout) blocks.push(g.callout)
  blocks.push({ kind: 'keyValues', rows: [['반복', `${result.completed}회 (성공 ${view.dist.nFailed === 0 ? result.completed : result.completed - view.dist.nFailed}회)`], ['대표 지표', spec.label]] })
  if (result.completed < COARSE_ITERATIONS) blocks.push({ kind: 'paragraph', tone: 'note', text: `반복이 ${COARSE_ITERATIONS}회 미만이라 분포가 거칠 수 있습니다.` })
  if (view.dist.nFailed > 0) blocks.push({ kind: 'paragraph', tone: 'warning', text: `수치 오류로 ${view.dist.nFailed}회를 제외했습니다.` })
  if (view.dist.nUndefined > 0) blocks.push({ kind: 'paragraph', tone: 'note', text: `종료 시각 안에 ${spec.label}을(를) 정할 수 없는 반복이 ${view.dist.nUndefined}회(${(view.dist.undefinedRate * 100).toFixed(1)}%) 있습니다. 분포는 정할 수 있는 ${view.dist.summary.n}회만의 분포입니다.` })
  if (view.dist.summary.n === 0) {
    blocks.push({ kind: 'paragraph', text: `${spec.label}을(를) 계산할 수 있는 반복이 없습니다.` })
  } else {
    const w = options.chartSize === 'large' ? 860 : 720
    const hist = histogramOption(view, spec, false)
    const conf = confidenceOption(view, spec, state.risk.settings.targets.filter((t) => t.kpi === spec.id).map((t) => t.value), false)
    if (hist) {
      blocks.push({
        kind: 'chart',
        title: `${spec.label} 분포(히스토그램)`,
        alt: histogramLabel(view, spec),
        svg: renderChartSvg(hist, w, 300),
        table: { kind: 'table', caption: '히스토그램 값', columns: [{ label: '구간' }, { label: '반복 수', align: 'right' }, { label: '비율', align: 'right' }], rows: view.bars.map((b): Cell[] => [`${b.from.toFixed(spec.decimals)} ~ ${b.to.toFixed(spec.decimals)}`, String(b.count), `${(b.share * 100).toFixed(1)}%`]) }
      })
    }
    if (conf) {
      blocks.push({
        kind: 'chart',
        title: `${spec.label} 신뢰 수준(이 값 이하로 끝날 확률)`,
        alt: confidenceLabel(view, spec),
        svg: renderChartSvg(conf, w, 300),
        table: { kind: 'table', caption: '핵심 분위수', columns: [{ label: '분위수' }, { label: spec.label, align: 'right' }, { label: '95% 구간', align: 'right' }], rows: view.quantiles.map((q): Cell[] => [q.label, f(q.value), `${f(q.ci.low)} ~ ${f(q.ci.high)}`]) }
      })
    }
    const d = view.dist
    blocks.push({
      kind: 'table',
      caption: `${spec.label} 요약 통계`,
      columns: [{ label: '통계' }, { label: '값', align: 'right' }, { label: '95% 구간' }],
      rows: [
        ['평균', f(d.summary.mean), `${f(d.meanCI.low)} ~ ${f(d.meanCI.high)}`],
        ['표준편차', f(d.summary.sd), ''],
        ['최소', f(d.summary.min), ''],
        ['최대', f(d.summary.max), ''],
        ...SUMMARY_PERCENTILES.map((p): Cell[] => [`P${Math.round(p * 100)}`, f(d.summary.percentiles[String(p)] as number), ''])
      ]
    })
    if (view.quantiles.length === 3) blocks.push({ kind: 'paragraph', tone: 'note', text: `여유(P80 − P50) ${f(view.quantiles[1]!.value - view.quantiles[0]!.value)}` })
  }

  // 지표별 한눈 표
  const rows: Cell[][] = entry.kpiSpecs.map((k) => {
    const v = distributionView(result, k.id)
    if (v.dist.summary.n === 0) return [k.label, '–', '–', '–', '–']
    const g2 = f1(k)
    return [k.label, g2(v.dist.summary.mean), ...v.quantiles.map((q) => g2(q.value))]
  })
  blocks.push({ kind: 'table', caption: '모든 지표의 평균과 P50·P80·P90', columns: [{ label: '지표' }, { label: '평균', align: 'right' }, { label: 'P50', align: 'right' }, { label: 'P80', align: 'right' }, { label: 'P90', align: 'right' }], rows })
  return { status: info.status, reason: info.reason, blocks }
}

// ---------- 목표 달성 확률 ----------

export function riskTargetsSection(state: ReportState, options: ReportOptions): Built {
  const { targets } = state.risk.settings
  if (targets.length === 0) return unavailable('na', '목표가 없습니다. 위험 분석 탭의 목표에서 목표를 정하면 달성 확률을 싣습니다.')
  const info = runInfo(state)
  const g = gate(info, options, '목표 달성 확률')
  if ('stop' in g) return g.stop
  const result = info.result as McResult
  const { entry } = state
  const specOf = (id: string): KpiSpec => entry.kpiSpecs.find((k) => k.id === id) ?? (entry.kpiSpecs[0] as KpiSpec)
  const view = targetView(result, targets)
  const rows: Cell[][] = view.rows.map((r) => {
    const spec = specOf(r.target.kpi)
    return [spec.label, `${r.target.op === '<=' ? '≤' : '≥'} ${formatValue(spec, r.target.value)}`, { text: pct(r.prob.p), tone: 'strong' as const }, `${pct(r.prob.low)} ~ ${pct(r.prob.high)} (${r.prob.met}/${r.prob.n}회)`]
  })
  const blocks: Block[] = [assumption(entry)]
  if (g.callout) blocks.push(g.callout)
  blocks.push({ kind: 'table', caption: '목표별 달성 확률', columns: [{ label: '지표' }, { label: '조건' }, { label: '달성 확률', align: 'right' }, { label: 'Wilson 95% 구간' }], rows, note: '종료 시각 안에 끝나지 않은 반복은 목표를 만족하지 못한 것으로 셉니다.' })
  if (view.joint) blocks.push({ kind: 'paragraph', text: `모두 함께 달성할 확률 ${pct(view.joint.p)} (95% 구간 ${pct(view.joint.low)} ~ ${pct(view.joint.high)}, ${view.joint.met}/${view.joint.n}회)` })
  return { status: info.status, reason: info.reason, blocks }
}

// ---------- 민감도 ----------

export function riskSensitivitySection(state: ReportState, options: ReportOptions): Built {
  const { sens, stale } = state.risk
  const { entry } = state
  const spec = primaryKpi(entry)
  const labelOf = (name: string) => entry.def.constants[name]?.label ?? name
  const info = runInfo(state)
  const hasOat = sens.oat !== null
  if (!hasOat && info.result === null) return unavailable('missing', '민감도를 계산하지 않았습니다. 위험 분석 탭에서 토네이도를 계산하거나 위험 분석을 실행하세요.')

  const blocks: Block[] = [assumption(entry)]
  const w = options.chartSize === 'large' ? 860 : 720
  let status: Built['status'] = 'fresh'
  const reasons: string[] = []
  if (sens.oat) {
    if (stale.oat) {
      status = 'stale'
      reasons.push('입력이 바뀌어 토네이도(한 번에 하나씩)가 오래되었습니다')
    }
    if (!stale.oat || options.includeStale) {
      if (stale.oat) blocks.push({ kind: 'callout', tone: 'warning', title: '오래된 결과 포함', text: '토네이도(한 번에 하나씩)가 오래되었습니다.' })
      const list = sens.oat.result.entries[spec.id] ?? []
      const bars = oatBars(list, labelOf)
      const base = sens.oat.result.base ? (sens.oat.result.base[spec.id] ?? null) : null
      if (bars.length > 0) {
        blocks.push({
          kind: 'chart',
          title: `${spec.label} 토네이도 — 한 번에 하나씩 바꾸기(P10 ↔ P90)`,
          alt: tornadoLabel(bars, spec),
          svg: renderChartSvg(tornadoOption(bars, base, spec, false), w, tornadoHeight(bars)),
          table: {
            kind: 'table',
            caption: '토네이도 값',
            columns: [{ label: '입력' }, { label: '낮은 값 → 지표', align: 'right' }, { label: '높은 값 → 지표', align: 'right' }, { label: '폭', align: 'right' }],
            rows: bars.map((b): Cell[] => [b.label, `${formatNumber(b.low)} → ${b.kpiLow === null ? '계산 불가' : formatValue(spec, b.kpiLow)}`, `${formatNumber(b.high)} → ${b.kpiHigh === null ? '계산 불가' : formatValue(spec, b.kpiHigh)}`, b.swing === null ? '–' : b.swing === 0 ? '영향 없음' : formatValue(spec, b.swing)])
          }
        })
      }
    } else {
      blocks.push({ kind: 'paragraph', tone: 'warning', text: '토네이도(한 번에 하나씩)는 입력이 바뀌어 오래되었으므로 싣지 않았습니다.' })
    }
  } else {
    blocks.push({ kind: 'paragraph', tone: 'note', text: '토네이도(한 번에 하나씩)는 계산하지 않았습니다.' })
  }

  // 순위상관은 위험 분석 결과에서 바로 구한다(추가 실행 없음). 결과가 오래되었으면 같은 규칙.
  if (info.result) {
    if (info.status === 'stale' && !options.includeStale) {
      if (status === 'fresh') status = 'stale'
      reasons.push(info.reason as string)
      blocks.push({ kind: 'paragraph', tone: 'warning', text: `순위상관은 위험 분석 결과가 오래되어 싣지 않았습니다(${info.reason}).` })
    } else {
      if (info.status === 'stale') {
        status = 'stale'
        reasons.push(info.reason as string)
        blocks.push({ kind: 'callout', tone: 'warning', title: '오래된 결과 포함', text: info.reason as string })
      }
      const rank = rankTornado(info.result, spec.id)
      if (rank.length > 0) {
        blocks.push({
          kind: 'chart',
          title: `${spec.label} 순위상관 — 함께 흔들 때`,
          alt: rankLabel(rank, labelOf),
          svg: renderChartSvg(rankOption(rank, labelOf, false), w, rankHeight(rank)),
          table: { kind: 'table', caption: '순위상관 값', columns: [{ label: '입력' }, { label: '상관', align: 'right' }], rows: rank.map((e): Cell[] => [labelOf(e.name), Number.isFinite(e.rho) ? e.rho.toFixed(3) : '계산 불가']) }
        })
        blocks.push({ kind: 'paragraph', tone: 'note', text: '순위상관은 인과나 크기가 아니라 단조 관계의 강도입니다.' })
        const oatList = sens.oat?.result.entries[spec.id]
        const disagree = oatList && oatList.length > 0 ? tornadoDisagreement(oatList, rank, labelOf) : null
        if (disagree) blocks.push({ kind: 'paragraph', tone: 'note', text: disagree })
      }
    }
  }
  return { status, reason: reasons.length > 0 ? reasons.join(' · ') : null, blocks }
}

// ---------- 수렴 진단 ----------

export function riskConvergenceSection(state: ReportState, options: ReportOptions): Built {
  const info = runInfo(state)
  const g = gate(info, options, '수렴 진단')
  if ('stop' in g) return g.stop
  const spec = primaryKpi(state.entry)
  const view = convergenceView(info.result as McResult, spec.id)
  if (!view) return unavailable('na', `${spec.label}을(를) 계산할 수 있는 반복이 2회 미만이라 수렴을 볼 수 없습니다.`)
  const f = f1(spec)
  const w = options.chartSize === 'large' ? 860 : 720
  const need = requiredIterations(view, Math.max(view.half, Number.EPSILON))
  const blocks: Block[] = []
  if (g.callout) blocks.push(g.callout)
  blocks.push({
    kind: 'chart',
    title: `${spec.label}의 누적 평균과 P80`,
    alt: `${spec.label}의 누적 평균과 P80이 반복 수에 따라 변하는 모습. 마지막 평균의 95% 신뢰구간 반폭 ±${f(view.half)}`,
    svg: renderChartSvg(convergenceOption(view.points, spec, false), w, 300),
    table: { kind: 'table', caption: `${spec.label}의 누적 통계`, columns: [{ label: '반복 수' }, { label: '평균', align: 'right' }, { label: 'P80', align: 'right' }, { label: '반폭', align: 'right' }], rows: view.points.map((p): Cell[] => [String(p.n), f(p.mean), f(p.quantile), `±${f(p.half)}`]) }
  })
  blocks.push({ kind: 'paragraph', text: `평균의 95% 신뢰구간 반폭 ±${f(view.half)} (표준편차 ${f(view.sd)}, ${view.n}회).` })
  if (need) blocks.push({ kind: 'paragraph', tone: 'note', text: '뒤로 갈수록 곡선이 평평해지면 반복이 충분합니다. 반복이 100회 미만이면 곡선이 거칠 수 있습니다.' })
  return { status: info.status, reason: info.reason, blocks }
}

// ---------- 시나리오 간 비교 확률 ----------

export function riskCompareSection(state: ReportState, options: ReportOptions): Built {
  const { compare, stale } = state.risk
  if (!compare && state.risk.settings.compareIds.length < 2) return unavailable('na', '비교할 시나리오를 2개 이상 고르지 않았습니다(위험 분석 탭의 "비교").')
  if (!compare || compare.results.length === 0) return unavailable('missing', '시나리오 간 비교를 실행하지 않았습니다. 위험 분석 탭의 "비교"에서 시나리오를 2개 이상 골라 실행하세요.')
  if (compare.status === 'running') return unavailable('missing', '시나리오 간 비교가 실행 중입니다.')
  const info = {
    status: stale.compare ? ('stale' as const) : compare.status === 'canceled' ? ('stale' as const) : ('fresh' as const),
    reason: stale.compare ? '입력이 바뀌어 시나리오 간 비교가 오래되었습니다' : compare.status === 'canceled' ? `취소되어 ${compare.results.length}개 시나리오만 끝났습니다` : null
  }
  const g = gate(info, options, '시나리오 간 비교')
  if ('stop' in g) return g.stop
  const { entry, scenarios } = state
  const spec = primaryKpi(entry)
  const nameOf = (id: string) => (id === BASE_ID ? '기준' : (scenarios.find((s) => s.id === id)?.name ?? id))
  const colorOf = (id: string) => (id === BASE_ID ? '#444444' : scenarioColor(id))
  const view = compareView(compare.results, spec.id)
  const f = f1(spec)
  const w = options.chartSize === 'large' ? 860 : 720
  const blocks: Block[] = [
    { kind: 'paragraph', tone: 'note', text: '같은 입력 분포·시드로 시나리오마다 실행해 반복마다 같은 난수를 씁니다(공통난수). 시나리오 사이의 차이가 입력의 우연이 아니라 정책에서 나온 것인지 정당하게 비교할 수 있습니다.' }
  ]
  if (g.callout) blocks.push(g.callout)
  blocks.push({
    kind: 'chart',
    title: `${spec.label} 신뢰 수준 비교`,
    alt: `${spec.label} 신뢰 수준 비교: ${view.items.map((i) => nameOf(i.id)).join(', ')}`,
    svg: renderChartSvg(compareCdfOption(view.items.map((it) => ({ name: nameOf(it.id), color: colorOf(it.id), cdf: it.cdf })), spec, false), w, 320),
    table: {
      kind: 'table',
      caption: `${spec.label} 분포 비교`,
      columns: [{ label: '시나리오' }, { label: '평균', align: 'right' }, { label: 'P50', align: 'right' }, { label: 'P80', align: 'right' }, { label: 'P90', align: 'right' }],
      rows: view.items.map((it): Cell[] => {
        const v = distributionView(compare.results.find((r) => r.id === it.id)!.result, spec.id)
        return v.dist.summary.n === 0 ? [nameOf(it.id), '–', '–', '–', '–'] : [nameOf(it.id), f(v.dist.summary.mean), ...v.quantiles.map((q) => f(q.value))]
      })
    }
  })
  if (view.pairs.length > 0) {
    blocks.push({ kind: 'list', items: view.pairs.map((p) => compareSentence(spec, nameOf(p.a), nameOf(p.b), p.cmp)) })
    blocks.push({
      kind: 'table',
      caption: '쌍별 비교',
      columns: [{ label: '비교' }, { label: '짝 수', align: 'right' }, { label: '차이(B − A)의 평균', align: 'right' }, { label: '95% 구간', align: 'right' }, { label: '순위가 뒤바뀐 비율', align: 'right' }],
      rows: view.pairs.map((p): Cell[] => [`${nameOf(p.a)} 대 ${nameOf(p.b)}`, String(p.cmp.pairs), p.cmp.pairs === 0 ? '–' : f(p.cmp.meanDiff), p.cmp.pairs === 0 ? '–' : `${f(p.cmp.diffCI.low)} ~ ${f(p.cmp.diffCI.high)}`, pct(p.cmp.flipRate)])
    })
  }
  return { status: info.status, reason: info.reason, blocks }
}
