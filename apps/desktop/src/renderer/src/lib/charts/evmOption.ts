import type * as echarts from 'echarts/core'
import type { LineSeriesOption } from 'echarts/charts'
import { chartPalette } from '../../components/chartTheme'
import type { ChartLine, ChartSpec } from '../evmCharts'

const TONES = {
  light: { plan: '#6b7280', earned: '#0b5fff', actual: '#c2410c', cost: '#0b5fff', schedule: '#7c3aed' },
  dark: { plan: '#a3a3a3', earned: '#6ea8ff', actual: '#fb923c', cost: '#6ea8ff', schedule: '#c4a8ff' }
} as const

const DASH: Record<ChartLine['style'], 'solid' | 'dashed' | 'dotted'> = { solid: 'solid', dashed: 'dashed', dotted: 'dotted' }

/** EVM 차트 한 장의 옵션. 선 모양(실선·점선)과 보고일 점을 함께 써 색에만 기대지 않는다. 화면과 보고서가 함께 쓴다. */
export function evmOption(spec: ChartSpec, dark: boolean) {
  const p = chartPalette(dark)
  const tones = dark ? TONES.dark : TONES.light
  const markLines = spec.marks.map((m) => ({
    ...(m.axis === 'x' ? { xAxis: m.value } : { yAxis: m.value }),
    label: { show: true, formatter: m.label, color: p.text, fontSize: 11 }
  }))
  const series: LineSeriesOption[] = spec.lines.map((l, i) => {
    const color = tones[l.tone]
    return {
      name: l.name,
      type: 'line',
      showSymbol: l.points,
      symbol: 'circle',
      symbolSize: 6,
      connectNulls: false,
      lineStyle: { width: 2, type: DASH[l.style], color },
      itemStyle: { color },
      data: l.data,
      ...(i === 0 && markLines.length > 0 ? { markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: p.axis, width: 1 }, data: markLines } } : {})
    }
  })
  return {
    animation: false,
    textStyle: { color: p.text },
    grid: { left: 64, right: 24, top: 40, bottom: 44 },
    legend: { top: 4, type: 'scroll', textStyle: { color: p.text } },
    tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => (typeof v === 'number' ? Number(v.toPrecision(5)).toString() : String(v)) },
    xAxis: { type: 'value', name: '일', nameLocation: 'middle', nameGap: 26, min: 0, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    yAxis: { type: 'value', name: spec.yName, nameTextStyle: { align: 'left' }, scale: spec.id !== 'value', axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
    series
  } satisfies echarts.EChartsCoreOption
}
