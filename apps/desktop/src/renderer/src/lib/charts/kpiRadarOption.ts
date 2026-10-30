import { RADAR_MAX } from '@spd/analysis'
import type * as echarts from 'echarts/core'
import { chartPalette } from '../../components/chartTheme'
import { BASE_COLOR, type RadarData } from '../scenarioCompare'

/** 레이더 차트 옵션. 기준 = 1(점선 원)로 정규화한 값이며 바깥일수록 기준보다 좋다(상한 2). 화면과 보고서가 함께 쓴다. */
export function kpiRadarOption(data: RadarData, dark: boolean) {
  const p = chartPalette(dark)
  return {
    animation: false,
    textStyle: { color: p.text },
    legend: { top: 0, textStyle: { color: p.text } },
    tooltip: {
      trigger: 'item',
      formatter: (param: { name: string; value: number[] }) =>
        `${param.name}<br/>` + data.axes.map((a, i) => `${a.label}: ${(param.value[i] ?? 0).toFixed(2)}`).join('<br/>') + '<br/>(1.00 = 기준, 클수록 좋음)'
    },
    radar: {
      radius: '66%',
      center: ['50%', '56%'],
      splitNumber: 4,
      indicator: data.axes.map((a) => ({ name: a.label, max: RADAR_MAX, min: 0 })),
      axisName: { color: p.text },
      splitLine: { lineStyle: { color: p.grid } },
      splitArea: { show: false },
      axisLine: { lineStyle: { color: p.grid } }
    },
    series: [
      {
        type: 'radar',
        symbol: 'circle',
        symbolSize: 5,
        data: [
          {
            name: '기준',
            value: data.axes.map(() => 1),
            symbol: 'none',
            lineStyle: { type: 'dashed', width: 2, color: BASE_COLOR },
            itemStyle: { color: BASE_COLOR }
          },
          ...data.series.map((s) => ({
            name: s.name,
            value: s.values,
            lineStyle: { width: 2, color: s.color },
            itemStyle: { color: s.color },
            areaStyle: { color: s.color, opacity: 0.12 }
          }))
        ]
      }
    ]
  } satisfies echarts.EChartsCoreOption
}

export function kpiRadarSummary(data: RadarData): string {
  return data.series.map((s) => `${s.name}: ${data.axes.map((a, i) => `${a.label} ${(s.values[i] ?? 0).toFixed(2)}`).join(', ')}`).join('; ')
}
