import { pvAt, revisionAsBaseline, type Baseline, type EvmPoint, type Forecast, type Revision } from '@spd/analysis'
import type { ReforecastView } from './reforecastView'

export interface ChartLine {
  name: string
  data: [number, number | null][]
  /** 선 모양. 색에만 기대지 않도록 점선·점 표시를 섞는다 */
  style: 'solid' | 'dashed' | 'dotted'
  /** 보고일 점을 그린다 */
  points: boolean
  /** 색 이름(팔레트 키) */
  tone: 'plan' | 'earned' | 'actual' | 'cost' | 'schedule'
  /** 예측 선이다(범례에 "예측"을 붙이고 점은 그리지 않는다) */
  forecast?: boolean
}

export interface ChartMark {
  axis: 'x' | 'y'
  value: number
  label: string
}

export interface ChartSpec {
  id: 'value' | 'variance' | 'index'
  title: string
  yName: string
  lines: ChartLine[]
  marks: ChartMark[]
}

const pts = (points: EvmPoint[], f: (p: EvmPoint) => number | null): [number, number | null][] => points.map((p) => [p.day, f(p)])

/** 계획 공수 곡선(PV)을 1일 간격 표본에서 `until`일까지 자른다. */
export function planCurve(baseline: Baseline, until: number): [number, number][] {
  const out: [number, number][] = []
  for (const t of baseline.series.time) {
    if (t > until) break
    out.push([t, pvAt(baseline, t)])
  }
  const last = out[out.length - 1]
  if (!last || last[0] < until) out.push([until, pvAt(baseline, until)])
  return out
}

/** 개정 기준선의 계획 완료일 가운데 가장 늦은 값(차트의 x축 끝을 정하는 데 쓴다). */
function shown_done(revisions: Revision[], useOriginal: boolean): number {
  return useOriginal ? 0 : Math.max(0, ...revisions.map((r) => r.baseline.plannedCompletion))
}

/** 설계 05의 5.2 차트 A·B·C. `selected`는 보고 기준일(세로선)이다. */
export function buildEvmCharts(baseline: Baseline, points: EvmPoint[], selected: number | null, forecast: Forecast | null = null, reforecast: ReforecastView | null = null, revisions: Revision[] = [], useOriginal = false): ChartSpec[] {
  const lastDay = points.length > 0 ? (points[points.length - 1] as EvmPoint).day : 0
  const predicted = forecast?.state === 'forecast' ? forecast : null
  const done = predicted?.cumulative.completionDay ?? null
  const reDone2 = shown_done(revisions, useOriginal)
  const reDone = reforecast ? Math.max(...reforecast.runs.map((r) => r.completionDay ?? 0)) : 0
  const until = Math.max(baseline.plannedCompletion, lastDay, done ?? 0, reDone, reDone2)
  const at = points.find((p) => p.day === selected) ?? null
  const forecastLines: ChartLine[] = []
  if (predicted && at) {
    if (done !== null) forecastLines.push({ name: 'EV 예측', data: [[at.day, at.ev], [done, baseline.bac]], style: 'dashed', points: false, tone: 'earned', forecast: true })
    if (done !== null && predicted.cumulative.eac !== null) forecastLines.push({ name: 'AC 예측', data: [[at.day, at.ac], [done, predicted.cumulative.eac]], style: 'dotted', points: false, tone: 'actual', forecast: true })
  }
  // 시뮬레이션 기반 재예측: 누적 공수 곡선(κ마다 한 줄). 지표 기반 예측과 구분되게 점선 모양을 달리한다.
  if (reforecast) {
    for (const r of reforecast.runs) forecastLines.push({ name: `AC 재예측(${r.label})`, data: r.ac, style: 'dashed', points: false, tone: 'actual', forecast: true })
  }
  // 기준선 개정: 원 PV는 연한 점선으로 남기고 개정 PV를 개정 시점부터 잇는다. 개정 시점은 세로선으로 표시한다.
  const shown = useOriginal ? [] : revisions
  const revisionLines: ChartLine[] = shown.map((r) => ({
    name: `PV(개정 ${r.number})`,
    data: planCurve({ ...revisionAsBaseline(baseline, r) }, Math.max(until, r.baseline.plannedCompletion)).filter(([t]) => t >= r.day),
    style: 'solid',
    points: false,
    tone: 'plan'
  }))
  const revisionMarks: ChartMark[] = shown.map((r) => ({ axis: 'x', value: r.day, label: `개정 ${r.number} (${r.day}일)` }))
  const doneMark: ChartMark[] = done !== null ? [{ axis: 'x', value: done, label: `예상 완료 ${Number(done.toFixed(1))}일` }] : []
  const dayMark: ChartMark[] = selected === null ? [] : [{ axis: 'x', value: selected, label: `${selected}일` }]
  return [
    {
      id: 'value',
      title: 'PV·EV·AC',
      yName: '맨데이',
      lines: [
        { name: 'PV(계획)', data: planCurve(baseline, until), style: 'dashed', points: false, tone: 'plan' },
        { name: 'EV(획득)', data: pts(points, (p) => p.ev), style: 'solid', points: true, tone: 'earned' },
        ...revisionLines,
        { name: 'AC(실제 공수)', data: pts(points, (p) => p.ac), style: 'dotted', points: true, tone: 'actual' },
        ...forecastLines
      ],
      marks: [
        { axis: 'y', value: baseline.bac, label: `BAC ${Math.round(baseline.bac).toLocaleString('ko-KR')}` },
        { axis: 'x', value: baseline.plannedCompletion, label: `계획 완료 ${Number(baseline.plannedCompletion.toFixed(1))}일` },
        ...doneMark,
        ...revisionMarks,
        ...dayMark
      ]
    },
    {
      id: 'variance',
      title: '비용·일정 편차(CV, SV)',
      yName: '맨데이',
      lines: [
        { name: 'CV(비용 편차)', data: pts(points, (p) => p.cv), style: 'solid', points: true, tone: 'cost' },
        { name: 'SV(일정 편차)', data: pts(points, (p) => p.sv), style: 'dashed', points: true, tone: 'schedule' }
      ],
      marks: [{ axis: 'y', value: 0, label: '0' }, ...dayMark]
    },
    {
      id: 'index',
      title: '비용·일정 지수(CPI, SPI)',
      yName: '지수',
      lines: [
        { name: 'CPI(누적)', data: pts(points, (p) => p.cpi), style: 'solid', points: true, tone: 'cost' },
        { name: 'SPI(누적)', data: pts(points, (p) => p.spi), style: 'solid', points: true, tone: 'schedule' },
        { name: 'CPI(최근 구간)', data: pts(points, (p) => p.cpiK), style: 'dashed', points: true, tone: 'cost' },
        { name: 'SPI(최근 구간)', data: pts(points, (p) => p.spiK), style: 'dashed', points: true, tone: 'schedule' }
      ],
      marks: [{ axis: 'y', value: 1, label: '1.0' }, ...dayMark]
    }
  ]
}

/** 차트를 글로 요약한다(스크린리더용): 마지막 보고일의 값. */
export function describeChart(spec: ChartSpec): string {
  const parts = spec.lines.map((l) => {
    const last = [...l.data].reverse().find((d) => d[1] !== null)
    return last ? `${l.name} ${Number((last[1] as number).toFixed(2))}(${last[0]}일)` : `${l.name} 값 없음`
  })
  return `${spec.title}: ${parts.join(', ')}`
}
