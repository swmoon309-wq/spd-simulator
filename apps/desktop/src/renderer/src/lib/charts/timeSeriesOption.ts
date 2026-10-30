import type * as echarts from 'echarts/core'
import type { LineSeriesOption } from 'echarts/charts'
import type { VariableInfo } from '../../catalog'
import { chartPalette } from '../../components/chartTheme'
import type { LiveRun, ReferenceSeries, RunRecord } from '../../stores/appStore'

export interface TimeSeriesInput {
  runs: RunRecord[]
  references: ReferenceSeries[]
  live: LiveRun | null
  variable: VariableInfo
}

/**
 * 실행 결과 시계열 차트 옵션. 화면은 확대·도구 상자·툴팁을 쓰고(`interactive`, 기본), 보고서는 정지 그림이라 그것들을 뺀다.
 * 실행 기록의 완료일은 같은 색의 점선 세로선으로 보인다.
 */
export function timeSeriesOption({ runs, references, live, variable }: TimeSeriesInput, dark: boolean, interactive = true) {
  const p = chartPalette(dark)
  const visible = runs.filter((r) => r.visible)
  const series: LineSeriesOption[] = visible.map((r) => {
    const t = r.result.time
    const y = r.result.series[variable.name]
    const data: [number, number][] = []
    if (y) for (let i = 0; i < t.length; i++) data.push([t[i] as number, y[i] as number])
    return {
      name: r.name,
      type: 'line',
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 2, color: r.color },
      itemStyle: { color: r.color },
      data,
      markLine:
        r.kpis.completionDay === null
          ? undefined
          : {
              silent: true,
              symbol: 'none',
              label: { show: false },
              lineStyle: { type: 'dashed', color: r.color, opacity: 0.55, width: 1 },
              data: [{ xAxis: r.kpis.completionDay }]
            }
    }
  })
  const shownRefs = references.filter((r) => r.visible && r.variable === variable.name)
  const refName = (r: ReferenceSeries) => {
    const base = `기준 · ${r.column} (${r.fileName})`
    return shownRefs.some((o) => o.id !== r.id && `기준 · ${o.column} (${o.fileName})` === base) ? `${base} #${r.id}` : base
  }
  shownRefs.forEach((r, i) => {
    const color = p.refs[i % p.refs.length] as string
    series.push({
      name: refName(r),
      type: 'line',
      z: 5,
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: r.points.length <= 400,
      lineStyle: { width: 1.5, type: 'dashed', color },
      itemStyle: { color },
      data: r.points
    })
  })
  const liveValues = live?.values[variable.name]
  if (live && liveValues && live.time.length > 0) {
    series.push({
      name: '실행 중',
      type: 'line',
      showSymbol: false,
      lineStyle: { width: 2, type: 'dotted', color: p.axis },
      itemStyle: { color: p.axis },
      data: live.time.map((t, i) => [t, liveValues[i] as number])
    })
  }
  return {
    animation: false,
    textStyle: { color: p.text },
    color: [...visible.map((r) => r.color)],
    grid: { left: 64, right: 24, top: interactive ? 80 : 56, bottom: interactive ? 72 : 48 },
    legend: { top: 4, type: 'scroll', textStyle: { color: p.text } },
    ...(interactive ? { toolbox: { right: 8, top: 24, feature: { saveAsImage: { title: '이미지 저장', name: variable.label } } } } : {}),
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: unknown) => (typeof v === 'number' ? Number(v.toPrecision(5)).toString() : String(v))
    },
    xAxis: {
      type: 'value',
      name: '일',
      nameLocation: 'middle',
      nameGap: 30,
      min: 0,
      axisLine: { lineStyle: { color: p.axis } },
      splitLine: { lineStyle: { color: p.grid } }
    },
    yAxis: {
      type: 'value',
      name: `${variable.label} (${variable.unit})`,
      nameTextStyle: { align: 'left' },
      scale: false,
      axisLine: { show: true, lineStyle: { color: p.axis } },
      splitLine: { lineStyle: { color: p.grid } }
    },
    ...(interactive
      ? {
          dataZoom: [
            { type: 'inside', xAxisIndex: 0 },
            { type: 'slider', xAxisIndex: 0, height: 18, bottom: 8 }
          ]
        }
      : {}),
    series
  } satisfies echarts.EChartsCoreOption
}
