import { useEffect, useState } from 'react'
import { MAX_SCENARIO_NAME, MAX_SCENARIO_NOTE, validateScenarioName } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { BASE_SCENARIO_ID } from '../../lib/adoption'
import { AdoptionPanel } from './AdoptionPanel'
import { diffRows } from '../../lib/scenarioView'
import { useAppStore } from '../../stores/appStore'

/** 선택한 시나리오의 이름·메모·기준과 다른 값. 선택이 "기준"이면 안내만 보인다. */
export function ScenarioDetail({ editing, onEdit }: { editing: boolean; onEdit: (open: boolean) => void }) {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const activeId = useAppStore((s) => s.activeScenarioId)
  const rename = useAppStore((s) => s.renameScenario)
  const setNote = useAppStore((s) => s.setScenarioNote)
  const remove = useAppStore((s) => s.deleteScenario)
  const resetAll = useAppStore((s) => s.resetScenarioOverrides)
  const resetValue = useAppStore((s) => s.resetScenarioValue)
  const entry = getEntry(modelId)
  const scenario = scenarios.find((s) => s.id === activeId)
  const adoptedHere = useAppStore((s) => s.adopted?.scenarioId === activeId)

  const [draft, setDraft] = useState(scenario?.name ?? '')
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null)

  // 다른 시나리오를 고르거나 이름이 바깥에서 바뀌면 입력창을 맞춘다. 입력 중인 값이 저장된 이름과
  // 공백만 다르면(저장할 때 앞뒤 공백을 지운다) 입력을 건드리지 않아 띄어쓰기를 계속 칠 수 있다.
  useEffect(() => {
    setDraft((prev) => (scenario && prev.trim() === scenario.name ? prev : (scenario?.name ?? '')))
  }, [scenario?.id, scenario?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setConfirm(null), [scenario?.id])

  if (!scenario) {
    return (
      <section className="scenario-detail" aria-label="기준 설정">
        <h2>기준</h2>
        <p className="muted">
          기본 설정입니다. 값은 <strong>실험</strong> 탭의 폼에서 바꿉니다. 시나리오는 이 기준에서 달라지는 값만 저장하므로, 기준을 바꾸면 모든 시나리오가 따라 바뀝니다.
        </p>
        <AdoptionPanel scenarioId={BASE_SCENARIO_ID} />
      </section>
    )
  }

  const error = validateScenarioName(draft, scenarios, scenario.id)
  // 유효한 이름은 입력하는 즉시 저장해 입력창과 저장된 이름이 어긋나지 않게 한다. 유효하지 않은 입력은
  // 오류만 보이고 저장하지 않으며, 입력창을 벗어나면 마지막으로 저장된 이름으로 되돌린다.
  const onNameChange = (value: string) => {
    setDraft(value)
    if (validateScenarioName(value, scenarios, scenario.id) === null) rename(scenario.id, value)
  }
  const rows = diffRows(entry, params, scenario)

  return (
    <section className="scenario-detail" aria-label={`시나리오 ${scenario.name}`}>
      <div className="field">
        <label htmlFor="scenario-name">이름</label>
        <input
          id="scenario-name"
          type="text"
          value={draft}
          maxLength={MAX_SCENARIO_NAME + 20}
          aria-invalid={error !== null}
          aria-describedby={error ? 'scenario-name-error' : undefined}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={() => error !== null && setDraft(scenario.name)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setDraft(scenario.name)
          }}
        />
        {error && (
          <div id="scenario-name-error" className="field-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="scenario-note">메모</label>
        <textarea id="scenario-note" rows={2} value={scenario.note ?? ''} maxLength={MAX_SCENARIO_NOTE} onChange={(e) => setNote(scenario.id, e.target.value)} />
        <div className="muted count">
          {(scenario.note ?? '').length}/{MAX_SCENARIO_NOTE}
        </div>
      </div>

      <h3>기준과 다른 값</h3>
      {rows.length === 0 ? (
        <p className="muted">기준과 같습니다. “값 편집”에서 달라지는 항목을 정하세요.</p>
      ) : (
        <table className="diff-table">
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col" className="num">
                기준
              </th>
              <th scope="col" aria-hidden="true" />
              <th scope="col" className="num">
                시나리오
              </th>
              <th scope="col">
                <span className="sr-only">되돌리기</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.label}</th>
                <td className="num">
                  {r.base}
                  {r.unit && <span className="muted"> {r.unit}</span>}
                </td>
                <td aria-hidden="true">→</td>
                <td className="num strong">
                  {r.value}
                  {r.unit && <span className="muted"> {r.unit}</span>}
                </td>
                <td>
                  <button type="button" className="link" onClick={() => resetValue(scenario.id, r.name)} aria-label={`${r.label}을(를) 기준값으로 되돌리기`}>
                    되돌리기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AdoptionPanel scenarioId={scenario.id} />

      <div className="row wrap actions">
        <button type="button" className={editing ? '' : 'primary'} onClick={() => onEdit(!editing)} aria-pressed={editing}>
          {editing ? '값 편집 닫기' : '값 편집…'}
        </button>
        {confirm === 'reset' ? (
          <span className="confirm" role="alert">
            모든 값을 기준으로 되돌릴까요?
            <button type="button" className="danger" onClick={() => (resetAll(scenario.id), setConfirm(null))}>
              되돌리기
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              취소
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm('reset')} disabled={rows.length === 0}>
            기준으로 되돌리기
          </button>
        )}
        {confirm === 'delete' ? (
          <span className="confirm" role="alert">
            “{scenario.name}”을(를) 삭제할까요?{adoptedHere && ' 채택이 해제됩니다.'}
            <button type="button" className="danger" onClick={() => (remove(scenario.id), onEdit(false))}>
              삭제
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              취소
            </button>
          </span>
        ) : (
          <button type="button" className="danger-outline" onClick={() => setConfirm('delete')}>
            삭제
          </button>
        )}
      </div>
    </section>
  )
}
