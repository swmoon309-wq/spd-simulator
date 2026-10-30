import { app, Menu } from 'electron'
import type { MenuCommand, MenuState } from '../shared/ipc'
import { APP_TITLE } from '../shared/menuCommands'
import { buildMenuTemplate } from './menuTemplate'

/** 앱 메뉴. 항목은 renderer로 명령을 보내 처리한다(상태는 renderer가 갖고 있다). 모델 목록이 바뀌면 다시 만든다. */
export function buildMenu(send: (command: MenuCommand) => void, state: MenuState): Menu {
  return Menu.buildFromTemplate(buildMenuTemplate({ isMac: process.platform === 'darwin', dev: !app.isPackaged, appName: APP_TITLE, state, send }))
}
