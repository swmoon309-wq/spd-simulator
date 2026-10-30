import { useMemo, useState } from 'react'
import { getEntry } from '../../catalog'
import { checkRunSettings } from '../../lib/runSettings'
import { rowStatus, taskFor } from '../../lib/scenarioRunner'
import { evaluateDataset } from '../../lib/validationView'
import { busyReason, useAppStore } from '../../stores/appStore'
import { ColumnMapping } from './ColumnMapping'
import { DatasetPanel } from './DatasetPanel'
import { MetricsTable } from './MetricsTable'
import { ObservedChart, ResidualChart } from './ValidationCharts'

/** 데이터 비교(VAL-01·02): 실제 데이터와 같은 조건으로 시뮬레이션한 결과를 비교한다. */
export function DataComparePanel() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const runSettings = useAppStore((s) => s.runSettings)
  const scenarios = useAppStore((s) => s.scenarios)
  const scenarioRuns = useAppStore((s) => s.scenarioRuns)
  const validation = useAppStore((s) => s.validation)
  const activeId = useAppStore((s) => s.validationActiveId)
  const batch = useAppStore((s) => s.batch)
  const busy = useAppStore((s) => (s.batch !== null ? null : busyReason(s)))
  const fieldInvalid = useAppStore((s) => Object.keys(s.paramErrors).length > 0)
  const runScenarios = useAppStore((s) => s.runScenarios)
  const [selectedCol, setSelectedCol] = useState<number | null>(null)

  const entry = getEntry(modelId)
  const dataset = validation.datasets.find((d) => d.id === activeId) ?? null
  const targetId = validation.targetScenarioId
  const task = taskFor({ modelId, params, settings: runSettings, scenarios }, targetId)
  const run = scenarioRuns[targetId]
  const status = rowStatus(run, task?.key ?? '')
  const result = (status.kind === 'done' || status.kind === 'stale') && run?.result ? run.result : null
  const resultParams = run?.resultParams ?? task?.params ?? params

  const evaluation = useMemo(() => (dataset && result ? evaluateDataset(entry, result, dataset, validation.tolerances, resultParams) : null), [entry, dataset, result, validation.tolerances, resultParams])

  const comboError = checkRunSettings(runSettings)
  const blocked = batch !== null ? '일괄 실행 중입니다.' : (busy ?? (fieldInvalid ? '실험 탭의 입력 오류를 먼저 고치세요.' : comboError))
  const col = evaluation?.columns.find((c) => c.index === selectedCol) ?? evaluation?.columns[0] ?? null
  const variable = col ? entry.variables.find((v) => v.name === col.variable) : null

  return (
    <div className="app-body">
      <aside className="panel side" aria-label="실제 데이터와 허용 기준">
        <DatasetPanel />
      </aside>
      <main className="panel main">
        <section className="run-panel" aria-label="대상 시뮬레이션">
          <div className="row wrap">
            <button type="button" className="primary" disabled={blocked !== null || status.kind === 'running' || status.kind === 'queued'} title={blocked ?? '대상의 유효 파라미터와 실행 설정으로 시뮬레이션합니다'} onClick={() => void runScenarios('all', [targetId])}>
              {status.kind === 'done' ? '다시 실행' : '시뮬레이션 실행'}
            </button>
            <span className="muted" role="status" aria-live="polite">
              {status.kind === 'running' ? `실행 중 ${Math.round(status.progress * 100)}%` : status.kind === 'queued' ? '대기 중' : status.kind === 'done' ? '최신 결과입니다' : status.kind === 'stale' ? '입력이 바뀌어 결과가 오래되었습니다. 다시 실행하세요.' : status.kind === 'error' ? status.message : '아직 실행하지 않았습니다.'}
            </span>
          </div>
          <p className="muted">
            같은 조건: 대상의 유효 파라미터와 실험 탭의 실행 설정(종료 {runSettings.end}일, dt {runSettings.dt}일)으로 시뮬레이션합니다. 실제 프로젝트의 알려진 입력(초기 인원, 총 태스크 등)은 그 시나리오에 반영해 두세요.
          </p>
          {blocked !== null && status.kind !== 'running' && <p className="muted">실행할 수 없음: {blocked}</p>}
        </section>

        {!dataset ? (
          <p className="muted">
            실제 데이터가 없습니다. 왼쪽의 <strong>가져오기</strong>로 CSV를 가져오면 열 이름이 모델 변수와 맞는 열은 자동으로 연결됩니다.
          </p>
        ) : (
          <>
            <ColumnMapping dataset={dataset} evaluation={evaluation} />
            {!result ? (
              <p className="muted">시뮬레이션을 실행하면 오차 지표와 그래프가 나타납니다.</p>
            ) : (
              <div className={status.kind === 'stale' ? 'stale' : undefined}>
                {status.kind === 'stale' && <p className="field-error">이 결과는 지금 입력으로 만든 것이 아닙니다.</p>}
                {evaluation && <MetricsTable evaluation={evaluation} selected={col?.index ?? null} onSelect={setSelectedCol} />}
                {evaluation && col && variable && (
                  <div className="risk-charts">
                    <figure>
                      <figcaption>{variable.label}: 관측(◆)과 시뮬레이션(선)</figcaption>
                      <ObservedChart result={result} ev={col} label={variable.label} unit={variable.unit} />
                    </figure>
                    <figure>
                      <figcaption>잔차(시뮬레이션 − 관측)</figcaption>
                      <ResidualChart ev={col} label={variable.label} unit={variable.unit} />
                    </figure>
                  </div>
                )}
                {evaluation && col && (
                  <details>
                    <summary>{col.column.name}의 짝 표</summary>
                    <div className="table-scroll">
                      <table className="risk-stats">
                        <thead>
                          <tr>
                            <th scope="col">시뮬레이션 일</th>
                            <th scope="col" className="num">관측</th>
                            <th scope="col" className="num">시뮬레이션</th>
                            <th scope="col" className="num">잔차</th>
                          </tr>
                        </thead>
                        <tbody>
                          {col.aligned.time.map((t, i) => (
                            <tr key={i}>
                              <th scope="row">{Number(t.toFixed(2))}</th>
                              <td className="num">{(col.aligned.observed[i] as number).toFixed(2)}</td>
                              <td className="num">{(col.aligned.simulated[i] as number).toFixed(2)}</td>
                              <td className="num">{(col.residuals[i]?.[1] as number).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}
          </>
        )}
        <p className="risk-disclaimer" role="note">
          ※ 검증은 증명이 아니라 <strong>신뢰를 쌓는 활동</strong>이고, 모델이 목적에 맞는지는 사람이 판단합니다. 이 화면은 합격·불합격을 선언하지 않고 지표와 (정했다면) 기준 안/밖만 보입니다. 통합 프로젝트 모델은 보정되지 않았습니다.
        </p>
      </main>
    </div>
  )
}
