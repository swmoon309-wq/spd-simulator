import { toleranceLabel } from '../../lib/validation'
import { fmt, statusText, type ColumnEval, type DatasetEval } from '../../lib/validationView'
import { formatNumber } from '../../lib/params'
import { getEntry } from '../../catalog'
import { useAppStore } from '../../stores/appStore'

/** 열별 오차 지표 표와 종합. 합격·불합격이 아니라 지표와, 사용자가 정한 기준의 안/밖만 보인다. */
export function MetricsTable({ evaluation, selected, onSelect }: { evaluation: DatasetEval; selected: number | null; onSelect(index: number): void }) {
  const modelId = useAppStore((s) => s.modelId)
  const entry = getEntry(modelId)
  const unitOf = (c: ColumnEval) => entry.variables.find((v) => v.name === c.variable)?.unit ?? ''
  const labelOf = (c: ColumnEval) => entry.variables.find((v) => v.name === c.variable)?.label ?? c.variable
  const { overall, completion } = evaluation

  if (evaluation.columns.length === 0) return <p className="muted">변수에 연결한 열이 없습니다. 위 표에서 열마다 비교할 변수를 고르세요.</p>

  return (
    <section aria-label="오차 지표">
      <h2>오차 지표</h2>
      <div className="table-scroll">
        <table className="risk-stats validation-metrics">
          <thead>
            <tr>
              <th scope="col">열 → 변수</th>
              <th scope="col" className="num">n</th>
              <th scope="col" className="num">평균 오차(ME)</th>
              <th scope="col" className="num">RMSE</th>
              <th scope="col" className="num">정규화 RMSE</th>
              <th scope="col" className="num">MRE</th>
              <th scope="col" className="num">NSE</th>
              <th scope="col" className="num" title="편향 몫">U<sup>M</sup></th>
              <th scope="col" className="num" title="변동 크기 몫">U<sup>S</sup></th>
              <th scope="col" className="num" title="비체계 오차 몫">U<sup>C</sup></th>
              <th scope="col" className="num">추세</th>
              <th scope="col">기준</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.columns.map((c) => {
              const m = c.metrics
              return (
                <tr key={c.index} className={selected === c.index ? 'selected' : undefined}>
                  <th scope="row">
                    <button type="button" className="link" aria-pressed={selected === c.index} onClick={() => onSelect(c.index)}>
                      {c.column.name}
                    </button>
                    <span className="muted"> → {labelOf(c)}</span>
                  </th>
                  <td className="num">{m.n}</td>
                  <td className="num">{fmt(m.me)}{unitOf(c) && <span className="muted"> {unitOf(c)}</span>}</td>
                  <td className="num">{fmt(m.rmse)}</td>
                  <td className="num">{fmt(m.nrmse, 3)}</td>
                  <td className="num">{Number.isFinite(m.mre) ? `${(m.mre * 100).toFixed(1)}%` : '–'}</td>
                  <td className="num">{fmt(m.nse)}</td>
                  <td className="num">{fmt(m.theilM)}</td>
                  <td className="num">{fmt(m.theilS)}</td>
                  <td className="num">{fmt(m.theilC)}</td>
                  <td className="num">{Number.isFinite(m.trend) ? `${(m.trend * 100).toFixed(0)}%` : '–'}</td>
                  <td>{statusText(c.status, toleranceLabel) || <span className="muted">기준 없음</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <ul className="muted validation-notes">
        <li>
          <strong>편향(ME·U<sup>M</sup>)이 크면</strong> 파라미터 보정으로 줄일 수 있고, <strong>비체계 오차(U<sup>C</sup>)가 크면</strong> 모델이 잡지 못한 잡음이라 보정해도 줄지 않습니다. U<sup>M</sup>+U<sup>S</sup>+U<sup>C</sup> = 1.
        </li>
        <li>상관은 편향을 놓칩니다. 이 표는 상관 대신 NSE(1이면 일치, 0이면 평균만큼, 음수면 평균보다 나쁨)와 추세 일치율을 보입니다.</li>
        <li>관측이 0인 점은 MRE에서 뺍니다.</li>
        <li>이 표는 합격·불합격이 아니라 <strong>지표</strong>입니다. 모델이 목적에 맞는지는 사람이 판단합니다.</li>
      </ul>
      <p>
        <strong>종합 J = Σ w·NRMSE²</strong> {fmt(overall.j, 4)}
        <span className="muted"> (쓴 열 {overall.used}개{overall.skipped > 0 ? `, 정규화 RMSE를 알 수 없어 뺀 열 ${overall.skipped}개` : ''}, 가중치 = 1/열 수)</span>
      </p>
      {completion && (
        <p>
          <strong>완료 시점 오차</strong>{' '}
          {completion.days === null
            ? `시뮬레이션이 종료 시각 안에 끝나지 않아 계산할 수 없습니다(실제 ${formatNumber(completion.actual)}일).`
            : `시뮬레이션 ${completion.simulated?.toFixed(1)}일 − 실제 ${formatNumber(completion.actual)}일 = ${completion.days >= 0 ? '+' : ''}${completion.days.toFixed(1)}일${completion.percent === null ? '' : ` (${completion.percent >= 0 ? '+' : ''}${completion.percent.toFixed(1)}%)`}`}
        </p>
      )}
    </section>
  )
}
