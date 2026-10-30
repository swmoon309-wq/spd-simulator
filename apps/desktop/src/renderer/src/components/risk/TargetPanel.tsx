import { useState } from 'react'
import type { KpiSpec, McTarget } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { adoptedTargets, defaultOp, pct, targetView } from '../../lib/riskView'
import { formatValue } from '../../lib/scenarioCompare'
import { useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'

const MAX_TARGETS = 4

/** 목표 달성 확률(RSK-04): 목표를 정하면 만족한 반복의 비율과 Wilson 95% 구간, 목표가 둘 이상이면 동시 달성 확률을 보인다. */
export function TargetPanel({ kpiId }: { kpiId: string }) {
  const modelId = useAppStore((s) => s.modelId)
  const targets = useAppStore((s) => s.risk.targets)
  const adopted = useAppStore((s) => s.adopted)
  const run = useAppStore((s) => s.riskRun)
  const setTargets = useAppStore((s) => s.setRiskTargets)
  const [message, setMessage] = useState<string | null>(null)
  const entry = getEntry(modelId)
  const result = run?.result ?? run?.partial ?? null
  const view = result && targets.length > 0 ? targetView(result, targets) : null
  const specOf = (id: string): KpiSpec => entry.kpiSpecs.find((k) => k.id === id) ?? (entry.kpiSpecs[0] as KpiSpec)
  const filled = adoptedTargets(entry, adopted)

  const add = () => {
    if (targets.length >= MAX_TARGETS) return setMessage(`목표는 최대 ${MAX_TARGETS}개입니다.`)
    const spec = specOf(kpiId)
    setMessage(null)
    setTargets([...targets, { kpi: spec.id, op: defaultOp(spec), value: 0 }])
  }
  const update = (i: number, patch: Partial<McTarget>) => setTargets(targets.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <section aria-label="목표 확률">
      <p className="muted">
        목표를 만족한 반복의 비율입니다. 종료 시각 안에 끝나지 않은 반복은 목표를 만족하지 못한 것으로 셉니다. 구간은 Wilson 95% 구간입니다.
      </p>
      <div className="row wrap">
        <button type="button" onClick={add} disabled={targets.length >= MAX_TARGETS}>
          + 목표 추가
        </button>
        <button
          type="button"
          disabled={filled.length === 0}
          title={adopted ? '채택 계획의 완료일과 예산(BAC)으로 목표를 채웁니다' : '채택한 계획이 없습니다(시나리오 탭에서 채택)'}
          onClick={() => {
            setMessage(null)
            setTargets(filled)
          }}
        >
          채택 계획으로 채우기
        </button>
        {targets.length > 0 && (
          <button type="button" className="link" onClick={() => setTargets([])}>
            모두 지우기
          </button>
        )}
      </div>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}

      {targets.length === 0 ? (
        <p className="muted">목표가 없습니다. 목표 없이도 분포 탭에서 P80과 필요한 여유(P80 − P50)를 볼 수 있습니다.</p>
      ) : (
        <table className="risk-stats risk-targets">
          <thead>
            <tr>
              <th scope="col">지표</th>
              <th scope="col">조건</th>
              <th scope="col">값</th>
              <th scope="col" className="num">달성 확률</th>
              <th scope="col">95% 구간</th>
              <th scope="col">
                <span className="sr-only">삭제</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t, i) => {
              const spec = specOf(t.kpi)
              const prob = view?.rows[i]?.prob
              return (
                <tr key={i}>
                  <td>
                    <select aria-label={`목표 ${i + 1} 지표`} value={t.kpi} onChange={(e) => update(i, { kpi: e.target.value, op: defaultOp(specOf(e.target.value)) })}>
                      {entry.kpiSpecs.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select aria-label={`목표 ${i + 1} 조건`} value={t.op} onChange={(e) => update(i, { op: e.target.value as McTarget['op'] })}>
                      <option value="<=">이하</option>
                      <option value=">=">이상</option>
                    </select>
                  </td>
                  <td>
                    <DraftNumber id={`risk-target-${i}`} label={`목표 ${i + 1} 값`} value={t.value} onValue={(v) => update(i, { value: v })} />
                    <span className="muted"> {spec.unit}</span>
                  </td>
                  <td className="num">{prob ? <strong>{pct(prob.p)}</strong> : '–'}</td>
                  <td className="muted">{prob ? `${pct(prob.low)} ~ ${pct(prob.high)} (${prob.met}/${prob.n}회)` : ''}</td>
                  <td>
                    <button type="button" className="link" aria-label={`목표 ${i + 1} 삭제`} onClick={() => setTargets(targets.filter((_, j) => j !== i))}>
                      삭제
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {view?.joint && (
        <p className="risk-joint" role="status">
          <strong>모두 함께 달성할 확률 {pct(view.joint.p)}</strong>
          <span className="muted"> (95% 구간 {pct(view.joint.low)} ~ {pct(view.joint.high)}, {view.joint.met}/{view.joint.n}회)</span>
        </p>
      )}
      {targets.length > 0 && !result && <p className="muted">위의 <strong>실행</strong>을 누르면 확률이 계산됩니다.</p>}
      {view && targets.length > 0 && (
        <p className="muted">
          {targets.map((t) => `${specOf(t.kpi).label} ${t.op === '<=' ? '≤' : '≥'} ${formatValue(specOf(t.kpi), t.value)}`).join(' 그리고 ')}
        </p>
      )}
    </section>
  )
}
