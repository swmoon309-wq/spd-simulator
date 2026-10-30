import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_DOC_VERSION, type ModelDocRaw } from '../shared/modelDoc'
import { DRAFT_FILE, ModelDraftService } from './modelDraftService'

const doc = (name = '초안'): ModelDocRaw => ({
  docVersion: MODEL_DOC_VERSION,
  def: { meta: { id: 'user-d-00000001', name, version: 1, timeUnit: 'day' }, constants: {} },
  info: { description: '', createdAt: '2026-10-23T00:00:00.000Z' },
  view: { positions: {}, sectors: [], notes: [] },
  spec: { params: [], kpis: [], presets: [] }
})

let dir: string
let svc: ModelDraftService
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'spd-draft-')), 'recovery')
  svc = new ModelDraftService({ dir, fs: { readFile: (p) => fsp.readFile(p, 'utf-8'), writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'), rename: fsp.rename, rm: (p) => fsp.rm(p), mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined) }, now: () => new Date('2026-10-23T05:00:00.000Z') })
})
afterEach(() => rm(join(dir, '..'), { recursive: true, force: true }))

describe('모델 편집 초안', () => {
  it('폴더나 파일이 없으면 없음', async () => {
    expect(await svc.read()).toEqual({ status: 'none' })
  })

  it('쓰면 폴더를 만들고 저장 시각과 함께 다시 읽힌다(임시 파일이 남지 않는다)', async () => {
    expect(await svc.write(doc('내 초안'))).toEqual({ status: 'saved' })
    expect(await readdir(dir)).toEqual([DRAFT_FILE])
    const r = await svc.read()
    expect(r).toEqual({ status: 'found', savedAt: '2026-10-23T05:00:00.000Z', doc: doc('내 초안') })
  })

  it('다시 쓰면 바꾸고, 지우면 사라진다(없는 것을 지워도 괜찮다)', async () => {
    await svc.write(doc('첫째'))
    await svc.write(doc('둘째'))
    const r = await svc.read()
    expect(r.status === 'found' && (r.doc.def['meta'] as { name: string }).name).toBe('둘째')
    await svc.clear()
    expect(await svc.read()).toEqual({ status: 'none' })
    await svc.clear()
  })

  it('깨졌거나 형식이 다른 파일은 지우고 없는 것으로 본다', async () => {
    await svc.write(doc())
    await writeFile(svc.path, '{ not json')
    expect(await svc.read()).toEqual({ status: 'none' })
    expect(await readdir(dir)).toEqual([])
    await writeFile(svc.path, JSON.stringify({ draftVersion: 99, savedAt: 'x', doc: doc() }))
    expect(await svc.read()).toEqual({ status: 'none' })
    await writeFile(svc.path, JSON.stringify({ draftVersion: 1, savedAt: 'x', doc: { docVersion: 1 } }))
    expect(await svc.read()).toEqual({ status: 'none' })
  })

  it('너무 큰 초안은 거절한다', async () => {
    const big = { ...doc(), def: { ...doc().def, filler: 'x'.repeat(1.3 * 1024 * 1024) } }
    const r = await svc.write(big)
    expect(r.status).toBe('error')
    expect(await readFile(svc.path, 'utf-8').catch(() => null)).toBeNull()
  })

  it('쓰기에 실패하면 이유를 돌려주고 던지지 않는다', async () => {
    const bad = new ModelDraftService({ dir: join(dir, 'a\u0000b'), fs: { readFile: fsp.readFile as never, writeFile: fsp.writeFile as never, rename: fsp.rename, rm: fsp.rm as never, mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined) }, now: () => new Date() })
    expect((await bad.write(doc())).status).toBe('error')
  })
})
