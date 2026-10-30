import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  ToolboxComponent,
  TooltipComponent
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { VariableInfo } from '../catalog'
import type { LiveRun, ReferenceSeries, RunRecord } from '../stores/appStore'
import { timeSeriesOption } from '../lib/charts/timeSeriesOption'
import { useDarkMode } from './chartTheme'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  ToolboxComponent,
  MarkLineComponent,
  CanvasRenderer
])

interface Props {
  runs: RunRecord[]
  references: ReferenceSeries[]
  live: LiveRun | null
  variable: VariableInfo
}

export function TimeSeriesChart({ runs, references, live, variable }: Props) {
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

  const option = useMemo(() => timeSeriesOption({ runs, references, live, variable }, dark), [runs, references, live, variable, dark])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  const visibleCount = runs.filter((r) => r.visible).length + references.filter((r) => r.visible && r.variable === variable.name).length
  return (
    <div className="chart-wrap">
      <div ref={el} className="chart" role="img" aria-label={`${variable.label} 시계열 그래프, 표시 중인 실행 ${visibleCount}개`} />
      {visibleCount === 0 && !live && <div className="chart-empty">표시할 실행 결과가 없습니다. “실행”을 눌러 보세요.</div>}
    </div>
  )
}
