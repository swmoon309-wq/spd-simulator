import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsService } from './settingsService'

let root: string
let file: string
const fs = { readFile: (p: string) => fsp.readFile(p, 'utf-8'), writeFile: (p: string, d: string) => fsp.writeFile(p, d, 'utf-8'), rename: fsp.rename, rm: (p: string) => fsp.rm(p, { force: true }) }
const service = () => new SettingsService({ file, fs })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spd-settings-'))
  file = join(root, 'settings.json')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('SettingsService', () => {
  it('파일이 없으면 기본값', async () => {
    expect(await service().get()).toEqual({ theme: 'system' })
  })

  it('바꾸면 저장하고, 새로 켜도(새 서비스) 남아 있다', async () => {
    expect(await service().update({ theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({ theme: 'dark' })
    expect(await service().get()).toEqual({ theme: 'dark' })
  })

  it('올바르지 않은 값은 무시하고 기존 값을 유지한다', async () => {
    const s = service()
    await s.update({ theme: 'light' })
    expect(await s.update({ theme: 'purple' })).toEqual({ theme: 'light' })
    expect(await s.update('dark')).toEqual({ theme: 'light' })
  })

  it('깨진 파일이나 낯선 내용은 기본값으로 읽는다', async () => {
    await writeFile(file, '{ not json')
    expect(await service().get()).toEqual({ theme: 'system' })
    await writeFile(file, JSON.stringify({ theme: 'neon', futureKey: 1 }))
    expect(await service().get()).toEqual({ theme: 'system' })
    await writeFile(file, JSON.stringify({ theme: 'dark', futureKey: 1 }))
    expect(await service().get()).toEqual({ theme: 'dark' })
  })

  it('저장하지 못해도 던지지 않고 이번 실행에서는 바뀐 값을 쓴다', async () => {
    const s = new SettingsService({ file: join(root, '없는폴더', 'settings.json'), fs })
    expect(await s.update({ theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(await s.get()).toEqual({ theme: 'dark' })
  })
})
