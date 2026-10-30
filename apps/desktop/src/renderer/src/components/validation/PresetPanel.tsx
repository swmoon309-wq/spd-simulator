import { useState } from 'react'
import { getEntry } from '../../catalog'
import { exportPresetsFile, importPresetsFile } from '../../lib/fileActions'
import { formatNumber } from '../../lib/params'
import { useAppStore } from '../../stores/appStore'

/** 보정 프리셋(설계 07의 5.4): 저장·시나리오로 적용(권장)·기본 설정에 적용·내보내기·가져오기. */
export function PresetPanel() {
  const modelId = useAppStore((s) => s.modelId)
  const presets = useAppStore((s) => s.validation.presets)
  const applyAsScenario = useAppStore((s) => s.applyPresetAsScenario)
  const applyToBase = useAppStore((s) => s.applyPresetToBase)
  const remove = useAppStore((s) => s.deletePreset)
  const rename = useAppStore((s) => s.renamePreset)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const desktop = typeof window.spd !== 'undefined'
  const entry = getEntry(modelId)
  const labelOf = (n: string) => entry.def.constants[n]?.label ?? n

  return (
    <section className="validation-section" aria-label="보정 프리셋">
      <h2>보정 프리셋</h2>
      <p className="muted">
        보정한 값을 이름 붙여 저장합니다(프로젝트 파일에 저장, 최대 20개). <strong>새 시나리오로 적용</strong>하면 기본 설정은 그대로 두고 비교할 수 있어 권장합니다. 내보낸 JSON은 다른 프로젝트에서 가져올 수 있고, 가져올 때 모델·파라미터 이름·범위를 검사합니다.
      </p>
      <div className="row wrap">
        <button type="button" onClick={() => void importPresetsFile()} disabled={!desktop} title={desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'}>
          가져오기…
        </button>
        <button type="button" onClick={() => void exportPresetsFile()} disabled={!desktop || presets.length === 0} title={presets.length === 0 ? '내보낼 프리셋이 없습니다' : desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'}>
          내보내기…
        </button>
      </div>
      {message && (
        <div className={message.kind === 'error' ? 'field-error' : 'muted'} role={message.kind === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
      {presets.length === 0 ? (
        <p className="muted">저장한 프리셋이 없습니다. 보정한 뒤 "프리셋으로 저장"을 누르거나 파일에서 가져오세요.</p>
      ) : (
        <ul className="preset-list">
          {presets.map((p) => (
            <li key={p.id} className="preset-item">
              <div className="row wrap">
                {editing?.id === p.id ? (
                  <input
                    type="text"
                    aria-label="프리셋 새 이름"
                    value={editing.name}
                    autoFocus
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    onBlur={() => {
                      const r = rename(p.id, editing.name)
                      setMessage(r ? { kind: 'error', text: r } : null)
                      setEditing(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <strong>{p.name}</strong>
                )}
                {p.modelVersion !== entry.def.meta.version && <span className="field-error">▲ 다른 모델 버전(v{p.modelVersion})</span>}
              </div>
              <div className="muted">
                {Object.entries(p.params).map(([k, v]) => `${labelOf(k)} = ${formatNumber(Number(v.toPrecision(6)))}`).join(' · ')}
              </div>
              <div className="muted">
                출처: {p.origin.dataset || '(알 수 없음)'} · 보정 구간 J {p.origin.objective === null ? '–' : p.origin.objective.toPrecision(3)}
                {p.origin.split !== null && ` · 검증 구간 J ${p.origin.valObjective === null ? '–' : p.origin.valObjective.toPrecision(3)} (앞 ${Math.round(p.origin.split * 100)}%로 보정)`} · {p.origin.at.slice(0, 16).replace('T', ' ')}
              </div>
              <div className="row wrap">
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const r = applyAsScenario(p.id)
                    setMessage(r.scenarioId ? { kind: 'ok', text: `'${p.name}'을(를) 새 시나리오로 만들었습니다. 시나리오 탭에서 기준과 비교하세요.${r.message ? ` ${r.message}` : ''}` } : { kind: 'error', text: r.message ?? '적용하지 못했습니다.' })
                  }}
                >
                  새 시나리오로 적용
                </button>
                {confirm === p.id ? (
                  <>
                    <span>기본 설정의 값이 바뀝니다. 계속할까요?</span>
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        const r = applyToBase(p.id)
                        setMessage(r ? { kind: 'error', text: r } : { kind: 'ok', text: `'${p.name}'을(를) 기본 설정에 적용했습니다(저장하지 않은 변경이 생겼습니다).` })
                        setConfirm(null)
                      }}
                    >
                      적용
                    </button>
                    <button type="button" onClick={() => setConfirm(null)}>
                      취소
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirm(p.id)}>
                    기본 설정에 적용…
                  </button>
                )}
                <button type="button" className="link" onClick={() => setEditing({ id: p.id, name: p.name })}>
                  이름 바꾸기
                </button>
                <button type="button" className="link" onClick={() => remove(p.id)} aria-label={`${p.name} 삭제`}>
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
