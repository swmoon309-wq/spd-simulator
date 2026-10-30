import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from 'electron'
import { IPC, type MenuCommand, type MenuState } from '../shared/ipc'
import { EMPTY_MENU_STATE } from '../shared/menuCommands'
import { createProjectContext, registerProjectIpc, resetProjectContext } from './ipc'
import { buildMenu } from './menu'

let mainWindow: BrowserWindow | null = null
const project = createProjectContext(() => mainWindow)

let menuState: MenuState = EMPTY_MENU_STATE

function applyMenu(): void {
  Menu.setApplicationMenu(buildMenu(sendCommand, menuState))
}

function sendCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IPC.menuCommand, command)
}

function createWindow(): void {
  resetProjectContext(project)
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: '소프트웨어 프로젝트 시뮬레이터',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = win

  win.once('ready-to-show', () => win.show())

  // 저장하지 않은 변경 사항이 있으면 닫기 전에 묻는다.
  win.on('close', (e) => {
    const { state } = project
    if (!state.dirty || state.forceClose) return
    e.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      message: '저장하지 않은 변경 사항이 있습니다.',
      detail: '닫기 전에 저장할까요?'
    })
    if (choice === 0) {
      state.closeAfterSave = true // 저장이 성공하면 IPC 핸들러가 창을 닫는다
      sendCommand('save')
    } else if (choice === 1) {
      state.forceClose = true
      win.close()
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // 여기까지 온 것은 정상 종료다(저장했거나 저장하지 않기로 했다). 비정상 종료만 자동 저장본이 남는다.
    try {
      rmSync(project.recovery.path, { force: true }) // 앱이 곧 끝날 수 있어 동기로 지운다
    } catch {
      // 지우지 못해도 다음 실행에서 복구를 묻는 것뿐이다
    }
  })

  // 외부 링크는 앱 안에서 열지 않고 기본 브라우저로 보낸다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerProjectIpc(() => mainWindow, project, {
    // 앱의 테마 설정을 운영체제 쪽(대화상자·메뉴)에도 맞춘다.
    onSettings: (s) => void (nativeTheme.themeSource = s.theme),
    onMenuState: (state) => {
      menuState = state
      applyMenu()
    }
  })
  void project.settings.get().then((s) => void (nativeTheme.themeSource = s.theme))
  applyMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
