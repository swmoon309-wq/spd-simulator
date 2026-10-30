import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { evmOption } from '../../lib/charts/evmOption'
import { describeChart, type ChartSpec } from '../../lib/evmCharts'
import { useDarkMode } from '../chartTheme'

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkLineComponent, CanvasRenderer])

/** EVM 차트 한 장. 선 모양(실선·점선)과 보고일 점을 함께 써 색에만 기대지 않는다. */
export function EvmChart({ spec }: { spec: ChartSpec }) {
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

  const option = useMemo(() => evmOption(spec, dark), [spec, dark])

  useEffect(() => {
    chart.current?.setOption(option, true)
  }, [option])

  return (
    <figure className="evm-chart">
      <figcaption className="muted">{spec.title}</figcaption>
      <div ref={el} className="evm-chart-canvas" role="img" aria-label={describeChart(spec)} />
    </figure>
  )
}
