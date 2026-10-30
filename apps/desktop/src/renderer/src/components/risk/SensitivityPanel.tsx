import { useMemo, useState } from 'react'
import { DEFAULT_SWEEP_LEVELS, MAX_SWEEP_LEVELS, MIN_SWEEP_LEVELS, rankTornado } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { formatNumber, paramSpecs } from '../../lib/params'
import { riskBaseParams } from '../../lib/risk'
import { sweepDefaults } from '../../lib/riskSensitivity'
import { oatBars, tornadoDisagreement } from '../../lib/riskView'
import { formatValue } from '../../lib/scenarioCompare'
import { busyReason, selectOatStale, selectSweepStale, useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'
import { RankChart, SweepChart, TornadoChart } from './RiskCharts'

/** 민감도(RSK-05): 한 번에 하나씩(OAT) 토네이도, Monte Carlo 순위상관, 단일 파라미터 스윕. */
export function SensitivityPanel({ kpiId }: { kpiId: string }) {
  const modelId = useAppStore((s) => s.modelId)
  const inputs = useAppStore((s) => s.risk.inputs)
  const scenarioId = useAppStore((s) => s.risk.scenarioId)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const sens = useAppStore((s) => s.riskSens)
  const oatStale = useAppStore(selectOatStale)
  const sweepStale = useAppStore(selectSweepStale)
  const run = useAppStore((s) => s.riskRun)
  const busy = useAppStore((s) => busyReason(s))
  const runOat = useAppStore((s) => s.runRiskOat)
  const runSweep = useAppStore((s) => s.runRiskSweep)
  const entry = getEntry(modelId)
  const spec = entry.kpiSpecs.find((k) => k.id === kpiId) ?? (entry.kpiSpecs[0] as (typeof entry.kpiSpecs)[number])
  const labelOf = useMemo(() => (name: string) => entry.def.constants[name]?.label ?? name, [entry])
  const specs = paramSpecs(entry)
  const base = riskBaseParams(params, scenarios, scenarioId)

  const [oatError, setOatError] = useState<string | null>(null)
  const [sweepError, setSweepError] = useState<string | null>(null)
  const first = sens.sweep?.request.name ?? inputs[0]?.name ?? specs[0]?.name ?? ''
  const initial = sens.sweep?.request ?? { name: first, ...(base ? (sweepDefaults(entry, base, inputs, first) ?? { min: 0, max: 1 }) : { min: 0, max: 1 }), k: DEFAULT_SWEEP_LEVELS }
  const [form, setForm] = useState(initial)

  const oat = sens.oat
  const list = oat?.result.entries[spec.id] ?? []
  const bars = oatBars(list, labelOf)
  const baseValue = oat?.result.base ? (oat.result.base[spec.id] ?? null) : null
  const mc = run?.result ?? run?.partial ?? null
  const rank = mc ? rankTornado(mc, spec.id) : []
  const disagree = list.length > 0 && rank.length > 0 ? tornadoDisagreement(list, rank, labelOf) : null
  const sweep = sens.sweep

  const changeParam = (name: string) => {
    const d = base ? sweepDefaults(entry, base, inputs, name) : null
    setForm({ name, min: d?.min ?? 0, max: d?.max ?? 1, k: form.k })
  }

  return (
    <div className="risk-sens">
      <section aria-label="한 번에 하나씩 바꾸기">
        <h3>한 번에 하나씩 바꾸기 (토네이도)</h3>
        <p className="muted">
          불확실한 입력마다 분포의 P10·P90 값으로 바꿔(나머지는 기준) {spec.label}의 변화 폭을 봅니다. 폭이 작은 입력은 정밀한 추정이 필요 없고, 큰 입력은 레버리지 지점이거나 추정에 공을 들일 대상입니다. 상호작용은 보지 못합니다.
        </p>
        <div className="row wrap">
          <button type="button" className="primary" disabled={busy !== null || inputs.length === 0} title={busy ?? (inputs.length === 0 ? '불확실한 입력을 먼저 추가하세요' : undefined)} onClick={() => setOatError(runOat())}>
            토네이도 계산
          </button>
          {oatStale && <span className="field-error">입력이 바뀌어 결과가 오래되었습니다. 다시 계산하세요.</span>}
        </div>
        {oatError && (
          <div className="field-error" role="alert">
            {oatError}
          </div>
        )}
        {oat && bars.length > 0 && (
          <>
            <TornadoChart bars={bars} base={baseValue} spec={spec} />
            <div className="table-scroll">
              <table className="risk-stats">
                <caption>{spec.label} 토네이도 값</caption>
                <thead>
                  <tr>
                    <th scope="col">입력</th>
                    <th scope="col" className="num">낮은 값 → 지표</th>
                    <th scope="col" className="num">높은 값 → 지표</th>
                    <th scope="col" className="num">폭</th>
                  </tr>
                </thead>
                <tbody>
                  {bars.map((b) => (
                    <tr key={b.name}>
                      <th scope="row">{b.label}</th>
                      <td className="num">{formatNumber(b.low)} → {b.kpiLow === null ? '계산 불가' : formatValue(spec, b.kpiLow)}</td>
                      <td className="num">{formatNumber(b.high)} → {b.kpiHigh === null ? '계산 불가' : formatValue(spec, b.kpiHigh)}</td>
                      <td className="num">{b.swing === null ? '–' : b.swing === 0 ? '영향 없음' : formatValue(spec, b.swing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {oat.result.errors.length > 0 && (
              <p className="field-error" role="alert">
                수치 오류: {oat.result.errors.map((e) => `${labelOf(e.name)} ${e.at === 'low' ? '낮은' : '높은'} 값(${e.message})`).join(', ')}
              </p>
            )}
          </>
        )}
      </section>

      <section aria-label="순위상관">
        <h3>함께 흔들 때 (순위상관)</h3>
        <p className="muted">
          Monte Carlo 결과에서 입력과 {spec.label}의 스피어만 순위상관을 구했습니다. 추가 실행이 필요 없고 입력이 동시에 흔들릴 때의 기여를 반영합니다. 상관은 인과나 크기가 아니라 <strong>단조 관계의 강도</strong>입니다.
        </p>
        {rank.length === 0 ? <p className="muted">위의 <strong>실행</strong>을 누르면 계산됩니다.</p> : <RankChart entries={rank} labelOf={labelOf} />}
        {disagree && (
          <p className="muted" role="note">
            ※ {disagree}
          </p>
        )}
      </section>

      <section aria-label="파라미터 스윕">
        <h3>파라미터 스윕</h3>
        <p className="muted">파라미터 하나를 범위의 여러 수준으로 바꿔 {spec.label} 곡선을 봅니다. 정수 파라미터는 정수 수준만 씁니다.</p>
        <div className="row wrap">
          <label className="risk-field">
            <span>파라미터</span>
            <select value={form.name} onChange={(e) => changeParam(e.target.value)}>
              {specs.map((s) => (
                <option key={s.name} value={s.name}>
                  {labelOf(s.name)}
                </option>
              ))}
            </select>
          </label>
          <label className="risk-field">
            <span>최솟값</span>
            <DraftNumber key={`min-${form.name}-${form.min}`} id="risk-sweep-min" label="스윕 최솟값" value={form.min} onValue={(v) => setForm((f) => ({ ...f, min: v }))} />
          </label>
          <label className="risk-field">
            <span>최댓값</span>
            <DraftNumber key={`max-${form.name}-${form.max}`} id="risk-sweep-max" label="스윕 최댓값" value={form.max} onValue={(v) => setForm((f) => ({ ...f, max: v }))} />
          </label>
          <label className="risk-field">
            <span>수준 수 ({MIN_SWEEP_LEVELS}~{MAX_SWEEP_LEVELS})</span>
            <DraftNumber id="risk-sweep-k" label="스윕 수준 수" value={form.k} onValue={(v) => setForm((f) => ({ ...f, k: v }))} />
          </label>
          <button type="button" disabled={busy !== null || !form.name} title={busy ?? undefined} onClick={() => setSweepError(runSweep(form))}>
            스윕 계산
          </button>
        </div>
        {sweepError && (
          <div className="field-error" role="alert">
            {sweepError}
          </div>
        )}
        {sweepStale && <p className="field-error">입력이 바뀌어 결과가 오래되었습니다. 다시 계산하세요.</p>}
        {sweep && (
          <>
            <SweepChart sweep={sweep.result} kpiId={spec.id} spec={spec} paramLabel={labelOf(sweep.request.name)} />
            {sweep.result.errors.some((e) => e !== null) && (
              <p className="field-error" role="alert">
                수치 오류가 난 수준이 있습니다: {sweep.result.errors.flatMap((e, i) => (e === null ? [] : [`${sweep.result.levels[i]}(${e})`])).join(', ')}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}
