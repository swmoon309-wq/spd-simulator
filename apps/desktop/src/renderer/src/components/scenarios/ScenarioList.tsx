import { canAddScenario, MAX_SCENARIOS } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { BASE_SCENARIO_ID } from '../../lib/adoption'
import { ADOPTED_MARK } from './AdoptionPanel'
import { scenarioColor } from '../../lib/palette'
import { diffRows } from '../../lib/scenarioView'
import { useAppStore } from '../../stores/appStore'

/** 시나리오 목록. 맨 위의 "기준"은 기본 설정(실험 탭의 폼)이다. */
export function ScenarioList() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const active = useAppStore((s) => s.activeScenarioId)
  const setActive = useAppStore((s) => s.setActiveScenario)
  const add = useAppStore((s) => s.addScenario)
  const duplicate = useAppStore((s) => s.duplicateScenario)
  const adoptedId = useAppStore((s) => s.adopted?.scenarioId ?? null)
  const entry = getEntry(modelId)
  const full = !canAddScenario(scenarios.length)

  return (
    <section aria-label="시나리오 목록">
      <ul className="scenario-list">
        <li>
          <button type="button" className={`scenario-item${active === null ? ' active' : ''}`} aria-current={active === null} onClick={() => setActive(null)}>
            <span className="swatch base" aria-hidden="true" />
            <span className="scenario-name">
              {adoptedId === BASE_SCENARIO_ID && <span title="채택 계획">{ADOPTED_MARK} </span>}기준
            </span>
            <span className="muted">기본 설정</span>
          </button>
        </li>
        {scenarios.map((sc) => {
          const changes = diffRows(entry, params, sc).length
          return (
            <li key={sc.id}>
              <button type="button" className={`scenario-item${active === sc.id ? ' active' : ''}`} aria-current={active === sc.id} onClick={() => setActive(sc.id)}>
                <span className="swatch" style={{ background: scenarioColor(sc.id) }} aria-hidden="true" />
                <span className="scenario-name">
                  {adoptedId === sc.id && <span title="채택 계획">{ADOPTED_MARK} </span>}
                  {sc.name}
                </span>
                <span className="muted">{changes === 0 ? '기준과 같음' : `${changes}개 변경`}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="row wrap">
        <button type="button" onClick={() => add()} disabled={full} title={full ? `시나리오는 최대 ${MAX_SCENARIOS}개입니다` : undefined}>
          + 새 시나리오
        </button>
        <button
          type="button"
          onClick={() => active && duplicate(active)}
          disabled={active === null || full}
          title={active === null ? '복제할 시나리오를 선택하세요' : full ? `시나리오는 최대 ${MAX_SCENARIOS}개입니다` : undefined}
        >
          복제
        </button>
        <span className="muted count" aria-live="polite">
          {scenarios.length}/{MAX_SCENARIOS}
        </span>
      </div>
    </section>
  )
}
