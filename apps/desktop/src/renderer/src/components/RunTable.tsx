import { canAddScenario, MAX_SCENARIOS } from '@spd/analysis'
import { exportRunCsv } from '../lib/fileActions'
import { useAppStore } from '../stores/appStore'

function formatDay(day: number | null): string {
  return day === null ? '미완료' : `${day.toFixed(1)}일`
}

export function RunTable() {
  const runs = useAppStore((s) => s.runs)
  const toggleRun = useAppStore((s) => s.toggleRun)
  const removeRun = useAppStore((s) => s.removeRun)
  const clearRuns = useAppStore((s) => s.clearRuns)
  const saveRunAsScenario = useAppStore((s) => s.saveRunAsScenario)
  const setNotice = useAppStore((s) => s.setNotice)
  const scenarioCount = useAppStore((s) => s.scenarios.length)
  const base = runs[0]?.kpis.completionDay ?? null
  const desktop = typeof window.spd !== 'undefined'

  const full = !canAddScenario(scenarioCount)
  const saveAsScenario = (runId: number) => {
    const { scenarioId, message } = saveRunAsScenario(runId)
    if (scenarioId === null) setNotice({ kind: 'warning', text: message ?? '시나리오로 저장하지 못했습니다.' })
    else {
      const name = useAppStore.getState().scenarios.find((x) => x.id === scenarioId)?.name ?? scenarioId
      setNotice({ kind: message ? 'warning' : 'info', text: `시나리오 '${name}'(으)로 저장했습니다. 시나리오 탭에서 비교하세요.`, ...(message ? { details: [message] } : {}) })
    }
  }

  if (runs.length === 0) return null
  return (
    <section className="run-table" aria-label="실행 결과 목록">
      <div className="run-table-head">
        <h2>실행 결과</h2>
        <button type="button" className="link" onClick={clearRuns}>
          모두 지우기
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">표시</th>
            <th scope="col">실행</th>
            <th scope="col" className="num">
              완료
            </th>
            <th scope="col" className="num">
              첫 실행 대비
            </th>
            <th scope="col" className="num">
              최대 인원
            </th>
            <th scope="col">
              <span className="sr-only">시나리오로 저장, CSV 저장, 삭제</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => {
            const delta = r.kpis.completionDay !== null && base !== null && i > 0 ? r.kpis.completionDay - base : null
            return (
              <tr key={r.id} className={r.visible ? '' : 'dim'}>
                <td>
                  <input
                    type="checkbox"
                    checked={r.visible}
                    onChange={() => toggleRun(r.id)}
                    aria-label={`${r.name} 표시`}
                  />
                </td>
                <td>
                  <span className="swatch" style={{ background: r.color }} aria-hidden="true" />
                  {r.name}
                </td>
                <td className="num">{formatDay(r.kpis.completionDay)}</td>
                <td className={`num ${delta === null ? '' : delta > 0 ? 'worse' : delta < 0 ? 'better' : ''}`}>
                  {delta === null ? '–' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}일`}
                </td>
                <td className="num">{Math.round(r.kpis.peakStaff)}명</td>
                <td className="actions">
                  <button
                    type="button"
                    className="link"
                    onClick={() => saveAsScenario(r.id)}
                    disabled={full}
                    title={full ? `시나리오는 최대 ${MAX_SCENARIOS}개입니다` : '이 실행의 입력값을 시나리오로 저장'}
                    aria-label={`${r.name} 시나리오로 저장`}
                  >
                    시나리오로
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void exportRunCsv(r)}
                    disabled={!desktop}
                    title={desktop ? '모든 변수를 CSV로 저장' : '데스크톱 앱에서만 사용할 수 있습니다'}
                    aria-label={`${r.name} CSV로 저장`}
                  >
                    CSV
                  </button>
                  <button type="button" className="link" onClick={() => removeRun(r.id)} aria-label={`${r.name} 삭제`}>
                    삭제
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
