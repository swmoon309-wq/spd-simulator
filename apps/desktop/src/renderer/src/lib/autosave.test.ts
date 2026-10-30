import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_EVM_FILE, type ProjectFile } from '../../../shared/projectFile'
import type { RecoveryRecord } from '../../../shared/recoveryFile'
import { createAutosave, startAutosave, type AutosaveDeps } from './autosave'

const project = (extra = 0, updatedAt = '2026-01-02T00:00:00.000Z'): ProjectFile => ({
  schemaVersion: 3,
  meta: { name: '내 프로젝트', createdAt: '2026-01-01T00:00:00.000Z', updatedAt },
  model: { id: 'brooks', version: 1 },
  params: { extra_people: extra },
  run: { end: 400, dt: 0.25, seed: 1 },
  ui: { chartVariable: 'total_personnel' },
  scenarios: [],
  adopted: null,
  actuals: [],
  evm: DEFAULT_EVM_FILE,
  revisions: [],
  risk: null,
  validation: null,
  reports: null
})

function harness() {
  const state = { dirty: false, project: project(), sourceFile: null as string | null }
  const writes: RecoveryRecord[] = []
  let clears = 0
  let writeResult: { status: 'saved' } | { status: 'error'; message: string } = { status: 'saved' }
  const deps: AutosaveDeps = {
    read: () => state,
    write: async (r) => {
      writes.push(r)
      return writeResult
    },
    clear: async () => void clears++,
    now: () => new Date('2026-10-22T05:00:00.000Z')
  }
  return { state, writes, clears: () => clears, deps, failWith: (m: string) => (writeResult = { status: 'error', message: m }), recover: () => (writeResult = { status: 'saved' }) }
}

describe('createAutosave', () => {
  it('변경이 없으면 아무것도 쓰지 않는다', async () => {
    const h = harness()
    expect(await createAutosave(h.deps).tick()).toBe('idle')
    expect(h.writes).toHaveLength(0)
    expect(h.clears()).toBe(0)
  })

  it('저장하지 않은 변경이 있으면 쓰고, 파일 이름과 시각을 함께 둔다', async () => {
    const h = harness()
    h.state.dirty = true
    h.state.sourceFile = 'a.spd.json'
    expect(await createAutosave(h.deps).tick()).toBe('written')
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0]).toMatchObject({ savedAt: '2026-10-22T05:00:00.000Z', sourceFile: 'a.spd.json', project: { params: { extra_people: 0 } } })
  })

  it('내용이 같으면(수정 시각만 달라도) 다시 쓰지 않는다', async () => {
    const h = harness()
    const a = createAutosave(h.deps)
    h.state.dirty = true
    await a.tick()
    h.state.project = project(0, '2026-12-31T00:00:00.000Z')
    expect(await a.tick()).toBe('idle')
    expect(h.writes).toHaveLength(1)
    h.state.project = project(5)
    expect(await a.tick()).toBe('written')
    expect(h.writes).toHaveLength(2)
  })

  it('저장하거나 새로 시작해 변경이 없어지면 한 번만 지운다', async () => {
    const h = harness()
    const a = createAutosave(h.deps)
    h.state.dirty = true
    await a.tick()
    h.state.dirty = false
    expect(await a.tick()).toBe('cleared')
    expect(await a.tick()).toBe('idle')
    expect(h.clears()).toBe(1)
  })

  it('지운 뒤 다시 변경하면 같은 내용이어도 새로 쓴다', async () => {
    const h = harness()
    const a = createAutosave(h.deps)
    h.state.dirty = true
    await a.tick()
    h.state.dirty = false
    await a.tick()
    h.state.dirty = true
    expect(await a.tick()).toBe('written')
    expect(h.writes).toHaveLength(2)
  })

  it('쓰기에 실패해도 던지지 않고, 다음 주기에 다시 시도한다', async () => {
    const h = harness()
    const a = createAutosave(h.deps)
    h.state.dirty = true
    h.failWith('디스크가 가득 찼습니다')
    expect(await a.tick()).toBe('error')
    h.recover()
    expect(await a.tick()).toBe('written')
    expect(h.writes).toHaveLength(2)
  })

  it('쓰는 중에 다시 부르면 겹쳐 쓰지 않는다', async () => {
    const h = harness()
    h.state.dirty = true
    let release!: () => void
    const slow: AutosaveDeps = { ...h.deps, write: (r) => new Promise((resolve) => { h.writes.push(r); release = () => resolve({ status: 'saved' }) }) }
    const a = createAutosave(slow)
    const first = a.tick()
    expect(await a.tick()).toBe('idle')
    release()
    expect(await first).toBe('written')
    expect(h.writes).toHaveLength(1)
  })
})

describe('startAutosave', () => {
  it('주기마다 tick을 부르고, 멈추면 더 부르지 않는다', () => {
    const tick = vi.fn(async () => 'idle' as const)
    let handler: () => void = () => undefined
    const cleared: unknown[] = []
    const stop = startAutosave({ tick }, 1234, { setInterval: (h, ms) => { handler = h; expect(ms).toBe(1234); return 7 }, clearInterval: (id) => void cleared.push(id) })
    handler()
    handler()
    expect(tick).toHaveBeenCalledTimes(2)
    stop()
    expect(cleared).toEqual([7])
  })
})
