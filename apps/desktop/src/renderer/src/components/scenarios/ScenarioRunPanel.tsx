import { useMemo } from 'react'
import type { RunResult } from '@spd/sd-engine'
import { getEntry } from '../../catalog'
import { formatNumber } from '../../lib/params'
import { scenarioColor } from '../../lib/palette'
import { BASE_ID, rowStatus, taskFor, type RowStatus } from '../../lib/scenarioRunner'
import { checkRunSettings } from '../../lib/runSettings'
import { busyReason, useAppStore } from '../../stores/appStore'

const STATUS_LABEL: Record<RowStatus['kind'], string> = {
  none: '실행 전',
  queued: '대기',
  running: '실행 중',
  done: '완료',
  stale: '오래됨',
  error: '오류'
}

const STATUS_MARK: Record<RowStatus['kind'], string> = {
  none: '○',
  queued: '◔',
  running: '▶',
  done: '✓',
  stale: '⚠',
  error: '✕'
}

/** 시나리오(기준 포함) 일괄 실행: 행별 상태와 진행, 전체/다시 실행, 중단. */
export function ScenarioRunPanel() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const settings = useAppStore((s) => s.runSettings)
  const scenarios = useAppStore((s) => s.scenarios)
  const runs = useAppStore((s) => s.scenarioRuns)
  const batch = useAppStore((s) => s.batch)
  const busy = useAppStore((s) => busyReason(s) !== null && s.batch === null)
  const fieldInvalid = useAppStore((s) => Object.keys(s.paramErrors).length > 0)
  const runScenarios = useAppStore((s) => s.runScenarios)
  const cancelBatch = useAppStore((s) => s.cancelBatch)
  const lastBatch = useAppStore((s) => s.lastBatch)

  const entry = getEntry(modelId)
  const completion = entry.kpiSpecs.find((k) => k.id === 'completionDay')
  const inputs = { modelId, params, settings, scenarios }
  const rows = [{ id: BASE_ID, name: '기준' }, ...scenarios.map((s) => ({ id: s.id, name: s.name }))]

  const comboError = checkRunSettings(settings)
  const blocked = batch !== null || busy || fieldInvalid || comboError !== null
  const blockedReason = batch
    ? '일괄 실행 중입니다'
    : busy
      ? '실험 탭의 실행이 끝날 때까지 기다리세요'
      : fieldInvalid
        ? '실험 탭의 입력 오류를 먼저 고치세요'
        : comboError

  const completionOf = useMemo(() => {
    const cache = new WeakMap<RunResult, number | null>()
    return (result: RunResult): number | null => {
      if (!completion) return null
      if (!cache.has(result)) cache.set(result, completion.compute(result, params))
      return cache.get(result) ?? null
    }
  }, [completion, params])

  // 마지막 일괄 실행 결과는 스토어에 있어 탭을 오가도 남는다.
  const summary = lastBatch
    ? [
        `${lastBatch.completed}개 완료`,
        ...(lastBatch.failed > 0 ? [`${lastBatch.failed}개 실패`] : []),
        ...(lastBatch.canceled ? ['중단됨'] : []),
        ...(lastBatch.completed === 0 && lastBatch.failed === 0 && !lastBatch.canceled ? ['(이미 최신입니다)'] : [])
      ].join(' · ')
    : ''
  const run = (mode: 'missing' | 'all', ids?: string[]) => void runScenarios(mode, ids)

  return (
    <section className="run-panel" aria-label="시나리오 실행">
      <div className="run-panel-head">
        <h2>실행</h2>
        <div className="row wrap">
          {batch ? (
            <button type="button" className="danger" onClick={cancelBatch}>
              중단
            </button>
          ) : (
            <>
              <button type="button" className="primary" disabled={blocked} title={blockedReason ?? '결과가 없거나 오래된 행만 실행합니다'} onClick={() => run('missing')}>
                전체 실행
              </button>
              <button type="button" disabled={blocked} title={blockedReason ?? '모든 행을 다시 실행합니다'} onClick={() => run('all')}>
                다시 실행
              </button>
            </>
          )}
          <span className="muted" role="status" aria-live="polite">
            {batch ? `${batch.done}/${batch.total} 처리 중` : summary}
          </span>
        </div>
      </div>
      <p className="muted">
        종료 {formatNumber(settings.end)}일 · dt {formatNumber(settings.dt)}일 · 시드 {settings.seed} (프로젝트 공통). 입력이 같은 행은 한 번만 계산합니다.
      </p>
      {comboError && (
        <div className="field-error" role="alert">
          {comboError}
        </div>
      )}

      <table className="run-status-table">
        <thead>
          <tr>
            <th scope="col">시나리오</th>
            <th scope="col">상태</th>
            <th scope="col" className="num">
              완료일
            </th>
            <th scope="col">
              <span className="sr-only">실행</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const task = taskFor(inputs, row.id)
            const run1 = runs[row.id]
            const status = rowStatus(run1, task?.key ?? '')
            const showResult = (status.kind === 'done' || status.kind === 'stale') && run1?.result
            const day = showResult ? completionOf(run1.result as RunResult) : null
            return (
              <tr key={row.id}>
                <th scope="row">
                  <span className={row.id === BASE_ID ? 'swatch base' : 'swatch'} style={row.id === BASE_ID ? undefined : { background: scenarioColor(row.id) }} aria-hidden="true" />
                  {row.name}
                </th>
                <td className={`status ${status.kind}`}>
                  <span aria-hidden="true">{STATUS_MARK[status.kind]} </span>
                  {STATUS_LABEL[status.kind]}
                  {status.kind === 'running' && ` ${Math.round(status.progress * 100)}%`}
                  {status.kind === 'running' && (
                    <div className="progress small" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.progress * 100)}>
                      <div className="progress-bar" style={{ width: `${status.progress * 100}%` }} />
                    </div>
                  )}
                  {status.kind === 'stale' && <div className="muted">입력이 바뀌었습니다. 다시 실행하세요.</div>}
                  {status.kind === 'error' && (
                    <div className="field-error" role="alert">
                      {status.message}
                    </div>
                  )}
                </td>
                <td className={`num${status.kind === 'stale' ? ' dim-text' : ''}`}>
                  {showResult ? (day === null ? '미완료' : `${day.toFixed(1)}일`) : '–'}
                  {status.kind === 'stale' && showResult && <div className="muted">이전 값</div>}
                </td>
                <td className="actions">
                  <button type="button" className="link" disabled={blocked} onClick={() => run('all', [row.id])} aria-label={`${row.name} 실행`}>
                    실행
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
