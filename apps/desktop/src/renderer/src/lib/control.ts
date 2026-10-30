import { reforecastAdapters, evaluateAlerts, evmSeriesRevised, isWorsening, ratio, validateActuals, type AlertEvent, type EvmSettings, type Revision, type ActualRow, type EvmPoint, type RowIssues } from '@spd/analysis'
import type { Adopted } from './adoption'

export interface ControlView {
  /** `actuals`와 같은 길이 */
  issues: RowIssues[]
  /** 채택 계획이 있을 때만. 오류 행은 빠진다 */
  points: EvmPoint[]
  /** 보고일마다 평가한 경고 */
  events: AlertEvent[]
  /** 최근 구간의 CPI가 연속 하락 중인가 */
  cpiWorsening: boolean
  /** 최근 구간의 SPI가 연속 하락 중인가 */
  spiWorsening: boolean
}

/** 실적 행을 검사하고, 채택 계획이 있으면 보고일별 지표와 경고를 계산한다. 채택이 없으면 검사만 한다. */
export interface ControlOptions {
  /** 기준선 개정 이력. 개정 이후 보고일은 개정 기준선으로 계산한다. */
  revisions?: Revision[]
  /** true이면 개정을 무시하고 원 기준선으로만 계산한다(누적 지연을 본다) */
  original?: boolean
}

export function buildControlView(
  adopted: Adopted | null,
  actuals: ActualRow[],
  fallback: { credits: { variable: string; weight: number }[]; totalTasks: number },
  settings: EvmSettings,
  options: ControlOptions = {}
): ControlView {
  const credits = adopted?.credits ?? fallback.credits
  const total = adopted?.totalTasks ?? fallback.totalTasks
  const issues = validateActuals(actuals, credits, total)
  if (!adopted) return { issues, points: [], events: [], cpiWorsening: false, spiWorsening: false }
  const points = evmSeriesRevised(adopted, options.revisions ?? [], actuals, issues, settings.k, options.original ?? false)
  const n = settings.alerts.trend
  return {
    issues,
    points,
    events: evaluateAlerts(points, settings),
    cpiWorsening: isWorsening(points.map((p) => p.cpiK), n),
    spiWorsening: isWorsening(points.map((p) => p.spiK), n)
  }
}

/** 지수 표시: 소수 2자리, 계산 불가는 "–". */
export const formatIndex = (x: number | null): string => (x === null ? '–' : x.toFixed(2))

/** 편차·금액 표시: 부호를 붙이고 정수로. */
export const formatSigned = (x: number): string => {
  const r = Math.round(x)
  return r > 0 ? `+${r.toLocaleString('ko-KR')}` : r.toLocaleString('ko-KR')
}

/**
 * 생산성 보정 계수 κ의 후보(재예측·조치 시험, 설계 05의 7.2). 누적 지수는 개정 기준선에서는 **개정 이후 구간의 지수**
 * (`(EV − EV₀) / (AC − AC₀)`)로 본다. 개정 시점의 과거 초과를 생산성으로 다시 세지 않기 위해서다.
 */
export function kappasOf(point: import('@spd/analysis').EvmPoint, revisions: Revision[]): { cum: number | null; recent: number | null } {
  const rev = point.revision ? revisions.find((r) => r.number === point.revision) : undefined
  const cum = rev ? ratio(point.ev - rev.ev0, point.ac - rev.ac0) : point.cpi
  const pos = (x: number | null) => (x !== null && x > 0 ? x : null)
  return { cum: pos(cum), recent: pos(point.cpiK) }
}

/**
 * 재예측과 시정 조치 시험은 모델마다 상태를 실적으로 덮어쓰는 어댑터가 있어야 한다. 없는 모델(기본 구조 라이브러리)이면 이유를,
 * 있으면 null을 돌려준다. 실적에 따른 CPI·SPI·경고·완료 예측(EVM)은 어댑터 없이도 쓸 수 있다.
 */
export function reforecastUnsupported(modelId: string, title?: string): string | null {
  return reforecastAdapters[modelId] ? null : `이 모델${title ? `(${title})` : ''}은 재예측과 시정 조치 시험을 지원하지 않습니다. 실적에 따른 CPI·SPI·경고와 완료 예측은 쓸 수 있습니다.`
}
