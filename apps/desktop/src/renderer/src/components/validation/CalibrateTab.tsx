import { useState } from 'react'
import { useAppStore } from '../../stores/appStore'
import { CalibrateForm } from './CalibrateForm'
import { PresetPanel } from './PresetPanel'

/** 보정(VAL-05): 데이터에 맞춰 파라미터를 보정하고 프리셋으로 저장·적용한다. */
export function CalibrateTab() {
  const modelId = useAppStore((s) => s.modelId)
  const datasets = useAppStore((s) => s.validation.datasets)
  const activeId = useAppStore((s) => s.validationActiveId)
  const [picked, setPicked] = useState<string | null>(null)
  const dataset = datasets.find((d) => d.id === (picked ?? activeId)) ?? datasets[0] ?? null

  return (
    <div className="app-body single">
      <main className="panel main">
        <section className="validation-section" aria-label="파라미터 보정">
          <h2>파라미터 보정</h2>
          <p className="muted">
            선택한 파라미터(최대 5개)를 실제 데이터에 맞춥니다. 유계 Nelder–Mead를 시작점 5개로 돌리고, <strong>식별 가능성 진단</strong>과 <strong>시간 분할 검증</strong>을 함께 보입니다. 점이 적고 파라미터가 많으면 해가 유일하지 않으므로 보정이 "맞는 값"을 준다고 믿지 마세요.
          </p>
          {datasets.length === 0 ? (
            <p className="muted">
              실제 데이터가 없습니다. <strong>데이터 비교</strong> 탭에서 CSV를 가져와 열을 모델 변수에 연결한 뒤 오세요.
            </p>
          ) : (
            <>
              <label className="risk-field">
                <span>데이터셋</span>
                <select aria-label="보정에 쓸 데이터셋" value={dataset?.id ?? ''} onChange={(e) => setPicked(e.target.value)}>
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              {dataset && <CalibrateForm key={`${modelId}-${dataset.id}`} dataset={dataset} />}
            </>
          )}
        </section>
        <PresetPanel key={`presets-${modelId}`} />
      </main>
    </div>
  )
}
