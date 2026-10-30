import { useMemo } from 'react'
import type { KpiSpec } from '@spd/analysis'
import { confidenceLabel, confidenceOption, histogramLabel, histogramOption } from '../../lib/charts/riskOptions'
import type { DistributionView } from '../../lib/riskView'
import { useDarkMode } from '../chartTheme'
import { useEChart } from '../useEChart'

/** 히스토그램: 구간별 반복 수. 접근성 이름에 요약을 넣고 같은 값을 표로도 낸다(상위 화면). */
export function HistogramChart({ view, spec }: { view: DistributionView; spec: KpiSpec }) {
  const dark = useDarkMode()
  const option = useMemo(() => histogramOption(view, spec, dark), [view, spec, dark])
  const el = useEChart(option)
  const label = histogramLabel(view, spec)
  return <div ref={el} className="risk-chart" role="img" aria-label={label} />
}

/** 신뢰 수준 차트: 세로 = 이 값 이하로 끝날 확률. P50·P80·P90을 점선으로 겹친다. */
export function ConfidenceChart({ view, spec, targets = [] }: { view: DistributionView; spec: KpiSpec; targets?: number[] }) {
  const dark = useDarkMode()
  const option = useMemo(() => confidenceOption(view, spec, targets, dark), [view, spec, targets, dark])
  const el = useEChart(option)
  const label = confidenceLabel(view, spec)
  return <div ref={el} className="risk-chart" role="img" aria-label={label} />
}
