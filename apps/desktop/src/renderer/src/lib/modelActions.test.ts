import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog, getEntry } from '../catalog'
import { docFromBuiltin } from '../catalog/exportDoc'
import { cloneModel, deleteModelFromLibrary, exportModelFile, importModelFile, loadModelLibrary } from './modelActions'
import { installUserModel, removeUserModel } from './modelRegistry'
import { handleMenuCommand } from './commands'
import { parseModelFileText, serializeModelFile, type ModelDocRaw } from '../../../shared/modelDoc'
import type { LibraryListResult } from '../../../shared/ipc'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    registerModel: () => undefined,
    unregisterModel: () => undefined,
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {},
      pause() {},
      resume() {},
      step() {}
    })
  }
})

const store = () => useAppStore.getState()
const NOW = new Date('2026-10-23T00:00:00.000Z')

interface Fake {
  saved: ModelDocRaw[]
  removed: string[]
  exported: { suggestedName: string; content: string }[]
  confirms: string[]
  library: LibraryListResult
  importContent: string | null
  saveError: string | null
  confirmAnswer: boolean
}
let fake: Fake

function stub() {
  fake = { saved: [], removed: [], exported: [], confirms: [], library: { status: 'ok', models: [], skipped: 0 }, importContent: null, saveError: null, confirmAnswer: true }
  const spd = {
    models: {
      list: async () => fake.library,
      save: async (doc: ModelDocRaw) => {
        if (fake.saveError) return { status: 'error' as const, message: fake.saveError }
        fake.saved.push(doc)
        return { status: 'saved' as const }
      },
      remove: async (id: string) => void fake.removed.push(id)
    },
    files: {
      importJson: async () => (fake.importContent === null ? { status: 'canceled' as const } : { status: 'opened' as const, fileName: 'm.spd-model.json', content: fake.importContent }),
      exportJson: async (r: { suggestedName: string; content: string }) => {
        fake.exported.push(r)
        return { status: 'saved' as const, fileName: r.suggestedName }
      }
    },
    project: { reset: async () => undefined, confirmDiscard: async () => 'discard' as const, setDirty: () => undefined }
  }
  vi.stubGlobal('window', { spd, confirm: (m: string) => (fake.confirms.push(m), fake.confirmAnswer) })
}

const userIds = () => catalog.filter((m) => m.category === 'user').map((m) => m.id)
beforeEach(async () => {
  stub()
  await store().newProject('brooks')
  store().setNotice(null)
  useUiStore.setState({ libraryIds: [], modelsVersion: 0 })
})
afterEach(() => {
  for (const id of userIds()) removeUserModel(id)
  vi.unstubAllGlobals()
})

describe('내 모델 불러오기 (시작할 때)', () => {
  it('목록의 모델을 앱에 올리고 목록 id를 기억한다', async () => {
    const doc = docFromBuiltin(getEntry('brooks'), { now: NOW, name: '저장된 모델', random: () => 0.1 })
    fake.library = { status: 'ok', models: [{ id: 'user-x', doc }], skipped: 0 }
    await loadModelLibrary()
    expect(userIds()).toHaveLength(1)
    expect(useUiStore.getState().libraryIds).toEqual(userIds())
    expect(useUiStore.getState().modelsVersion).toBe(1)
    expect(store().notice).toBeNull()
  })

  it('올리지 못한 모델과 건너뛴 파일은 경고로 알린다(나머지는 올린다)', async () => {
    const ok = docFromBuiltin(getEntry('brooks'), { now: NOW, name: '정상', random: () => 0.1 })
    const bad = { ...ok, def: { ...ok.def, auxiliaries: { z: { expr: 'nothing + 1' } } } }
    fake.library = { status: 'ok', models: [{ id: 'a', doc: bad }, { id: 'b', doc: ok }], skipped: 2 }
    await loadModelLibrary()
    expect(userIds()).toHaveLength(1)
    expect(store().notice?.kind).toBe('warning')
    expect(store().notice?.details).toHaveLength(2)
    expect(store().notice?.details?.join(' ')).toMatch(/읽을 수 없는 모델 파일 2개/)
  })

  it('목록을 읽지 못하면 경고하고 끝낸다. 브라우저(window.spd 없음)에서는 아무것도 하지 않는다', async () => {
    fake.library = { status: 'error', message: '권한 없음' }
    await loadModelLibrary()
    expect(store().notice?.text).toMatch(/권한 없음/)
    vi.stubGlobal('window', {})
    store().setNotice(null)
    await loadModelLibrary()
    expect(store().notice).toBeNull()
  })
})

describe('모델 파일 가져오기', () => {
  const fileOf = (doc: ModelDocRaw) => serializeModelFile(doc)
  const brooks = () => docFromBuiltin(getEntry('brooks'), { now: NOW, name: '가져올 모델', random: () => 0.2 })

  it('올리고 내 모델 목록에 저장한다', async () => {
    fake.importContent = fileOf(brooks())
    await importModelFile()
    expect(userIds()).toHaveLength(1)
    expect(fake.saved).toHaveLength(1)
    expect(useUiStore.getState().libraryIds).toEqual(userIds())
    expect(store().notice?.kind).toBe('info')
    expect(store().notice?.text).toMatch(/가져왔습니다/)
  })

  it('같은 id가 이미 있으면 새 id를 발급해 둘 다 둔다', async () => {
    fake.importContent = fileOf(brooks())
    await importModelFile()
    await importModelFile()
    expect(userIds()).toHaveLength(2)
    expect(new Set(userIds()).size).toBe(2)
    expect(store().notice?.text).toMatch(/새 id를 발급/)
  })

  it('취소하면 아무 일도 없다. 형식이 틀리거나 검증을 통과하지 못하면 이유를 알린다', async () => {
    await importModelFile()
    expect(store().notice).toBeNull()
    fake.importContent = '{ nope'
    await importModelFile()
    expect(store().notice?.kind).toBe('error')
    const bad = brooks()
    fake.importContent = fileOf({ ...bad, def: { ...bad.def, auxiliaries: { z: { expr: 'nothing + 1' } } } })
    await importModelFile()
    expect(store().notice?.text).toMatch(/모델을 사용할 수 없습니다/)
    expect(userIds()).toHaveLength(0)
    expect(fake.saved).toHaveLength(0)
  })

  it('목록 저장에 실패해도 앱에는 올리고 경고한다', async () => {
    fake.saveError = '디스크가 가득 찼습니다'
    fake.importContent = fileOf(brooks())
    await importModelFile()
    expect(userIds()).toHaveLength(1)
    expect(store().notice?.kind).toBe('warning')
    expect(useUiStore.getState().libraryIds).toEqual([])
  })
})

describe('내보내기·복제·지우기', () => {
  it('내장 모델을 내보내면 사용자 모델 파일이 된다(원본은 그대로)', async () => {
    await exportModelFile()
    const out = fake.exported[0]!
    expect(out.suggestedName).toBe('Brooks 법칙.spd-model.json')
    const parsed = parseModelFileText(out.content)
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && (parsed.doc.def['meta'] as { id: string }).id.startsWith('user-')).toBe(true)
    expect(getEntry('brooks').def.meta.id).toBe('brooks')
  })

  it('사용자 모델을 내보내면 같은 문서(같은 id)가 나간다', async () => {
    const r = installUserModel(docFromBuiltin(getEntry('brooks'), { now: NOW, name: '내 모델', random: () => 0.4 }))
    if (!r.ok) throw new Error(r.message)
    await store().newProject(r.entry.id)
    await exportModelFile()
    const parsed = parseModelFileText(fake.exported[0]!.content)
    expect(parsed.ok && (parsed.doc.def['meta'] as { id: string }).id).toBe(r.entry.id)
  })

  it('복제: 내장 모델은 사본을 내 모델로 만들고, 사용자 모델은 새 id·"사본" 이름·버전 1로 복제한다', async () => {
    await cloneModel()
    expect(userIds()).toHaveLength(1)
    const first = getEntry(userIds()[0]!)
    expect(first.title).toBe('Brooks 법칙 사본')
    expect(fake.saved).toHaveLength(1)
    await store().newProject(first.id)
    await cloneModel()
    expect(userIds()).toHaveLength(2)
    const second = catalog.filter((m) => m.category === 'user').find((m) => m.id !== first.id)!
    expect(second.title).toBe('Brooks 법칙 사본 사본')
    expect(second.def.meta.version).toBe(1)
    expect(second.custom?.doc.info.basedOn).toBe(`${first.id}@1`)
    expect(store().modelId).toBe(first.id) // 지금 프로젝트는 바뀌지 않는다
  })

  it('지우기: 내장 모델은 거절, 목록에 있는 내 모델은 확인 뒤 파일만 지운다', async () => {
    await deleteModelFromLibrary()
    expect(store().notice?.text).toMatch(/내장 모델은 지울 수 없습니다/)
    await cloneModel()
    const id = userIds()[0]!
    await store().newProject(id)
    fake.confirmAnswer = false
    await deleteModelFromLibrary()
    expect(fake.removed).toEqual([])
    fake.confirmAnswer = true
    await deleteModelFromLibrary()
    expect(fake.removed).toEqual([id])
    expect(useUiStore.getState().libraryIds).not.toContain(id)
    expect(store().modelId).toBe(id) // 프로젝트는 계속 이 모델을 쓴다
    await deleteModelFromLibrary()
    expect(store().notice?.text).toMatch(/목록에 없습니다/)
  })
})

describe('메뉴 명령', () => {
  it('네 명령이 각 동작을 부른다', async () => {
    handleMenuCommand('cloneModel')
    await vi.waitFor(() => expect(userIds()).toHaveLength(1))
    handleMenuCommand('exportModel')
    await vi.waitFor(() => expect(fake.exported).toHaveLength(1))
    fake.importContent = serializeModelFile(docFromBuiltin(getEntry('brooks'), { now: NOW, name: '메뉴로', random: () => 0.7 }))
    handleMenuCommand('importModel')
    await vi.waitFor(() => expect(userIds()).toHaveLength(2))
    await store().newProject(userIds()[0]!)
    handleMenuCommand('deleteModel')
    await vi.waitFor(() => expect(fake.removed).toHaveLength(1))
  })
})
