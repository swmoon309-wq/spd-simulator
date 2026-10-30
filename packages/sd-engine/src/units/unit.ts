/**
 * 단위 대수(설계 08의 6.3). 단위 문자열을 **기본 단위의 곱과 지수**(차원)로 읽는다: `맨데이/일`, `1/명²`, `오류/태스크`, `FTE/신입`.
 * 차원은 기본 단위 이름 → 지수의 표이며 지수가 0인 항은 없다. 같은 차원이면 같은 단위다(`맨데이` = `명·일`).
 */
export type Dim = Readonly<Record<string, number>>

export const DIMENSIONLESS: Dim = Object.freeze({})

const EPS = 1e-9
const clean = (d: Record<string, number>): Dim => {
  const out: Record<string, number> = {}
  for (const k of Object.keys(d).sort()) {
    const v = d[k] as number
    if (Math.abs(v) > EPS) out[k] = Math.round(v * 1e6) / 1e6
  }
  return Object.freeze(out)
}

export const mulDim = (a: Dim, b: Dim): Dim => {
  const out: Record<string, number> = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v
  return clean(out)
}
export const divDim = (a: Dim, b: Dim): Dim => mulDim(a, powDim(b, -1))
export const powDim = (a: Dim, n: number): Dim => clean(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v * n])))
export const isDimensionless = (a: Dim): boolean => Object.keys(a).length === 0
export const equalDim = (a: Dim, b: Dim): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > EPS) return false
  return true
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '.': '·' }
const sup = (n: number): string => (n === 1 ? '' : String(n).split('').map((c) => SUP[c] ?? c).join(''))

/** 사람이 읽는 단위 문자열(분자·분모 순, 무차원은 `1`). `parseUnit(formatDim(d))`는 같은 차원이 된다(별칭 없이). */
export function formatDim(d: Dim): string {
  const num = Object.entries(d).filter(([, v]) => v > 0)
  const den = Object.entries(d).filter(([, v]) => v < 0)
  if (num.length === 0 && den.length === 0) return '1'
  const part = (xs: [string, number][], flip: boolean) => xs.map(([k, v]) => `${k}${sup(flip ? -v : v)}`).join('·')
  const top = num.length > 0 ? part(num, false) : '1'
  if (den.length === 0) return top
  return `${top}/${part(den, true)}`
}

/** 기본 단위 하나의 별칭: 이름 → 단위 문자열(다른 기본 단위의 곱으로 풀린다). */
export type UnitAliases = Readonly<Record<string, string>>

/**
 * 모델이 쓰는 별칭의 기본값. `맨데이`는 명·일(옛 이름 `인일`도 같은 뜻으로 받는다), `비율`·`배`·`0/1`은 무차원이다. `FTE`와 `신입`은 사람 수(명)와 같은 차원으로 본다: 1 FTE는 한 사람의
 * 노동량이고 `신입`은 신입 인원 수를 세는 말이라, `FTE/신입`은 사람 수끼리의 비(무차원)이다.
 */
export const DEFAULT_UNIT_ALIASES: UnitAliases = Object.freeze({ 맨데이: '명·일', 인일: '명·일', 비율: '1', 배: '1', '0/1': '1', FTE: '명', 신입: '명' })

export interface UnitParseError {
  message: string
  /** 문자열 안의 위치(글자 번호) */
  pos: number
}

export type UnitParse = { ok: true; dim: Dim } | { ok: false; error: UnitParseError }

const SUPERSCRIPT: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' }
const NAME = /[^\s·*/^()（）0-9²³¹⁰⁴-⁹⁻][^\s·*/^()（）²³¹⁰⁴-⁹⁻]*/y

/**
 * 단위 문자열을 차원으로 읽는다. 문법: 항을 `·` 또는 `*`로 곱하고 `/`로 나눈다(왼쪽부터 차례로), 항은 이름 또는 숫자 `1`이고 `²`·`³`·`^n`(정수, 음수 가능)
 * 지수를 붙일 수 있다. **괄호 주석은 버린다**(`명(생산성 환산)` = `명`). 별칭은 `aliases`로 풀고(기본: `DEFAULT_UNIT_ALIASES`), 그 밖의 이름은 새 기본
 * 단위다. 문자열 전체가 별칭이면(`0/1`) 그 별칭을 쓴다. 비어 있으면 오류다(호출하는 쪽이 비어 있는 단위는 "단위 없음"으로 따로 다룬다).
 */
export function parseUnit(text: string, aliases: UnitAliases = DEFAULT_UNIT_ALIASES, depth = 0): UnitParse {
  if (depth > 8) return { ok: false, error: { message: `별칭이 서로를 가리킵니다('${text}')`, pos: 0 } }
  const source = text.replace(/[(（][^)）]*[)）]/g, '').trim()
  if (source === '') return { ok: false, error: { message: '단위가 비어 있습니다', pos: 0 } }
  if (source in aliases) return resolveAlias(source, aliases, depth)
  let i = 0
  let acc: Dim = DIMENSIONLESS
  let op: '*' | '/' = '*'
  let first = true
  const fail = (message: string, pos: number): UnitParse => ({ ok: false, error: { message, pos } })
  const skip = () => {
    while (i < source.length && /\s/.test(source.charAt(i))) i++
  }
  for (;;) {
    skip()
    let factor: Dim
    if (source.charAt(i) === '1' && !/[0-9]/.test(source.charAt(i + 1))) {
      factor = DIMENSIONLESS
      i++
    } else {
      NAME.lastIndex = i
      const m = NAME.exec(source)
      if (!m) return fail(first ? `단위를 읽을 수 없습니다('${source.charAt(i) || '끝'}')` : `'${op === '*' ? '·' : '/'}' 뒤에 단위 이름이 필요합니다`, i)
      const name = m[0]
      if (name in aliases) {
        const r = resolveAlias(name, aliases, depth)
        if (!r.ok) return r
        factor = r.dim
      } else factor = Object.freeze({ [name]: 1 })
      i += name.length
    }
    // 지수
    skip()
    let exp = 1
    const c = source.charAt(i)
    if (c === '^') {
      const m = /^\^(-?\d+)/.exec(source.slice(i))
      if (!m) return fail("'^' 뒤에 정수 지수가 필요합니다", i)
      exp = Number(m[1])
      i += m[0].length
    } else if (c in SUPERSCRIPT) {
      let digits = ''
      while (i < source.length && source.charAt(i) in SUPERSCRIPT) digits += SUPERSCRIPT[source.charAt(i++)]
      if (!/^-?\d+$/.test(digits)) return fail('지수를 읽을 수 없습니다', i)
      exp = Number(digits)
    }
    factor = powDim(factor, exp)
    acc = op === '*' ? mulDim(acc, factor) : divDim(acc, factor)
    first = false
    skip()
    if (i >= source.length) return { ok: true, dim: acc }
    const next = source.charAt(i)
    if (next === '·' || next === '*') op = '*'
    else if (next === '/') op = '/'
    else return fail(`예상하지 못한 '${next}'`, i)
    i++
  }
}

function resolveAlias(name: string, aliases: UnitAliases, depth: number): UnitParse {
  // 별칭의 정의에서 자기 자신을 다시 풀지 않도록 그 이름을 뺀 별칭으로 읽는다
  const { [name]: def, ...rest } = aliases as Record<string, string>
  return parseUnit(def as string, rest, depth + 1)
}
