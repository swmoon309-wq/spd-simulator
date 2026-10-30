import type { AppState } from './state'

/**
 * 다른 실행이 진행 중이어서 새 실행을 시작할 수 없는 이유(없으면 null). 시뮬레이션·시나리오 일괄 실행·재예측·조치 시험·위험 분석은
 * 하나의 Worker를 쓰므로 한 번에 하나만 실행한다(설계 06의 4.3).
 */
export function busyReason(s: Pick<AppState, 'status' | 'batch' | 'riskRun' | 'riskCompare' | 'reforecast' | 'actionRun'>): string | null {
  if (s.status === 'running') return '시뮬레이션이 실행 중입니다.'
  if (s.batch !== null) return '시나리오 일괄 실행 중입니다.'
  if (s.riskRun?.status === 'running' || s.riskCompare?.status === 'running') return '위험 분석이 실행 중입니다.'
  if (s.reforecast?.status === 'running' || s.actionRun?.status === 'running') return '재예측 또는 조치 시험이 실행 중입니다.'
  return null
}
