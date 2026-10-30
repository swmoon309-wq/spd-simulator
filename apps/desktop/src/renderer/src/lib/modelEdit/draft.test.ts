import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { catalog } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { installUserModel, removeUserModel } from '../modelRegistry'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import type { DraftReadResult } from '../../../../shared/ipc'
import type { ModelDocRaw } from '../../../../shared/modelDoc'
import { selectDirty, useEditorStore } from '../../stores/editorStore'
import { useUiStore } from '../../stores/uiStore'
import { setField } from './commands'
import { checkDraftRecovery, createDraftAutosave, isDraftOnDisk, lenientModelDoc, startDraftAutosave } from './draft'

vi.mock('../../engine/engineClient', () => ({ registerModel: () => undefined, unregisterModel: () => undefined }))

const NOW = new Date('2026-10-23T00:00:00.000Z')
const brooks = (): ModelDoc => {
  const v = validateModelDoc(docFromBuiltin(catalog.find((m) => m.id === 'brooks')!, { now: NOW, random: () => 0.3 }))
  if (!v.ok) throw new Error(v.message)
  return v.doc
}
const ed = () => useEditorStore.getState()

describe('초안 자동 저장 (tick)', () => {
  const make = () => {
    const state = { doc: null as ModelDoc | null, dirty: false }
    const writes: ModelDocRaw[] = []
    let clears = 0
    let fail = false
    const a = createDraftAutosave({
      read: () => ({ doc: state.doc, dirty: state.dirty }),
      write: async (d) => (fail ? { status: 'error', message: '디스크' } : (writes.push(d), { status: 'saved' })),
      clear: async () => void clears++
    })
    return { state, writes, clears: () => clears, a, setFail: (f: boolean) => (fail = f) }
  }

  it('편집하지 않았으면 아무것도 하지 않는다', async () => {
    const t = make()
    expect(await t.a.tick()).toBe('idle')
    t.state.doc = brooks()
    expect(await t.a.tick()).toBe('idle') // 열기만 하고 고치지 않았다(수정됨 아님)
    expect(t.writes).toHaveLength(0)
  })

  it('수정되면 쓰고, 같은 문서는 다시 쓰지 않고, 바뀌면 다시 쓴다', async () => {
    const t = make()
    const doc = brooks()
    t.state.doc = doc
    t.state.dirty = true
    expect(await t.a.tick()).toBe('written')
    expect(await t.a.tick()).toBe('idle')
    t.state.doc = { ...doc }
    expect(await t.a.tick()).toBe('written')
    expect(t.writes).toHaveLength(2)
  })

  it('적용하거나 닫아 수정됨이 없어지면 초안을 지운다(한 번만)', async () => {
    const t = make()
    t.state.doc = brooks()
    t.state.dirty = true
    await t.a.tick()
    t.state.dirty = false
    expect(await t.a.tick()).toBe('cleared')
    expect(await t.a.tick()).toBe('idle')
    expect(t.clears()).toBe(1)
    t.state.dirty = true
    await t.a.tick()
    t.state.doc = null
    expect(await t.a.tick()).toBe('cleared')
  })

  it('이번 세션에서 쓴 적이 없어도 디스크에 남은(복구한) 초안은 수정됨이 없어지면 지운다', async () => {
    let stale = true
    let clears = 0
    const a = createDraftAutosave({ read: () => ({ doc: brooks(), dirty: false }), staleOnDisk: () => stale, write: async () => ({ status: 'saved' }), clear: async () => void (clears++, (stale = false)) })
    expect(await a.tick()).toBe('cleared')
    expect(await a.tick()).toBe('idle')
    expect(clears).toBe(1)
  })

  it('쓰기에 실패해도 던지지 않고 다음 주기에 다시 시도한다', async () => {
    const t = make()
    t.state.doc = brooks()
    t.state.dirty = true
    t.setFail(true)
    expect(await t.a.tick()).toBe('error')
    t.setFail(false)
    expect(await t.a.tick()).toBe('written')
  })
})

describe('초안 모양 확인 (lenientModelDoc)', () => {
  it('아직 오류가 있는 초안(비어 있는 수식, 정의되지 않은 변수)도 받아들인다', () => {
    const d = brooks()
    const broken = { ...d, def: { ...d.def, rates: { ...d.def.rates, software_development_rate: { expr: '' } }, auxiliaries: { ...d.def.auxiliaries, bad: { expr: 'nothing +' } } } }
    expect(lenientModelDoc(broken as unknown as ModelDocRaw)).not.toBeNull()
  })

  it('필요한 구역이 없거나 모양이 틀리면 거절한다', () => {
    const d = brooks() as unknown as ModelDocRaw
    const def = d.def as Record<string, unknown>
    for (const [k, v] of [['levels', []], ['rates', null], ['outputs', {}], ['time', { start: 0 }], ['meta', { id: 1 }], ['constants', { k: { value: 'x' } }]] as const) {
      expect(lenientModelDoc({ ...d, def: { ...def, [k]: v } }), k).toBeNull()
    }
    expect(lenientModelDoc({ ...d, def: { ...def, levels: { a: { init: 1, inflows: [], outflows: [] } } } })).toBeNull()
    expect(lenientModelDoc({ ...d, def: { ...def, rates: { a: { expr: 5 } } } })).toBeNull()
  })
})

describe('시작할 때 초안 복구', () => {
  let read: DraftReadResult
  let cleared = 0
  beforeEach(() => {
    ed().close()
    useUiStore.setState({ tab: 'home' })
    cleared = 0
    read = { status: 'none' }
    vi.stubGlobal('window', { spd: { modelDraft: { read: async () => read, clear: async () => void cleared++, write: async () => ({ status: 'saved' as const }) } }, confirm: () => true })
  })
  afterEach(() => {
    ed().close()
    for (const m of catalog.filter((x) => x.category === 'user')) removeUserModel(m.id)
    vi.unstubAllGlobals()
  })
  const found = (doc: ModelDoc = brooks()): DraftReadResult => ({ status: 'found', savedAt: '2026-10-23T05:00:00.000Z', doc: doc as unknown as ModelDocRaw })

  it('초안이 없으면 아무 일도 없다. 브라우저(window.spd 없음)에서도', async () => {
    expect(await checkDraftRecovery(() => true)).toBe('none')
    vi.stubGlobal('window', {})
    expect(await checkDraftRecovery(() => true)).toBe('none')
  })

  it('복구하면 모델 탭에 수정됨 상태로 열린다(아직 올라온 적 없는 모델은 버전 0)', async () => {
    read = found()
    const asked: { message: string; detail: string; ok: string; cancel: string }[] = []
    expect(await checkDraftRecovery((r) => (asked.push(r), true))).toBe('restored')
    expect(asked[0]?.detail).toContain('복구할까요')
    expect(asked[0]?.detail).toContain('Brooks 법칙 사본')
    expect([asked[0]?.ok, asked[0]?.cancel]).toEqual(['복구', '버리기'])
    expect(ed().doc?.def.meta.name).toBe('Brooks 법칙 사본')
    expect(ed().installedVersion).toBe(0)
    expect(selectDirty(ed())).toBe(true)
    expect(ed().message?.text).toContain('복구한 편집 초안')
    expect(useUiStore.getState().tab).toBe('model')
    expect(cleared).toBe(0) // 적용하거나 버릴 때 지운다
    expect(isDraftOnDisk()).toBe(true) // 복구한 초안이 디스크에 남아 있다는 것을 자동 저장이 안다
  })

  it('복구한 초안을 적용해 수정됨이 없어지면 새 세션의 자동 저장이 디스크의 초안을 지운다', async () => {
    read = found()
    vi.useFakeTimers()
    let clearedNow = 0
    ;(window as unknown as { spd: { modelDraft: Record<string, unknown> } }).spd.modelDraft['clear'] = async () => void clearedNow++
    const stop = startDraftAutosave()
    try {
      await checkDraftRecovery(() => true)
      await vi.advanceTimersByTimeAsync(5100)
      expect(clearedNow).toBe(0) // 아직 수정됨이라 둔다
      useEditorStore.setState({ baseline: ed().doc })
      await vi.advanceTimersByTimeAsync(5100)
      expect(clearedNow).toBe(1)
      expect(isDraftOnDisk()).toBe(false)
    } finally {
      stop()
      vi.useRealTimers()
    }
  })

  it('이미 올라와 있는 같은 id의 모델이면 그 버전을 이어 쓴다', async () => {
    const r = installUserModel(docFromBuiltin(catalog.find((m) => m.id === 'brooks')!, { now: NOW, random: () => 0.7 }) as ModelDocRaw)
    if (!r.ok) throw new Error(r.message)
    const edited = { ...r.entry.custom!.doc, def: { ...r.entry.custom!.doc.def, meta: { ...r.entry.custom!.doc.def.meta, name: '고친 이름' } } }
    read = found(edited as ModelDoc)
    expect(await checkDraftRecovery(() => true)).toBe('restored')
    expect(ed().installedVersion).toBe(1)
    expect(ed().doc?.def.meta.name).toBe('고친 이름')
  })

  it('버리면 초안을 지우고 편집기는 비어 있다', async () => {
    read = found()
    expect(await checkDraftRecovery(() => false)).toBe('discarded')
    expect(cleared).toBe(1)
    expect(ed().doc).toBeNull()
  })

  it('이미 편집 중이면 묻지 않고 건너뛴다(초안은 그대로)', async () => {
    ed().openBlank()
    read = found()
    const ask = vi.fn(() => true)
    expect(await checkDraftRecovery(ask)).toBe('skipped')
    expect(ask).not.toHaveBeenCalled()
    expect(cleared).toBe(0)
  })

  it('모양이 맞지 않는 초안은 지우고 없는 것으로 본다', async () => {
    const d = brooks() as unknown as ModelDocRaw
    read = { status: 'found', savedAt: 'x', doc: { ...d, def: { ...d.def, levels: [] } } }
    expect(await checkDraftRecovery(() => true)).toBe('invalid')
    expect(cleared).toBe(1)
    expect(ed().doc).toBeNull()
  })

  it('복구한 초안을 계속 고치고 되돌릴 수 있다(이력은 복구 시점부터)', async () => {
    read = found()
    await checkDraftRecovery(() => true)
    expect(ed().run('수식', (d) => setField(d, 'software_development_rate', { field: 'expr', value: '1' }))).toBeNull()
    ed().undo()
    expect(ed().doc?.def.rates['software_development_rate']?.expr).not.toBe('1')
    expect(ed().history?.past).toHaveLength(0)
  })
})
