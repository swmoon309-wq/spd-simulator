import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MODEL_DOC_VERSION, MODEL_FILE_EXTENSION, serializeModelFile, type ModelDocRaw } from '../shared/modelDoc'
import { LIBRARY_ID, MAX_LIBRARY_MODELS, ModelLibraryService } from './modelLibraryService'
import * as fsp from 'node:fs/promises'

const doc = (id: string, name = '모델'): ModelDocRaw => ({
  docVersion: MODEL_DOC_VERSION,
  def: { meta: { id, name, version: 1, timeUnit: 'day' }, constants: {} },
  info: { description: '', createdAt: '2026-10-23T00:00:00.000Z' },
  view: { positions: {}, sectors: [], notes: [] },
  spec: { params: [], kpis: [], presets: [] }
})

let dir: string
let svc: ModelLibraryService
beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'spd-lib-')), 'models') // 폴더는 아직 없다
  svc = new ModelLibraryService({
    dir,
    fs: { readFile: (p) => fsp.readFile(p, 'utf-8'), writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'), rename: fsp.rename, rm: (p) => fsp.rm(p), mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined), readdir: fsp.readdir }
  })
})
afterEach(() => rm(join(dir, '..'), { recursive: true, force: true }))

describe('내 모델 목록', () => {
  it('폴더가 없으면 빈 목록이다', async () => {
    expect(await svc.list()).toEqual({ status: 'ok', models: [], skipped: 0 })
  })

  it('저장하면 폴더를 만들고 id로 된 파일에 쓰며, 다시 읽으면 같은 문서다', async () => {
    expect(await svc.save(doc('user-a-00000001', 'A'))).toEqual({ status: 'saved' })
    expect(await readdir(dir)).toEqual([`user-a-00000001${MODEL_FILE_EXTENSION}`])
    const r = await svc.list()
    expect(r).toEqual({ status: 'ok', models: [{ id: 'user-a-00000001', doc: doc('user-a-00000001', 'A') }], skipped: 0 })
  })

  it('같은 id를 다시 저장하면 바꾼다(임시 파일이 남지 않는다)', async () => {
    await svc.save(doc('user-a-00000001', '첫째'))
    await svc.save(doc('user-a-00000001', '둘째'))
    const r = await svc.list()
    expect(r.status === 'ok' && r.models).toHaveLength(1)
    expect(r.status === 'ok' && (r.models[0]?.doc.def['meta'] as { name: string }).name).toBe('둘째')
    expect(await readdir(dir)).toHaveLength(1)
  })

  it('지우면 목록에서 사라진다. 경로 문자가 든 id는 무시한다', async () => {
    await svc.save(doc('user-a-00000001'))
    await svc.remove('../../etc/passwd')
    await svc.remove('user-a-00000001')
    expect(await readdir(dir)).toEqual([])
    expect(LIBRARY_ID.test('user-a/b')).toBe(false)
    expect(LIBRARY_ID.test('brooks')).toBe(false)
  })

  it('올바르지 않은 id·형식은 저장하지 않는다', async () => {
    for (const id of ['brooks', 'user-a/b', 'user-' + 'x'.repeat(100), 'user-../x']) {
      const r = await svc.save(doc(id))
      expect(r.status, id).toBe('error')
    }
    expect(await readdir(dir).catch(() => [])).toEqual([])
  })

  it('읽을 수 없는 파일(깨진 JSON·id가 파일 이름과 다름)은 건너뛰고 센다', async () => {
    await svc.save(doc('user-ok-00000001'))
    await writeFile(join(dir, `user-broken-00000002${MODEL_FILE_EXTENSION}`), '{ not json')
    await writeFile(join(dir, `user-other-00000003${MODEL_FILE_EXTENSION}`), serializeModelFile(doc('user-different-00000009')))
    await writeFile(join(dir, 'notes.txt'), 'x')
    const r = await svc.list()
    expect(r.status === 'ok' && r.models.map((m) => m.id)).toEqual(['user-ok-00000001'])
    expect(r.status === 'ok' && r.skipped).toBe(2)
  })

  it(`최대 ${MAX_LIBRARY_MODELS}개: 새 모델은 거절하고 기존 모델의 덮어쓰기는 허용한다`, async () => {
    for (let i = 0; i < MAX_LIBRARY_MODELS; i++) expect((await svc.save(doc(`user-m-${String(i).padStart(4, '0')}`))).status).toBe('saved')
    const more = await svc.save(doc('user-extra-0000'))
    expect(more.status === 'error' && more.message).toMatch(/최대/)
    expect((await svc.save(doc('user-m-0007', '바뀜'))).status).toBe('saved')
    expect(await readFile(join(dir, `user-m-0007${MODEL_FILE_EXTENSION}`), 'utf-8')).toContain('바뀜')
  })
})
