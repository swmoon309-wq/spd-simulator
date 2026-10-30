import { useMemo } from 'react'
import type { RunResult } from '@spd/sd-engine'
import type { ColumnEval } from '../../lib/validationView'
import { chartPalette, useDarkMode } from '../chartTheme'
import { useEChart } from '../useEChart'

const MAX_LINE_POINTS = 800

/** 시뮬레이션 곡선(선)과 관측(점)을 겹쳐 그린다. */
export function ObservedChart({ result, ev, label, unit }: { result: RunResult; ev: ColumnEval; label: string; unit: string }) {
  const dark = useDarkMode()
  const option = useMemo(() => {
    const p = chartPalette(dark)
    const series = result.series[ev.variable] as Float64Array
    const step = Math.max(1, Math.ceil(result.time.length / MAX_LINE_POINTS))
    const line: [number, number][] = []
    for (let i = 0; i < result.time.length; i += step) line.push([result.time[i] as number, series[i] as number])
    const last = result.time.length - 1
    if (last % step !== 0) line.push([result.time[last] as number, series[last] as number])
    return {
      animation: false,
      textStyle: { color: p.text },
      legend: { top: 0, textStyle: { color: p.text } },
      grid: { left: 60, right: 20, top: 36, bottom: 44 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'value', name: '일', nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      yAxis: { type: 'value', scale: true, name: `${label}${unit ? ` (${unit})` : ''}`, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        { name: '시뮬레이션', type: 'line', showSymbol: false, lineStyle: { color: p.refs[2], width: 2 }, itemStyle: { color: p.refs[2] }, data: line },
        { name: '관측', type: 'scatter', symbol: 'diamond', symbolSize: 9, itemStyle: { color: p.refs[1] }, data: ev.aligned.time.map((t, i) => [t, ev.aligned.observed[i]]) }
      ]
    }
  }, [result, ev, label, unit, dark])
  const el = useEChart(option)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${label}: 시뮬레이션 곡선과 관측 ${ev.aligned.time.length}점`} />
}

/** 잔차(시뮬레이션 − 관측). 0보다 위면 시뮬레이션이 크다. */
export function ResidualChart({ ev, label, unit }: { ev: ColumnEval; label: string; unit: string }) {
  const dark = useDarkMode()
  const option = useMemo(() => {
    const p = chartPalette(dark)
    return {
      animation: false,
      textStyle: { color: p.text },
      grid: { left: 60, right: 20, top: 24, bottom: 44 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'value', name: '일', nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      yAxis: { type: 'value', scale: true, name: `잔차${unit ? ` (${unit})` : ''}`, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      series: [
        {
          type: 'line',
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: p.refs[2], width: 1.5 },
          itemStyle: { color: p.refs[2] },
          data: ev.residuals,
          markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dashed', color: p.axis }, label: { show: false }, data: [{ yAxis: 0 }] }
        }
      ]
    }
  }, [ev, unit, dark])
  const el = useEChart(option)
  const maxAbs = ev.residuals.reduce((m, [, v]) => Math.max(m, Math.abs(v)), 0)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${label} 잔차(시뮬레이션 − 관측): ${ev.residuals.length}점, 최대 ${maxAbs.toFixed(2)}${unit}`} />
}

export interface OverlaySeries {
  name: string
  color: string
  time: ArrayLike<number>
  values: ArrayLike<number>
  dashed?: boolean
}

/** 여러 실행의 같은 변수를 겹쳐 그린다(기준 vs 극단 값, 기준 vs 교란). `marks`는 변경 시각의 세로선. */
/** 관측 점(산점도). 시뮬레이션 곡선 위에 겹쳐 그린다. */
export interface OverlayPoints {
  name: string
  color: string
  data: [number, number][]
}

export function OverlayChart({ series, label, unit, marks = [], points = [] }: { series: OverlaySeries[]; label: string; unit: string; marks?: number[]; points?: OverlayPoints[] }) {
  const dark = useDarkMode()
  const option = useMemo(() => {
    const p = chartPalette(dark)
    return {
      animation: false,
      textStyle: { color: p.text },
      legend: { top: 0, textStyle: { color: p.text } },
      grid: { left: 60, right: 20, top: 36, bottom: 44 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'value', name: '일', nameLocation: 'middle', nameGap: 28, axisLine: { lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      yAxis: { type: 'value', scale: true, name: `${label}${unit ? ` (${unit})` : ''}`, axisLine: { show: true, lineStyle: { color: p.axis } }, splitLine: { lineStyle: { color: p.grid } } },
      series: series.map((s, k) => {
        const step = Math.max(1, Math.ceil(s.time.length / MAX_LINE_POINTS))
        const data: [number, number][] = []
        for (let i = 0; i < s.time.length; i += step) data.push([s.time[i] as number, s.values[i] as number])
        const last = s.time.length - 1
        if (last >= 0 && last % step !== 0) data.push([s.time[last] as number, s.values[last] as number])
        return {
          name: s.name,
          type: 'line',
          showSymbol: false,
          lineStyle: { color: s.color, width: 2, ...(s.dashed ? { type: 'dashed' as const } : {}) },
          itemStyle: { color: s.color },
          data,
          ...(k === 0 && marks.length > 0 ? { markLine: { silent: true, symbol: 'none', lineStyle: { type: 'dotted' as const, color: p.axis }, label: { show: false }, data: marks.map((x) => ({ xAxis: x })) } } : {})
        }
      }).concat(points.map((pt) => ({ name: pt.name, type: 'scatter', symbol: 'diamond', symbolSize: 8, itemStyle: { color: pt.color }, data: pt.data }) as never))
    }
  }, [series, label, unit, marks, points, dark])
  const el = useEChart(option)
  return <div ref={el} className="risk-chart" role="img" aria-label={`${label}: ${[...series.map((s) => s.name), ...points.map((p) => `${p.name} ${p.data.length}점`)].join(' 대 ')}`} />
}
