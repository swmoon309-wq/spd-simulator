import { DEFAULT_TREND, DEFAULT_WINDOW, isWorsening } from './indicators'
import type { EvmPoint } from './actuals'

/** 경고 임계값과 구간 설정. 프로젝트 파일(`evm`)에 저장한다. 설계 05의 5.3. */
export interface EvmSettings {
  /** 최근 구간 지수의 보고 구간 수 */
  k: number
  alerts: {
    /** CPI·SPI가 이보다 낮으면 주의 */
    warn: number
    /** CPI·SPI가 이보다 낮으면 위험 */
    critical: number
    /** 구간 지수가 이만큼 연속 하락하면 주의 */
    trend: number
    /** 조기 경고: 진척률이 이 이상이고 CPI가 이 미만이면 회복이 어렵다고 알린다 */
    early: { progress: number; cpi: number }
  }
}

export const DEFAULT_EVM_SETTINGS: EvmSettings = {
  k: DEFAULT_WINDOW,
  alerts: { warn: 0.9, critical: 0.8, trend: DEFAULT_TREND, early: { progress: 0.15, cpi: 0.9 } }
}

export const cloneEvmSettings = (s: EvmSettings): EvmSettings => ({ k: s.k, alerts: { ...s.alerts, early: { ...s.alerts.early } } })

/** 설정 검사. 문제가 없으면 null. */
export function validateEvmSettings(s: EvmSettings): string | null {
  const finite = (x: number) => Number.isFinite(x)
  if (!Number.isInteger(s.k) || s.k < 1 || s.k > 10) return '구간 수는 1~10의 정수여야 합니다'
  const a = s.alerts
  if (![a.warn, a.critical, a.early.progress, a.early.cpi].every(finite)) return '임계값은 유한한 수여야 합니다'
  if (!(a.critical > 0) || !(a.warn <= 2)) return '임계값은 0보다 크고 2 이하여야 합니다'
  if (a.critical > a.warn) return '위험 임계값은 주의 임계값보다 클 수 없습니다'
  if (!Number.isInteger(a.trend) || a.trend < 2 || a.trend > 10) return '연속 하락 횟수는 2~10의 정수여야 합니다'
  if (a.early.progress < 0 || a.early.progress > 1) return '조기 경고 진척률은 0~1이어야 합니다'
  if (!(a.early.cpi > 0) || a.early.cpi > 2) return '조기 경고 CPI는 0보다 크고 2 이하여야 합니다'
  return null
}

export type AlertLevel = 'warn' | 'critical'
export type AlertRule = 'cpi' | 'spi' | 'trend' | 'early'

export interface AlertEvent {
  /** 발생한 보고일 */
  day: number
  level: AlertLevel
  rule: AlertRule
  message: string
}

const f2 = (x: number) => x.toFixed(2)

/**
 * 보고일마다 경고를 평가한다. 지수가 계산 불가(null)인 지표는 건너뛴다. 추세는 그 보고일까지의 구간 지수로 본다.
 */
export function evaluateAlerts(points: EvmPoint[], settings: EvmSettings): AlertEvent[] {
  const { warn, critical, trend, early } = settings.alerts
  const events: AlertEvent[] = []
  points.forEach((p, i) => {
    for (const [rule, label, v] of [['cpi', 'CPI', p.cpi], ['spi', 'SPI', p.spi]] as const) {
      if (v === null) continue
      if (v < critical) events.push({ day: p.day, level: 'critical', rule, message: `${label} ${f2(v)}가 위험 임계값 ${critical} 미만입니다` })
      else if (v < warn) events.push({ day: p.day, level: 'warn', rule, message: `${label} ${f2(v)}가 주의 임계값 ${warn} 미만입니다` })
    }
    const upto = points.slice(0, i + 1)
    const worse = [isWorsening(upto.map((q) => q.cpiK), trend) && 'CPI', isWorsening(upto.map((q) => q.spiK), trend) && 'SPI'].filter(Boolean)
    if (worse.length > 0) events.push({ day: p.day, level: 'warn', rule: 'trend', message: `최근 구간 ${worse.join('·')}가 연속 ${trend}번 하락했습니다(악화 중)` })
    if (p.cpi !== null && p.progress >= early.progress && p.cpi < early.cpi) {
      events.push({ day: p.day, level: 'critical', rule: 'early', message: '회복이 어렵습니다. 더 나빠지지 않게 하고 먼 예측을 현재 초과에 맞춰 조정하세요' })
    }
  })
  return events
}

export type Status = 'none' | 'normal' | 'warn' | 'critical'

/** `day`의 상태: 그날 발생한 경고 중 가장 심각한 수준. 보고가 없으면 'none'. */
export function statusAt(events: AlertEvent[], points: EvmPoint[], day: number): Status {
  if (!points.some((p) => p.day === day)) return 'none'
  const here = events.filter((e) => e.day === day)
  if (here.some((e) => e.level === 'critical')) return 'critical'
  if (here.some((e) => e.level === 'warn')) return 'warn'
  return 'normal'
}
