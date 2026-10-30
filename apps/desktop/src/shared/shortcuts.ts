import type { AppTab } from './menuCommands'

/** 단축키(Electron 가속기 형식). 메뉴와 도움말의 단축키 표가 같은 정의를 쓴다. */
export interface Shortcut {
  /** 메뉴 명령 이름 */
  command: string
  label: string
  accelerator: string
}

const TAB_KEYS: Record<AppTab, string> = { home: '1', experiment: '2', scenarios: '3', control: '4', risk: '5', validation: '6', report: '7', model: '8' }

export function acceleratorFor(command: string, isMac: boolean): string | undefined {
  if (command.startsWith('tab:')) {
    const key = TAB_KEYS[command.slice(4) as AppTab]
    return key ? `CmdOrCtrl+${key}` : undefined
  }
  switch (command) {
    case 'new':
      return 'CmdOrCtrl+N'
    case 'open':
      return 'CmdOrCtrl+O'
    case 'save':
      return 'CmdOrCtrl+S'
    case 'saveAs':
      return 'Shift+CmdOrCtrl+S'
    case 'undo':
      return 'CmdOrCtrl+Z'
    case 'redo':
      return isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y'
    case 'settings':
      return 'CmdOrCtrl+,'
    case 'help:glossary':
      return 'F1'
    case 'run':
      return 'CmdOrCtrl+Enter'
    case 'togglePause':
      return 'Shift+CmdOrCtrl+P'
    case 'step':
      return 'CmdOrCtrl+.'
    default:
      return undefined
  }
}

/** 도움말의 단축키 표에 싣는 명령(표시 순서) */
export const SHORTCUT_LABELS: [command: string, label: string][] = [
  ['new', '새 프로젝트'],
  ['open', '프로젝트 열기'],
  ['save', '저장'],
  ['saveAs', '다른 이름으로 저장'],
  ['undo', '실행 취소'],
  ['redo', '다시 실행'],
  ['run', '시뮬레이션 실행'],
  ['togglePause', '일시정지 / 계속'],
  ['step', '스텝(1일 진행)'],
  ['tab:home', '홈'],
  ['tab:experiment', '실험'],
  ['tab:scenarios', '시나리오'],
  ['tab:control', '통제'],
  ['tab:risk', '위험 분석'],
  ['tab:validation', '검증'],
  ['tab:report', '보고서'],
  ['settings', '설정'],
  ['help:glossary', '도움말']
]

/** 화면에 보이는 모양: macOS는 ⌘⇧ 기호, 그 밖에는 Ctrl+Shift+ 형식. */
export function formatAccelerator(accelerator: string, isMac: boolean): string {
  const parts = accelerator.split('+')
  const key = parts.pop() as string
  const mods = new Set(parts)
  const shown = key === 'Enter' ? (isMac ? '↩' : 'Enter') : key
  if (isMac) return `${mods.has('Shift') ? '⇧' : ''}${mods.has('Alt') ? '⌥' : ''}${mods.has('CmdOrCtrl') ? '⌘' : ''}${shown}`
  return [...(mods.has('CmdOrCtrl') ? ['Ctrl'] : []), ...(mods.has('Alt') ? ['Alt'] : []), ...(mods.has('Shift') ? ['Shift'] : []), shown].join('+')
}
