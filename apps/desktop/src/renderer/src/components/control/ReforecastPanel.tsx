import { useMemo, useState } from 'react'
import { rangeOf, type Forecast } from '@spd/analysis'
import type { ActualRow } from '@spd/analysis'
import { getEntry } from '../../catalog'
import type { Adopted } from '../../lib/adoption'
import { reforecastUnsupported } from '../../lib/control'
import { reforecastKey, summarizeReforecast, type ReforecastView } from '../../lib/reforecastView'
import { useAppStore } from '../../stores/appStore'

const fmt = (x: number) => Math.round(x).toLocaleString('ko-KR')
const day = (x: number) => `${Number(x.toFixed(1))}일`

function span(r: { low: number; high: number } | null, f: (x: number) => string): string {
  if (!r) return '끝나지 않음'
  return Math.abs(r.high - r.low) < 1e-9 ? f(r.low) : `${f(r.low)} ~ ${f(r.high)}`
}

/** 현재 입력으로 만든 재예측 결과(없거나 오래되었으면 null). 차트가 같이 쓴다. */
export function useCurrentReforecast(adopted: Adopted | null, row: ActualRow | null): ReforecastView | null {
  const modelId = useAppStore((s) => s.modelId)
  const k = useAppStore((s) => s.evm.k)
  const state = useAppStore((s) => s.reforecast)
  return useMemo(() => {
    if (!adopted || !row || !state || state.status !== 'done' || !state.outcome) return null
    if (state.key !== reforecastKey(adopted, row, k)) return null
    return summarizeReforecast(getEntry(modelId), state.outcome)
  }, [adopted, row, state, k, modelId])
}

/**
 * 시뮬레이션 기반 재예측(설계 05의 7장). 채택 계획을 보고일까지 실행해 관측값으로 상태를 덮고, 최근 생산성(CPI)을
 * 보정 계수 κ로 곱해 이어 실행한다. 관측할 수 없는 상태는 기준선 값을 쓰므로 **추정**이며 범위로 보인다.
 */
export function ReforecastPanel({ adopted, forecast, row, point }: { adopted: Adopted; forecast: Forecast | null; row: ActualRow | null; point: number | null }) {
  const state = useAppStore((s) => s.reforecast)
  const k = useAppStore((s) => s.evm.k)
  const run = useAppStore((s) => s.runReforecast)
  const modelId = useAppStore((s) => s.modelId)
  const unsupported = reforecastUnsupported(modelId, getEntry(modelId).title)
  const view = useCurrentReforecast(adopted, row)
  const key = adopted && row ? reforecastKey(adopted, row, k) : null
  const stale = state !== null && state.status === 'done' && key !== null && state.key !== key
  const running = state?.status === 'running'
  const [refusal, setRefusal] = useState<string | null>(null)

  if (point === null || row === null) return null
  if (unsupported) {
    return (
      <section className="reforecast" aria-label="재예측">
        <h2 className="section-title">재예측</h2>
        <p className="muted">{unsupported}</p>
      </section>
    )
  }
  const complete = forecast?.state === 'complete'
  const plannedCompletion = adopted.plannedCompletion
  const metric = forecast?.state === 'forecast' ? rangeOf(forecast.cumulative.completionDay, forecast.recent.completionDay) : null

  return (
    <section className="reforecast" aria-label="재예측">
      <div className="row wrap">
        <h2 className="section-title">재예측 <span className="muted">(시뮬레이션 기반 · 추정)</span></h2>
        <button type="button" className="primary" disabled={running || complete} onClick={() => {
            setRefusal(null)
            void run(point).then(setRefusal)
          }}>
          {running ? '재예측 중…' : '재예측 실행'}
        </button>
      </div>
      {complete && <p className="muted">완료한 프로젝트는 재예측하지 않습니다.</p>}
      {!complete && !view && !running && (
        <p className="muted">
          {stale ? '실적·계획·설정이 바뀌어 이전 재예측은 오래되었습니다. 다시 실행하세요.' : '보고 기준일의 실적으로 모델의 상태를 보정해 완료일과 공수를 다시 계산합니다.'}
        </p>
      )}
      {refusal && !running && (
        <div className="field-error" role="alert">
          {refusal}
        </div>
      )}
      {state?.status === 'error' && !running && state.key === key && !refusal && (
        <div className="field-error" role="alert">
          {state.error}
        </div>
      )}
      {view && (
        <>
          <div className="kpi-cards">
            <div className="kpi-card">
              <div className="muted">재예측 완료일(추정)</div>
              <div className="kpi-value">{span(view.completion, day)}</div>
              <div className="muted">
                계획 {day(plannedCompletion)}
                {view.completion && view.completion.high - plannedCompletion > 0.05 ? ` · 최대 ${day(view.completion.high - plannedCompletion)} 늦음` : ''}
              </div>
              {metric && <div className="muted">지표 기반 예측 {span(metric, day)}</div>}
            </div>
            <div className="kpi-card">
              <div className="muted">재예측 EAC(추정)</div>
              <div className="kpi-value">{span(view.eac, (x) => `${fmt(x)} 맨데이`)}</div>
              <div className="muted">BAC {fmt(adopted.bac)}</div>
            </div>
          </div>
          <table className="kappa-table">
            <caption className="muted">생산성 보정 계수 κ (공칭 생산성에 곱함)</caption>
            <thead>
              <tr>
                <th scope="col">기준</th>
                <th scope="col" className="num">κ</th>
                <th scope="col" className="num">완료일</th>
                <th scope="col" className="num">EAC</th>
              </tr>
            </thead>
            <tbody>
              {view.runs.map((r) => (
                <tr key={r.name}>
                  <th scope="row">{r.label}</th>
                  <td className="num">
                    {r.kappa.toFixed(2)}
                    {r.clamped && <span title={`요청값 ${r.requested.toFixed(2)}를 [0.3, 3]으로 제한했습니다`}> (제한됨)</span>}
                  </td>
                  <td className="num">{r.completionDay === null ? '끝나지 않음' : day(r.completionDay)}</td>
                  <td className="num">{r.eac === null ? '–' : `${fmt(r.eac)} 맨데이`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="assumptions">
            <summary>가정 목록: 무엇을 실적으로 덮고 무엇을 기준선에서 가져왔나</summary>
            <p className="muted">{day(view.atDay)}까지 기준선(채택 계획)을 실행한 상태에서 아래 항목을 실적으로 덮어쓰고 이어서 실행했습니다.</p>
            <table className="indicator-table">
              <thead>
                <tr>
                  <th scope="col">항목</th>
                  <th scope="col">구분</th>
                  <th scope="col" className="num">기준선 값</th>
                  <th scope="col" className="num">덮어쓴 값</th>
                  <th scope="col">설명</th>
                </tr>
              </thead>
              <tbody>
                {view.assumptions.map((a) => (
                  <tr key={a.name}>
                    <th scope="row">{a.label}</th>
                    <td>{a.kind === 'observed' ? '실적' : '실적에서 계산'}</td>
                    <td className="num">{Number(a.baseline.toFixed(2))}</td>
                    <td className="num">{Number(a.value.toFixed(2))}</td>
                    <td>{a.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">
              <strong>관측할 수 없어 기준선 값을 그대로 쓴 상태 {view.estimatedLevels.length}개</strong>(오류 재고, 소진, 인식 규모 등): {view.estimatedLevels.join(', ')}
            </p>
          </details>
          <p className="muted">
            재예측은 관측할 수 없는 상태를 기준선 값으로 채운 <strong>추정</strong>이며 절대값을 예측으로 읽으면 안 됩니다. 계획 쪽(인식한 작업 규모, 계획 일정)이 기준선과 다른 프로젝트는 이른 시점에 잘 맞지 않습니다. 쌍둥이 실험에서의 정확도는 구현 문서를 참고하세요.
          </p>
        </>
      )}
      {running && <p className="muted" role="status">계산 중입니다…</p>}
    </section>
  )
}
