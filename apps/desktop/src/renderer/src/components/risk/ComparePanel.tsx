import { useState } from 'react'
import { getEntry } from '../../catalog'
import { compareProblems, MAX_COMPARE } from '../../lib/risk'
import { compareSentence, compareView, pct } from '../../lib/riskView'
import { BASE_ID } from '../../lib/scenarioRunner'
import { scenarioColor } from '../../lib/palette'
import { formatValue } from '../../lib/scenarioCompare'
import { busyReason, selectCompareStale, useAppStore } from '../../stores/appStore'
import { CompareChart } from './RiskCharts'

/** 시나리오 간 비교(RSK-07): 같은 표본(공통난수)으로 시나리오마다 실행해 "A가 B보다 먼저 끝날 확률"을 구한다. */
export function ComparePanel({ kpiId }: { kpiId: string }) {
  const modelId = useAppStore((s) => s.modelId)
  const risk = useAppStore((s) => s.risk)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const run = useAppStore((s) => s.riskCompare)
  const stale = useAppStore(selectCompareStale)
  const busy = useAppStore((s) => (s.riskCompare?.status === 'running' ? null : busyReason(s)))
  const toggle = useAppStore((s) => s.toggleRiskCompare)
  const runCompare = useAppStore((s) => s.runRiskCompare)
  const cancel = useAppStore((s) => s.cancelRisk)
  const [message, setMessage] = useState<string | null>(null)

  const entry = getEntry(modelId)
  const spec = entry.kpiSpecs.find((k) => k.id === kpiId) ?? (entry.kpiSpecs[0] as (typeof entry.kpiSpecs)[number])
  const rows = [{ id: BASE_ID, name: '기준' }, ...scenarios.map((s) => ({ id: s.id, name: s.name }))]
  const nameOf = (id: string) => rows.find((r) => r.id === id)?.name ?? id
  const colorOf = (id: string) => (id === BASE_ID ? '#444444' : scenarioColor(id))
  const running = run?.status === 'running'
  const problems = compareProblems(entry, risk, params, scenarios)
  const blocked = busy ?? problems[0] ?? null
  const view = run && run.results.length > 0 ? compareView(run.results, spec.id) : null
  const f = (v: number) => formatValue(spec, v)
  const progress = run && run.total > 0 ? Math.round(((run.index + run.completed / run.total) / Math.max(1, risk.compareIds.length)) * 100) : 0

  return (
    <section aria-label="시나리오 간 비교">
      <p className="muted">
        고른 시나리오를 <strong>같은 입력 분포·시드</strong>로 실행해 반복마다 같은 난수를 씁니다(공통난수). 그래서 시나리오 사이의 차이가 입력의 우연이 아니라 정책에서 나온 것인지 정당하게 비교할 수 있습니다. 절대 확률보다 이 상대 비교를 먼저 보세요.
      </p>
      <fieldset className="risk-compare-pick" disabled={running}>
        <legend>비교할 시나리오 (2~{MAX_COMPARE}개, 먼저 고른 것이 A)</legend>
        {rows.map((r) => {
          const idx = risk.compareIds.indexOf(r.id)
          return (
            <label key={r.id} className="risk-check">
              <input
                type="checkbox"
                checked={idx >= 0}
                onChange={() => setMessage(toggle(r.id))}
              />
              <span className={r.id === BASE_ID ? 'swatch base' : 'swatch'} style={r.id === BASE_ID ? undefined : { background: colorOf(r.id) }} aria-hidden="true" />
              {r.name}
              {idx >= 0 && <span className="muted"> ({idx === 0 ? 'A' : `B${risk.compareIds.length > 2 ? idx : ''}`})</span>}
            </label>
          )
        })}
      </fieldset>
      <div className="row wrap">
        {running ? (
          <button type="button" className="danger" onClick={cancel}>
            중단
          </button>
        ) : (
          <button type="button" className="primary" disabled={blocked !== null} title={blocked ?? undefined} onClick={async () => setMessage(await runCompare())}>
            비교 실행
          </button>
        )}
        {running && (
          <div className="progress" role="progressbar" aria-label="비교 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <div className="progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
        <span className="muted" role="status" aria-live="polite">
          {running
            ? `${nameOf(risk.compareIds[run.index] ?? '')} 실행 중 (${run.index + 1}/${risk.compareIds.length}) ${run.completed}/${run.total}회`
            : run?.status === 'canceled'
              ? `취소됨 — ${run.results.length}개 시나리오만 끝났습니다.`
              : run?.status === 'done'
                ? `${run.results.length}개 시나리오 × ${run.total}회 완료${stale ? ' — 입력이 바뀌어 결과가 오래되었습니다. 다시 실행하세요.' : ''}`
                : ''}
        </span>
      </div>
      {!running && blocked !== null && risk.compareIds.length > 0 && <p className="muted">실행할 수 없음: {blocked}</p>}
      {(message ?? run?.error) && (
        <div className="field-error" role="alert">
          {message ?? run?.error}
        </div>
      )}

      {view && (
        <div className={stale ? 'stale' : undefined}>
          <CompareChart items={view.items.map((it) => ({ name: nameOf(it.id), color: colorOf(it.id), cdf: it.cdf }))} spec={spec} />
          <div className="table-scroll">
            <table className="risk-stats">
              <caption>{spec.label} 분포 비교</caption>
              <thead>
                <tr>
                  <th scope="col">시나리오</th>
                  <th scope="col" className="num">평균</th>
                  <th scope="col" className="num">P50</th>
                  <th scope="col" className="num">P80</th>
                  <th scope="col" className="num">P90</th>
                  <th scope="col" className="num">미완료</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((it) => (
                  <tr key={it.id}>
                    <th scope="row">
                      <span className={it.id === BASE_ID ? 'swatch base' : 'swatch'} style={it.id === BASE_ID ? undefined : { background: colorOf(it.id) }} aria-hidden="true" />
                      {nameOf(it.id)}
                    </th>
                    <td className="num">{f(it.dist.summary.mean)}</td>
                    <td className="num">{f(it.dist.summary.percentiles['0.5'] as number)}</td>
                    <td className="num">{f(it.dist.summary.percentiles['0.8'] as number)}</td>
                    <td className="num">{f(it.dist.summary.percentiles['0.9'] as number)}</td>
                    <td className="num">{pct(it.dist.undefinedRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {view.pairs.map((p) => (
            <div key={p.b} className="risk-pair">
              <p>
                <strong>{compareSentence(spec, nameOf(p.a), nameOf(p.b), p.cmp)}</strong>
              </p>
              {p.cmp.pairs > 0 && (
                <p className="muted">
                  차이({nameOf(p.b)} − {nameOf(p.a)}) 평균 {f(p.cmp.meanDiff)} (95% 구간 {f(p.cmp.diffCI.low)} ~ {f(p.cmp.diffCI.high)}) · 우열이 뒤바뀌는 반복 {pct(p.cmp.flipRate)} · 같은 값 {pct(p.cmp.probTie)}
                  {p.cmp.unpaired > 0 ? ` · 한쪽만 끝난 반복 ${p.cmp.unpaired}회 제외` : ''}
                </p>
              )}
            </div>
          ))}
          {view.pairs.length === 0 && <p className="muted">비교하려면 시나리오가 둘 이상 끝나야 합니다.</p>}
        </div>
      )}
    </section>
  )
}
