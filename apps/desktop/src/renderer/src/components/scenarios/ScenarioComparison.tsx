import { useMemo, useState } from 'react'
import { getEntry } from '../../catalog'
import { barData, buildComparison, formatDelta, formatValue, overlayRuns, radarData, type CompareColumn, type Comparison } from '../../lib/scenarioCompare'
import { BASE_SCENARIO_ID } from '../../lib/adoption'
import { BASE_ID, rowStatus } from '../../lib/scenarioRunner'
import { useAppStore } from '../../stores/appStore'
import { TimeSeriesChart } from '../TimeSeriesChart'
import { ADOPTED_MARK } from './AdoptionPanel'
import { KpiBarChart } from './KpiBarChart'
import { KpiRadarChart } from './KpiRadarChart'

type View = 'bar' | 'radar' | 'series'
const VIEWS: [View, string][] = [
  ['bar', '막대'],
  ['radar', '레이더'],
  ['series', '시계열 겹치기']
]

function columnNote(col: CompareColumn): string | null {
  if (col.stale) return '오래됨'
  if (!col.hasResult) return col.status === 'queued' ? '대기' : col.status === 'running' ? '실행 중' : col.status === 'error' ? '오류' : '실행 전'
  return null
}

/** 시나리오 비교: 지표 표(기준 대비 차이)와 막대·레이더·시계열 차트. */
export function ScenarioComparison() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const settings = useAppStore((s) => s.runSettings)
  const scenarios = useAppStore((s) => s.scenarios)
  const runs = useAppStore((s) => s.scenarioRuns)
  const hidden = useAppStore((s) => s.compareHidden)
  const adoptedColumn = useAppStore((s) => (s.adopted ? (s.adopted.scenarioId === BASE_SCENARIO_ID ? BASE_ID : s.adopted.scenarioId) : null))
  const toggle = useAppStore((s) => s.toggleCompareVisible)
  const entry = getEntry(modelId)

  const [view, setView] = useState<View>('bar')
  const [kpiId, setKpiId] = useState<string | null>(null)
  const [variable, setVariable] = useState<string | null>(null)

  const comparison: Comparison = useMemo(
    () => buildComparison(entry, { modelId, params, settings, scenarios }, runs),
    [entry, modelId, params, settings, scenarios, runs]
  )
  const anyResult = comparison.columns.some((c) => c.hasResult)
  const specs = entry.kpiSpecs
  const activeKpi = specs.find((k) => k.id === kpiId) ?? specs[0]
  const activeVar = entry.variables.find((v) => v.name === variable) ?? entry.variables.find((v) => v.name === entry.defaultVariable) ?? entry.variables[0]
  const colSpan = comparison.columns.length + 1

  const bar = useMemo(() => (activeKpi ? barData(comparison, activeKpi.id, hidden) : null), [comparison, activeKpi, hidden])
  const radar = useMemo(() => radarData(entry, comparison, hidden), [entry, comparison, hidden])
  const overlay = useMemo(() => overlayRuns(entry, comparison, runs, hidden), [entry, comparison, runs, hidden])

  return (
    <section className="compare" aria-label="시나리오 비교">
      <h2>비교</h2>
      <p className="muted">시나리오 사이의 상대 비교용입니다. 모델은 책과 정량적으로 일치하지 않으므로 절대값을 예측으로 읽지 마세요.</p>

      {!anyResult ? (
        <p className="empty-hint">아직 결과가 없습니다. 위의 “전체 실행”으로 기준과 시나리오를 실행하세요.</p>
      ) : (
        <>
          {!comparison.baseReady && (
            <div className="notice warning" role="status">
              <div className="notice-body">기준의 결과가 없어 차이를 계산할 수 없습니다. 기준을 실행하세요.</div>
            </div>
          )}
          {comparison.anyStale && (
            <div className="notice warning" role="status">
              <div className="notice-body">입력이 바뀐 뒤 다시 실행하지 않은 시나리오가 있습니다(오래됨). 표와 차트는 각 결과를 만든 입력 기준이며, 다시 실행하면 갱신됩니다.</div>
            </div>
          )}

          <div className="compare-scroll">
            <table className="compare-table">
              <thead>
                <tr>
                  <th scope="col" className="sticky">
                    지표
                  </th>
                  {comparison.columns.map((col) => {
                    const note = columnNote(col)
                    return (
                      <th scope="col" key={col.id} className="num">
                        <div className="col-head">
                          <span className={col.color ? 'swatch' : 'swatch base'} style={col.color ? { background: col.color } : undefined} aria-hidden="true" />
                          {col.name}
                          {adoptedColumn === col.id && <span title="채택 계획"> {ADOPTED_MARK} 채택</span>}
                        </div>
                        {note && <div className="muted note">{note}</div>}
                        <label className="show-toggle">
                          <input type="checkbox" checked={hidden[col.id] !== true} onChange={() => toggle(col.id)} aria-label={`${col.name} 차트에 표시`} />
                          차트
                        </label>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {comparison.groups.map((g) => (
                  <GroupRows key={g.group} group={g} columns={comparison.columns} colSpan={colSpan} />
                ))}
              </tbody>
            </table>
          </div>

          <div className="view-switch" role="tablist" aria-label="차트 종류">
            {VIEWS.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={view === id} className={`seg${view === id ? ' active' : ''}`} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>

          {view === 'bar' && bar && activeKpi && (
            <div className="chart-block">
              <div className="chart-toolbar">
                <label htmlFor="kpi-select">지표</label>
                <select id="kpi-select" value={activeKpi.id} onChange={(e) => setKpiId(e.target.value)}>
                  {specs.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              {bar.categories.length === 0 ? <p className="empty-hint">그래프에 표시할 결과가 없습니다.</p> : <KpiBarChart data={bar} />}
            </div>
          )}

          {view === 'radar' && (
            <div className="chart-block">
              {radar.ready ? <KpiRadarChart data={radar} /> : <p className="empty-hint">{radar.reason}</p>}
              {radar.ready && radar.series.length === 0 && <p className="empty-hint">기준과 비교할 시나리오가 없습니다.</p>}
              {radar.skipped.length > 0 && (
                <ul className="muted notes">
                  {radar.skipped.map((s) => (
                    <li key={s.axis.id}>
                      {s.axis.label} 축 제외: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {radar.excluded.length > 0 && (
                <ul className="muted notes">
                  {radar.excluded.map((s) => (
                    <li key={s.name}>
                      {s.name} 제외: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {radar.ready && <p className="muted">값은 기준을 1로 맞춘 비율이며 바깥쪽일수록 기준보다 좋습니다(최대 2).</p>}
            </div>
          )}

          {view === 'series' && activeVar && (
            <div className="chart-block">
              <div className="chart-toolbar">
                <label htmlFor="series-var">그래프 변수</label>
                <select id="series-var" value={activeVar.name} onChange={(e) => setVariable(e.target.value)}>
                  {entry.variables.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.label} ({v.unit})
                    </option>
                  ))}
                </select>
              </div>
              <div className="series-box">
                <TimeSeriesChart runs={overlay} references={[]} live={null} variable={activeVar} />
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function GroupRows({ group, columns, colSpan }: { group: Comparison['groups'][number]; columns: CompareColumn[]; colSpan: number }) {
  return (
    <>
      <tr className="group-row">
        <th scope="rowgroup" colSpan={colSpan}>
          {group.label}
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.spec.id}>
          <th scope="row" className="sticky">
            {row.spec.label}
          </th>
          {columns.map((col) => {
            const cell = row.cells[col.id]
            const isBase = col.id === BASE_ID
            const delta = cell?.delta ? formatDelta(row.spec, cell.delta) : null
            const hasKpis = col.kpis !== null
            return (
              <td key={col.id} className={`num${col.stale ? ' stale-cell' : ''}`}>
                {!hasKpis ? (
                  <span className="muted">–</span>
                ) : (
                  <>
                    <div className={isBase ? 'strong' : ''}>{formatValue(row.spec, cell?.value ?? null)}</div>
                    {!isBase && delta && cell?.delta && (
                      <div
                        className={`delta ${cell.delta.verdict === 'better' ? 'better' : cell.delta.verdict === 'worse' ? 'worse' : 'neutral'}`}
                        title={delta.percent ? `기준 대비 ${delta.percent}` : undefined}
                      >
                        <span aria-hidden="true">{delta.arrow} </span>
                        {delta.text}
                        {delta.verdict && <span className="verdict"> {delta.verdict}</span>}
                        <span className="sr-only">{`, 기준보다 ${delta.arrow === '▲' ? '큼' : delta.arrow === '▼' ? '작음' : '같음'}`}</span>
                      </div>
                    )}
                  </>
                )}
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}
