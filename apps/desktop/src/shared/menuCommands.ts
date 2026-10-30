/** 메뉴·단축키가 renderer에 보내는 명령(COM-01). main은 명령 이름만 보내고 처리는 renderer가 한다(상태는 renderer에 있다). */
export const APP_TABS = ['home', 'experiment', 'scenarios', 'control', 'risk', 'validation', 'report', 'model'] as const
export type AppTab = (typeof APP_TABS)[number]

export const HELP_TOPICS = ['glossary', 'examples', 'shortcuts', 'about'] as const
export type HelpTopic = (typeof HELP_TOPICS)[number]

export type SimCommand = 'run' | 'togglePause' | 'step' | 'reset' | 'cancel'

export type MenuCommand =
  | 'new'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'undo'
  | 'redo'
  | 'settings'
  | 'resetParams'
  /** 모델 파일(.spd-model.json) 가져오기·내보내기, 현재 모델을 내 모델로 복제, 내 모델 목록에서 지우기(COM-04) */
  | 'importModel'
  | 'exportModel'
  | 'cloneModel'
  | 'deleteModel'
  | SimCommand
  | `tab:${AppTab}`
  | `model:${string}`
  | `help:${HelpTopic}`
  /** 보고서 탭을 열고 그 종류를 고른다(종류 이름은 renderer가 확인한다) */
  | `report:${string}`

/** 메뉴를 만드는 데 필요한 화면 쪽 상태. 모델 목록은 renderer의 카탈로그에 있어 renderer가 알려 준다. */
export interface MenuState {
  models: { id: string; title: string }[]
  modelId: string
}

/** 사용자에게 보이는 앱 이름(패키지 이름이 아니다). 사용자 데이터 폴더 이름은 패키지 이름을 따르므로 앱 이름을 바꾸지 않고 표시에만 쓴다. */
export const APP_TITLE = '소프트웨어 프로젝트 시뮬레이터'

export const EMPTY_MENU_STATE: MenuState = { models: [], modelId: '' }

export function isAppTab(v: string): v is AppTab {
  return (APP_TABS as readonly string[]).includes(v)
}

export function isHelpTopic(v: string): v is HelpTopic {
  return (HELP_TOPICS as readonly string[]).includes(v)
}

export const TAB_LABELS: Record<AppTab, string> = {
  home: '홈',
  experiment: '실험',
  scenarios: '시나리오',
  control: '통제',
  risk: '위험 분석',
  validation: '검증',
  report: '보고서',
  model: '모델'
}
