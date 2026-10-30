import { useMemo } from 'react'
import type { BandPoint } from '@spd/analysis'
import { chartPalette, useDarkMode } from '../chartTheme'
import { useEChart } from '../useEChart'

/** 시계열 띠: 중앙값(P50)과 P10~P90 띠. */
export function BandChart({ label, unit, points }: { label: string; unit: string; points: BandPoint[] }) {
  const dark = useDarkMode()
  const option = useMemo(() => {
    const p = chartPalette(dark)
    const color = p.refs[2]
    return {
      animation: false,
      textStyle: { color: p.text },
      grid: { left: 56, right: 16, top: 16, bottom: 44 },
      tooltip: {
        trigger: 'axis',
        formatter: (a: { dataIndex: number }[]) => {
          const b = points[a[0]?.dataIndex ?? 0]
          return b ? `${b.time}일<br/>P10 ${b.p10.toFixed(1)} · <b>P50 ${b.p50.toFixed(1)}</b> · P90 ${b.p90.toFixed(1)}` : ''
        }
      },
      xAxis: { type: 'category', data: points.map((b) => b.time), name: '일', nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, axisLabel: { color: p.text } },
      yAxis: { type: 'value', scale: true, name: `${label}${unit ? ` (${unit})` : ''}`, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, data: points.map((b) => b.p10) },
        { type: 'line', stack: 'band', symbol: 'none', lineStyle: { opacity: 0 }, areaStyle: { color, opacity: 0.25 }, data: points.map((b) => b.p90 - b.p10) },
        { type: 'line', symbol: 'none', lineStyle: { color, width: 2 }, data: points.map((b) => b.p50) }
      ]
    }
  }, [points, label, unit, dark])
  const el = useEChart(option)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${label} 시계열 띠: 중앙값과 P10~P90`} />
}
