import { useMemo, useState } from 'react'
import { EXTREME_LEVELS, EXTREME_LEVEL_LABEL, runWithChanges, simulateExtreme, summarizeExtremes, type CellStatus, type ExtremeCell, type ExtremeLevel } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { getCompiledModel } from '../../engine/models'
import { formatNumber, paramSpecs } from '../../lib/params'
import { riskBaseParams } from '../../lib/risk'
import { formatValue } from '../../lib/scenarioCompare'
import { extremeInputFor } from '../../lib/validationRuns'
import { selectExtremesStale, useAppStore } from '../../stores/appStore'
import { OverlayChart } from './ValidationCharts'

/** 판정 기호. 색에만 기대지 않고 글자로도 구분한다. */
export const CELL_MARK: Record<CellStatus, { mark: string; label: string }> = {
  pass: { mark: '✓', label: '통과' },
  warn: { mark: '▲', label: '주의' },
  fail: { mark: '✗', label: '실패' },
  info: { mark: 'ⓘ', label: '정보' }
}

/** 극단 조건 시험(VAL-03): 파라미터 × 수준 표와 셀 상세. 기계적 결함만 잡고 "말이 되는 거동인가"는 사람이 읽는다. */
export function ExtremesPanel() {
  const modelId = useAppStore((s) => s.modelId)
  const run = useAppStore((s) => s.validationExtremes)
  const stale = useAppStore(selectExtremesStale)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const targetId = useAppStore((s) => s.validation.targetScenarioId)
  const runSettings = useAppStore((s) => s.runSettings)
  const runExtremes = useAppStore((s) => s.runExtremes)
  const cancel = useAppStore((s) => s.cancelExtremes)
  const [message, setMessage] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [selected, setSelected] = useState<{ name: string; value: number } | null>(null)

  const entry = getEntry(modelId)
  const running = run?.status === 'running'
  const cells = run?.cells ?? []
  const summary = useMemo(() => summarizeExtremes(cells), [cells])
  const specs = paramSpecs(entry)
  const labelOf = (name: string) => entry.def.constants[name]?.label ?? name
  const unitOf = (name: string) => entry.def.constants[name]?.unit ?? ''
  const pct = run && run.total > 0 ? Math.round((run.done / run.total) * 100) : 0

  const byParam = useMemo(() => {
    const m = new Map<string, ExtremeCell[]>()
    for (const c of cells) m.set(c.case.name, [...(m.get(c.case.name) ?? []), c])
    return m
  }, [cells])
  const cellAt = (name: string, level: ExtremeLevel): ExtremeCell | undefined => byParam.get(name)?.find((c) => c.case.levels.includes(level))
  const rows = specs.filter((s) => !onlyProblems || (byParam.get(s.name) ?? []).some((c) => c.status !== 'pass'))
  const selectedCell = selected ? cells.find((c) => c.case.name === selected.name && c.case.value === selected.value) ?? null : null

  const start = async () => {
    setMessage(null)
    setSelected(null)
    setMessage(await runExtremes())
  }

  return (
    <section className="validation-section" aria-label="극단 조건 시험">
      <h2>극단 조건 시험</h2>
      <p className="muted">
        파라미터를 하나씩 <strong>허용 범위의 최소·최대</strong>와 <strong>범위 밖의 값(0, 현재 값의 ×10·×0.1)</strong>으로 바꿔 실행하고 기계적 결함을 찾습니다.
        이 표는 수치 오류, 음수 Level, 불변식 위반, 종료 시각까지 끝나지 않음만 잡습니다. <strong>거동이 말이 되는지는 셀을 열어 지표와 그래프를 보고 사람이 판단</strong>합니다.
      </p>
      <div className="row wrap">
        {running ? (
          <button type="button" className="danger" onClick={cancel}>
            중단
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => void start()} title="대상 시나리오에서 모든 파라미터를 한 번에 하나씩 바꿔 실행합니다">
            {run ? '다시 실행' : '극단 조건 실행'}
          </button>
        )}
        {running && (
          <div className="progress" role="progressbar" aria-label="극단 조건 시험 진행" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
        )}
        <span className="muted" role="status" aria-live="polite">
          {!run ? '아직 실행하지 않았습니다.' : running ? `실행 중 ${run.done}/${run.total}` : run.status === 'canceled' ? `취소됨 — ${run.done}/${run.total}개까지의 결과입니다.` : run.status === 'error' ? '실행하지 못했습니다.' : `${run.total}개 값 완료${stale ? ' — 입력이 바뀌어 결과가 오래되었습니다. 다시 실행하세요.' : ''}`}
        </span>
      </div>
      <p className="muted">
        대상: {targetId === '@base' ? '기준' : (scenarios.find((s) => s.id === targetId)?.name ?? targetId)} · 종료 {runSettings.end}일, dt {runSettings.dt}일
        {riskBaseParams(params, scenarios, targetId) === null ? ' (대상 시나리오를 찾을 수 없습니다)' : ''}
      </p>
      {(message ?? run?.error) && (
        <div className="field-error" role="alert">
          {message ?? run?.error}
        </div>
      )}

      {run && cells.length > 0 && (
        <div className={stale ? 'stale' : undefined}>
          <p role="status">
            {(['pass', 'warn', 'fail', 'info'] as CellStatus[]).map((s) => (
              <span key={s} className="extreme-legend">
                <span>
                  <strong>
                    {CELL_MARK[s].mark} {CELL_MARK[s].label} {summary.counts[s]}
                  </strong>
                </span>
              </span>
            ))}
          </p>
          <p className="muted extreme-legend">
            <span>✓ 통과: 오류 없고 Level ≥ 0, 불변식 성립, 끝남</span>
            <span>▲ 주의: 음수 Level·불변식 위반, 또는 범위 안인데 끝나지 않음</span>
            <span>✗ 실패: 허용 범위 안의 값에서 수치 오류</span>
            <span>ⓘ 정보: 범위 밖의 오류나 끝나지 않음(예상된 거동일 수 있음)</span>
          </p>
          {summary.failures.length > 0 && (
            <div className="field-error" role="alert">
              <strong>모델 결함 후보 {summary.failures.length}개</strong> (허용 범위 안의 값에서 오류):
              <ul>
                {summary.failures.map((c) => (
                  <li key={`${c.case.name}-${c.case.value}`}>
                    {labelOf(c.case.name)} = {formatNumber(c.case.value)}: {c.error?.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="risk-check">
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> 문제가 있는 파라미터만
          </label>
          <div className="table-scroll">
            <table className="risk-stats extreme-table">
              <thead>
                <tr>
                  <th scope="col">파라미터</th>
                  {EXTREME_LEVELS.map((l) => (
                    <th key={l} scope="col">
                      {EXTREME_LEVEL_LABEL[l]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((sp) => (
                  <tr key={sp.name}>
                    <th scope="row">
                      {labelOf(sp.name)}
                      <span className="muted"> {sp.min} ~ {sp.max}</span>
                    </th>
                    {EXTREME_LEVELS.map((l) => {
                      const c = cellAt(sp.name, l)
                      if (!c) return <td key={l} className="muted">{running ? '…' : '–'}</td>
                      const m = CELL_MARK[c.status]
                      const isSel = selected?.name === c.case.name && selected.value === c.case.value
                      return (
                        <td key={l}>
                          <button
                            type="button"
                            className={`extreme-cell ${c.status}${isSel ? ' selected' : ''}`}
                            aria-pressed={isSel}
                            aria-label={`${labelOf(sp.name)} ${EXTREME_LEVEL_LABEL[l]} ${formatNumber(c.case.value)}: ${m.label}${c.reasons.length > 0 ? `, ${c.reasons[0]}` : ''}`}
                            title={c.reasons.join('\n') || '통과'}
                            onClick={() => setSelected({ name: c.case.name, value: c.case.value })}
                          >
                            {m.mark} {formatNumber(c.case.value)}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedCell && <ExtremeDetail cell={selectedCell} unit={unitOf(selectedCell.case.name)} label={labelOf(selectedCell.case.name)} />}
        </div>
      )}
    </section>
  )
}

/** 한 셀의 상세: 판정 이유, 지표, 기준(대상) 실행과 겹친 그래프. 그래프는 선택할 때 같은 값으로 다시 실행해 그린다. */
function ExtremeDetail({ cell, label, unit }: { cell: ExtremeCell; label: string; unit: string }) {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const targetId = useAppStore((s) => s.validation.targetScenarioId)
  const runSettings = useAppStore((s) => s.runSettings)
  const entry = getEntry(modelId)
  const [variable, setVariable] = useState(entry.defaultVariable)
  const v = entry.variables.find((x) => x.name === variable) ?? (entry.variables[0] as (typeof entry.variables)[number])

  const runs = useMemo(() => {
    const base = riskBaseParams(params, scenarios, targetId)
    if (!base || cell.error) return null
    const model = getCompiledModel(modelId)
    const input = extremeInputFor(model, entry, base, runSettings)
    try {
      return { base: runWithChanges(model, base, input.options, []), extreme: simulateExtreme(input, cell.case) }
    } catch {
      return null
    }
  }, [cell, params, scenarios, targetId, runSettings, modelId, entry])

  return (
    <section className="validation-detail" aria-label="셀 상세">
      <h3>
        {label} = {formatNumber(cell.case.value)}
        {unit && <span className="muted"> {unit}</span>} <span className="muted">({cell.case.levels.map((l) => EXTREME_LEVEL_LABEL[l]).join('·')}, {cell.case.inRange ? '허용 범위 안' : '허용 범위 밖'})</span>
      </h3>
      <p>
        <strong>
          {CELL_MARK[cell.status].mark} {CELL_MARK[cell.status].label}
        </strong>
        {cell.reasons.length === 0 ? ' — 기계적 결함이 없습니다.' : ''}
      </p>
      {cell.reasons.length > 0 && (
        <ul>
          {cell.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {cell.error && (
        <p className="muted">
          오류 위치: {cell.error.variable ?? '(모델)'}
          {cell.error.time !== undefined ? `, ${cell.error.time}일` : ''}
        </p>
      )}
      {cell.kpis && (
        <ul className="muted" aria-label="지표">
          {entry.kpiSpecs.map((k) => (
            <li key={k.id}>
              {k.label}: {formatValue(k, cell.kpis?.[k.id] ?? null)}
            </li>
          ))}
        </ul>
      )}
      {runs ? (
        <>
          <label className="risk-field">
            <span>그래프 변수</span>
            <select value={v.name} onChange={(e) => setVariable(e.target.value)}>
              {entry.variables.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.label} ({x.unit})
                </option>
              ))}
            </select>
          </label>
          <OverlayChart
            label={v.label}
            unit={v.unit}
            series={[
              { name: '대상(현재 값)', color: '#7A7A7A', time: runs.base.time, values: runs.base.series[v.name] as Float64Array, dashed: true },
              { name: `${label} = ${formatNumber(cell.case.value)}`, color: '#D55E00', time: runs.extreme.time, values: runs.extreme.series[v.name] as Float64Array }
            ]}
          />
        </>
      ) : (
        <p className="muted">{cell.error ? '오류로 중단되어 그래프가 없습니다.' : '그래프를 그릴 수 없습니다.'}</p>
      )}
    </section>
  )
}
