import { useEffect, useState } from 'react'
import { TIME_UNIT_LABEL, type TimeUnit } from '@spd/analysis'
import { importDatasetCsv } from '../../lib/fileActions'
import { pointCount, TOLERANCE_KEYS, toleranceLabel } from '../../lib/validation'
import { useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'
import { OptionalNumber } from './OptionalNumber'

const TOLERANCE_HINT: Record<(typeof TOLERANCE_KEYS)[number], string> = {
  nrmse: '이하',
  mre: '절댓값 이하',
  mape: '이하',
  nse: '이상',
  trend: '이상(0~1)'
}

/** 데이터셋 관리와 허용 기준. 실제 데이터를 가져와 이름·시간 단위·시간 이동·실제 완료일을 정한다. */
export function DatasetPanel() {
  const datasets = useAppStore((s) => s.validation.datasets)
  const tolerances = useAppStore((s) => s.validation.tolerances)
  const activeId = useAppStore((s) => s.validationActiveId)
  const setActive = useAppStore((s) => s.setValidationActive)
  const update = useAppStore((s) => s.updateDataset)
  const remove = useAppStore((s) => s.removeDataset)
  const setTolerance = useAppStore((s) => s.setTolerance)
  const desktop = typeof window.spd !== 'undefined'
  const active = datasets.find((d) => d.id === activeId) ?? null
  const [message, setMessage] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [name, setName] = useState(active?.name ?? '')
  useEffect(() => {
    setName(active?.name ?? '')
    setConfirming(false)
    setMessage(null)
  }, [active?.id, active?.name])

  const apply = (r: string | null) => setMessage(r)

  return (
    <section aria-label="데이터셋">
      <h2>실제 데이터</h2>
      <p className="muted">
        과거 프로젝트의 시계열(CSV: 첫 열은 시간, 나머지는 열마다 하나의 시계열)을 가져와 모델 변수와 맞춰 봅니다. 프로젝트 파일에 저장됩니다.
      </p>
      <div className="row wrap">
        <button type="button" className="primary" onClick={() => void importDatasetCsv()} disabled={!desktop} title={desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'}>
          + 가져오기…
        </button>
        {datasets.length > 0 && (
          <select aria-label="데이터셋 선택" value={active?.id ?? ''} onChange={(e) => setActive(e.target.value || null)}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({pointCount(d)}점)
              </option>
            ))}
          </select>
        )}
      </div>

      {active && (
        <div className="validation-fields">
          <label className="risk-field">
            <span>이름</span>
            <input
              id="val-name"
              type="text"
              value={name}
              aria-label="데이터셋 이름"
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name !== active.name) {
                  const r = update(active.id, { name })
                  apply(r)
                  if (r) setName(active.name)
                }
              }}
            />
          </label>
          <div className="muted">파일: {active.fileName}</div>
          <label className="risk-field">
            <span>데이터의 시간 단위</span>
            <select value={active.timeUnit} aria-label="데이터의 시간 단위" onChange={(e) => apply(update(active.id, { timeUnit: e.target.value as TimeUnit }))}>
              {(Object.keys(TIME_UNIT_LABEL) as TimeUnit[]).map((u) => (
                <option key={u} value={u}>
                  {TIME_UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </label>
          <label className="risk-field">
            <span>시간 이동(일)</span>
            <DraftNumber id="val-offset" label="시간 이동(일)" value={active.offsetDay} onValue={(v) => apply(update(active.id, { offsetDay: v }))} />
          </label>
          <p className="muted">시뮬레이션 시각 = 데이터 시각 × 단위 + 이동. 이동은 (실제 프로젝트 시작일 − 시뮬레이션 0일)입니다.</p>
          <label className="risk-field">
            <span>실제 완료일(시뮬레이션 일, 선택)</span>
            <OptionalNumber id="val-actual" label="실제 완료일" value={active.actualCompletionDay} onValue={(v) => apply(update(active.id, { actualCompletionDay: v }))} />
          </label>
          {confirming ? (
            <div className="row wrap">
              <span>이 데이터셋을 지울까요?</span>
              <button type="button" className="danger" onClick={() => remove(active.id)}>
                지우기
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                취소
              </button>
            </div>
          ) : (
            <button type="button" className="link" onClick={() => setConfirming(true)}>
              데이터셋 삭제
            </button>
          )}
        </div>
      )}
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}

      <h2>허용 기준 (선택)</h2>
      <p className="muted">정하지 않으면 값만 보입니다. 정하면 그 지표가 기준 안인지 밖인지 표시합니다. 합격·불합격을 판정하지 않습니다.</p>
      <table className="risk-stats validation-tolerances">
        <tbody>
          {TOLERANCE_KEYS.map((k) => (
            <tr key={k}>
              <th scope="row">{toleranceLabel(k)}</th>
              <td>
                <OptionalNumber id={`val-tol-${k}`} label={`${toleranceLabel(k)} 허용 기준`} value={tolerances[k] ?? null} onValue={(v) => apply(setTolerance(k, v))} />
              </td>
              <td className="muted">{TOLERANCE_HINT[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
