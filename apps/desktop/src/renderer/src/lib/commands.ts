import { catalog } from '../catalog'
import { isAppTab, isHelpTopic, type MenuCommand } from '../../../shared/menuCommands'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { REPORT_KINDS } from './report/model'
import { performHistory } from './historyActions'
import { cloneModel, deleteModelFromLibrary, exportModelFile, importModelFile } from './modelActions'
import { newProject, openProject, saveProject, switchModel } from './projectActions'

/**
 * 메뉴와 단축키가 보낸 명령을 처리한다(COM-01). 모르는 명령은 무시한다. 시뮬레이션 명령은 실험 화면으로 옮겨서 결과가 보이게 한다.
 * 실행 중이 아니거나 입력 오류가 있을 때의 동작은 화면의 버튼과 같다(스토어 액션이 같은 검사를 한다).
 */
export function handleMenuCommand(command: MenuCommand): void {
  const app = useAppStore.getState()
  const ui = useUiStore.getState()

  if (command.startsWith('tab:')) {
    const id = command.slice(4)
    if (isAppTab(id)) ui.setTab(id)
    return
  }
  if (command.startsWith('model:')) {
    const id = command.slice(6)
    if (catalog.some((m) => m.id === id)) void switchModel(id)
    return
  }
  if (command.startsWith('report:')) {
    const kind = REPORT_KINDS.find((k) => k.kind === command.slice(7))
    if (kind) {
      useAppStore.getState().setReportKind(kind.kind)
      ui.setTab('report')
    }
    return
  }
  if (command.startsWith('help:')) {
    const topic = command.slice(5)
    if (isHelpTopic(topic)) ui.openHelp(topic)
    return
  }

  switch (command) {
    case 'new':
      void newProject()
      return
    case 'open':
      void openProject()
      return
    case 'save':
      void saveProject(false)
      return
    case 'saveAs':
      void saveProject(true)
      return
    case 'importModel':
      void importModelFile()
      return
    case 'exportModel':
      void exportModelFile()
      return
    case 'cloneModel':
      void cloneModel()
      return
    case 'deleteModel':
      void deleteModelFromLibrary()
      return
    case 'undo':
    case 'redo':
      performHistory(command)
      return
    case 'settings':
      ui.openSettings()
      return
    case 'resetParams':
      ui.setTab('experiment')
      if (app.status !== 'running') app.resetParams()
      return
    case 'run':
      ui.setTab('experiment')
      void app.run()
      return
    case 'step':
      ui.setTab('experiment')
      app.step()
      return
    case 'reset':
      ui.setTab('experiment')
      void app.reset()
      return
    case 'togglePause':
      if (app.status !== 'running') return
      if (app.paused) app.resume()
      else app.pause()
      return
    case 'cancel':
      app.cancel()
      return
    default:
      return
  }
}
