import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as fsp from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVM_FILE, type ProjectFile } from '../shared/projectFile'
import { defaultFileName, ensureExtension, ProjectService } from './projectService'

const project = (name = '내 프로젝트'): ProjectFile => ({
  schemaVersion: 3,
  meta: { name, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  model: { id: 'brooks', version: 1 },
  params: { extra_people: 5, hire_day: 110 },
  run: { end: 400, dt: 0.25, seed: 1 },
  ui: { chartVariable: 'total_personnel' },
  scenarios: [
    { id: 's1', name: '채용 앞당기기', note: '지연 단축', overrides: { hiring_delay: 10 } },
    { id: 's2', name: '일정 촉박', overrides: { planned_duration_days: 120 } }
  ],
  adopted: null,
  actuals: [],
  evm: DEFAULT_EVM_FILE,
  revisions: [],
  risk: null,
  validation: null,
  reports: null
})

/** MVP가 저장하던 v1 파일 내용 */
const v1Project = () => {
  const { scenarios: _s, adopted: _a, actuals: _c, evm: _e, revisions: _r, risk: _k, validation: _v, ...rest } = project()
  return { ...rest, schemaVersion: 1, meta: { ...rest.meta, name: 'a' } }
}

let dir: string
let openAnswer: string | null
let saveAnswer: string | null
let saveDialogCalls: string[]

function service() {
  return new ProjectService({
    pickOpenPath: async () => openAnswer,
    pickSavePath: async (name) => {
      saveDialogCalls.push(name)
      return saveAnswer
    },
    fs: {
      readFile: (p) => fsp.readFile(p, 'utf-8'),
      writeFile: (p, d) => fsp.writeFile(p, d, 'utf-8'),
      rename: fsp.rename,
      rm: (p) => fsp.rm(p),
      stat: fsp.stat
    }
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spd-test-'))
  openAnswer = null
  saveAnswer = null
  saveDialogCalls = []
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('경로 도우미', () => {
  it('확장자를 .spd.json으로 맞춘다', () => {
    expect(ensureExtension('/a/b.spd.json')).toBe('/a/b.spd.json')
    expect(ensureExtension('/a/b.json')).toBe('/a/b.spd.json')
    expect(ensureExtension('/a/b')).toBe('/a/b.spd.json')
    expect(ensureExtension('/a/b.txt')).toBe('/a/b.txt.spd.json')
  })
  it('기본 파일 이름에서 경로에 쓸 수 없는 문자를 바꾼다', () => {
    expect(defaultFileName('실험 1/2: Brooks?')).toBe('실험 1_2_ Brooks_.spd.json')
    expect(defaultFileName('   ')).toBe('project.spd.json')
  })
})

describe('저장', () => {
  it('처음 저장하면 대화상자를 거쳐 보기 좋은 JSON으로 쓴다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a')
    const r = await s.save(project())
    expect(r).toEqual({ status: 'saved', fileName: 'a.spd.json' })
    expect(saveDialogCalls).toEqual(['내 프로젝트.spd.json'])
    const text = await readFile(join(dir, 'a.spd.json'), 'utf-8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "schemaVersion": 3')
    expect(JSON.parse(text)).toEqual({ ...project(), meta: { ...project().meta, name: 'a' } })
  })

  it('이미 경로가 있으면 대화상자 없이 같은 파일에 덮어쓴다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a.spd.json')
    await s.save(project())
    saveAnswer = join(dir, 'never.spd.json')
    const updated = { ...project(), params: { extra_people: 9 } }
    expect(await s.save(updated)).toEqual({ status: 'saved', fileName: 'a.spd.json' })
    expect(saveDialogCalls).toHaveLength(1)
    expect(JSON.parse(await readFile(join(dir, 'a.spd.json'), 'utf-8')).params).toEqual({ extra_people: 9 })
    expect((await readdir(dir)).sort()).toEqual(['a.spd.json'])
  })

  it('다른 이름으로 저장하면 이후 저장은 새 파일을 쓴다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a.spd.json')
    await s.save(project())
    saveAnswer = join(dir, 'b.spd.json')
    await s.saveAs(project())
    expect(s.path).toBe(join(dir, 'b.spd.json'))
    await s.save({ ...project(), params: { extra_people: 1 } })
    expect(JSON.parse(await readFile(join(dir, 'a.spd.json'), 'utf-8')).params.extra_people).toBe(5)
    expect(JSON.parse(await readFile(join(dir, 'b.spd.json'), 'utf-8')).params.extra_people).toBe(1)
  })

  it('대화상자를 취소하면 아무것도 쓰지 않고 경로도 바뀌지 않는다', async () => {
    const s = service()
    saveAnswer = null
    expect(await s.save(project())).toEqual({ status: 'canceled' })
    expect(s.path).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('저장하는 파일 이름이 프로젝트 이름이 된다', async () => {
    const s = service()
    saveAnswer = join(dir, '실험 A.spd.json')
    await s.save(project('이름 없는 프로젝트'))
    expect(JSON.parse(await readFile(join(dir, '실험 A.spd.json'), 'utf-8')).meta.name).toBe('실험 A')
    saveAnswer = join(dir, 'B.spd.json')
    await s.saveAs(project('실험 A'))
    expect(JSON.parse(await readFile(join(dir, 'B.spd.json'), 'utf-8')).meta.name).toBe('B')
  })

  it('.json 확장자를 골라도 .spd.json으로 저장한다', async () => {
    const s = service()
    saveAnswer = join(dir, 'x.json')
    expect((await s.save(project())) as { fileName: string }).toMatchObject({ fileName: 'x.spd.json' })
  })

  it('쓰기에 실패하면 오류를 알리고 임시 파일을 남기지 않으며 경로를 기억하지 않는다', async () => {
    const s = service()
    saveAnswer = join(dir, 'missing-dir', 'a.spd.json')
    const r = await s.save(project())
    expect(r.status).toBe('error')
    expect(s.path).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })

  it('저장 실패 시 기존 파일 내용이 보존된다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a.spd.json')
    await s.save(project())
    const failing = new ProjectService({
      pickOpenPath: async () => join(dir, 'a.spd.json'),
      pickSavePath: async () => null,
      fs: {
        readFile: (p) => fsp.readFile(p, 'utf-8'),
        writeFile: async (p) => {
          await fsp.writeFile(p, '{"깨진": ', 'utf-8')
          throw new Error('디스크 가득 참')
        },
        rename: fsp.rename,
        rm: (p) => fsp.rm(p),
        stat: fsp.stat
      }
    })
    expect((await failing.open()).status).toBe('opened')
    const r = await failing.save({ ...project(), params: { extra_people: 99 } })
    expect(r).toMatchObject({ status: 'error' })
    expect(JSON.parse(await readFile(join(dir, 'a.spd.json'), 'utf-8')).params.extra_people).toBe(5)
    expect(await readdir(dir)).toEqual(['a.spd.json'])
  })

  it('올바르지 않은 프로젝트 내용은 저장하지 않는다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a.spd.json')
    const bad = { ...project(), params: { x: Infinity } } as ProjectFile
    expect((await s.save(bad)).status).toBe('error')
    expect(await readdir(dir)).toEqual([])
  })
})

describe('열기', () => {
  it('저장한 파일을 그대로 열고 이후 저장은 같은 파일에 쓴다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a.spd.json')
    await s.save(project())

    const s2 = service()
    openAnswer = join(dir, 'a.spd.json')
    const r = await s2.open()
    expect(r).toEqual({ status: 'opened', fileName: 'a.spd.json', project: { ...project(), meta: { ...project().meta, name: 'a' } } })
    saveAnswer = join(dir, 'other.spd.json')
    await s2.save({ ...project(), params: { extra_people: 2 } })
    expect(saveDialogCalls).toHaveLength(1) // 두 번째 서비스는 대화상자를 쓰지 않았다
    expect(JSON.parse(await readFile(join(dir, 'a.spd.json'), 'utf-8')).params.extra_people).toBe(2)
  })

  it('취소하면 canceled', async () => {
    expect(await service().open()).toEqual({ status: 'canceled' })
  })

  it('v1 파일을 열면 최신 버전으로 변환되어 열린다(시나리오 없음)', async () => {
    const f = join(dir, 'old.spd.json')
    await writeFile(f, JSON.stringify(v1Project()))
    openAnswer = f
    const r = await service().open()
    expect(r.status).toBe('opened')
    if (r.status !== 'opened') return
    expect(r.project.schemaVersion).toBe(3)
    expect(r.project.scenarios).toEqual([])
    expect(r.project.adopted).toBeNull()
    expect(r.project.params).toEqual(project().params)
  })

  it('v1 파일을 연 뒤 저장하면 파일이 최신 버전으로 올라가고 원래 내용은 유지된다', async () => {
    const f = join(dir, 'old.spd.json')
    await writeFile(f, JSON.stringify(v1Project()))
    openAnswer = f
    const s = service()
    const opened = await s.open()
    if (opened.status !== 'opened') throw new Error('열려야 합니다')
    expect((await s.save(opened.project)).status).toBe('saved')
    const onDisk = JSON.parse(await readFile(f, 'utf-8'))
    expect(onDisk.schemaVersion).toBe(3)
    expect(onDisk.scenarios).toEqual([])
    expect(onDisk.params).toEqual(project().params)
    expect(onDisk.run).toEqual(project().run)
  })

  it('시나리오가 들어 있는 v2 파일은 저장·열기에서 그대로 유지된다', async () => {
    const s = service()
    saveAnswer = join(dir, 'sc.spd.json')
    await s.save(project())
    openAnswer = saveAnswer
    const r = await service().open()
    expect(r.status === 'opened' && r.project.scenarios).toEqual(project().scenarios)
  })

  it('시나리오 이름이 겹치는 파일은 어디가 문제인지 알리며 거부한다', async () => {
    const f = join(dir, 'dup.spd.json')
    await writeFile(f, JSON.stringify({ ...project(), scenarios: [project().scenarios[0], { ...project().scenarios[1], name: '채용 앞당기기' }] }))
    openAnswer = f
    expect(await service().open()).toMatchObject({ status: 'error', message: expect.stringContaining('scenarios.1.name') })
  })

  it('JSON이 아니거나 형식이 틀리면 오류 메시지를 돌려주고 경로를 바꾸지 않는다', async () => {
    const s = service()
    const f = join(dir, 'bad.spd.json')
    await writeFile(f, 'not json {')
    openAnswer = f
    expect(await s.open()).toMatchObject({ status: 'error', message: expect.stringContaining('JSON') })
    await writeFile(f, JSON.stringify({ schemaVersion: 1, meta: {} }))
    expect(await s.open()).toMatchObject({ status: 'error', message: expect.stringContaining('올바르지') })
    expect(s.path).toBeNull()
  })

  it('더 새로운 스키마 버전은 이유를 알려준다', async () => {
    const f = join(dir, 'new.spd.json')
    await writeFile(f, JSON.stringify({ ...project(), schemaVersion: 4 }))
    openAnswer = f
    expect(await service().open()).toMatchObject({ status: 'error', message: expect.stringContaining('더 새로운 버전') })
  })

  it('너무 큰 파일은 읽지 않는다', async () => {
    const f = join(dir, 'big.spd.json')
    await writeFile(f, ' '.repeat(5 * 1024 * 1024 + 1))
    openAnswer = f
    expect(await service().open()).toMatchObject({ status: 'error', message: expect.stringContaining('너무 큽니다') })
  })

  it('없는 파일은 읽기 오류', async () => {
    openAnswer = join(dir, 'nope.spd.json')
    expect(await service().open()).toMatchObject({ status: 'error', message: expect.stringContaining('읽지 못했습니다') })
  })

  it('디렉터리를 가리켜도 오류로 처리한다', async () => {
    await mkdir(join(dir, 'd'))
    openAnswer = join(dir, 'd')
    expect((await service().open()).status).toBe('error')
  })
})

describe('reset', () => {
  it('새 프로젝트로 돌아가면 다음 저장에서 대화상자를 연다', async () => {
    const s = service()
    saveAnswer = join(dir, 'a.spd.json')
    await s.save(project())
    s.reset()
    expect(s.path).toBeNull()
    await s.save(project())
    expect(saveDialogCalls).toHaveLength(2)
  })
})
