import type { MenuItemConstructorOptions } from 'electron'
import { TAB_LABELS, type MenuCommand, type MenuState } from '../shared/menuCommands'
import { acceleratorFor } from '../shared/shortcuts'

/** 보고서 메뉴의 종류별 항목. 종류 이름은 renderer의 `REPORT_KINDS`와 같아야 한다(시험으로 확인한다). */
export const REPORT_MENU: { kind: string; label: string }[] = [
  { kind: 'plan', label: '계획서 요약' },
  { kind: 'scenarios', label: '시나리오 비교 보고서' },
  { kind: 'risk', label: '위험 분석 보고서' },
  { kind: 'status', label: '상태 보고서' }
]

export interface MenuTemplateOptions {
  isMac: boolean
  /** 개발 중이면 다시 불러오기·개발자 도구를 넣는다 */
  dev: boolean
  appName: string
  state: MenuState
  send(command: MenuCommand): void
}

/**
 * 앱 메뉴(COM-01): 파일 · 편집 · 보기 · 프로젝트 · 모델 · 시뮬레이션 · 분석 · 제어 · 보고서 · 창 · 도움말.
 * 항목은 renderer로 명령을 보내 처리한다. Electron에 의존하지 않는 순수 함수라 구조를 시험할 수 있다.
 */
export function buildMenuTemplate(o: MenuTemplateOptions): MenuItemConstructorOptions[] {
  const { isMac, dev, send } = o
  const item = (label: string, command: MenuCommand, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => {
    const accelerator = acceleratorFor(command, isMac)
    return { label, ...(accelerator ? { accelerator } : {}), click: () => send(command), ...extra }
  }
  const tab = (id: keyof typeof TAB_LABELS, label = TAB_LABELS[id]) => item(label, `tab:${id}`)

  const file: MenuItemConstructorOptions = {
    label: '파일',
    submenu: [
      item('새 프로젝트', 'new'),
      item('열기…', 'open'),
      { type: 'separator' },
      item('저장', 'save'),
      item('다른 이름으로 저장…', 'saveAs'),
      ...(isMac ? [] : [{ type: 'separator' } as const, item('설정…', 'settings')]),
      { type: 'separator' },
      isMac ? { role: 'close', label: '창 닫기' } : { role: 'quit', label: '종료' }
    ]
  }

  const edit: MenuItemConstructorOptions = {
    label: '편집',
    // 실행 취소/다시 실행은 renderer가 처리한다(입력창에서는 글자 편집, 그 밖에서는 프로젝트 입력 편집을 되돌린다).
    submenu: [item('실행 취소', 'undo'), item('다시 실행', 'redo'), { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
  }

  const view: MenuItemConstructorOptions = {
    label: '보기',
    submenu: [
      ...(dev ? [{ role: 'reload' } as const, { role: 'toggleDevTools' } as const, { type: 'separator' } as const] : []),
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }

  const models = o.state.models
  const model: MenuItemConstructorOptions = {
    label: '모델',
    submenu: [
      tab('model', '모델 편집기 열기…'),
      { type: 'separator' },
      ...(models.length > 0
        ? models.map((m): MenuItemConstructorOptions => ({ label: m.title, type: 'radio', checked: m.id === o.state.modelId, click: () => send(`model:${m.id}`) }))
        : [{ label: '모델 목록을 불러오는 중…', enabled: false } as MenuItemConstructorOptions]),
      { type: 'separator' },
      item('입력값을 기본값으로 되돌리기', 'resetParams'),
      { type: 'separator' },
      item('모델 파일 가져오기…', 'importModel'),
      item('현재 모델을 모델 파일로 내보내기…', 'exportModel'),
      item('현재 모델을 내 모델로 복제', 'cloneModel'),
      item('현재 모델을 내 모델 목록에서 지우기…', 'deleteModel')
    ]
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: o.appName,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              item('설정…', 'settings'),
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    file,
    edit,
    view,
    { label: '프로젝트', submenu: [tab('home', '홈(요약·최근 프로젝트·예제)')] },
    model,
    {
      label: '시뮬레이션',
      submenu: [
        tab('experiment', '실험 화면'),
        { type: 'separator' },
        item('실행', 'run'),
        item('일시정지 / 계속', 'togglePause'),
        item('스텝(1일 진행)', 'step'),
        item('리셋', 'reset'),
        item('중단', 'cancel')
      ]
    },
    { label: '분석', submenu: [tab('scenarios', '시나리오 비교'), tab('risk', '위험 분석'), tab('validation', '모델 검증')] },
    { label: '제어', submenu: [tab('control', '통제(Earned Value)')] },
    { label: '보고서', submenu: [tab('report', '보고서 만들기…'), { type: 'separator' }, ...REPORT_MENU.map((r) => item(r.label, `report:${r.kind}`))] },
    { label: '창', role: 'windowMenu' },
    {
      label: '도움말',
      role: 'help',
      submenu: [
        item('도움말', 'help:glossary', { label: '도움말(용어 설명)' }),
        item('예제 안내', 'help:examples'),
        item('단축키', 'help:shortcuts'),
        ...(isMac ? [] : [{ type: 'separator' } as const, item('앱 정보', 'help:about')])
      ]
    }
  ]
  return template
}
