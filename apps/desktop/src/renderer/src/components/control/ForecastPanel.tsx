import { rangeOf, type Forecast } from '@spd/analysis'

const fmt = (x: number) => Math.round(x).toLocaleString('ko-KR')
const day = (x: number) => `${Number(x.toFixed(1))}일`

/** 낙관·비관 범위를 "a ~ b" 또는 한 값으로 쓴다. */
function span(a: number | null, b: number | null, f: (x: number) => string): string {
  const r = rangeOf(a, b)
  if (!r) return '산출 불가'
  return Math.abs(r.high - r.low) < 1e-9 ? f(r.low) : `${f(r.low)} ~ ${f(r.high)}`
}

/** 지표 기반 예측(EAC·ETC·VAC, 획득 일정으로 예상 완료일). 항상 "현재 효율이 계속된다는 가정"임을 밝힌다. */
export function ForecastPanel({ forecast, bac, plannedCompletion }: { forecast: Forecast | null; bac: number; plannedCompletion: number }) {
  if (!forecast) return null
  if (forecast.state === 'complete' && forecast.complete) {
    const delay = forecast.complete.day - plannedCompletion
    return (
      <section className="forecast" aria-label="예측">
        <h2 className="section-title">완료</h2>
        <p>
          <strong>실제 완료일 {day(forecast.complete.day)}</strong> (계획 {day(plannedCompletion)}, {delay > 0 ? `${day(delay)} 늦음` : delay < 0 ? `${day(-delay)} 빠름` : '계획대로'}) ·{' '}
          <strong>최종 공수 {fmt(forecast.complete.cost)} 맨데이</strong> (BAC {fmt(bac)}, {forecast.complete.cost > bac ? `${fmt(forecast.complete.cost - bac)} 초과` : forecast.complete.cost < bac ? `${fmt(bac - forecast.complete.cost)} 절감` : '예산대로'})
        </p>
        <p className="muted">획득 가치가 총 예산에 닿았으므로 예측 대신 실적을 보입니다.</p>
      </section>
    )
  }

  const { cumulative: c, recent: r } = forecast
  const completion = rangeOf(c.completionDay, r.completionDay)
  const delayWorst = completion ? completion.high - plannedCompletion : null
  return (
    <section className="forecast" aria-label="예측">
      <h2 className="section-title">예측</h2>
      <div className="kpi-cards">
        <div className="kpi-card">
          <div className="muted">예상 완료일</div>
          <div className="kpi-value">{span(c.completionDay, r.completionDay, day)}</div>
          <div className="muted">
            계획 {day(plannedCompletion)}
            {delayWorst !== null && delayWorst > 0.05 ? ` · 최대 ${day(delayWorst)} 늦음` : ''}
          </div>
        </div>
        <div className="kpi-card">
          <div className="muted">EAC(완료 시 총 공수)</div>
          <div className="kpi-value">{span(c.eac, r.eac, (x) => `${fmt(x)} 맨데이`)}</div>
          <div className="muted">BAC {fmt(bac)}</div>
        </div>
        <div className="kpi-card">
          <div className="muted">ETC(남은 공수)</div>
          <div className="kpi-value">{span(c.etc, r.etc, (x) => `${fmt(x)} 맨데이`)}</div>
        </div>
        <div className="kpi-card">
          <div className="muted">VAC(예산 편차)</div>
          <div className={`kpi-value ${rangeOf(c.vac, r.vac) && (rangeOf(c.vac, r.vac) as { low: number }).low < 0 ? 'bad' : ''}`}>{span(c.vac, r.vac, (x) => `${x > 0 ? '+' : ''}${fmt(x)} 맨데이`)}</div>
          <div className="muted">음수는 초과</div>
        </div>
      </div>
      <p className="muted">
        범위는 누적 지수(낙관 또는 비관)와 최근 구간 지수로 계산한 두 값입니다. <strong>현재의 효율이 남은 작업에도 계속된다는 가정</strong>의 추정이며 예측이 아닙니다.
      </p>
      {forecast.reasons.length > 0 && (
        <ul className="issue-list warning" aria-label="예측 제한 사유">
          {forecast.reasons.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
