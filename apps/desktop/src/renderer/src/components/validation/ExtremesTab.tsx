import { useAppStore } from '../../stores/appStore'
import { ExtremesPanel } from './ExtremesPanel'
import { LevelCheckPanel } from './LevelCheckPanel'
import { PerturbPanel } from './PerturbPanel'

/** 극단·교란 시험(VAL-03, 06): 극단 조건 표, 교란 시험, Level 변화 점검. */
export function ExtremesTab() {
  // 모델이 바뀌면 폼 상태(상수·변수 선택)를 처음 값으로 돌린다.
  const modelId = useAppStore((s) => s.modelId)
  return (
    <div className="app-body single">
      <main className="panel main">
        <ExtremesPanel key={`extremes-${modelId}`} />
        <PerturbPanel key={`perturb-${modelId}`} />
        <LevelCheckPanel key={`levels-${modelId}`} />
        <p className="risk-disclaimer" role="note">
          ※ 이 시험들은 기계적 결함과 반응을 <strong>보여 줄 뿐</strong> 모델이 목적에 맞는지는 판단하지 않습니다. 통과해도 검증이 끝난 것이 아니고, 주의·정보는 결함이 아닐 수 있습니다. 외부 신호를 Rate에 직접 넣는 시험은 지원하지 않습니다(모델 편집기, 4차).
        </p>
      </main>
    </div>
  )
}
