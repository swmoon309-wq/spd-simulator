import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { APP_TABS, isAppTab, isHelpTopic, type MenuCommand } from '../shared/menuCommands'
import { buildMenuTemplate, REPORT_MENU } from './menuTemplate'

const state = { models: [{ id: 'brooks', title: 'Brooks 법칙' }, { id: 'integrated-project', title: '통합 프로젝트' }], modelId: 'brooks' }
const build = (o: { isMac?: boolean; dev?: boolean; models?: boolean } = {}) => {
  const sent: MenuCommand[] = []
  const template = buildMenuTemplate({ isMac: o.isMac ?? false, dev: o.dev ?? false, appName: 'SPD', state: o.models === false ? { models: [], modelId: '' } : state, send: (c) => sent.push(c) })
  return { template, sent }
}
const labelsOf = (t: MenuItemConstructorOptions[]) => t.map((m) => m.label)
const sub = (t: MenuItemConstructorOptions[], label: string) => (t.find((m) => m.label === label)?.submenu ?? []) as MenuItemConstructorOptions[]
const all = (t: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => t.flatMap((m) => [m, ...(Array.isArray(m.submenu) ? all(m.submenu) : [])])

describe('앱 메뉴 구성 (COM-01)', () => {
  it('Windows·Linux: 파일 편집 보기 프로젝트 모델 시뮬레이션 분석 제어 보고서 창 도움말', () => {
    expect(labelsOf(build().template)).toEqual(['파일', '편집', '보기', '프로젝트', '모델', '시뮬레이션', '분석', '제어', '보고서', '창', '도움말'])
  })

  it('macOS는 앱 메뉴가 맨 앞에 더해지고 설정은 거기에 있다', () => {
    const { template } = build({ isMac: true })
    expect(template[0]?.label).toBe('SPD')
    expect(labelsOf(sub(template, 'SPD'))).toContain('설정…')
    expect(labelsOf(sub(template, '파일'))).not.toContain('설정…')
    expect(labelsOf(sub(build().template, '파일'))).toContain('설정…')
  })

  it('항목을 누르면 renderer로 명령을 보낸다', () => {
    const { template, sent } = build()
    const click = (menu: string, label: string) => (sub(template, menu).find((m) => m.label === label)?.click as unknown as () => void)()
    click('파일', '새 프로젝트')
    click('파일', '설정…')
    click('시뮬레이션', '실행')
    click('시뮬레이션', '스텝(1일 진행)')
    click('분석', '위험 분석')
    click('제어', '통제(Earned Value)')
    click('도움말', '예제 안내')
    click('모델', '입력값을 기본값으로 되돌리기')
    expect(sent).toEqual(['new', 'settings', 'run', 'step', 'tab:risk', 'tab:control', 'help:examples', 'resetParams'])
  })

  it('모델 메뉴는 목록을 라디오로 보이고 현재 모델에 표시한다', () => {
    const { template, sent } = build()
    const items = sub(template, '모델').filter((m) => m.type === 'radio')
    expect(items.map((m) => [m.label, m.type, m.checked])).toEqual([['Brooks 법칙', 'radio', true], ['통합 프로젝트', 'radio', false]])
    ;(items[1]?.click as unknown as () => void)()
    expect(sent).toEqual(['model:integrated-project'])
  })

  it('모델 목록을 아직 모르면 안내 항목만 있다', () => {
    const items = sub(build({ models: false }).template, '모델')
    expect(items.find((m) => m.enabled === false)).toBeDefined()
    expect(items.some((m) => m.type === 'radio')).toBe(false)
  })

  it('모델 메뉴의 맨 위는 모델 편집기 열기(Cmd/Ctrl+8)다', () => {
    const { template, sent } = build()
    const first = sub(template, '모델')[0]!
    expect(first).toMatchObject({ label: '모델 편집기 열기…', accelerator: 'CmdOrCtrl+8' })
    ;(first.click as unknown as () => void)()
    expect(sent).toEqual(['tab:model'])
  })

  it('보고서 메뉴: 보고서 탭 열기와 종류별 항목(모두 쓸 수 있다)', () => {
    const { template, sent } = build()
    const items = sub(template, '보고서').filter((m) => m.type !== 'separator')
    expect(items.map((m) => m.label)).toEqual(['보고서 만들기…', ...REPORT_MENU.map((r) => r.label)])
    expect(items.every((m) => m.enabled !== false)).toBe(true)
    for (const m of items) (m.click as unknown as () => void)()
    expect(sent).toEqual(['tab:report', ...REPORT_MENU.map((r) => `report:${r.kind}`)])
  })

  it('화면 이동 단축키가 6개 화면에 모두 있고 겹치지 않는다', () => {
    const items = all(build().template).filter((m) => typeof m.click === 'function')
    const accels = items.map((m) => m.accelerator).filter(Boolean)
    expect(new Set(accels).size).toBe(accels.length)
    for (const id of APP_TABS) expect(items.some((m) => m.accelerator === `CmdOrCtrl+${APP_TABS.indexOf(id) + 1}`), id).toBe(true)
  })

  it('보내는 명령은 모두 renderer가 아는 명령이다', () => {
    const { template, sent } = build()
    for (const m of all(template)) if (typeof m.click === 'function') (m.click as unknown as () => void)()
    for (const c of sent) {
      if (c.startsWith('tab:')) expect(isAppTab(c.slice(4)), c).toBe(true)
      else if (c.startsWith('help:')) expect(isHelpTopic(c.slice(5)), c).toBe(true)
      else if (c.startsWith('report:')) expect(REPORT_MENU.some((r) => `report:${r.kind}` === c), c).toBe(true)
      else if (c.startsWith('model:')) expect(state.models.some((m) => `model:${m.id}` === c), c).toBe(true)
      else expect(['new', 'open', 'save', 'saveAs', 'undo', 'redo', 'settings', 'resetParams', 'importModel', 'exportModel', 'cloneModel', 'deleteModel', 'run', 'togglePause', 'step', 'reset', 'cancel']).toContain(c)
    }
    expect(sent.length).toBeGreaterThan(15)
  })

  it('개발 중에만 다시 불러오기·개발자 도구가 있다', () => {
    const roles = (dev: boolean) => sub(build({ dev }).template, '보기').map((m) => m.role)
    expect(roles(true)).toContain('toggleDevTools')
    expect(roles(false)).not.toContain('toggleDevTools')
  })

  it('다시 실행 단축키는 플랫폼마다 다르다', () => {
    const redo = (isMac: boolean) => sub(build({ isMac }).template, '편집').find((m) => m.label === '다시 실행')?.accelerator
    expect(redo(true)).toBe('Shift+CmdOrCtrl+Z')
    expect(redo(false)).toBe('CmdOrCtrl+Y')
  })
})

