import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_RECENT, RecentService, recentId } from './recentService'

let root: string
let file: string
let clock: number

const service = () =>
  new RecentService({
    file,
    fs: { readFile: (p) => fsp.readFile(p, 'utf-8'), writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'), rename: fsp.rename, rm: (p) => fsp.rm(p), stat: fsp.stat },
    now: () => new Date(Date.UTC(2026, 9, 22, 0, 0, clock++))
  })

/** 실제로 있는 프로젝트 파일 하나를 만든다. */
async function touch(name: string, dir = root): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, '{}')
  return p
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spd-recent-'))
  file = join(root, 'recent.json')
  clock = 0
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('RecentService', () => {
  it('처음에는 비어 있다', async () => {
    expect(await service().list()).toEqual([])
  })

  it('가장 최근 것이 맨 앞이고, 다시 열면 앞으로 옮겨진다', async () => {
    const s = service()
    const a = await touch('a.spd.json')
    const b = await touch('b.spd.json')
    await s.add(a)
    await s.add(b)
    expect((await s.list()).map((e) => e.fileName)).toEqual(['b.spd.json', 'a.spd.json'])
    await s.add(a)
    expect((await s.list()).map((e) => e.fileName)).toEqual(['a.spd.json', 'b.spd.json'])
  })

  it('경로 대신 파일 이름·폴더 이름·식별자만 알린다', async () => {
    const s = service()
    const p = await touch('a.spd.json')
    await s.add(p)
    const [e] = await s.list()
    expect(e).toMatchObject({ id: recentId(p), fileName: 'a.spd.json', missing: false })
    expect(e?.folder).toBe(root.split('/').at(-1))
    expect(JSON.stringify(e)).not.toContain(root + '/')
  })

  it(`최대 ${MAX_RECENT}개만 남긴다`, async () => {
    const s = service()
    for (let i = 0; i < MAX_RECENT + 3; i++) await s.add(await touch(`p${i}.spd.json`))
    const list = await s.list()
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0]?.fileName).toBe(`p${MAX_RECENT + 2}.spd.json`)
  })

  it('파일이 없어진 항목은 missing으로 표시하되 지우지 않는다', async () => {
    const s = service()
    const p = await touch('a.spd.json')
    await s.add(p)
    await rm(p)
    expect((await s.list())[0]).toMatchObject({ fileName: 'a.spd.json', missing: true })
  })

  it('식별자로 경로를 찾고, 모르는 식별자는 null', async () => {
    const s = service()
    const p = await touch('a.spd.json')
    await s.add(p)
    expect(await s.resolve(recentId(p))).toBe(p)
    expect(await s.resolve('없는-식별자')).toBeNull()
  })

  it('항목 하나를 빼거나 모두 지운다', async () => {
    const s = service()
    const a = await touch('a.spd.json')
    const b = await touch('b.spd.json')
    await s.add(a)
    await s.add(b)
    await s.remove(recentId(a))
    expect((await s.list()).map((e) => e.fileName)).toEqual(['b.spd.json'])
    await s.clear()
    expect(await s.list()).toEqual([])
  })

  it('앱을 다시 켜도(새 서비스) 목록이 남아 있다', async () => {
    const a = await touch('a.spd.json')
    await service().add(a)
    expect((await service().list()).map((e) => e.fileName)).toEqual(['a.spd.json'])
  })

  it('깨진 파일이나 잘못된 항목은 무시하고 오류를 내지 않는다', async () => {
    await writeFile(file, '{ not json')
    expect(await service().list()).toEqual([])
    const a = await touch('a.spd.json')
    await writeFile(file, JSON.stringify({ version: 1, items: [{ path: 3 }, null, { path: a, openedAt: 'x' }, { path: a, openedAt: 'y' }, { path: '', openedAt: 'z' }] }))
    const list = await service().list()
    expect(list.map((e) => e.fileName)).toEqual(['a.spd.json']) // 겹치는 경로는 하나
  })

  it('목록을 저장하지 못해도 던지지 않는다', async () => {
    const failing = new RecentService({
      file: join(root, '없는폴더', 'recent.json'),
      fs: { readFile: (p) => fsp.readFile(p, 'utf-8'), writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'), rename: fsp.rename, rm: (p) => fsp.rm(p, { force: true }), stat: fsp.stat },
      now: () => new Date()
    })
    await expect(failing.add(await touch('a.spd.json'))).resolves.toBeUndefined()
    expect((await failing.list()).length).toBe(1) // 이번 실행 동안은 기억한다
  })

  it('저장 파일에는 경로와 시각이 남는다', async () => {
    const s = service()
    const p = await touch('a.spd.json')
    await s.add(p)
    const raw = JSON.parse(await readFile(file, 'utf-8'))
    expect(raw).toEqual({ version: 1, items: [{ path: p, openedAt: '2026-10-22T00:00:00.000Z' }] })
  })
})
