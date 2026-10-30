import { describe, expect, it } from 'vitest'
import { canonicalJson, isUserModelId, MODEL_LIMITS, modelContentHash, newUserModelId, parseModelFileText, serializeModelFile, sha256Hex, type ModelDocRaw } from './modelDoc'

const doc: ModelDocRaw = {
  docVersion: 1,
  def: { meta: { id: 'user-a-00000000', name: 'A', version: 1, timeUnit: 'day' }, constants: { k: { value: 1 } } },
  info: { description: '', createdAt: '2026-10-23T00:00:00.000Z' },
  view: { positions: {}, sectors: [], notes: [] },
  spec: { params: [{ name: 'k', group: '기본', min: 0, max: 10, step: 1 }], kpis: [], presets: [] }
}

describe('SHA-256', () => {
  it('알려진 값', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('블록 경계(55·56·64바이트)', () => {
    expect(sha256Hex('a'.repeat(55))).toBe('9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318')
    expect(sha256Hex('a'.repeat(56))).toBe('b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a')
    expect(sha256Hex('a'.repeat(64))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb')
  })
})

describe('정규 JSON·해시', () => {
  it('키 순서와 무관하다', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }))
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]))
  })
  it('설명·화면 정보는 해시에 영향이 없고 정의·연결은 영향이 있다', () => {
    const h = modelContentHash(doc)
    expect(h).toHaveLength(16)
    expect(modelContentHash({ ...doc, info: { ...doc.info, description: '바뀜' }, view: { positions: { k: { x: 1, y: 2 } }, sectors: [], notes: [] } } as ModelDocRaw)).toBe(h)
    expect(modelContentHash({ ...doc, def: { ...doc.def, constants: { k: { value: 2 } } } })).not.toBe(h)
    expect(modelContentHash({ ...doc, spec: { ...doc.spec, presets: [{ label: 'p', overrides: {} }] } })).not.toBe(h)
  })
})

describe('모델 id', () => {
  it('user- 접두사와 8자 해시', () => {
    expect(newUserModelId('My Brooks', () => 0.5)).toBe('user-my-brooks-88888888')
    expect(newUserModelId('내 모델', () => 0)).toBe('user-model-00000000')
    expect(isUserModelId('user-x-1')).toBe(true)
    expect(isUserModelId('brooks')).toBe(false)
  })
})

describe('모델 파일', () => {
  it('왕복한다', () => {
    const r = parseModelFileText(serializeModelFile(doc))
    expect(r).toEqual({ ok: true, doc })
  })
  it('JSON이 아니거나 형식이 다르면 이유를 준다', () => {
    expect(parseModelFileText('{').ok).toBe(false)
    const bad = parseModelFileText(JSON.stringify({ format: 'other', docVersion: 1, doc }))
    expect(bad.ok).toBe(false)
    const noSpec = parseModelFileText(JSON.stringify({ format: 'spd-model', docVersion: 1, doc: { ...doc, spec: undefined } }))
    expect(!noSpec.ok && noSpec.message).toMatch(/spec/)
  })
  it('한도: 지표 13개, 이름 규칙, 너무 큰 파일', () => {
    const kpi = (i: number) => ({ id: `k${i}`, label: 'l', unit: '', kind: 'final', variable: 'k', better: 'none', group: 'risk', decimals: 0 })
    const many = { ...doc, spec: { ...doc.spec, kpis: Array.from({ length: MODEL_LIMITS.kpis + 1 }, (_, i) => kpi(i)) } }
    expect(parseModelFileText(JSON.stringify({ format: 'spd-model', docVersion: 1, doc: many })).ok).toBe(false)
    const badName = { ...doc, spec: { ...doc.spec, params: [{ name: '1x', group: 'g', min: 0, max: 1, step: 1 }] } }
    expect(parseModelFileText(JSON.stringify({ format: 'spd-model', docVersion: 1, doc: badName })).ok).toBe(false)
    expect(parseModelFileText(' '.repeat(MODEL_LIMITS.docBytes * 2)).ok).toBe(false)
    const big = { ...doc, def: { ...doc.def, filler: 'x'.repeat(MODEL_LIMITS.docBytes) } }
    const r = parseModelFileText(JSON.stringify({ format: 'spd-model', docVersion: 1, doc: big }))
    expect(!r.ok && r.message).toMatch(/너무 큽니다/)
  })
})
