import { getEntry } from '../catalog'
import { checkRunSettings } from '../lib/runSettings'
import { useAppStore } from '../stores/appStore'

export function RunControls() {
  const modelId = useAppStore((s) => s.modelId)
  const status = useAppStore((s) => s.status)
  const progress = useAppStore((s) => s.progress)
  const error = useAppStore((s) => s.error)
  const runSettings = useAppStore((s) => s.runSettings)
  const fieldInvalid = useAppStore((s) => Object.keys(s.paramErrors).length > 0)
  const comboError = checkRunSettings(runSettings)
  const invalid = fieldInvalid || comboError !== null
  const run = useAppStore((s) => s.run)
  const runPresets = useAppStore((s) => s.runPresets)
  const cancel = useAppStore((s) => s.cancel)
  const paused = useAppStore((s) => s.paused)
  const pause = useAppStore((s) => s.pause)
  const resume = useAppStore((s) => s.resume)
  const step = useAppStore((s) => s.step)
  const reset = useAppStore((s) => s.reset)
  const time = useAppStore((s) => s.live?.time.at(-1) ?? null)
  const entry = getEntry(modelId)
  const batching = useAppStore((s) => s.batch !== null || s.riskRun?.status === 'running')
  const running = status === 'running'

  return (
    <div className="run-controls">
      <div className="row wrap run-buttons">
        {running ? (
          <>
            {paused ? (
              <button type="button" className="primary" onClick={resume} title="멈춘 실행을 끝까지 이어서 실행합니다">
                계속
              </button>
            ) : (
              <button type="button" onClick={pause} title="다음 구간이 끝나면 멈춥니다">
                일시정지
              </button>
            )}
            <button type="button" onClick={step} title="1일 진행하고 멈춥니다">
              스텝
            </button>
            <button type="button" className="danger" onClick={cancel} title="이 실행을 버립니다">
              중단
            </button>
          </>
        ) : (
          <>
            <button type="button" className="primary" disabled={invalid || batching} title={batching ? '다른 실행(시나리오 일괄 실행·위험 분석)이 끝나면 실행할 수 있습니다' : undefined} onClick={() => void run()}>
              실행
            </button>
            <button type="button" disabled={invalid || batching} onClick={step} title="시각 0에서 멈춘 채 시작해 1일 진행합니다">
              스텝
            </button>
          </>
        )}
        <button type="button" disabled={invalid || (batching && !running)} onClick={() => void reset()} title="이 실행을 버리고 시각 0에서 멈춘 채 다시 시작합니다(스텝으로 처음부터 따라갈 때)">
          리셋
        </button>
      </div>
      <div className="row">
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="progress-text">{running ? `${Math.round(progress * 100)}%` : ''}</span>
      </div>
      {running && paused && (
        <div className="hint" role="status">
          멈춤{time !== null ? ` · ${time.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}일` : ''} — 스텝으로 1일씩 진행하거나 계속으로 끝까지 실행합니다.
        </div>
      )}
      {comboError && (
        <div className="field-error" role="alert">
          {comboError}
        </div>
      )}
      {batching && <div className="hint">시나리오 일괄 실행 또는 위험 분석이 끝나면 실행할 수 있습니다.</div>}
      {fieldInvalid && <div className="hint">입력 오류를 고치면 실행할 수 있습니다.</div>}
      {error && (
        <div className="field-error" role="alert">
          실행 오류: {error}
        </div>
      )}
      <div className="presets">
        <div className="presets-title">실험 한 번에 실행</div>
        <div className="row wrap">
          {entry.presets.map((p) => (
            <button key={p.label} type="button" disabled={running || invalid || batching} onClick={() => void run(p.overrides)}>
              {p.label}
            </button>
          ))}
          <button
            type="button"
            disabled={running || invalid || batching}
            onClick={() => void runPresets(entry.presets.map((p) => p.overrides))}
          >
            모두 실행
          </button>
        </div>
      </div>
    </div>
  )
}
