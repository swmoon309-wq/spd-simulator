import { getEntry } from '../catalog'
import { modelCaveat } from '../lib/report/caveats'
import { useAppStore } from '../stores/appStore'

/** 사용자 모델은 보정·검증되지 않았을 수 있다는 상시 안내(모델 편집기 설계 8.3). 결과를 읽는 화면의 머리에 둔다. */
export function UserModelNotice() {
  const modelId = useAppStore((s) => s.modelId)
  const entry = getEntry(modelId)
  if (entry.category !== 'user') return null
  return (
    <div className="notice warning" role="note" aria-label="사용자 모델 안내">
      <span>
        <strong>사용자 모델</strong> · {modelCaveat(entry)}
      </span>
    </div>
  )
}
