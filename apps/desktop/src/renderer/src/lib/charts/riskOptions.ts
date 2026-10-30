import type * as echarts from 'echarts/core'
import type { ConvergencePoint, KpiSpec, RankEntry } from '@spd/analysis'
import { chartPalette } from '../../components/chartTheme'
import { formatNumber } from '../params'
import type { DistributionView, TornadoBar } from '../riskView'
import { formatValue } from '../scenarioCompare'

/**
 * 위험 분석 차트 옵션(히스토그램·신뢰 수준·토네이도·순위상관·수렴·시나리오 비교). 화면 컴포넌트와 보고서가 함께 쓴다.
 * 그릴 것이 없으면 null.
 */
const num = (spec: Pick<KpiSpec, 'decimals'>, v: number) => v.toFixed(spec.decimals)

export function histogramOption(view: DistributionView, spec: KpiSpec, dark: boolean) {
  if (view.bars.length === 0) return null
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    grid: { left: 52, right: 16, top: 16, bottom: 52 },
    tooltip: {
      trigger: 'axis',
      formatter: (a: { dataIndex: number }[]) => {
        const b = view.bars[a[0]?.dataIndex ?? 0]
        return b ? `${num(spec, b.from)} ~ ${num(spec, b.to)}${spec.unit}<br/><b>${b.count}회</b> (${(b.share * 100).toFixed(1)}%)` : ''
      }
    },
    xAxis: {
      type: 'category',
      data: view.bars.map((b) => num(spec, (b.from + b.to) / 2)),
      name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`,
      nameLocation: 'middle',
      nameGap: 32,
      axisLine: { lineStyle: { color: p.axis } },
      axisLabel: { color: p.text }
    },
    yAxis: { type: 'value', name: '반복 수', axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    series: [{ type: 'bar', barCategoryGap: '4%', data: view.bars.map((b) => b.count), itemStyle: { color: p.refs[2] } }]
  } satisfies echarts.EChartsCoreOption
}

export function histogramLabel(view: DistributionView, spec: KpiSpec): string {
  const top = view.bars.reduce((m, b) => (b.count > m.count ? b : m), view.bars[0] ?? { count: 0, from: 0, to: 0, share: 0 })
  return `${spec.label} 히스토그램: ${view.bars.length}개 구간, 가장 많은 구간은 ${top.count}회`
}

export function confidenceOption(view: DistributionView, spec: KpiSpec, targets: number[], dark: boolean) {
  if (view.cdf.length === 0) return null
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    grid: { left: 52, right: 40, top: 16, bottom: 52 },
    tooltip: { trigger: 'axis', formatter: (a: { value: [number, number] }[]) => (a[0] ? `${num(spec, a[0].value[0])}${spec.unit} 이하: <b>${a[0].value[1].toFixed(1)}%</b>` : '') },
    xAxis: { type: 'value', scale: true, name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`, nameLocation: 'middle', nameGap: 32, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    yAxis: { type: 'value', min: 0, max: 100, name: '이하일 확률(%)', axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    series: [
      {
        type: 'line',
        step: 'end',
        showSymbol: false,
        lineStyle: { color: p.refs[2], width: 2 },
        data: view.cdf.map(([x, q]) => [x, q * 100]),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: p.axis },
          label: { color: p.text, formatter: (r: { name: string }) => r.name },
          data: [...view.quantiles.map((q) => ({ name: q.label, yAxis: q.p * 100 })), ...targets.map((v) => ({ name: '목표', xAxis: v, lineStyle: { type: 'solid' as const, color: '#D55E00' } }))]
        }
      }
    ]
  } satisfies echarts.EChartsCoreOption
}

export function confidenceLabel(view: DistributionView, spec: KpiSpec): string {
  return `${spec.label} 신뢰 수준 차트: ${view.quantiles.map((q) => `${q.label} ${formatValue(spec, q.value)}`).join(', ')}`
}

export function tornadoOption(bars: TornadoBar[], base: number | null, spec: KpiSpec, dark: boolean) {
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    grid: { left: 150, right: 24, top: 24, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (a: { dataIndex: number }[]) => {
        const b = bars[a[0]?.dataIndex ?? 0]
        if (!b) return ''
        const f = (v: number | null) => (v === null ? '계산 불가' : `${num(spec, v)}${spec.unit}`)
        return `${b.label}<br/>${formatNumber(b.low)} → ${f(b.kpiLow)}<br/>${formatNumber(b.high)} → ${f(b.kpiHigh)}`
      }
    },
    xAxis: { type: 'value', scale: true, name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`, nameLocation: 'middle', nameGap: 26, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    yAxis: { type: 'category', inverse: true, data: bars.map((b) => b.label), axisLabel: { width: 136, overflow: 'truncate', color: p.text }, axisLine: { lineStyle: { color: p.axis } } },
    series: [
      { type: 'bar', stack: 't', silent: true, itemStyle: { color: 'transparent' }, data: bars.map((b) => b.from) },
      {
        type: 'bar',
        stack: 't',
        barMaxWidth: 22,
        itemStyle: { color: p.refs[2] },
        data: bars.map((b) => b.swing),
        markLine: base === null ? undefined : { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: p.axis }, label: { formatter: '기준', color: p.text }, data: [{ xAxis: base }] }
      }
    ]
  } satisfies echarts.EChartsCoreOption
}

export const tornadoHeight = (bars: unknown[]): number => Math.max(180, 70 + 34 * bars.length)

export function tornadoLabel(bars: TornadoBar[], spec: KpiSpec): string {
  return `${spec.label} 토네이도: ${bars.map((b) => `${b.label} 폭 ${b.swing === null ? '계산 불가' : num(spec, b.swing)}`).join(', ')}`
}

export function rankOption(entries: RankEntry[], labelOf: (name: string) => string, dark: boolean) {
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    grid: { left: 150, right: 40, top: 16, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (a: { dataIndex: number }[]) => {
        const e = entries[a[0]?.dataIndex ?? 0]
        return e ? `${labelOf(e.name)}<br/>상관 ${Number.isFinite(e.rho) ? e.rho.toFixed(3) : '계산 불가'}` : ''
      }
    },
    xAxis: { type: 'value', min: -1, max: 1, name: '순위상관', nameLocation: 'middle', nameGap: 26, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    yAxis: { type: 'category', inverse: true, data: entries.map((e) => labelOf(e.name)), axisLabel: { width: 136, overflow: 'truncate', color: p.text }, axisLine: { lineStyle: { color: p.axis } } },
    series: [{ type: 'bar', barMaxWidth: 22, itemStyle: { color: p.refs[2] }, data: entries.map((e) => (Number.isFinite(e.rho) ? e.rho : null)), label: { show: true, position: 'right', color: p.text, formatter: (r: { value: number | null }) => (r.value === null ? '' : r.value.toFixed(2)) } }]
  } satisfies echarts.EChartsCoreOption
}

export const rankHeight = (entries: unknown[]): number => Math.max(160, 60 + 34 * entries.length)

export function rankLabel(entries: RankEntry[], labelOf: (name: string) => string): string {
  return `순위상관 토네이도: ${entries.map((e) => `${labelOf(e.name)} ${Number.isFinite(e.rho) ? e.rho.toFixed(2) : '계산 불가'}`).join(', ')}`
}

export function convergenceOption(points: ConvergencePoint[], spec: KpiSpec, dark: boolean) {
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    legend: { top: 0, textStyle: { color: p.text } },
    grid: { left: 56, right: 24, top: 44, bottom: 44 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: points.map((q) => q.n), name: '반복 수', nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, axisLabel: { color: p.text } },
    yAxis: { type: 'value', scale: true, name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    series: [
      { name: '평균', type: 'line', symbolSize: 5, lineStyle: { color: p.refs[2], width: 2 }, itemStyle: { color: p.refs[2] }, data: points.map((q) => q.mean) },
      { name: 'P80', type: 'line', symbolSize: 5, lineStyle: { color: p.refs[1], width: 2, type: 'dashed' }, itemStyle: { color: p.refs[1] }, data: points.map((q) => q.quantile) }
    ]
  } satisfies echarts.EChartsCoreOption
}

export function compareCdfOption(items: { name: string; color: string; cdf: [number, number][] }[], spec: KpiSpec, dark: boolean) {
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    legend: { top: 0, textStyle: { color: p.text } },
    grid: { left: 52, right: 24, top: 44, bottom: 44 },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', scale: true, name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`, nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    yAxis: { type: 'value', min: 0, max: 100, name: '이하일 확률(%)', axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    series: items.map((it) => ({ name: it.name, type: 'line' as const, step: 'end' as const, showSymbol: false, lineStyle: { color: it.color, width: 2 }, itemStyle: { color: it.color }, data: it.cdf.map(([x, q]) => [x, q * 100]) }))
  } satisfies echarts.EChartsCoreOption
}
