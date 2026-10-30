import { effectiveParams } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { useAppStore } from '../../stores/appStore'
import { NumberField } from '../ParamForm'

/**
 * 선택한 시나리오의 값을 편집한다. 폼은 기본 설정 폼과 같은 구성이고, 값은 "기본 설정 + 시나리오 변경"으로 보인다.
 * 실행 설정(종료 시각, dt, 시드)은 프로젝트 전체에 하나라 여기서는 편집하지 않는다.
 */
export function ScenarioParamEditor({ scenarioId, onClose }: { scenarioId: string; onClose: () => void }) {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const scenario = useAppStore((s) => s.scenarios.find((x) => x.id === scenarioId))
  const setOverride = useAppStore((s) => s.setScenarioOverride)
  const resetValue = useAppStore((s) => s.resetScenarioValue)
  const entry = getEntry(modelId)
  if (!scenario) return null
  const values = effectiveParams(params, scenario)

  return (
    <section className="panel scenario-editor" aria-label={`${scenario.name} 값 편집`}>
      <div className="editing-badge" role="status">
        편집 중: <strong>{scenario.name}</strong>
        <button type="button" className="link" onClick={onClose}>
          닫기
        </button>
      </div>
      <p className="muted">기본 설정과 다른 값만 이 시나리오에 저장됩니다. 값을 기준값과 같게 하면 변경이 사라집니다.</p>
      {entry.groups.map((g) => (
        <fieldset key={g.title}>
          <legend>{g.title}</legend>
          {g.params.map((spec) => {
            const c = entry.def.constants[spec.name]
            return (
              <NumberField
                key={spec.name}
                id={`sc-${scenario.id}-${spec.name}`}
                spec={spec}
                label={c?.label ?? spec.name}
                unit={c?.unit ?? ''}
                value={values[spec.name] as number}
                errorKey={`sc:${scenario.id}:${spec.name}`}
                trackError={false}
                baseValue={params[spec.name] as number}
                onValue={(v) => setOverride(scenario.id, spec.name, v)}
                onRevert={() => resetValue(scenario.id, spec.name)}
              />
            )
          })}
        </fieldset>
      ))}
    </section>
  )
}
