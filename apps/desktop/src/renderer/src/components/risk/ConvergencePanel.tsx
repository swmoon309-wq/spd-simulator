import { useMemo, useState } from 'react'
import { getEntry } from '../../catalog'
import { convergenceView, requiredIterations } from '../../lib/riskView'
import { formatValue } from '../../lib/scenarioCompare'
import { useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'
import { ConvergenceChart } from './RiskCharts'

/** 수렴 진단(RSK-08): 반복이 충분한지 누적 평균·P80의 안정과 평균 신뢰구간의 반폭으로 본다. */
export function ConvergencePanel({ kpiId }: { kpiId: string }) {
  const modelId = useAppStore((s) => s.modelId)
  const run = useAppStore((s) => s.riskRun)
  const entry = getEntry(modelId)
  const spec = entry.kpiSpecs.find((k) => k.id === kpiId) ?? (entry.kpiSpecs[0] as (typeof entry.kpiSpecs)[number])
  const result = run?.result ?? run?.partial ?? null
  const view = useMemo(() => (result ? convergenceView(result, spec.id) : null), [result, spec.id])
  const [target, setTarget] = useState<number | null>(null)
  const f = (v: number) => formatValue(spec, v)

  if (!result) return <p className="muted">실행하면 반복 수에 따른 평균과 P80의 변화를 볼 수 있습니다.</p>
  if (!view) return <p className="muted">{spec.label}을(를) 계산할 수 있는 반복이 2회 미만이라 수렴을 볼 수 없습니다.</p>

  const need = target === null ? null : requiredIterations(view, target)
  return (
    <section aria-label="수렴 진단">
      <p className="muted">표본을 앞에서부터 10%씩 쌓아 평균과 P80이 어떻게 안정되는지 봅니다. 뒤로 갈수록 평평해지면 반복이 충분합니다.</p>
      {view.n < 100 && <p className="muted">반복이 100회 미만이라 곡선이 거칠 수 있습니다.</p>}
      <ConvergenceChart points={view.points} spec={spec} />
      <p>
        <strong>평균의 95% 신뢰구간 반폭 ±{f(view.half)}</strong>
        <span className="muted"> (표준편차 {f(view.sd)}, {view.n}회)</span>
      </p>
      <div className="row wrap">
        <label className="risk-field">
          <span>목표 반폭 ({spec.unit || '값'})</span>
          <DraftNumber id="risk-half" label="목표 반폭" value={target ?? Number(view.half.toFixed(2))} onValue={(v) => setTarget(v)} />
        </label>
        {need && (
          <p role="status" className={need.enough ? 'muted' : 'field-error'}>
            필요한 반복 수 약 {need.needed}회 — {need.enough ? `지금(${view.n}회)으로 충분합니다.` : `지금(${view.n}회)은 부족합니다. 반복 수를 늘려 다시 실행하세요.`}
          </p>
        )}
        {target !== null && !need && <p className="field-error">목표 반폭은 0보다 큰 수여야 합니다.</p>}
      </div>
      <div className="table-scroll">
        <table className="risk-stats">
          <caption>{spec.label}의 누적 통계</caption>
          <thead>
            <tr>
              <th scope="col">반복 수</th>
              <th scope="col" className="num">평균</th>
              <th scope="col" className="num">P80</th>
              <th scope="col" className="num">반폭</th>
            </tr>
          </thead>
          <tbody>
            {view.points.map((p) => (
              <tr key={p.n}>
                <th scope="row">{p.n}</th>
                <td className="num">{f(p.mean)}</td>
                <td className="num">{f(p.quantile)}</td>
                <td className="num">±{f(p.half)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
