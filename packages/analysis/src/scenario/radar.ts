import type { KpiSpec, KpiValues } from './kpi'

/** 레이더 정규화 값의 상한. 바깥쪽 끝이 "기준의 2배 좋음"이다. */
export const RADAR_MAX = 2

export interface RadarAxis {
  id: string
  label: string
  /** 이 축을 대표하는 지표 */
  kpiId: string
}

export interface RadarSeries {
  id: string
  /** 축 순서대로의 값. 그릴 수 없으면 null */
  values: (number | null)[]
}

export interface RadarResult {
  /** 그릴 수 있는 축 */
  axes: RadarAxis[]
  /** 그릴 수 없는 축과 이유 */
  skipped: { axis: RadarAxis; reason: string }[]
  series: RadarSeries[]
}

/**
 * 레이더용 정규화. 기준 = 1, 바깥일수록 좋음. 좋은 방향이 낮음이면 `기준 ÷ 값`, 높음이면 `값 ÷ 기준`이고
 * 0 이상 RADAR_MAX 이하로 제한한다. 기준이 null·0이거나 방향이 없는 지표의 축은 그리지 않고 이유를 돌려준다.
 */
export function normalizeForRadar(
  axes: RadarAxis[],
  specs: KpiSpec[],
  base: KpiValues,
  scenarios: { id: string; kpis: KpiValues }[]
): RadarResult {
  const usable: RadarAxis[] = []
  const skipped: RadarResult['skipped'] = []
  const spec = (axis: RadarAxis) => specs.find((s) => s.id === axis.kpiId)

  for (const axis of axes) {
    const s = spec(axis)
    const b = base[axis.kpiId] ?? null
    if (!s) skipped.push({ axis, reason: '지표 정의가 없습니다' })
    else if (s.better === 'none') skipped.push({ axis, reason: '좋은 방향이 정해지지 않은 지표입니다' })
    else if (b === null) skipped.push({ axis, reason: '기준 시나리오의 값이 없습니다(미완료 등)' })
    else if (!(b > 0)) skipped.push({ axis, reason: '기준 값이 0 이하라 비율을 정할 수 없습니다' })
    else usable.push(axis)
  }

  const score = (better: 'lower' | 'higher', b: number, v: number): number => {
    if (better === 'lower') return v <= 0 ? RADAR_MAX : Math.min(RADAR_MAX, b / v)
    return Math.max(0, Math.min(RADAR_MAX, v / b))
  }

  const series = scenarios.map((sc) => ({
    id: sc.id,
    values: usable.map((axis) => {
      const s = spec(axis) as KpiSpec
      const v = sc.kpis[axis.kpiId] ?? null
      return v === null ? null : score(s.better as 'lower' | 'higher', base[axis.kpiId] as number, v)
    })
  }))
  return { axes: usable, skipped, series }
}
