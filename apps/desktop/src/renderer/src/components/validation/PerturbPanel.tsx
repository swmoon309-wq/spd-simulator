import { useState } from 'react'
import { PERTURB_LABEL, RAMP_STEPS, targetValue, type PerturbKind, type PerturbSpec } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { formatNumber, paramSpecs } from '../../lib/params'
import { riskBaseParams } from '../../lib/risk'
import { selectPerturbStale, useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'
import { OverlayChart } from './ValidationCharts'

/** 교란 시험(VAL-06): 상수에 스텝·펄스·램프를 걸어 기준 실행과 비교한다. 외부 신호를 Rate에 넣는 것은 지원하지 않는다. */
export function PerturbPanel() {
  const modelId = useAppStore((s) => s.modelId)
  const run = useAppStore((s) => s.validationPerturb)
  const stale = useAppStore(selectPerturbStale)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const targetId = useAppStore((s) => s.validation.targetScenarioId)
  const runSettings = useAppStore((s) => s.runSettings)
  const runPerturb = useAppStore((s) => s.runPerturb)
  const entry = getEntry(modelId)
  const specs = paramSpecs(entry)
  const base = riskBaseParams(params, scenarios, targetId)
  const labelOf = (n: string) => entry.def.constants[n]?.label ?? n
  const unitOf = (n: string) => entry.def.constants[n]?.unit ?? ''

  // 기본 시험: 추가 투입 인원이 있는 모델은 +10명(Brooks 법칙 실험), 아니면 첫 상수의 +20%. 현재 값이 0이면 %는 반응이 없으므로 쓰지 않는다.
  const [spec, setSpec] = useState<PerturbSpec>(() => {
    const staffing = specs.find((s) => s.name === 'extra_people')
    return {
      kind: 'step',
      name: staffing?.name ?? (specs[0]?.name as string),
      mode: staffing ? 'absolute' : 'percent',
      amount: staffing ? 10 : 20,
      day: Math.round(runSettings.end / 4),
      width: Math.round(runSettings.end / 10)
    }
  })
  const [variables, setVariables] = useState<string[]>([entry.defaultVariable])
  const [message, setMessage] = useState<string | null>(null)
  const current = base?.[spec.name]
  const toggleVar = (name: string) => setVariables((v) => (v.includes(name) ? v.filter((x) => x !== name) : [...v, name]))

  return (
    <section className="validation-section" aria-label="교란 시험">
      <h2>교란 시험</h2>
      <p className="muted">
        이상화된 시험 입력(책 2.7.2)으로 모델을 건드려 반응을 봅니다. 이 앱의 모델은 외부 입력 변수가 없으므로 <strong>상수</strong>에 시각별 변경으로 입력을 겁니다(스텝: 시각부터 새 값, 펄스: 폭 동안만 새 값, 램프: 폭 동안 {RAMP_STEPS}단 계단으로 새 값까지). 레벨이 음수가 되는지, 계속 커지는지, 반응이 너무 빠른지는 그래프를 보고 사람이 읽습니다.
      </p>
      <p className="muted">초기값에만 쓰이는 상수(예: 초기 인원)는 실행이 시작된 뒤에 바꿔도 반응이 없습니다.</p>
      <div className="perturb-form">
        <label className="risk-field">
          <span>상수</span>
          <select aria-label="교란할 상수" value={spec.name} onChange={(e) => setSpec({ ...spec, name: e.target.value })}>
            {specs.map((s) => (
              <option key={s.name} value={s.name}>
                {labelOf(s.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="risk-field">
          <span>종류</span>
          <select aria-label="교란 종류" value={spec.kind} onChange={(e) => setSpec({ ...spec, kind: e.target.value as PerturbKind })}>
            {(Object.keys(PERTURB_LABEL) as PerturbKind[]).map((k) => (
              <option key={k} value={k}>
                {PERTURB_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="risk-field">
          <span>크기 방식</span>
          <select aria-label="크기 방식" value={spec.mode} onChange={(e) => setSpec({ ...spec, mode: e.target.value as PerturbSpec['mode'] })}>
            <option value="percent">현재 값 대비 ±%</option>
            <option value="absolute">새 값(절대)</option>
          </select>
        </label>
        <label className="risk-field">
          <span>크기{spec.mode === 'percent' ? ' (%)' : unitOf(spec.name) ? ` (${unitOf(spec.name)})` : ''}</span>
          <DraftNumber id="perturb-amount" label="교란 크기" value={spec.amount} onValue={(v) => setSpec((s) => ({ ...s, amount: v }))} />
        </label>
        <label className="risk-field">
          <span>시작(일)</span>
          <DraftNumber id="perturb-day" label="교란 시작 시각" value={spec.day} onValue={(v) => setSpec((s) => ({ ...s, day: v }))} />
        </label>
        {spec.kind !== 'step' && (
          <label className="risk-field">
            <span>폭(일)</span>
            <DraftNumber id="perturb-width" label="교란 폭" value={spec.width} onValue={(v) => setSpec((s) => ({ ...s, width: v }))} />
          </label>
        )}
      </div>
      {current !== undefined && Number.isFinite(spec.amount) && (
        <p className="muted">
          현재 값 {formatNumber(current)} → 새 값 {formatNumber(Number(targetValue(spec, current).toPrecision(8)))}
          {unitOf(spec.name) ? ` ${unitOf(spec.name)}` : ''}
        </p>
      )}
      <fieldset className="risk-compare-pick">
        <legend>보고할 변수</legend>
        <div className="var-checks">
          {entry.variables.map((v) => (
            <label key={v.name} className="risk-check">
              <input type="checkbox" checked={variables.includes(v.name)} onChange={() => toggleVar(v.name)} />
              {v.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="row wrap">
        <button type="button" className="primary" onClick={() => setMessage(runPerturb(spec, variables))}>
          시험 실행
        </button>
        {run && stale && <span className="field-error">입력이 바뀌어 결과가 오래되었습니다. 다시 실행하세요.</span>}
      </div>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}

      {run && (
        <div className={stale ? 'stale' : undefined}>
          <p className="muted">
            변경 목록: {run.changes.slice(0, 4).map((c) => `${formatNumber(Number(c.day.toFixed(2)))}일 ${labelOf(c.name)} → ${formatNumber(Number(c.value.toPrecision(6)))}`).join(' · ')}
            {run.changes.length > 4 ? ` … (${run.changes.length}개)` : ''}
          </p>
          <div className="table-scroll">
            <table className="risk-stats">
              <caption>{PERTURB_LABEL[run.spec.kind]} 반응 요약(기준 실행과의 편차)</caption>
              <thead>
                <tr>
                  <th scope="col">변수</th>
                  <th scope="col" className="num">최대 편차</th>
                  <th scope="col" className="num">그 시각</th>
                  <th scope="col" className="num">기준 대비</th>
                  <th scope="col">복귀(최대의 5% 이하)</th>
                  <th scope="col" className="num">마지막 편차</th>
                  <th scope="col">비고</th>
                </tr>
              </thead>
              <tbody>
                {run.summaries.map((s) => {
                  const v = entry.variables.find((x) => x.name === s.variable)
                  return (
                    <tr key={s.variable}>
                      <th scope="row">{v?.label ?? s.variable}</th>
                      {s.noEffect ? (
                        <td colSpan={5}>반응 없음(이 변수는 달라지지 않았습니다)</td>
                      ) : (
                        <>
                          <td className="num">
                            {s.signedAtMax >= 0 ? '+' : '−'}
                            {formatNumber(Number(s.maxDeviation.toPrecision(4)))} {v?.unit}
                          </td>
                          <td className="num">{formatNumber(Number(s.timeOfMax.toFixed(2)))}일</td>
                          <td className="num">{s.relativeAtMax === null ? '–' : `${s.relativeAtMax >= 0 ? '+' : ''}${(s.relativeAtMax * 100).toFixed(1)}%`}</td>
                          <td>{s.returnTime === null ? '복귀 안 함' : `${formatNumber(Number(s.returnTime.toFixed(2)))}일`}</td>
                          <td className="num">{formatNumber(Number(s.finalDeviation.toPrecision(4)))}</td>
                        </>
                      )}
                      <td>{s.goesNegative ? '▲ 음수가 됨' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="risk-charts">
            {run.summaries.map((s) => {
              const v = entry.variables.find((x) => x.name === s.variable)
              return (
                <figure key={s.variable}>
                  <figcaption>{v?.label ?? s.variable}: 기준 vs 교란</figcaption>
                  <OverlayChart
                    label={v?.label ?? s.variable}
                    unit={v?.unit ?? ''}
                    marks={run.changes.map((c) => c.day)}
                    series={[
                      { name: '기준', color: '#7A7A7A', time: run.base.time, values: run.base.series[s.variable] as Float64Array, dashed: true },
                      { name: PERTURB_LABEL[run.spec.kind], color: '#D55E00', time: run.perturbed.time, values: run.perturbed.series[s.variable] as Float64Array }
                    ]}
                  />
                </figure>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
