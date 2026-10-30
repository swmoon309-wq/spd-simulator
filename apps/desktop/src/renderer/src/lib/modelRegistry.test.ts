import { afterEach, describe, expect, it, vi } from 'vitest'
import { catalog, catalogGroups, getEntry, registerEntry } from '../catalog'
import { docFromBuiltin } from '../catalog/exportDoc'
import { getCompiledModel, modelDefs, registerUserModel, registeredUserModels } from '../engine/models'
import { installUserModel, isInstalled, removeUserModel, withNewId } from './modelRegistry'
import { MODEL_DOC_VERSION } from '../../../shared/modelDoc'

const sent = vi.hoisted(() => [] as { id: string; hash: string }[])
vi.mock('../engine/engineClient', () => ({
  registerModel: (id: string, hash: string) => void sent.push({ id, hash }),
  unregisterModel: () => undefined
}))

const NOW = new Date('2026-10-23T00:00:00.000Z')
const brooksDoc = (rnd = 0.2) => docFromBuiltin(getEntry('brooks'), { now: NOW, random: () => rnd, name: '내 Brooks' })
const installed: string[] = []
afterEach(() => {
  for (const id of installed.splice(0)) removeUserModel(id)
  sent.length = 0
})
const install = (raw = brooksDoc()) => {
  const r = installUserModel(raw)
  if (r.ok) installed.push(r.entry.id)
  return r
}

describe('사용자 모델 레지스트리 (설계 08의 5.1)', () => {
  it('올리면 카탈로그의 "내 모델" 묶음과 엔진 정의에 나타나고 Worker 등록이 요청된다', () => {
    const r = install()
    expect(r.ok && r.replaced).toBe(false)
    const id = r.ok ? r.entry.id : ''
    expect(isInstalled(id)).toBe(true)
    expect(catalogGroups().find((g) => g.label === '내 모델')?.entries.map((e) => e.id)).toEqual([id])
    expect(modelDefs[id]).toBeDefined()
    expect(getCompiledModel(id).names).toContain('requirements')
    expect(sent).toEqual([{ id, hash: expect.stringMatching(/^[0-9a-f]{16}$/) }])
    expect(getEntry(id).custom?.hash).toBe(sent[0]?.hash)
  })

  it('"내 모델" 묶음은 모델이 없으면 나타나지 않는다', () => {
    expect(catalogGroups().map((g) => g.label)).toEqual(['프로젝트 모델', '기본 구조 라이브러리(책 3장)'])
  })

  it('같은 id를 다시 올리면 바꾼다. 같은 해시면 컴파일 캐시를 지우지 않는다', () => {
    const r = install()
    const id = r.ok ? r.entry.id : ''
    const compiledBefore = getCompiledModel(id)
    const again = installUserModel(brooksDoc())
    expect(again.ok && again.replaced).toBe(true)
    expect(catalog.filter((m) => m.id === id)).toHaveLength(1)
    expect(getCompiledModel(id)).toBe(compiledBefore)
    // 내용이 다르면 새로 컴파일한다
    const raw = brooksDoc()
    const changed = { ...raw, def: { ...raw.def, time: { ...(raw.def['time'] as object), end: 300 } } }
    expect(installUserModel(changed).ok).toBe(true)
    expect(getCompiledModel(id)).not.toBe(compiledBefore)
    expect(getEntry(id).def.time.end).toBe(300)
  })

  it('내장 모델 id와 겹치거나 검증을 통과하지 못하면 아무것도 바꾸지 않는다', () => {
    const raw = brooksDoc()
    const clash = installUserModel({ ...raw, def: { ...raw.def, meta: { ...(raw.def['meta'] as object), id: 'brooks' } } })
    expect(!clash.ok && clash.message).toMatch(/user-/)
    const bad = installUserModel({ ...raw, def: { ...raw.def, auxiliaries: { x: { expr: 'nope + 1' } } } })
    expect(bad.ok).toBe(false)
    expect(catalog.filter((m) => m.category === 'user')).toHaveLength(0)
    expect(sent).toEqual([])
  })

  it('내장 모델은 등록·해제로 덮어쓸 수 없다', () => {
    expect(() => registerUserModel('brooks', 'h', getEntry('brooks').def)).toThrow(/내장/)
    expect(() => registerEntry(getEntry('brooks'))).toThrow(/사용자 모델만/)
    removeUserModel('brooks')
    expect(isInstalled('brooks')).toBe(true)
  })

  it('해제하면 카탈로그·엔진에서 사라진다', () => {
    const r = install()
    const id = r.ok ? r.entry.id : ''
    removeUserModel(id)
    expect(isInstalled(id)).toBe(false)
    expect(modelDefs[id]).toBeUndefined()
    expect(registeredUserModels().map((m) => m.id)).not.toContain(id)
    expect(() => getCompiledModel(id)).toThrow(/알 수 없는 모델/)
  })

  it('가져오기: 같은 id가 있으면 새 id를 발급한다(정의의 이름·버전은 그대로)', () => {
    const raw = brooksDoc()
    const renamed = withNewId(raw, () => 0.9)
    const a = raw.def['meta'] as { id: string; name: string }
    const b = renamed.def['meta'] as { id: string; name: string }
    expect(b.id).not.toBe(a.id)
    expect(b.id.startsWith('user-')).toBe(true)
    expect(b.name).toBe(a.name)
    expect(renamed.docVersion).toBe(MODEL_DOC_VERSION)
    expect(JSON.stringify(raw.def)).toContain(a.id) // 원본은 그대로
  })
})
