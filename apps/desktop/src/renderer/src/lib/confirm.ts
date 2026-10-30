import type { ConfirmRequest } from '../../../shared/ipc'

/**
 * 예/아니오 확인. 데스크톱 앱에서는 네이티브 대화상자(버튼 이름을 정할 수 있고 프로젝트 복구 대화상자와 같은 모양)를, 브라우저(개발용)나
 * 대화상자 API가 없는 환경에서는 `window.confirm`을 쓴다. `ok`를 누르면 true.
 */
export async function askConfirm(request: ConfirmRequest): Promise<boolean> {
  const dialogs = typeof window !== 'undefined' ? window.spd?.dialogs : undefined
  if (dialogs) return dialogs.confirm(request)
  return window.confirm(request.detail ? `${request.message}\n${request.detail}` : request.message)
}
