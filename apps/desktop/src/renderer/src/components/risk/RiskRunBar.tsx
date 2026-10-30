import { useState } from 'react'
import { getEntry } from '../../catalog'
import { MAX_ITERATIONS } from '@spd/analysis'
import { BASE_ID } from '../../lib/scenarioRunner'
import { riskProblems } from '../../lib/risk'
import { checkRunSettings } from '../../lib/runSettings'
import { riskStatusText } from '../../lib/riskView'
import { busyReason, selectRiskStale, useAppStore } from '../../stores/appStore'
import { exportRiskCsv } from '../../lib/fileActions'
import { DraftNumber } from '../DraftNumber'

/** 대상 시나리오·반복 수·시드, 실행·중단, 진행 상태. */
export function RiskRunBar() {
  const modelId = useAppStore((s) => s.modelId)
  const risk = useAppStore((s) => s.risk)
  const run = useAppStore((s) => s.riskRun)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const runSettings = useAppStore((s) => s.runSettings)
  const fieldInvalid = useAppStore((s) => Object.keys(s.paramErrors).length > 0)
  const busy = useAppStore((s) => (s.riskRun?.status === 'running' ? null : busyReason(s)))
  const stale = useAppStore(selectRiskStale)
  const setScenario = useAppStore((s) => s.setRiskScenario)
  const setN = useAppStore((s) => s.setRiskIterations)
  const setSeed = useAppStore((s) => s.setRiskSeed)
  const setBand = useAppStore((s) => s.setRiskBand)
  const runRisk = useAppStore((s) => s.runRisk)
  const cancelRisk = useAppStore((s) => s.cancelRisk)
  const [error, setError] = useState<string | null>(null)

  const entry = getEntry(modelId)
  const running = run?.status === 'running'
  const comboError = checkRunSettings(runSettings)
  const problems = riskProblems(entry, risk, params, scenarios)
  const blocked = busy ?? (fieldInvalid ? '실험 탭의 입력 오류를 먼저 고치세요.' : (comboError ?? problems[0] ?? null))
  const pct = run && run.total > 0 ? Math.round((run.completed / run.total) * 100) : 0

  const start = async () => {
    setError(null)
    const message = await runRisk()
    setError(message)
  }

  return (
    <section className="run-panel" aria-label="위험 분석 실행">
      <div className="row wrap">
        <label className="risk-field">
          <span>대상</span>
          <select value={risk.scenarioId} disabled={running} onChange={(e) => setScenario(e.target.value)}>
            <option value={BASE_ID}>기준</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="risk-field">
          <span>반복</span>
          <DraftNumber id="risk-n" label="반복 수" value={risk.n} onValue={(v) => setN(v)} />
        </label>
        <label className="risk-field">
          <span>시드</span>
          <DraftNumber id="risk-seed" label="시드" value={risk.seed} onValue={(v) => setSeed(v)} />
        </label>
        <label className="risk-field">
          <span>시간 변화 변수</span>
          <select value={risk.bandVariable ?? ''} disabled={running} onChange={(e) => setBand(e.target.value || null)}>
            <option value="">없음</option>
            {entry.variables.map((v) => (
              <option key={v.name} value={v.name}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className="danger" onClick={cancelRisk}>
            중단
          </button>
        ) : (
          <button type="button" className="primary" disabled={blocked !== null} title={blocked ?? '입력 분포에서 표본을 뽑아 반복 실행합니다'} onClick={() => void start()}>
            실행
          </button>
        )}
        {running && (
          <div className="progress" role="progressbar" aria-label="위험 분석 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <p className="muted" role="status" aria-live="polite">
        {riskStatusText(run?.status ?? 'idle', run?.completed ?? 0, run?.total ?? 0, stale)}
      </p>
      {!running && blocked !== null && risk.inputs.length > 0 && <p className="muted">실행할 수 없음: {blocked}</p>}
      {(error ?? run?.error) && (
        <div className="field-error" role="alert">
          {error ?? run?.error}
        </div>
      )}
      <div className="row wrap">
        <button type="button" disabled={!run?.result || running || typeof window.spd === 'undefined'} title={typeof window.spd === 'undefined' ? '데스크톱 앱에서만 사용할 수 있습니다' : run?.result ? '반복마다의 입력 표본과 지표' : '먼저 실행하세요'} onClick={() => void exportRiskCsv('iterations')}>
          반복별 CSV…
        </button>
        <button type="button" disabled={!run?.result || running || typeof window.spd === 'undefined'} title={typeof window.spd === 'undefined' ? '데스크톱 앱에서만 사용할 수 있습니다' : run?.result ? '지표별 평균·신뢰구간·백분위수' : '먼저 실행하세요'} onClick={() => void exportRiskCsv('summary')}>
          요약 통계 CSV…
        </button>
      </div>
      <p className="muted">반복은 {MAX_ITERATIONS}회까지, 시드가 같으면 결과도 같습니다. 종료 시각과 dt는 실험 탭의 설정을 따릅니다.</p>
    </section>
  )
}
