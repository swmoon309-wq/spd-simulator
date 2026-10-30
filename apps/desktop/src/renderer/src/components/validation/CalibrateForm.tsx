import { useMemo, useState } from 'react'
import { alignColumn, DEFAULT_SPLIT_FRACTION, MAX_CALIB_PARAMS, runWithChanges, SPLIT_MIN_POINTS, type CalibParam, type CalibrationResult } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { getCompiledModel } from '../../engine/models'
import { formatNumber, paramSpecs } from '../../lib/params'
import { riskBaseParams } from '../../lib/risk'
import type { Dataset } from '../../lib/validation'
import { selectCalibrationStale, useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'
import { OverlayChart } from './ValidationCharts'

const j = (v: number | null, d = 4): string => (v === null || !Number.isFinite(v) ? '–' : v.toPrecision(d))

/** 파라미터의 기본 보정 범위: 현재 값의 0.25~4배를 허용 범위 안으로(좁을수록 빠르고 식별하기 쉽다). */
function defaultRange(spec: { min: number; max: number; integer?: boolean }, value: number): { min: number; max: number } {
  let lo = Math.max(spec.min, value * 0.25)
  let hi = Math.min(spec.max, value * 4)
  if (!(value > 0) || !(hi > lo)) {
    lo = spec.min
    hi = spec.max
  }
  const clean = (x: number) => Number(x.toPrecision(6))
  return spec.integer ? { min: Math.ceil(lo), max: Math.floor(hi) } : { min: clean(lo), max: clean(hi) }
}

interface Row {
  name: string
  min: number
  max: number
}

/** 보정 폼과 결과(VAL-05). 데이터셋 하나를 정해 열·가중치, 파라미터·범위, 시간 분할을 고르고 실행한다. */
export function CalibrateForm({ dataset }: { dataset: Dataset }) {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const targetId = useAppStore((s) => s.validation.targetScenarioId)
  const runSettings = useAppStore((s) => s.runSettings)
  const run = useAppStore((s) => s.validationCalibration)
  const stale = useAppStore(selectCalibrationStale)
  const runCalibration = useAppStore((s) => s.runCalibration)
  const cancel = useAppStore((s) => s.cancelCalibration)
  const savePreset = useAppStore((s) => s.savePreset)
  const entry = getEntry(modelId)
  const specs = paramSpecs(entry)
  const base = useMemo(() => riskBaseParams(params, scenarios, targetId) ?? params, [params, scenarios, targetId])
  const labelOf = (n: string) => entry.def.constants[n]?.label ?? n
  const usable = dataset.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.variable !== null)

  const [used, setUsed] = useState<Record<number, boolean>>({})
  const [weights, setWeights] = useState<Record<number, number>>({})
  const [rows, setRows] = useState<Row[]>(() => {
    const first = specs.find((s) => /prod/.test(s.name)) ?? specs[0]
    return first ? [{ name: first.name, ...defaultRange(first, base[first.name] ?? 0) }] : []
  })
  const [split, setSplit] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  const [presetName, setPresetName] = useState('')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const isUsed = (i: number) => used[i] ?? true
  const weightOf = (i: number) => weights[i] ?? 1
  const chosen = usable.filter(({ i }) => isUsed(i))
  const points = chosen.reduce((s, { c }) => s + c.points.length, 0)
  const running = run?.status === 'running'
  const result: CalibrationResult | null = run?.result ?? null
  const pct = running && run?.progress ? Math.min(100, Math.round((run.progress.evaluations / Math.max(1, run.progress.maxEvaluations)) * 100)) : 0

  const addRow = () => {
    const free = specs.find((s) => !rows.some((r) => r.name === s.name))
    if (free && rows.length < MAX_CALIB_PARAMS) setRows([...rows, { name: free.name, ...defaultRange(free, base[free.name] ?? 0) }])
  }
  const changeName = (i: number, name: string) => {
    const sp = specs.find((s) => s.name === name)
    if (sp) setRows(rows.map((r, k) => (k === i ? { name, ...defaultRange(sp, base[name] ?? 0) } : r)))
  }
  const start = async () => {
    setMessage(null)
    setSaveMessage(null)
    const calibParams: CalibParam[] = rows.map((r) => ({ name: r.name, min: r.min, max: r.max, ...(specs.find((s) => s.name === r.name)?.integer ? { integer: true } : {}) }))
    setMessage(await runCalibration({ datasetId: dataset.id, params: calibParams, columns: chosen.map(({ i }) => ({ index: i, weight: weightOf(i) })), split }))
  }

  // 그래프: 관측과 보정 전·후의 시뮬레이션(첫 번째로 고른 열)
  const chart = useMemo(() => {
    if (!result || !run) return null
    const first = run.request.columns[0]
    const col = first ? dataset.columns[first.index] : undefined
    if (!col || col.variable === null) return null
    const model = getCompiledModel(modelId)
    const options = { end: runSettings.end, dt: runSettings.dt, seed: runSettings.seed }
    const theta = (values: number[]) => ({ ...base, ...Object.fromEntries(result.names.map((n, k) => [n, values[k] as number])) })
    try {
      const before = runWithChanges(model, theta(result.initial), options, [])
      const after = runWithChanges(model, theta(result.best), options, [])
      const a = alignColumn(before, { variable: col.variable, scale: col.scale, points: col.points }, { timeUnit: dataset.timeUnit, offsetDay: dataset.offsetDay })
      return { before, after, variable: col.variable, name: col.name, obs: a.time.map((t, k) => [t, a.observed[k] as number] as [number, number]) }
    } catch {
      return null
    }
  }, [result, run, dataset, modelId, runSettings, base])
  const v = chart ? entry.variables.find((x) => x.name === chart.variable) : undefined

  return (
    <div>
      <h3>1. 맞출 데이터</h3>
      <p className="muted">
        데이터셋 <strong>{dataset.name}</strong>의 열 중 모델 변수에 연결한 열만 쓸 수 있습니다. 열마다 가중치를 줄 수 있고(합이 1이 되게 다시 맞춥니다), 목적함수는 <strong>J = Σ w·NRMSE²</strong>(NRMSE = RMSE / 관측의 평균 크기)입니다.
      </p>
      {usable.length === 0 ? (
        <p className="field-error">연결한 열이 없습니다. 데이터 비교 탭에서 열을 모델 변수에 연결하세요.</p>
      ) : (
        <table className="risk-stats">
          <thead>
            <tr>
              <th scope="col">사용</th>
              <th scope="col">열 → 변수</th>
              <th scope="col" className="num">점</th>
              <th scope="col">가중치</th>
            </tr>
          </thead>
          <tbody>
            {usable.map(({ c, i }) => (
              <tr key={i}>
                <td>
                  <input type="checkbox" aria-label={`${c.name} 사용`} checked={isUsed(i)} disabled={running} onChange={(e) => setUsed({ ...used, [i]: e.target.checked })} />
                </td>
                <th scope="row">
                  {c.name} <span className="muted">→ {entry.variables.find((x) => x.name === c.variable)?.label ?? c.variable}</span>
                </th>
                <td className="num">{c.points.length}</td>
                <td>
                  <DraftNumber id={`calib-w-${i}`} label={`${c.name} 가중치`} value={weightOf(i)} onValue={(w) => setWeights({ ...weights, [i]: w })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>2. 보정할 파라미터 (최대 {MAX_CALIB_PARAMS}개)</h3>
      <p className="muted">파라미터가 많고 점이 적으면 해가 유일하지 않습니다. 범위를 좁히면 빠르고 식별하기 쉽습니다. 기본 범위는 현재 값의 0.25~4배입니다.</p>
      <table className="risk-stats">
        <thead>
          <tr>
            <th scope="col">파라미터</th>
            <th scope="col" className="num">현재 값</th>
            <th scope="col">최솟값</th>
            <th scope="col">최댓값</th>
            <th scope="col">
              <span className="sr-only">빼기</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${i}-${r.name}`}>
              <td>
                <select aria-label={`보정 파라미터 ${i + 1}`} value={r.name} disabled={running} onChange={(e) => changeName(i, e.target.value)}>
                  {specs.filter((s) => s.name === r.name || !rows.some((x) => x.name === s.name)).map((s) => (
                    <option key={s.name} value={s.name}>
                      {labelOf(s.name)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="num">{formatNumber(base[r.name] ?? 0)}</td>
              <td>
                <DraftNumber id={`calib-min-${i}-${r.name}`} label={`${labelOf(r.name)} 최솟값`} value={r.min} onValue={(x) => setRows(rows.map((q, k) => (k === i ? { ...q, min: x } : q)))} />
              </td>
              <td>
                <DraftNumber id={`calib-max-${i}-${r.name}`} label={`${labelOf(r.name)} 최댓값`} value={r.max} onValue={(x) => setRows(rows.map((q, k) => (k === i ? { ...q, max: x } : q)))} />
              </td>
              <td>
                <button type="button" className="link" disabled={running || rows.length <= 1} onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={`${labelOf(r.name)} 빼기`}>
                  빼기
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={running || rows.length >= MAX_CALIB_PARAMS} onClick={addRow}>
        + 파라미터 추가
      </button>

      <h3>3. 시간 분할 검증</h3>
      <label className="risk-check">
        <input type="checkbox" checked={split && points >= SPLIT_MIN_POINTS} disabled={running || points < SPLIT_MIN_POINTS} onChange={(e) => setSplit(e.target.checked)} />
        앞 {Math.round(DEFAULT_SPLIT_FRACTION * 100)}%로 보정하고 뒤 {100 - Math.round(DEFAULT_SPLIT_FRACTION * 100)}%로 <strong>보정에 쓰지 않은 구간의 오차</strong>를 봅니다
      </label>
      <p className="muted">{points >= SPLIT_MIN_POINTS ? `관측 ${points}점. 보정 구간의 오차만 작고 검증 구간의 오차가 크면 과적합입니다.` : `관측이 ${SPLIT_MIN_POINTS}점 미만(${points}점)이라 시간 분할을 쓰지 않습니다.`}</p>

      <div className="row wrap">
        {running ? (
          <button type="button" className="danger" onClick={cancel}>
            중단
          </button>
        ) : (
          <button type="button" className="primary" disabled={chosen.length === 0 || rows.length === 0} onClick={() => void start()}>
            {run ? '다시 보정' : '보정 실행'}
          </button>
        )}
        {running && (
          <div className="progress" role="progressbar" aria-label="보정 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
        <span className="muted" role="status" aria-live="polite">
          {running ? `시작점 ${(run?.progress?.start ?? 0) + 1}/${run?.progress?.starts ?? 5} · 평가 ${run?.progress?.evaluations ?? 0}회 · 최선 J ${j(run?.progress?.best ?? null)}` : run?.status === 'canceled' ? '취소됨 — 그때까지의 최선입니다.' : run?.status === 'done' ? `완료 — 평가 ${result?.evaluations}회${stale ? ' · 입력이 바뀌어 결과가 오래되었습니다. 다시 보정하세요.' : ''}` : run?.status === 'error' ? '실행하지 못했습니다.' : '아직 실행하지 않았습니다.'}
        </span>
      </div>
      {(message ?? run?.error) && (
        <div className="field-error" role="alert">
          {message ?? run?.error}
        </div>
      )}

      {result && (
        <div className={stale ? 'stale' : undefined}>
          <h3>결과</h3>
          <p>
            <strong>보정 구간 J {j(result.jBefore)} → {j(result.jAfter)}</strong>
            {result.jValAfter !== null && (
              <>
                {' · '}
                <strong>검증 구간 J {j(result.jValBefore)} → {j(result.jValAfter)}</strong>
                <span className="muted"> (보정에 쓰지 않은 뒤 {result.split ? Math.round((1 - result.split.fraction) * 100) : 0}%, {result.split?.nVal}점)</span>
              </>
            )}
          </p>
          <div className="table-scroll">
            <table className="risk-stats">
              <caption>보정한 값 (보정은 &quot;맞는 값&quot;을 약속하지 않습니다)</caption>
              <thead>
                <tr>
                  <th scope="col">파라미터</th>
                  <th scope="col" className="num">시작 값</th>
                  <th scope="col" className="num">보정한 값</th>
                  <th scope="col">범위</th>
                  <th scope="col">진단</th>
                </tr>
              </thead>
              <tbody>
                {result.names.map((n, i) => {
                  const flags = result.diagnostics.filter((d) => d.params.includes(n) && d.severity === 'warn').map((d) => ({ boundary: '▲ 경계', flat: '▲ 정해지지 않음', nonunique: '▲ 비유일', scarce: '▲ 자료 부족', overfit: '', noimprove: '', failed: '', excluded: '' })[d.kind])
                  const r = run?.request.params.find((p) => p.name === n)
                  return (
                    <tr key={n}>
                      <th scope="row">{labelOf(n)}</th>
                      <td className="num">{formatNumber(Number((result.initial[i] as number).toPrecision(6)))}</td>
                      <td className="num">
                        <strong>{formatNumber(Number((result.best[i] as number).toPrecision(6)))}</strong>
                      </td>
                      <td>{r ? `${formatNumber(r.min)} ~ ${formatNumber(r.max)}` : ''}</td>
                      <td>{flags.length > 0 ? flags.join(' · ') : <span className="muted">–</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h3>진단</h3>
          {result.diagnostics.length === 0 ? (
            <p className="muted">✓ 경고가 없습니다(경계에 붙지 않았고, 정해지지 않는 파라미터나 비유일성이 없습니다). 그래도 모델이 맞다는 증명은 아닙니다.</p>
          ) : (
            <ul>
              {result.diagnostics.map((d, i) => (
                <li key={i} className={d.severity === 'warn' ? 'field-error' : 'muted'}>
                  {d.severity === 'warn' ? '▲ ' : 'ⓘ '}
                  {d.message}
                </li>
              ))}
            </ul>
          )}

          <div className="table-scroll">
            <table className="risk-stats">
              <caption>열별 정규화 RMSE (보정 전 → 후)</caption>
              <thead>
                <tr>
                  <th scope="col">열</th>
                  <th scope="col" className="num">가중치</th>
                  <th scope="col" className="num">보정 구간({result.columns[0]?.n}점)</th>
                  <th scope="col" className="num">검증 구간({result.columns[0]?.nVal}점)</th>
                </tr>
              </thead>
              <tbody>
                {result.columns.map((c) => (
                  <tr key={c.variable}>
                    <th scope="row">{c.label}</th>
                    <td className="num">{(c.weight * 100).toFixed(0)}%</td>
                    <td className="num">{j(c.nrmseBefore, 3)} → {j(c.nrmseAfter, 3)}</td>
                    <td className="num">{c.nrmseValAfter === null ? '–' : `${j(c.nrmseValBefore, 3)} → ${j(c.nrmseValAfter, 3)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details>
            <summary>시작점 {result.starts.length}개의 결과(다중 시작)</summary>
            <p className="muted">시작점마다 파라미터가 다른데 J가 비슷하면 해가 유일하지 않다는 뜻입니다. 첫 시작점은 현재 값이고 나머지는 시드로 뽑은 라틴 하이퍼큐브 표본입니다.</p>
            <div className="table-scroll">
              <table className="risk-stats">
                <thead>
                  <tr>
                    <th scope="col">시작점</th>
                    {result.names.map((n) => (
                      <th key={n} scope="col" className="num">{labelOf(n)}</th>
                    ))}
                    <th scope="col" className="num">J</th>
                    <th scope="col" className="num">평가</th>
                    <th scope="col">끝</th>
                  </tr>
                </thead>
                <tbody>
                  {result.starts.map((s) => (
                    <tr key={s.index}>
                      <th scope="row">{s.index === 0 ? '현재 값' : `표본 ${s.index}`}</th>
                      {s.theta.map((t, k) => (
                        <td key={k} className="num">{formatNumber(Number(t.toPrecision(5)))}</td>
                      ))}
                      <td className="num">{j(s.j, 3)}</td>
                      <td className="num">{s.evaluations}</td>
                      <td>{s.converged ? '수렴' : '평가 상한'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {chart && v && (
            <figure>
              <figcaption>
                {v.label}: 관측(◆), 보정 전, 보정 후 ({chart.name})
              </figcaption>
              <OverlayChart
                label={v.label}
                unit={v.unit}
                series={[
                  { name: '보정 전', color: '#7A7A7A', time: chart.before.time, values: chart.before.series[chart.variable] as Float64Array, dashed: true },
                  { name: '보정 후', color: '#0072B2', time: chart.after.time, values: chart.after.series[chart.variable] as Float64Array }
                ]}
                points={[{ name: '관측', color: '#D55E00', data: chart.obs }]}
                marks={result.split ? [result.split.cutoffTime] : []}
              />
              {result.split && <p className="muted">점선은 보정 구간과 검증 구간의 경계(일)입니다.</p>}
            </figure>
          )}

          {!running && run?.status !== 'error' && (
            <div className="row wrap">
              <label className="risk-field">
                <span>프리셋 이름</span>
                <input type="text" aria-label="프리셋 이름" value={presetName} placeholder="예: 팀 A 보정" maxLength={100} onChange={(e) => setPresetName(e.target.value)} />
              </label>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  const r = savePreset(presetName || `${dataset.name} 보정`)
                  setSaveMessage(r)
                  if (!r) setPresetName('')
                }}
              >
                프리셋으로 저장
              </button>
            </div>
          )}
          {saveMessage && (
            <div className="field-error" role="alert">
              {saveMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
