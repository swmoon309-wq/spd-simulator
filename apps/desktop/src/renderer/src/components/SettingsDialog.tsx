import { THEMES, THEME_LABELS, type Theme } from '../../../shared/settings'
import { useSettingsStore } from '../stores/settingsStore'
import { useUiStore } from '../stores/uiStore'
import { Modal } from './Modal'

/** 설정(COM-03). 지금은 테마만 있다. 설정은 사용자별로 저장되고 프로젝트 파일에는 들어가지 않는다. */
export function SettingsDialog() {
  const close = useUiStore((s) => s.closeDialog)
  const theme = useSettingsStore((s) => s.settings.theme)
  const update = useSettingsStore((s) => s.update)

  return (
    <Modal title="설정" onClose={close}>
      <fieldset className="settings-group">
        <legend>테마</legend>
        {THEMES.map((t: Theme) => (
          <label key={t} className="settings-option">
            <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => void update({ theme: t })} />
            {THEME_LABELS[t]}
          </label>
        ))}
      </fieldset>
      <p className="muted">설정은 이 컴퓨터의 사용자별로 저장되며 프로젝트 파일에는 들어가지 않습니다. 화면 언어는 한국어, 시간 단위는 일, 규모 단위는 태스크로 고정되어 있습니다.</p>
    </Modal>
  )
}
