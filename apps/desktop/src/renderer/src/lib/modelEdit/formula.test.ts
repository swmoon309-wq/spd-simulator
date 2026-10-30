import { describe, expect, it } from 'vitest'
import { FUNCTIONS, SPECIAL_FUNCTIONS, lintModel, type ModelDef } from '@spd/sd-engine'
import { applyCompletion, completionsAt, FUNCTION_DOCS, FUNCTION_NAMES, highlight, type Segment } from './formula'
import type { VarKind } from './commands'

const kinds: Record<string, VarKind> = { k: 'constant', x: 'level', r: 'rate', a: 'auxiliary' }
const kindOf = (n: string) => kinds[n] ?? null
const join = (s: Segment[]) => s.map((x) => x.text).join('')
const classes = (s: Segment[]) => s.filter((x) => x.text.trim() !== '').map((x) => [x.text, x.cls])

describe('구문 강조', () => {
  it('조각을 이으면 원래 수식이 된다(공백·연산자 포함)', () => {
    for (const src of ['k * x + MAX(r, 1) - 2.5e3', 'IF(a >= 1 AND NOT x, 1, 0)', '  k   *x', '', '(1+2', 'k $ x', 'GRAPH(x, curve)', 'a <> b == c != d']) {
      expect(join(highlight(src, kindOf)), src).toBe(src)
    }
  })

  it('변수는 종류별, 함수·숫자·연산자·시간·알 수 없는 변수를 구분한다', () => {
    expect(classes(highlight('k * x + MAX(r, 2) + TIME + ghost', kindOf))).toEqual([
      ['k', 'var-constant'], ['*', 'op'], ['x', 'var-level'], ['+', 'op'], ['MAX', 'fn'], ['(', 'op'], ['r', 'var-rate'], [',', 'op'], ['2', 'num'], [')', 'op'], ['+', 'op'], ['TIME', 'time'], ['+', 'op'], ['ghost', 'var-unknown']
    ])
  })

  it('GRAPH의 두 번째 인자는 테이블로, AND·NOT은 연산자로 칠한다', () => {
    expect(classes(highlight('GRAPH(x, curve) AND NOT a', kindOf)).map((c) => c[1])).toEqual(['fn', 'op', 'var-level', 'op', 'table', 'op', 'op', 'op', 'var-auxiliary'])
  })

  it('문제 범위와 겹치는 조각에 오류·경고를 붙인다(오류가 우선)', () => {
    const segs = highlight('k * ghost + x', kindOf, [{ severity: 'error', range: [4, 9] }, { severity: 'warning', range: [0, 1] }])
    expect(segs.find((s) => s.text === 'ghost')?.issue).toBe('error')
    expect(segs.find((s) => s.text === 'k')?.issue).toBe('warning')
    expect(segs.find((s) => s.text === 'x')?.issue).toBeUndefined()
    const both = highlight('ghost', kindOf, [{ severity: 'warning', range: [0, 5] }, { severity: 'error', range: [2, 3] }])
    expect(both[0]?.issue).toBe('error')
  })

  it('허용되지 않는 문자가 있어 나눌 수 없으면 한 조각이다', () => {
    expect(highlight('k $ x', kindOf)).toEqual([{ text: 'k $ x', cls: 'plain' }])
    expect(highlight('k $ x', kindOf, [{ severity: 'error', range: [2, 3] }])[0]?.issue).toBe('error')
  })
})

describe('자동완성', () => {
  const vars = [
    { name: 'productivity', kind: 'constant' as const, unit: 'FP/맨데이' },
    { name: 'prod_rate', kind: 'rate' as const },
    { name: 'level_a', kind: 'level' as const, unit: 'FP' }
  ]

  it('접두사 일치가 먼저, 부분 일치가 뒤에 온다. 변수와 함수가 함께 나온다', () => {
    const st = completionsAt('k * pro', 7, vars)!
    expect(st.from).toBe(4)
    expect(st.items.map((i) => i.label)).toEqual(['productivity', 'prod_rate'])
    const fn = completionsAt('MA', 2, vars)!
    expect(fn.items[0]).toMatchObject({ label: 'MAX', insert: 'MAX(', kind: 'function' })
    expect(fn.items[0]?.detail).toContain('MAX(a, b')
    expect(completionsAt('ate', 3, vars)!.items.map((i) => i.label)).toContain('prod_rate') // 부분 일치
  })

  it('이름 조각이 없거나 숫자로 시작하면 후보가 없다. 이미 정확히 같으면 그 항목은 뺀다', () => {
    expect(completionsAt('k * ', 4, vars)).toBeNull()
    expect(completionsAt('12', 2, vars)).toBeNull()
    expect(completionsAt('zzzz', 4, vars)).toBeNull()
    expect(completionsAt('level_a', 7, vars)).toBeNull()
  })

  it('이름 중간에서도 이어진 조각 전체를 바꾼다. 변수 설명에 종류와 단위가 있다', () => {
    const st = completionsAt('1 + prodxyz', 8, vars)!
    expect(st.from).toBe(4)
    expect(st.to).toBe(11)
    const v = completionsAt('level', 5, vars)!.items.find((i) => i.label === 'level_a')!
    expect(v.detail).toBe('Level · FP')
    const r = applyCompletion('1 + prodxyz', st, st.items[0]!)
    expect(r.source).toBe(`1 + ${st.items[0]!.insert}`)
    expect(r.caret).toBe(4 + st.items[0]!.insert.length)
  })

  it('상한 개수를 지킨다', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `v${i}`, kind: 'auxiliary' as const }))
    expect(completionsAt('v', 1, many, 5)!.items).toHaveLength(5)
  })
})

describe('함수 설명', () => {
  it('엔진이 아는 모든 함수에 설명이 있고, 없는 함수의 설명은 없다', () => {
    expect([...FUNCTION_NAMES].sort()).toEqual([...Object.keys(FUNCTIONS), ...SPECIAL_FUNCTIONS].sort())
    expect(Object.keys(FUNCTION_DOCS).sort()).toEqual([...FUNCTION_NAMES].sort())
    for (const n of FUNCTION_NAMES) expect(FUNCTION_DOCS[n]!.signature.startsWith(`${n}(`), n).toBe(true)
  })

  it('시그니처의 인자 수가 엔진의 규칙과 맞는다(IF 3, MAX 1 이상, GRAPH 2·3)', () => {
    const def = (expr: string): ModelDef => ({ meta: { id: 'm', name: 'm', version: 1, timeUnit: 'day' }, time: { start: 0, end: 1, dt: 1 }, constants: { k: { value: 1 } }, levels: {}, rates: {}, auxiliaries: { a: { expr } }, tables: {}, outputs: [] })
    expect(lintModel(def('IF(k, 1, 2)')).filter((i) => i.severity === 'error')).toEqual([])
    expect(lintModel(def('MAX(k, 1, 2, 3)')).filter((i) => i.severity === 'error')).toEqual([])
  })
})
