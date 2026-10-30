import { useMemo, useState } from 'react'
import { getEntry } from '../../catalog'
import { COARSE_ITERATIONS, SUMMARY_PERCENTILES } from '@spd/analysis'
import { autoBins, bandView, distributionView, MAX_BINS, MIN_BINS } from '../../lib/riskView'
import { formatValue } from '../../lib/scenarioCompare'
import { selectRiskStale, useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'
import { BandChart } from './BandChart'
import { ConfidenceChart, HistogramChart } from './DistributionCharts'

/** 결과: 지표를 고르면 히스토그램·신뢰 수준 차트·요약 통계를 보인다. 실행 중에는 중간 결과를 보인다. */
export function RiskResults({ kpiId }: { kpiId: string }) {
  const modelId = useAppStore((s) => s.modelId)
  const run = useAppStore((s) => s.riskRun)
  const stale = useAppStore(selectRiskStale)
  const entry = getEntry(modelId)
  const targets = useAppStore((s) => s.risk.targets)
  const [bins, setBins] = useState<number | null>(null)

  const result = run?.result ?? run?.partial ?? null
  const spec = entry.kpiSpecs.find((k) => k.id === kpiId) ?? (entry.kpiSpecs[0] as (typeof entry.kpiSpecs)[number])
  const view = useMemo(() => (result ? distributionView(result, spec.id, bins ?? undefined) : null), [result, spec.id, bins])
  const band = useMemo(() => (result ? bandView(result) : null), [result])

  if (!run || !result || !view) {
    return (
      <section className="risk-results" aria-label="결과">
        <p className="muted">입력을 정하고 <strong>실행</strong>을 누르면 완료일 같은 지표의 분포가 여기에 나타납니다.</p>
        <Disclaimer />
      </section>
    )
  }

  const { dist } = view
  const f = (v: number) => formatValue(spec, v)
  const partial = run.status === 'running'
  const bandSpec = band ? entry.variables.find((v) => v.name === band.variable) : null

  return (
    <section className={`risk-results${stale ? ' stale' : ''}`} aria-label="결과">
      <div className="row wrap">
        <label className="risk-field">
          <span>구간 수</span>
          <DraftNumber id="risk-bins" label="히스토그램 구간 수" value={bins ?? autoBins(dist.summary.n)} onValue={(v) => setBins(Math.min(MAX_BINS, Math.max(MIN_BINS, Math.round(v))))} />
        </label>
        {bins !== null && (
          <button type="button" className="link" onClick={() => setBins(null)}>
            자동
          </button>
        )}
      </div>

      {partial && <p className="muted">실행 중인 중간 결과입니다({result.completed}회).</p>}
      {stale && <p className="field-error">이 결과는 지금 입력으로 만든 것이 아닙니다.</p>}
      {result.completed < COARSE_ITERATIONS && <p className="muted">반복이 {COARSE_ITERATIONS}회 미만이라 분포가 거칠 수 있습니다.</p>}
      {dist.nFailed > 0 && (
        <p className="field-error" role="alert">
          수치 오류로 {dist.nFailed}회를 제외했습니다.
        </p>
      )}
      {dist.nUndefined > 0 && (
        <p className="muted">
          종료 시각 안에 {spec.label}을(를) 정할 수 없는 반복이 {dist.nUndefined}회({(dist.undefinedRate * 100).toFixed(1)}%) 있습니다. 아래 분포는 정할 수 있는 {dist.summary.n}회만의 분포입니다.
        </p>
      )}

      {dist.summary.n === 0 ? (
        <p className="muted">{spec.label}을(를) 계산할 수 있는 반복이 없습니다.</p>
      ) : (
        <>
          <div className="risk-charts">
            <figure>
              <figcaption>분포(히스토그램)</figcaption>
              <HistogramChart view={view} spec={spec} />
            </figure>
            <figure>
              <figcaption>신뢰 수준(이 값 이하로 끝날 확률)</figcaption>
              <ConfidenceChart view={view} spec={spec} targets={targets.filter((t) => t.kpi === spec.id).map((t) => t.value)} />
            </figure>
          </div>

          <div className="risk-quantiles" aria-label="핵심 분위수">
            {view.quantiles.map((q) => (
              <div key={q.label}>
                <strong>{q.label}</strong> {f(q.value)}
                <span className="muted"> (95% 구간 {f(q.ci.low)} ~ {f(q.ci.high)})</span>
              </div>
            ))}
            {view.quantiles.length === 3 && <div className="muted">여유(P80 − P50) {f(view.quantiles[1]!.value - view.quantiles[0]!.value)}</div>}
          </div>

          <div className="table-scroll">
            <table className="risk-stats">
              <caption>{spec.label} 요약 통계</caption>
              <tbody>
                <tr>
                  <th scope="row">평균</th>
                  <td className="num">{f(dist.summary.mean)}</td>
                  <td className="muted">95% 구간 {f(dist.meanCI.low)} ~ {f(dist.meanCI.high)}</td>
                </tr>
                <tr>
                  <th scope="row">표준편차</th>
                  <td className="num">{f(dist.summary.sd)}</td>
                  <td />
                </tr>
                <tr>
                  <th scope="row">최소 / 최대</th>
                  <td className="num">{f(dist.summary.min)}</td>
                  <td className="num">{f(dist.summary.max)}</td>
                </tr>
                {SUMMARY_PERCENTILES.map((p) => (
                  <tr key={p}>
                    <th scope="row">P{Math.round(p * 100)}</th>
                    <td className="num">{f(dist.summary.percentiles[String(p)] as number)}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details>
            <summary>히스토그램 값 표</summary>
            <div className="table-scroll">
              <table className="risk-stats">
                <thead>
                  <tr>
                    <th scope="col">구간</th>
                    <th scope="col" className="num">반복 수</th>
                    <th scope="col" className="num">비율</th>
                  </tr>
                </thead>
                <tbody>
                  {view.bars.map((b) => (
                    <tr key={b.from}>
                      <th scope="row">{b.from.toFixed(spec.decimals)} ~ {b.to.toFixed(spec.decimals)}</th>
                      <td className="num">{b.count}</td>
                      <td className="num">{(b.share * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {band && bandSpec && (
        <figure>
          <figcaption>{bandSpec.label}의 시간 변화(중앙값과 P10~P90)</figcaption>
          <BandChart label={bandSpec.label} unit={bandSpec.unit} points={band.points} />
        </figure>
      )}
      <Disclaimer />
    </section>
  )
}

/** 결과 옆에 항상 보이는 안내(설계 06의 0장). */
function Disclaimer() {
  return (
    <p className="risk-disclaimer" role="note">
      ※ 이 확률은 <strong>입력 분포를 가정했을 때 이 모델이 내는 값</strong>이며 실제 프로젝트의 확률이 아닙니다. 통합 프로젝트 모델은 보정되지 않았습니다. 절대값보다 시나리오 사이의 상대 비교를 먼저 보세요.
    </p>
  )
}
