import { useAppStore, selectIsDirty } from '../stores/appStore'
import type { Example } from './examples'
import { clearAutosave } from './recoveryActions'

const store = () => useAppStore.getState()

const DESKTOP_ONLY = '파일 저장과 열기는 데스크톱 앱에서만 사용할 수 있습니다.'

function unavailable(): false {
  store().setNotice({ kind: 'error', text: DESKTOP_ONLY })
  return false
}

/** 저장(또는 다른 이름으로 저장). 저장했으면 true, 취소나 오류면 false. */
export async function saveProject(saveAs = false): Promise<boolean> {
  const spd = window.spd
  if (!spd) return unavailable()
  const file = store().buildProjectFile()
  const r = saveAs ? await spd.project.saveAs(file) : await spd.project.save(file)
  if (r.status === 'saved') {
    store().markSaved(r.fileName)
    store().setNotice(null)
    await clearAutosave()
    return true
  }
  if (r.status === 'error') store().setNotice({ kind: 'error', text: r.message })
  return false
}

/** 저장하지 않은 변경이 있으면 물어보고, 계속 진행해도 되면 true. */
async function confirmDiscardIfDirty(): Promise<boolean> {
  const spd = window.spd
  if (!selectIsDirty(store())) return true
  if (!spd) return true
  const choice = await spd.project.confirmDiscard()
  if (choice === 'cancel') return false
  if (choice === 'save') return saveProject()
  await clearAutosave() // 변경을 버리기로 했으니 자동 저장본도 필요 없다
  return true
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscardIfDirty())) return
  await window.spd?.project.reset()
  await store().newProject()
}

/** 다른 모델로 새 프로젝트를 시작한다. 저장하지 않은 변경이 있으면 먼저 묻는다. */
export async function switchModel(modelId: string): Promise<void> {
  if (modelId === store().modelId) return
  if (!(await confirmDiscardIfDirty())) return
  await window.spd?.project.reset()
  await store().newProject(modelId)
}

/** 새 프로젝트를 이름·설명과 함께 시작한다(PRJ-01). 저장하지 않은 변경이 있으면 먼저 묻는다. 시작했으면 true. */
export async function startProject(modelId: string, init: { name?: string; description?: string } = {}): Promise<boolean> {
  if (!(await confirmDiscardIfDirty())) return false
  await window.spd?.project.reset()
  await store().newProject(modelId, init)
  return true
}

/** 내장 예제를 복사본으로 연다(PRJ-03). 저장하지 않은 변경이 있으면 먼저 묻는다. 열었으면 true. */
export async function openExample(example: Example): Promise<boolean> {
  if (!(await confirmDiscardIfDirty())) return false
  await window.spd?.project.reset() // 복사본은 어떤 파일에도 연결되지 않는다
  return store().openExample(example.file, { runPresets: example.runPresets })
}

/** 최근 목록의 프로젝트를 연다(PRJ-02). 저장하지 않은 변경이 있으면 먼저 묻는다. 열었으면 true. */
export async function openRecent(id: string): Promise<boolean> {
  const spd = window.spd
  if (!spd) {
    unavailable()
    return false
  }
  if (!(await confirmDiscardIfDirty())) return false
  const r = await spd.recent.open(id)
  if (r.status === 'opened') return store().loadProjectFile(r.project, r.fileName)
  if (r.status === 'error') store().setNotice({ kind: 'error', text: r.message })
  return false
}

export async function openProject(): Promise<void> {
  const spd = window.spd
  if (!spd) {
    unavailable()
    return
  }
  if (!(await confirmDiscardIfDirty())) return
  const r = await spd.project.open()
  if (r.status === 'opened') await store().loadProjectFile(r.project, r.fileName)
  else if (r.status === 'error') store().setNotice({ kind: 'error', text: r.message })
}
