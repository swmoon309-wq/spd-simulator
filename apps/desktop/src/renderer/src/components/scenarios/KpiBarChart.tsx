import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { kpiBarHeight, kpiBarOption, kpiBarSummary } from '../../lib/charts/kpiBarOption'
import type { BarData } from '../../lib/scenarioCompare'
import { useDarkMode } from '../chartTheme'

echarts.use([BarChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])

/** 지표 하나를 시나리오별 가로 막대로 비교한다. 기준 값은 점선, 완료하지 못한 항목은 막대 없이 "(미완료)". */
export function KpiBarChart({ data }: { data: BarData }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const dark = useDarkMode()

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current)
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  const option = useMemo(() => kpiBarOption(data, dark), [data, dark])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  const height = kpiBarHeight(data)
  const summary = kpiBarSummary(data)
  return <div ref={el} className="kpi-chart" style={{ height }} role="img" aria-label={`${data.spec.label} 막대 차트: ${summary}`} />
}
