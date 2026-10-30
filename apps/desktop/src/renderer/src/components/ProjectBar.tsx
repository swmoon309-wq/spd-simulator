import { useEffect } from 'react'
import { performHistory } from '../lib/historyActions'
import { handleMenuCommand } from '../lib/commands'
import { newProject, openProject, saveProject } from '../lib/projectActions'
import { startAppAutosave } from '../lib/recoveryActions'
import { useHistoryStore } from '../stores/history'
import { selectIsDirty, useAppStore } from '../stores/appStore'

const SUFFIX = '— 소프트웨어 프로젝트 시뮬레이터'

/** 프로젝트 이름·변경 여부·파일 명령, 안내 메시지. 메뉴 명령과 창 제목도 여기서 연결한다. */
export function ProjectBar() {
  const name = useAppStore((s) => s.projectName)
  const file = useAppStore((s) => s.projectFile)
  const dirty = useAppStore(selectIsDirty)
  const notice = useAppStore((s) => s.notice)
  const setNotice = useAppStore((s) => s.setNotice)
  const undoLabel = useHistoryStore((s) => s.undoLabel)
  const redoLabel = useHistoryStore((s) => s.redoLabel)
  const desktop = typeof window.spd !== 'undefined'

  useEffect(() => window.spd?.menu.onCommand(handleMenuCommand), [])

  // 저장하지 않은 변경은 주기적으로 자동 저장본에 둔다(비정상 종료 대비, COM-05).
  useEffect(() => startAppAutosave(), [])

  // 데스크톱 앱에서는 메뉴의 단축키가 같은 명령을 보낸다. 브라우저(개발용)에서만 직접 받는다.
  useEffect(() => {
    if (desktop) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      e.preventDefault()
      performHistory(key === 'y' || e.shiftKey ? 'redo' : 'undo')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [desktop])

  useEffect(() => {
    window.spd?.project.setDirty(dirty)
    document.title = `${dirty ? '● ' : ''}${name} ${SUFFIX}`
  }, [dirty, name])

  // 완료 안내(info)는 잠시 뒤 스스로 닫힌다. 경고와 오류는 직접 닫을 때까지 남는다.
  useEffect(() => {
    if (notice?.kind !== 'info') return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice, setNotice])

  const disabledTitle = desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'
  return (
    <>
      <div className="project-bar" role="toolbar" aria-label="프로젝트">
        <div className="project-name" title={file ?? '아직 저장하지 않은 프로젝트'}>
          <span className="doc-name">{name}</span>
          {dirty && (
            <span className="dirty" role="status">
              수정됨
            </span>
          )}
          {!file && !dirty && <span className="muted">저장 전</span>}
        </div>
        <div className="row">
          <button type="button" onClick={() => performHistory('undo')} disabled={undoLabel === null} title={undoLabel ? `실행 취소: ${undoLabel}` : '되돌릴 변경이 없습니다'}>
            실행 취소
          </button>
          <button type="button" onClick={() => performHistory('redo')} disabled={redoLabel === null} title={redoLabel ? `다시 실행: ${redoLabel}` : '다시 실행할 변경이 없습니다'}>
            다시 실행
          </button>
          <button type="button" onClick={() => void newProject()}>
            새 프로젝트
          </button>
          <button type="button" onClick={() => void openProject()} disabled={!desktop} title={disabledTitle}>
            열기…
          </button>
          <button type="button" onClick={() => void saveProject(false)} disabled={!desktop} title={disabledTitle}>
            저장
          </button>
          <button type="button" onClick={() => void saveProject(true)} disabled={!desktop} title={disabledTitle}>
            다른 이름으로 저장…
          </button>
        </div>
      </div>
      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <div className="notice-body">
            <div>{notice.text}</div>
            {notice.details && (
              <ul>
                {notice.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="link" onClick={() => setNotice(null)}>
            닫기
          </button>
        </div>
      )}
    </>
  )
}
