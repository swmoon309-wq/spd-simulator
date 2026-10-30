import type * as echarts from 'echarts/core'
import { chartPalette } from '../../components/chartTheme'
import { formatValue, type BarData } from '../scenarioCompare'

/** 지표 하나를 시나리오별 가로 막대로 비교하는 차트 옵션. 기준 값은 점선, 완료하지 못한 항목은 막대 없이 "(미완료)". 화면과 보고서가 함께 쓴다. */
export function kpiBarOption(data: BarData, dark: boolean) {
  const p = chartPalette(dark)
  const { spec } = data
  return {
    animation: false,
    textStyle: { color: p.text },
    grid: { left: 128, right: 96, top: 28, bottom: 28 },
    tooltip: {
      trigger: 'item',
      formatter: (param: { name: string; value: number | null }) => `${param.name}<br/>${spec.label}: <b>${formatValue(spec, param.value ?? null)}</b>`
    },
    xAxis: {
      type: 'value',
      name: `${spec.label}${spec.unit ? ` (${spec.unit})` : ''}`,
      nameLocation: 'middle',
      nameGap: 24,
      axisLine: { show: true, lineStyle: { color: p.axis } },
      splitLine: { lineStyle: { color: p.grid } }
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: data.categories.map((name, i) => (data.values[i] === null ? `${name} (미완료)` : name)),
      axisLabel: { width: 112, overflow: 'truncate', color: p.text },
      axisLine: { lineStyle: { color: p.axis } }
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 28,
        data: data.values.map((v, i) => ({ value: v, itemStyle: { color: data.colors[i] } })),
        label: { show: true, position: 'right', color: p.text, formatter: (r: { value: number | null }) => (r.value === null ? '' : formatValue(spec, r.value)) },
        markLine:
          data.baseValue === null
            ? undefined
            : {
                silent: true,
                symbol: 'none',
                label: { show: true, formatter: '기준', color: p.text },
                lineStyle: { type: 'dashed', color: p.axis, width: 1.5 },
                data: [{ xAxis: data.baseValue }]
              }
      }
    ]
  } satisfies echarts.EChartsCoreOption
}

/** 막대 차트의 높이(항목 수에 따라). */
export const kpiBarHeight = (data: BarData): number => Math.max(200, 80 + 40 * data.categories.length)

/** 스크린 리더와 보고서의 대체 문장. */
export function kpiBarSummary(data: BarData): string {
  return data.categories.map((name, i) => `${name} ${formatValue(data.spec, data.values[i] ?? null)}`).join(', ')
}
