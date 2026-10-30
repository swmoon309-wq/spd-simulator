import { baselineOfPoint, forecastAt, rangeOf, statusAt, type AlertEvent, type EvmPoint, type Forecast, type Status } from '@spd/analysis'
import type { Block, Cell } from '../../../../shared/reportDoc'
import { buildActionComparison } from '../actionCompare'
import { buildControlView, formatIndex, formatSigned, kappasOf, reforecastUnsupported, type ControlView } from '../control'
import { evmOption } from '../charts/evmOption'
import { buildEvmCharts, describeChart } from '../evmCharts'
import { formatDelta, formatValue } from '../scenarioCompare'
import { reforecastKey, summarizeReforecast } from '../reforecastView'
import { renderChartSvg } from './chartSvg'
import type { ReportOptions, ReportState } from './model'
import { unavailable, type Built } from './sections'

const STATUS_TEXT: Record<Status, string> = { none: '–', normal: '정상', warn: '주의', critical: '위험' }
const STATUS_MARK: Record<Status, string> = { none: '', normal: '●', warn: '▲', critical: '■' }
const LEVEL_TEXT = { warn: '▲ 주의', critical: '■ 위험' } as const
const fmt = (x: number) => Math.round(x).toLocaleString('ko-KR')
const day1 = (x: number) => `${Number(x.toFixed(1))}일`

/** 상태 보고서가 쓰는 계산(통제 탭과 같은 함수): 지표 시계열, 보고일, 예측. */
export interface StatusContext {
  view: ControlView
  point: EvmPoint | null
  rowIndex: number | null
  forecast: Forecast | null
  status: Status
  last: EvmPoint | null
}

export function statusContext(state: ReportState, options: ReportOptions): StatusContext | null {
  const { adopted, entry, control } = state
  if (!adopted || !entry.evm) return null
  const evm = entry.evm
  const view = buildControlView(adopted, control.actuals, { credits: evm.credits, totalTasks: evm.totalTasks(state.params) }, control.evm, { revisions: control.revisions })
  const last = view.points[view.points.length - 1] ?? null
  // 보고 기준일: 고른 날(없어졌으면 마지막 보고일)
  const point = (options.reportDay != null ? view.points.find((p) => p.day === options.reportDay) : undefined) ?? last
  let forecast: Forecast | null = null
  if (point) {
    const seg = view.points.filter((p) => p.revision === point.revision)
    const i = seg.indexOf(point)
    if (i >= 0) forecast = forecastAt(baselineOfPoint(adopted, control.revisions, point, false), seg, i, control.evm.k)
  }
  return { view, point, rowIndex: point ? point.index : null, forecast, status: point ? statusAt(view.events, view.points, point.day) : 'none', last }
}

const noAdoption = () => unavailable('na', '채택한 계획이 없어 상태 보고서를 만들 수 없습니다. 시나리오 탭에서 시나리오를 채택하면 계획 기준선(PV)이 만들어집니다.')
const noActuals = () => unavailable('missing', '실적이 없습니다. 통제 탭에서 보고일별 실적을 입력하거나 CSV로 가져오세요.')

// ---------- 보고일 기준 지표 ----------

export function statusIndicatorsSection(state: ReportState, options: ReportOptions): Built {
  const ctx = statusContext(state, options)
  if (!ctx) return noAdoption()
  if (!ctx.point) return noActuals()
  const p = ctx.point
  const idx = (x: number | null) => (x === null ? '–' : formatIndex(x))
  const rows: Cell[][] = [
    ['PV(계획 가치)', `${fmt(p.pv)} 맨데이`, '채택 계획이 이 보고일까지 하기로 한 일'],
    ['EV(획득 가치)', `${fmt(p.ev)} 맨데이`, '실제로 끝낸 일을 공수로 환산한 값'],
    ['AC(실제 비용)', `${fmt(p.ac)} 맨데이`, '이 보고일까지 투입한 누적 공수'],
    ['CV(비용 편차)', `${formatSigned(p.cv)} 맨데이`, 'EV − AC. 음수면 계획보다 공수를 더 썼음'],
    ['SV(일정 편차)', `${formatSigned(p.sv)} 맨데이`, 'EV − PV. 음수면 계획보다 느림'],
    [{ text: 'CPI', tone: 'strong' }, { text: idx(p.cpi), tone: p.cpi !== null && p.cpi < 1 ? 'worse' : 'strong' }, 'EV ÷ AC. 1보다 작으면 같은 일에 계획보다 공수를 더 씀'],
    [{ text: 'SPI', tone: 'strong' }, { text: idx(p.spi), tone: p.spi !== null && p.spi < 1 ? 'worse' : 'strong' }, 'EV ÷ PV. 1보다 작으면 계획보다 느림'],
    ['진척률', `${(p.progress * 100).toFixed(1)}%`, '단계별 누적 태스크에서 계산']
  ]
  const blocks: Block[] = [
    { kind: 'keyValues', rows: [['보고 기준일', `${p.day}일${p === ctx.last ? ' (최근 보고일)' : ''}`], ['채택 계획', `${state.adopted?.scenarioName ?? ''} — 계획 완료 ${day1(state.adopted?.plannedCompletion ?? 0)}, 예산 ${fmt(state.adopted?.bac ?? 0)} 맨데이`], ['상태', `${STATUS_MARK[ctx.status]} ${STATUS_TEXT[ctx.status]}`.trim()], ['기준선 개정', `${state.control.revisions.length}회`]] },
    { kind: 'table', caption: '보고일 지표', columns: [{ label: '지표' }, { label: '값', align: 'right' }, { label: '뜻' }], rows }
  ]
  return { status: 'fresh', reason: null, blocks }
}

// ---------- 추이 차트 ----------

export function statusChartsSection(state: ReportState, options: ReportOptions): Built {
  const ctx = statusContext(state, options)
  if (!ctx) return noAdoption()
  if (ctx.view.points.length === 0) return noActuals()
  const { adopted, control } = state
  const rowForDay = ctx.point ? control.actuals[ctx.point.index] ?? null : null
  const reView = reforecastView(state, ctx, rowForDay)
  const specs = buildEvmCharts(adopted!, ctx.view.points, ctx.point?.day ?? null, ctx.forecast, reView?.view ?? null, control.revisions, false)
  if (specs.length === 0) return unavailable('na', '그릴 수 있는 차트가 없습니다.')
  const w = options.chartSize === 'large' ? 860 : 720
  const blocks: Block[] = specs.map((spec): Block => ({
    kind: 'chart',
    title: spec.title,
    alt: describeChart(spec),
    svg: renderChartSvg(evmOption(spec, false), w, 320),
    table: {
      kind: 'table',
      caption: `${spec.title}의 값(보고일)`,
      columns: [{ label: '보고일' }, ...spec.lines.map((l) => ({ label: l.name, align: 'right' as const }))],
      rows: ctx.view.points.map((p): Cell[] => [`${p.day}일`, ...spec.lines.map((l) => {
        const hit = l.data.find((d) => d[0] === p.day)
        return hit && hit[1] !== null ? String(Number(hit[1].toPrecision(5))) : '–'
      })])
    }
  }))
  return { status: 'fresh', reason: null, blocks }
}

// ---------- 경고 ----------

export function statusAlertsSection(state: ReportState, options: ReportOptions): Built {
  const ctx = statusContext(state, options)
  if (!ctx) return noAdoption()
  if (ctx.view.points.length === 0) return noActuals()
  const events: AlertEvent[] = [...ctx.view.events].sort((a, b) => b.day - a.day || (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
  const a = state.control.evm.alerts
  const blocks: Block[] = [{ kind: 'paragraph', tone: 'note', text: `경고 설정: 주의 ${a.warn}, 위험 ${a.critical}(CPI·SPI), 연속 하락 ${a.trend}회, 조기 경고는 진척률 ${a.early.progress}에서 CPI ${a.early.cpi}.` }]
  if (events.length === 0) blocks.push({ kind: 'paragraph', text: '경고가 없습니다.' })
  else blocks.push({ kind: 'table', caption: '경고 목록(최근 보고일 먼저)', columns: [{ label: '보고일' }, { label: '수준' }, { label: '내용' }], rows: events.map((e): Cell[] => [`${e.day}일`, { text: LEVEL_TEXT[e.level], tone: e.level === 'critical' ? 'worse' : 'strong' }, e.message]) })
  return { status: 'fresh', reason: null, blocks }
}

// ---------- 완료 예측과 재예측 ----------

function span(a: number | null, b: number | null, f: (x: number) => string): string {
  const r = rangeOf(a, b)
  if (!r) return '산출 불가'
  return Math.abs(r.high - r.low) < 1e-9 ? f(r.low) : `${f(r.low)} ~ ${f(r.high)}`
}

/** 이 보고일의 재예측 결과를 쓸 수 있는지(같은 입력으로 만든 것인지) 확인한다. */
function reforecastView(state: ReportState, ctx: StatusContext, row: ReportState['control']['actuals'][number] | null) {
  const { control, adopted, entry } = state
  const rf = control.reforecast
  if (!rf || rf.status !== 'done' || !rf.outcome || !adopted || !ctx.point || !row) return null
  if (rf.day !== ctx.point.day) return null
  if (rf.key !== reforecastKey(adopted, row, control.evm.k)) return null
  return { view: summarizeReforecast(entry, rf.outcome), kappas: kappasOf(ctx.point, control.revisions) }
}

export function statusForecastSection(state: ReportState, options: ReportOptions): Built {
  const ctx = statusContext(state, options)
  if (!ctx) return noAdoption()
  if (!ctx.point || !ctx.forecast) return noActuals()
  const { adopted, entry, control } = state
  const f = ctx.forecast
  const blocks: Block[] = []
  if (f.state === 'complete' && f.complete) {
    const delay = f.complete.day - (adopted?.plannedCompletion ?? 0)
    blocks.push({ kind: 'paragraph', text: `완료했습니다. 실제 완료일 ${day1(f.complete.day)}(계획 ${day1(adopted!.plannedCompletion)}, ${delay > 0 ? `${day1(delay)} 늦음` : delay < 0 ? `${day1(-delay)} 빠름` : '계획대로'}), 최종 공수 ${fmt(f.complete.cost)} 맨데이(예산 ${fmt(adopted!.bac)}). 획득 가치가 총 예산에 닿았으므로 예측 대신 실적을 싣습니다.` })
  } else {
    const c = f.cumulative
    const r = f.recent
    blocks.push({
      kind: 'table',
      caption: '지표 기반 예측(낙관 ~ 비관 범위)',
      columns: [{ label: '항목' }, { label: '추정', align: 'right' }, { label: '참고' }],
      rows: [
        ['예상 완료일', span(c.completionDay, r.completionDay, day1), `계획 ${day1(adopted!.plannedCompletion)}`],
        ['EAC(완료 시 총 공수)', span(c.eac, r.eac, (x) => `${fmt(x)} 맨데이`), `BAC ${fmt(adopted!.bac)} 맨데이`],
        ['ETC(남은 공수)', span(c.etc, r.etc, (x) => `${fmt(x)} 맨데이`), ''],
        ['VAC(예산 편차)', span(c.vac, r.vac, (x) => `${x > 0 ? '+' : ''}${fmt(x)} 맨데이`), '음수는 초과']
      ]
    })
    blocks.push({ kind: 'callout', tone: 'warning', title: '추정입니다', text: '범위는 누적 지수와 최근 구간 지수로 계산한 두 값입니다. 현재의 효율이 남은 작업에도 계속된다는 가정의 추정이며 예측이 아닙니다.' })
    if (f.reasons.length > 0) blocks.push({ kind: 'list', items: f.reasons })
  }

  // 재예측(시뮬레이션 기반)
  const unsupported = reforecastUnsupported(entry.id, entry.title)
  const row = control.actuals[ctx.point.index] ?? null
  const rv = reforecastView(state, ctx, row)
  let status: Built['status'] = 'fresh'
  let reason: string | null = null
  if (f.state !== 'complete') {
    if (unsupported) blocks.push({ kind: 'paragraph', tone: 'note', text: unsupported })
    else if (rv) {
      const v = rv.view
      blocks.push({
        kind: 'table',
        caption: `재예측(시뮬레이션 기반, 보고일 ${ctx.point.day}일, 추정)`,
        columns: [{ label: '가정' }, { label: '보정 계수 κ', align: 'right' }, { label: '예상 완료일', align: 'right' }, { label: 'EAC', align: 'right' }],
        rows: v.runs.map((x): Cell[] => [x.label, `${x.kappa.toFixed(2)}${x.clamped ? ' (제한됨)' : ''}`, x.completionDay === null ? '종료 시각 안에 끝나지 않음' : day1(x.completionDay), x.eac === null ? '–' : `${fmt(x.eac)} 맨데이`])
      })
      if (v.completion) blocks.push({ kind: 'paragraph', text: `재예측 범위: 완료일 ${day1(v.completion.low)} ~ ${day1(v.completion.high)}${v.eac ? `, EAC ${fmt(v.eac.low)} ~ ${fmt(v.eac.high)} 맨데이` : ''}. 관측할 수 없는 상태는 기준선 값을 쓰므로 추정입니다.` })
    } else if (control.reforecast) {
      status = 'stale'
      reason = '재예측 결과가 이 보고일·현재 입력과 맞지 않아 싣지 않았습니다(오래됨)'
      blocks.push({ kind: 'paragraph', tone: 'warning', text: `${reason}. 통제 탭에서 이 보고일로 다시 재예측하세요.` })
    } else {
      blocks.push({ kind: 'paragraph', tone: 'note', text: '재예측을 실행하지 않았습니다(통제 탭의 "재예측 실행").' })
    }
  }
  return { status, reason, blocks }
}

// ---------- 시정 조치와 개정 이력 ----------

export function statusActionsSection(state: ReportState, options: ReportOptions): Built {
  const ctx = statusContext(state, options)
  if (!ctx) return noAdoption()
  const { adopted, entry, control } = state
  const blocks: Block[] = []
  let status: Built['status'] = 'fresh'
  let reason: string | null = null

  // 조치 후보 비교: 이 보고일에 같은 후보·같은 입력으로 만든 것만 싣는다.
  const run = control.actionRun
  if (run && run.status === 'done' && ctx.point && adopted) {
    const row = control.actuals[ctx.point.index]
    let fresh = false
    if (row && run.day === ctx.point.day) {
      const ks = kappasOf(ctx.point, control.revisions)
      const have = [ks.cum, ks.recent].filter((x): x is number => x !== null)
      const kappa = have.length > 0 ? have.reduce((a, b) => a + b, 0) / have.length : NaN
      fresh = run.key === JSON.stringify([reforecastKey(adopted, row, control.evm.k), control.revisions.length, kappa, control.candidates])
    }
    if (fresh) {
      const cmp = buildActionComparison(entry, run, adopted.params)
      blocks.push({
        kind: 'table',
        caption: `시정 조치 후보 비교(보고일 ${run.day}일, 생산성 보정 계수 κ = ${run.kappa.toFixed(2)}, 추정)`,
        columns: [{ label: '지표' }, ...cmp.columns.map((c) => ({ label: c.label, align: 'right' as const }))],
        rows: cmp.rows.map((r): Cell[] => [r.label, ...cmp.columns.map((c) => {
          const cell = r.cells[c.id]
          const text = formatValue(r.spec, cell?.value ?? null).replace(/ /g, ' ')
          if (!cell?.delta) return text
          const d = formatDelta(r.spec, cell.delta)
          return d ? { text: `${text}\n(${d.arrow} ${d.text}${d.verdict ? ` ${d.verdict}` : ''})`, ...(d.verdict === '좋음' ? { tone: 'better' as const } : d.verdict === '나쁨' ? { tone: 'worse' as const } : {}) } : text
        })])
      })
      blocks.push({ kind: 'paragraph', tone: 'note', text: '모든 후보에 같은 생산성 보정 계수를 써서 이어 실행한 결과입니다(추정).' })
    } else {
      status = 'stale'
      reason = '시정 조치 비교가 이 보고일·현재 입력과 맞지 않아 싣지 않았습니다(오래됨)'
      blocks.push({ kind: 'paragraph', tone: 'warning', text: `${reason}. 통제 탭에서 후보를 다시 실행하세요.` })
    }
  } else {
    blocks.push({ kind: 'paragraph', tone: 'note', text: run ? '조치 시험이 끝나지 않았거나 실패했습니다.' : '시정 조치 시험을 실행하지 않았습니다.' })
  }

  // 개정 이력
  if (control.revisions.length === 0) blocks.push({ kind: 'paragraph', text: '기준선 개정이 없습니다. 채택한 원 기준선을 그대로 씁니다.' })
  else if (adopted) {
    blocks.push({
      kind: 'table',
      caption: '기준선 개정 이력',
      columns: [{ label: '번호' }, { label: '개정일' }, { label: '조치' }, { label: '사유' }, { label: '계획 완료일', align: 'right' }, { label: 'BAC(맨데이)', align: 'right' }],
      rows: [
        ['0', '채택', '–', adopted.scenarioName, day1(adopted.plannedCompletion), fmt(adopted.bac)],
        ...control.revisions.map((r): Cell[] => [String(r.number), day1(r.day), r.action ? r.action.label : '조치 없음(재예측)', r.reason, `${day1(r.before.plannedCompletion)} → ${day1(r.after.plannedCompletion)}`, `${fmt(r.before.bac)} → ${fmt(r.after.bac)}`])
      ]
    })
  }
  return { status, reason, blocks }
}
