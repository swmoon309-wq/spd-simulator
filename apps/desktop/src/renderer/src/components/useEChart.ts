import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, CanvasRenderer])

/** 요소에 차트를 붙이고 옵션이 바뀔 때마다 갱신한다. 크기는 요소를 따른다. */
export function useEChart(option: echarts.EChartsCoreOption | null) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

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

  useEffect(() => {
    if (option) chart.current?.setOption(option, { notMerge: true })
    else chart.current?.clear()
  }, [option])

  return el
}
