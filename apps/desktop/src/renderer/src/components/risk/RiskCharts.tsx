import { useMemo } from 'react'
import type { ConvergencePoint, KpiSpec, RankEntry, SweepResult } from '@spd/analysis'
import { compareCdfOption, convergenceOption, rankHeight, rankLabel, rankOption, tornadoHeight, tornadoLabel, tornadoOption } from '../../lib/charts/riskOptions'
import type { TornadoBar } from '../../lib/riskView'
import { chartPalette, useDarkMode } from '../chartTheme'
import { useEChart } from '../useEChart'

const fmt = (spec: Pick<KpiSpec, 'decimals'>, v: number) => v.toFixed(spec.decimals)

/** OAT 토네이도: 파라미터마다 지표가 낮은 값~높은 값 사이를 가로 막대로, 기준 값은 점선. */
export function TornadoChart({ bars, base, spec }: { bars: TornadoBar[]; base: number | null; spec: KpiSpec }) {
  const dark = useDarkMode()
  const option = useMemo(() => tornadoOption(bars, base, spec, dark), [bars, base, spec, dark])
  const el = useEChart(option)
  const label = tornadoLabel(bars, spec)
  return <div ref={el} className="risk-chart" style={{ height: tornadoHeight(bars) }} role="img" aria-label={label} />
}

/** Monte Carlo 순위상관 토네이도: 입력과 지표의 스피어만 상관(−1~1). */
export function RankChart({ entries, labelOf }: { entries: RankEntry[]; labelOf: (name: string) => string }) {
  const dark = useDarkMode()
  const option = useMemo(() => rankOption(entries, labelOf, dark), [entries, labelOf, dark])
  const el = useEChart(option)
  const label = rankLabel(entries, labelOf)
  return <div ref={el} className="risk-chart" style={{ height: rankHeight(entries) }} role="img" aria-label={label} />
}

/** 단일 파라미터 스윕: 수준에 따른 지표 곡선. 계산할 수 없는 수준은 끊긴다. */
export function SweepChart({ sweep, kpiId, spec, paramLabel }: { sweep: SweepResult; kpiId: string; spec: KpiSpec; paramLabel: string }) {
  const dark = useDarkMode()
  const values = sweep.values[kpiId] ?? []
  const option = useMemo(() => {
    const p = chartPalette(dark)
    return {
      animation: false,
      textStyle: { color: p.text },
      grid: { left: 56, right: 24, top: 32, bottom: 44 },
      tooltip: { trigger: 'axis', formatter: (a: { value: [number, number | null] }[]) => (a[0] ? `${paramLabel} ${a[0].value[0]}<br/>${spec.label}: <b>${a[0].value[1] === null ? '미완료·계산 불가' : `${fmt(spec, a[0].value[1])}${spec.unit}`}</b>` : '') },
      xAxis: { type: 'value', scale: true, name: paramLabel, nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      yAxis: { type: 'value', scale: true, name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      series: [{ type: 'line', symbolSize: 6, itemStyle: { color: p.refs[2] }, lineStyle: { color: p.refs[2], width: 2 }, data: sweep.levels.map((l, i) => [l, values[i] ?? null]) }]
    }
  }, [sweep, values, spec, paramLabel, dark])
  const el = useEChart(option)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${paramLabel}에 따른 ${spec.label} 곡선: ${sweep.levels.length}개 수준`} />
}

/** 수렴 곡선: 반복 수에 따른 누적 평균과 P80. */
export function ConvergenceChart({ points, spec }: { points: ConvergencePoint[]; spec: KpiSpec }) {
  const dark = useDarkMode()
  const option = useMemo(() => convergenceOption(points, spec, dark), [points, spec, dark])
  const el = useEChart(option)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${spec.label}의 누적 평균과 P80이 반복 수에 따라 변하는 모습`} />
}

/** 시나리오별 신뢰 수준 곡선을 한 차트에 겹친다. */
export function CompareChart({ items, spec }: { items: { name: string; color: string; cdf: [number, number][] }[]; spec: KpiSpec }) {
  const dark = useDarkMode()
  const option = useMemo(() => compareCdfOption(items, spec, dark), [items, spec, dark])
  const el = useEChart(option)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${spec.label} 신뢰 수준 비교: ${items.map((i) => i.name).join(', ')}`} />
}
