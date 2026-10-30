import { useState } from 'react'
import { DEFAULT_LEVEL_CHECK_DAYS } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { formatNumber } from '../../lib/params'
import { selectLevelsStale, useAppStore } from '../../stores/appStore'
import { DraftNumber } from '../DraftNumber'

/** Level 변화 점검: 짧은 구간을 실행해 시작 대비 움직이는 Level을 보인다(책 2.7.1의 "범인 찾기"). 정상 상태인지는 판정하지 않는다. */
export function LevelCheckPanel() {
  const modelId = useAppStore((s) => s.modelId)
  const run = useAppStore((s) => s.validationLevels)
  const stale = useAppStore(selectLevelsStale)
  const runLevelCheck = useAppStore((s) => s.runLevelCheck)
  const [days, setDays] = useState(DEFAULT_LEVEL_CHECK_DAYS)
  const [message, setMessage] = useState<string | null>(null)
  const [onlyMoving, setOnlyMoving] = useState(true)
  const entry = getEntry(modelId)
  const labelOf = (n: string) => entry.variables.find((v) => v.name === n)?.label ?? n
  const unitOf = (n: string) => entry.def.levels[n]?.unit ?? ''
  const rows = (run?.rows ?? []).filter((r) => !onlyMoving || r.moves)

  return (
    <section className="validation-section" aria-label="Level 변화 점검">
      <h2>Level 변화 점검</h2>
      <p className="muted">
        짧은 구간을 실행해 시작 값에서 변하는 Level을 보입니다. 모델마다 정상 상태를 만드는 중립 입력이 달라 정상 상태인지는 <strong>자동으로 판정하지 않습니다</strong> — 어느 Level이 움직이는지 보고 사람이 범인을 찾습니다.
      </p>
      <div className="row wrap">
        <label className="risk-field">
          <span>구간(일)</span>
          <DraftNumber id="level-days" label="Level 변화 점검 구간(일)" value={days} onValue={setDays} />
        </label>
        <button type="button" className="primary" onClick={() => setMessage(runLevelCheck(days))}>
          점검 실행
        </button>
        {run && (
          <label className="risk-check">
            <input type="checkbox" checked={onlyMoving} onChange={(e) => setOnlyMoving(e.target.checked)} /> 움직이는 Level만
          </label>
        )}
        {run && stale && <span className="field-error">입력이 바뀌어 결과가 오래되었습니다. 다시 실행하세요.</span>}
      </div>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
      {run && (
        <div className={stale ? 'stale' : undefined}>
          {rows.length === 0 ? (
            <p className="muted">{run.days}일 동안 움직인 Level이 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table className="risk-stats">
                <caption>{run.days}일 동안의 Level 변화(변화량 큰 순)</caption>
                <thead>
                  <tr>
                    <th scope="col">Level</th>
                    <th scope="col" className="num">시작</th>
                    <th scope="col" className="num">{run.days}일 뒤</th>
                    <th scope="col" className="num">변화</th>
                    <th scope="col" className="num">비율</th>
                    <th scope="col">움직임</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name}>
                      <th scope="row">
                        {labelOf(r.name)}
                        {unitOf(r.name) && <span className="muted"> ({unitOf(r.name)})</span>}
                      </th>
                      <td className="num">{formatNumber(Number(r.start.toPrecision(5)))}</td>
                      <td className="num">{formatNumber(Number(r.end.toPrecision(5)))}</td>
                      <td className="num">
                        {r.change >= 0 ? '+' : '−'}
                        {formatNumber(Number(Math.abs(r.change).toPrecision(4)))}
                      </td>
                      <td className="num">{r.relative === null ? '–' : `${r.relative >= 0 ? '+' : ''}${(r.relative * 100).toFixed(1)}%`}</td>
                      <td>{r.moves ? '● 움직임' : '– 그대로'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
