import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { RadarChart } from 'echarts/charts'
import { LegendComponent, RadarComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { kpiRadarOption, kpiRadarSummary } from '../../lib/charts/kpiRadarOption'
import type { RadarData } from '../../lib/scenarioCompare'
import { useDarkMode } from '../chartTheme'

echarts.use([RadarChart, RadarComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/**
 * 레이더 차트. 기준 = 1(점선 원)로 정규화한 값이며 바깥일수록 기준보다 좋다(상한 2).
 * 그릴 수 없는 이유와 제외한 시나리오는 차트 밑에 글로 알린다.
 */
export function KpiRadarChart({ data }: { data: RadarData }) {
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

  const option = useMemo(() => kpiRadarOption(data, dark), [data, dark])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  const summary = kpiRadarSummary(data)
  return <div ref={el} className="kpi-chart radar" style={{ height: 360 }} role="img" aria-label={`레이더 차트(기준 = 1, 클수록 좋음). ${summary}`} />
}
