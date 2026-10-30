import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVM_FILE, type ProjectFile } from '../shared/projectFile'
import { parseRecoveryJson, serializeRecovery, type RecoveryRecord } from '../shared/recoveryFile'
import { RECOVERY_FILE, RecoveryService } from './recoveryService'

const project = (name = '내 프로젝트'): ProjectFile => ({
  schemaVersion: 3,
  meta: { name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  model: { id: 'brooks', version: 1 },
  params: { extra_people: 5, hire_day: 110 },
  run: { end: 400, dt: 0.25, seed: 1 },
  ui: { chartVariable: 'total_personnel' },
  scenarios: [{ id: 's1', name: '채용 앞당기기', overrides: { hiring_delay: 10 } }],
  adopted: null,
  actuals: [],
  evm: DEFAULT_EVM_FILE,
  revisions: [],
  risk: null,
  validation: null,
  reports: null
})
const record = (name?: string): RecoveryRecord => ({ savedAt: '2026-10-22T05:00:00.000Z', sourceFile: 'a.spd.json', project: project(name) })

let root: string
let dir: string
const service = () =>
  new RecoveryService({
    dir,
    fs: { readFile: (p) => fsp.readFile(p, 'utf-8'), writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'), rename: fsp.rename, rm: (p) => fsp.rm(p), mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined) }
  })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spd-recovery-'))
  dir = join(root, 'recovery') // 아직 없는 폴더
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('RecoveryService', () => {
  it('폴더가 없어도 쓰고 같은 내용을 읽는다', async () => {
    const s = service()
    expect(await s.write(record())).toEqual({ status: 'saved' })
    const r = await s.read()
    expect(r.status).toBe('found')
    if (r.status === 'found') {
      expect(r.record.savedAt).toBe('2026-10-22T05:00:00.000Z')
      expect(r.record.sourceFile).toBe('a.spd.json')
      expect(r.record.project).toEqual(project())
    }
  })

  it('자동 저장본이 없으면 none', async () => {
    expect(await service().read()).toEqual({ status: 'none' })
  })

  it('다시 쓰면 하나만 남고 새 내용이다. 임시 파일이 남지 않는다', async () => {
    const s = service()
    await s.write(record('첫째'))
    await s.write(record('둘째'))
    expect(await readdir(dir)).toEqual([RECOVERY_FILE])
    const r = await s.read()
    expect(r.status === 'found' && r.record.project.meta.name).toBe('둘째')
  })

  it('clear는 지우고, 없어도 오류가 아니다', async () => {
    const s = service()
    await s.write(record())
    await s.clear()
    expect(await s.read()).toEqual({ status: 'none' })
    await expect(s.clear()).resolves.toBeUndefined()
  })

  it('깨진 파일이나 형식이 다른 파일은 지우고 없는 것으로 본다', async () => {
    const s = service()
    await s.write(record())
    for (const bad of ['{ not json', '{"recoveryVersion":2,"savedAt":"x","sourceFile":null,"project":{}}', JSON.stringify({ recoveryVersion: 1, savedAt: 'x', sourceFile: null, project: { schemaVersion: 2 } })]) {
      await writeFile(join(dir, RECOVERY_FILE), bad)
      expect(await s.read()).toEqual({ status: 'none' })
      expect(await readdir(dir)).toEqual([]) // 지웠다
    }
  })

  it('쓰기에 실패하면 이유를 돌려주고 이전 자동 저장본은 그대로다', async () => {
    const s = service()
    await s.write(record('이전'))
    const failing = new RecoveryService({
      dir,
      fs: {
        readFile: (p) => fsp.readFile(p, 'utf-8'),
        writeFile: async () => {
          throw new Error('디스크가 가득 찼습니다')
        },
        rename: fsp.rename,
        rm: (p) => fsp.rm(p, { force: true }),
        mkdir: (p) => fsp.mkdir(p, { recursive: true }).then(() => undefined)
      }
    })
    expect(await failing.write(record('새'))).toEqual({ status: 'error', message: '디스크가 가득 찼습니다' })
    const r = await s.read()
    expect(r.status === 'found' && r.record.project.meta.name).toBe('이전')
  })

  it('디스크에는 프로젝트 파일 모양이 그대로 들어 있다', async () => {
    await service().write(record())
    const raw = JSON.parse(await readFile(join(dir, RECOVERY_FILE), 'utf-8'))
    expect(raw.recoveryVersion).toBe(1)
    expect(raw.project.schemaVersion).toBe(3)
  })
})

describe('recoveryFile', () => {
  it('오래된 프로젝트 버전도 읽을 때 최신으로 올린다', () => {
    const { scenarios: _s, adopted: _a, actuals: _c, evm: _e, revisions: _r, risk: _k, validation: _v, ...v1 } = project()
    const text = JSON.stringify({ recoveryVersion: 1, savedAt: 'x', sourceFile: null, project: { ...v1, schemaVersion: 1 } })
    const r = parseRecoveryJson(text)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.record.project.schemaVersion).toBe(3)
  })

  it('serialize와 parse는 서로 되돌린다', () => {
    const r = parseRecoveryJson(serializeRecovery(record()))
    expect(r).toEqual({ ok: true, record: record() })
  })

  it('봉투가 올바르지 않으면 거절한다', () => {
    expect(parseRecoveryJson('[]').ok).toBe(false)
    expect(parseRecoveryJson(JSON.stringify({ recoveryVersion: 1, project: project() })).ok).toBe(false)
  })
})
