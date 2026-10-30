import { busyReason, selectCompareStale, selectOatStale, selectRiskStale, useAppStore } from '../../stores/appStore'
import type { ReportKind, SectionInfo } from './model'

const store = () => useAppStore.getState()

/**
 * "필요한 결과 만들기"(설계 09의 4.2)로 채울 수 있는 절인지. 시나리오 비교·차트는 일괄 실행, 위험 분석 절은 위험 분석 실행으로 채운다.
 * 재예측·시정 조치 시험은 판단이 필요한 일이라 자동으로 만들지 않는다(통제 탭에서 직접 실행).
 */
export function makeable(kind: ReportKind, sections: SectionInfo[]): boolean {
  const open = sections.filter((s) => s.status === 'missing' || s.status === 'stale')
  if (kind === 'scenarios') return open.some((s) => s.id === 'comparison' || s.id === 'charts')
  if (kind === 'risk') return open.some((s) => ['riskResults', 'riskTargets', 'riskSensitivity', 'riskConvergence', 'riskCompare'].includes(s.id))
  return false
}

/**
 * 보고서에 필요한 결과 중 없거나 오래된 것을 기존 액션으로 만든다(이미 최신이면 다시 실행하지 않는다). 하나의 Worker 규칙에 따라 차례로
 * 실행하고, 하지 못한 이유를 모아 돌려준다.
 */
export async function makeMissingResults(kind: ReportKind): Promise<string[]> {
  const messages: string[] = []
  const busy = busyReason(store())
  if (busy) return [busy]

  if (kind === 'scenarios') {
    const outcome = await store().runScenarios('missing')
    if (outcome === null) messages.push('시나리오를 실행하지 못했습니다(입력 오류가 있거나 다른 실행이 진행 중입니다).')
  }

  if (kind === 'risk') {
    const s = store()
    if (s.risk.inputs.length === 0) return ['위험 분석을 하려면 먼저 위험 분석 탭에서 불확실한 입력을 정하세요.']
    if (!s.riskRun?.result || selectRiskStale(s) || s.riskRun.status === 'canceled') {
      const reason = await store().runRisk()
      if (reason) messages.push(reason)
    }
    const s2 = store()
    if (s2.risk.inputs.length > 0 && (!s2.riskSens.oat || selectOatStale(s2))) {
      const reason = store().runRiskOat()
      if (reason) messages.push(reason)
    }
    const s3 = store()
    if (s3.risk.compareIds.length >= 2 && (!s3.riskCompare || selectCompareStale(s3) || s3.riskCompare.status === 'canceled')) {
      const reason = await store().runRiskCompare()
      if (reason) messages.push(reason)
    }
  }
  return messages
}
