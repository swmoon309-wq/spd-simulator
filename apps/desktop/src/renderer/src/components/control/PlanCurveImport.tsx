import { useState } from 'react'
import { readPlanCurveCsv } from '../../lib/fileActions'
import type { PlanCurve } from '../../lib/planCurveCsv'
import { useAppStore } from '../../stores/appStore'

interface Pending {
  curve: PlanCurve
  fileName: string
}

/**
 * 계획서의 계획 곡선(CSV)을 PV로 쓴다(CTL-11). 시뮬레이션 시나리오 대신 현장 계획서의 누적 공수(와 선택으로 진척률)를
 * 채택 계획으로 삼는다. 이미 채택 계획이 있으면 개정 이력이 지워지므로 확인한다.
 */
export function PlanCurveImport() {
  const adopted = useAppStore((s) => s.adopted)
  const revisionCount = useAppStore((s) => s.revisions.length)
  const adoptPlanCurve = useAppStore((s) => s.adoptPlanCurve)
  const setNotice = useAppStore((s) => s.setNotice)
  const desktop = typeof window.spd !== 'undefined'
  const [pending, setPending] = useState<Pending | null>(null)

  const apply = (p: Pending) => {
    setPending(null)
    const err = adoptPlanCurve(p.curve, p.fileName)
    if (err) return setNotice({ kind: 'error', text: err })
    const details = [
      `총 예산 ${Math.round(p.curve.bac).toLocaleString('ko-KR')} 맨데이 · 계획 완료 ${p.curve.plannedCompletion.toFixed(1)}일`,
      p.curve.hasProgress ? '진척률은 파일의 값을 썼습니다.' : '진척률 열이 없어 진척률 = 누적 공수 ÷ 총 예산으로 두었습니다.',
      ...(p.curve.ignored.length > 0 ? [`맞지 않아 무시한 열: ${p.curve.ignored.join(', ')}`] : []),
      ...p.curve.warnings
    ]
    setNotice({ kind: p.curve.warnings.length > 0 || p.curve.ignored.length > 0 ? 'warning' : 'info', text: `'${p.fileName}'의 계획 곡선 ${p.curve.rows}행을 PV로 채택했습니다.`, details })
  }

  const onImport = async () => {
    const r = await readPlanCurveCsv()
    if (!r) return
    if (adopted) setPending(r)
    else apply(r)
  }

  return (
    <div className="actuals-toolbar" aria-label="계획 곡선 가져오기">
      <div className="row wrap">
        <button type="button" onClick={() => void onImport()} disabled={!desktop} title={desktop ? '현장 계획서의 일정 곡선(일, 누적 공수[, 진척률])을 PV로 쓴다' : '데스크톱 앱에서만 사용할 수 있습니다'}>
          계획 곡선 CSV를 PV로…
        </button>
        <span className="muted">열: 일, 누적 공수(effort)[, 진척률]. 시나리오 대신 현장 계획서의 곡선을 기준선으로 씁니다.</span>
      </div>
      {pending && (
        <div className="confirm" role="alert">
          채택 계획 '{adopted?.scenarioName}'을(를) 이 곡선으로 바꿉니다.
          {revisionCount > 0 && ` 기준선 개정 이력 ${revisionCount}건이 지워집니다.`}
          <button type="button" className="danger" onClick={() => apply(pending)}>
            바꾸기
          </button>
          <button type="button" onClick={() => setPending(null)}>
            취소
          </button>
        </div>
      )}
    </div>
  )
}
