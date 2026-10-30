import { selectIsDirty, useAppStore } from '../stores/appStore'
import { createAutosave, startAutosave } from './autosave'

const store = () => useAppStore.getState()

/** 데스크톱 앱에서 자동 저장을 시작한다. 돌려받은 함수로 멈춘다. 브라우저(개발용)에서는 아무것도 하지 않는다. */
export function startAppAutosave(): () => void {
  const spd = window.spd
  if (!spd) return () => undefined
  const autosave = createAutosave({
    read: () => {
      const s = store()
      return { dirty: selectIsDirty(s), project: s.buildProjectFile(), sourceFile: s.projectFile }
    },
    write: (record) => spd.recovery.write(record),
    clear: () => spd.recovery.clear(),
    now: () => new Date()
  })
  return startAutosave(autosave)
}

/** 저장했거나 변경을 버리기로 해서 자동 저장본이 필요 없어졌을 때 지운다. */
export async function clearAutosave(): Promise<void> {
  await window.spd?.recovery.clear()
}

/**
 * 시작할 때 비정상 종료로 남은 자동 저장본이 있으면 복구할지 묻는다. 복구하면 저장하지 않은 프로젝트로 열고, 버리면 지운다.
 * 돌려주는 값은 무슨 일이 있었는지(`none`은 자동 저장본이 없음).
 */
export function checkRecovery(): Promise<RecoveryCheck> {
  // 같은 화면에서 두 번 묻지 않는다(개발 중 효과가 두 번 실행될 때 등).
  checking ??= doCheckRecovery()
  return checking
}

export type RecoveryCheck = 'none' | 'restored' | 'discarded' | 'failed'
let checking: Promise<RecoveryCheck> | null = null

/** 시험에서 한 번만 묻는 기억을 지운다. */
export function resetRecoveryCheck(): void {
  checking = null
}

async function doCheckRecovery(): Promise<RecoveryCheck> {
  const spd = window.spd
  if (!spd) return 'none'
  const r = await spd.recovery.read()
  if (r.status === 'none') return 'none'
  if (r.status === 'error') {
    store().setNotice({ kind: 'warning', text: `자동 저장본을 읽지 못했습니다: ${r.message}` })
    return 'failed'
  }
  const { record } = r
  const choice = await spd.recovery.confirmRestore({ name: record.sourceFile ?? record.project.meta.name, savedAt: record.savedAt })
  if (choice === 'discard') {
    await spd.recovery.clear()
    return 'discarded'
  }
  return (await store().restoreRecovered(record.project)) ? 'restored' : 'failed'
}
