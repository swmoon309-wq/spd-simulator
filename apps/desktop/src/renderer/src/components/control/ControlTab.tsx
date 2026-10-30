import { useMemo, useState } from 'react'
import { baselineOfPoint, forecastAt, statusAt } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { controlUnsupported, evmOf } from '../../catalog/evm'
import { adoptionSummary, PLAN_CSV_SCENARIO_ID } from '../../lib/adoption'
import { buildControlView } from '../../lib/control'
import { buildEvmCharts } from '../../lib/evmCharts'
import { useAppStore } from '../../stores/appStore'
import { useAdoptionStatus } from '../scenarios/AdoptionPanel'
import { ActualsTable } from './ActualsTable'
import { ActualsToolbar } from './ActualsToolbar'
import { AlertList, AlertSettingsForm } from './AlertPanel'
import { EvmChart } from './EvmChart'
import { ActionPanel } from './ActionPanel'
import { PlanCurveImport } from './PlanCurveImport'
import { ForecastPanel } from './ForecastPanel'
import { RevisionHistory } from './RevisionHistory'
import { ReforecastPanel, useCurrentReforecast } from './ReforecastPanel'
import { IndicatorTable } from './IndicatorTable'
import { KpiCards } from './KpiCards'

const PLAN_CURVE_NO_SIM = '계획 곡선(CSV)을 PV로 쓰는 중에는 재예측과 시정 조치 시험을 쓸 수 없습니다. 이 기능은 모델로 계획을 다시 실행해 출발하는데, 계획서의 곡선은 모델에서 나온 것이 아니기 때문입니다. 시나리오를 채택하면 쓸 수 있습니다.'

/** 통제 탭: 채택한 계획에 대한 실적 입력, Earned Value 지표·차트, 경고. 진척 정의가 없는 모델은 안내만 보인다. */
export function ControlTab() {
  const modelId = useAppStore((s) => s.modelId)
  const reason = controlUnsupported(getEntry(modelId))
  if (reason) {
    return (
      <div className="tab-body">
        <p className="notice warning" role="status">
          {reason}
        </p>
      </div>
    )
  }
  return <ControlBody />
}

function ControlBody() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const adopted = useAppStore((s) => s.adopted)
  const actuals = useAppStore((s) => s.actuals)
  const evm = useAppStore((s) => s.evm)
  const revisions = useAppStore((s) => s.revisions)
  const adoption = useAdoptionStatus()
  const [useOriginal, setUseOriginal] = useState(false)
  const entry = getEntry(modelId)
  const [selected, setSelected] = useState<number | null>(null)
  const view = useMemo(
    () => buildControlView(adopted, actuals, { credits: evmOf(entry).credits, totalTasks: evmOf(entry).totalTasks(params) }, evm, { revisions, original: useOriginal }),
    [adopted, actuals, entry, params, evm, revisions, useOriginal]
  )

  // 보고 기준일: 기본은 최근 보고일. 고른 날이 없어졌으면 최근으로 돌아간다.
  const last = view.points[view.points.length - 1] ?? null
  const point = (selected !== null ? view.points.find((p) => p.day === selected) : undefined) ?? last
  const day = point?.day ?? null
  const status = day === null ? 'none' : statusAt(view.events, view.points, day)
  const forecast = useMemo(() => {
    if (!adopted || !point) return null
    // 예측은 그 점을 계산한 기준선(원 기준선 또는 개정)과 같은 기준선의 점들로만 한다.
    const seg = view.points.filter((p) => p.revision === point.revision)
    const i = seg.indexOf(point)
    return i < 0 ? null : forecastAt(baselineOfPoint(adopted, revisions, point, useOriginal), seg, i, evm.k)
  }, [adopted, point, view.points, evm.k, revisions, useOriginal])
  const row = point ? (actuals[point.index] ?? null) : null
  const reforecastView = useCurrentReforecast(adopted, row)
  const charts = useMemo(() => (adopted ? buildEvmCharts(adopted, view.points, day, forecast, reforecastView, revisions, useOriginal) : []), [adopted, view.points, day, forecast, reforecastView, revisions, useOriginal])
  const fromPlan = adopted?.scenarioId === PLAN_CSV_SCENARIO_ID
  const versionMismatch = adoption?.changes.some((c) => c.key === 'model:version') ?? false

  return (
    <div className="app-body control">
      <main className="panel main wide">
        {adopted ? (
          <div className="adoption-banner" role="status">
            <span>
              <strong>★ 채택 계획: {adopted.scenarioName}</strong> <span className="muted">{adoptionSummary(adopted)}</span>
              {versionMismatch && <strong> · 기준선이 다른 모델 버전으로 만들어졌습니다</strong>}
            </span>
            {revisions.length > 0 && (
              <label className="report-day">
                <input type="checkbox" checked={useOriginal} onChange={(e) => setUseOriginal(e.target.checked)} />
                원 기준선 기준으로 보기
              </label>
            )}
            {view.points.length > 0 && (
              <label className="report-day">
                보고 기준일
                <select value={day ?? ''} onChange={(e) => setSelected(Number(e.target.value))} aria-label="보고 기준일">
                  {view.points.map((p) => (
                    <option key={p.index} value={p.day}>
                      {p.day}일{p === last ? ' (최근)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : (
          <p className="drift" role="status">
            <strong>채택한 계획이 없습니다.</strong> 시나리오 탭에서 실행한 시나리오(또는 기준)를 채택하면 PV와 지표를 계산합니다. 실적은 지금도 입력할 수 있고 저장됩니다.
          </p>
        )}

        {adopted && (
          <>
            <KpiCards point={point} status={status} />
            <ForecastPanel forecast={forecast} bac={adopted.bac} plannedCompletion={adopted.plannedCompletion} />
            {fromPlan ? (
              row && (
                <section className="reforecast" aria-label="재예측">
                  <h2 className="section-title">재예측</h2>
                  <p className="muted">{PLAN_CURVE_NO_SIM}</p>
                </section>
              )
            ) : (
              <ReforecastPanel adopted={adopted} forecast={forecast} row={row} point={day} />
            )}
            {point && row && day !== null && (
              <ActionPanel
                adopted={adopted}
                reportDay={day}
                reportActualDay={row.day}
                disabledReason={fromPlan ? PLAN_CURVE_NO_SIM : forecast?.state === 'complete' ? '완료한 프로젝트는 조치를 시험하지 않습니다.' : useOriginal ? '"원 기준선 기준" 보기에서는 개정할 수 없습니다. 보기를 끄세요.' : null}
              />
            )}
            <RevisionHistory />
            <div className="evm-charts">
              {charts.map((c) => (
                <EvmChart key={c.id} spec={c} />
              ))}
            </div>
            <section aria-label="경고">
              <h2 className="section-title">경고</h2>
              <AlertList events={view.events} />
              <AlertSettingsForm />
            </section>
          </>
        )}

        <PlanCurveImport />
        <ActualsTable issues={view.issues} />
        <ActualsToolbar />
        {adopted && <IndicatorTable points={view.points} cpiWorsening={view.cpiWorsening} spiWorsening={view.spiWorsening} trend={evm.alerts.trend} />}
        {view.points.length === 0 && adopted && actuals.length === 0 && <p className="muted">실적을 입력하면 곡선과 지표가 나타납니다. 위 차트의 점선은 계획(PV)입니다.</p>}
      </main>
    </div>
  )
}
