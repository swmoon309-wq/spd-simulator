import { FUNCTIONS, SPECIAL_FUNCTIONS, findReferences, tokenize, type LintIssue } from '@spd/sd-engine'
import type { VarKind } from './commands'

/** 구문 강조용 조각. 모든 조각을 이으면 원래 수식이 된다. */
export interface Segment {
  text: string
  /** 스타일 이름: 종류별 변수, 알 수 없는 변수, 함수, 테이블, 숫자, 연산자, 일반 */
  cls: 'plain' | 'num' | 'op' | 'fn' | 'table' | 'var-constant' | 'var-level' | 'var-rate' | 'var-auxiliary' | 'var-unknown' | 'time'
  /** 이 조각에 걸린 문제(오류 우선) */
  issue?: 'error' | 'warning'
}

/**
 * 수식을 색칠할 조각으로 나눈다(설계 08의 6.2). 변수는 종류별로, 모르는 변수는 따로 표시하고, `issues`의 글자 범위와 겹치는 조각에
 * 오류·경고 표시를 붙는다. 수식이 미완성이어도 토큰으로 추정해 색칠한다. 허용되지 않는 문자가 있어 토큰을 못 나누면 한 조각으로 둔다.
 */
export function highlight(source: string, kindOf: (name: string) => VarKind | null, issues: Pick<LintIssue, 'severity' | 'range'>[] = []): Segment[] {
  let tokens
  try {
    tokens = tokenize(source)
  } catch {
    return [{ text: source, cls: 'plain', ...(issues.some((i) => i.severity === 'error') ? { issue: 'error' as const } : {}) }]
  }
  const refs = new Map(findReferences(source).refs.map((r) => [r.start, r]))
  const issueAt = (start: number, end: number): 'error' | 'warning' | undefined => {
    let found: 'error' | 'warning' | undefined
    for (const i of issues) {
      if (!i.range) continue
      if (i.range[0] < end && start < i.range[1]) {
        if (i.severity === 'error') return 'error'
        found = 'warning'
      }
    }
    return found
  }
  const out: Segment[] = []
  let at = 0
  const push = (start: number, end: number, cls: Segment['cls']) => {
    if (start > at) out.push({ text: source.slice(at, start), cls: 'plain' })
    const issue = issueAt(start, end)
    out.push({ text: source.slice(start, end), cls, ...(issue ? { issue } : {}) })
    at = end
  }
  for (const t of tokens) {
    if (t.type === 'eof') break
    const end = t.pos + (t.type === 'op' ? source.slice(t.pos).match(/^(AND|OR|NOT)/i)?.[0].length ?? (['<=', '>=', '<>', '!=', '=='].includes(source.slice(t.pos, t.pos + 2)) ? 2 : 1) : t.value.length)
    if (t.type === 'num') push(t.pos, end, 'num')
    else if (t.type === 'op') push(t.pos, end, 'op')
    else {
      const r = refs.get(t.pos)
      if (t.value === 'TIME' || t.value === 'DT') push(t.pos, end, 'time')
      else if (r?.kind === 'function') push(t.pos, end, 'fn')
      else if (r?.kind === 'table') push(t.pos, end, 'table')
      else {
        const k = kindOf(t.value)
        push(t.pos, end, k ? (`var-${k}` as Segment['cls']) : 'var-unknown')
      }
    }
  }
  if (at < source.length) out.push({ text: source.slice(at), cls: 'plain' })
  // 토큰 사이의 공백에도 문제 범위가 걸리지 않도록 그대로 둔다
  return out
}

export interface Completion {
  label: string
  /** 입력 칸에 넣을 글 */
  insert: string
  kind: VarKind | 'function'
  /** 보조 설명(단위, 함수 시그니처) */
  detail: string
}

/** 함수 시그니처와 설명(자동완성에 보인다). 엔진의 함수 목록과 같은 이름이어야 한다(시험으로 확인). */
export const FUNCTION_DOCS: Record<string, { signature: string; doc: string }> = {
  IF: { signature: 'IF(조건, 참일 때, 거짓일 때)', doc: '조건이 0이 아니면 두 번째, 0이면 세 번째 값' },
  MIN: { signature: 'MIN(a, b, …)', doc: '가장 작은 값' },
  MAX: { signature: 'MAX(a, b, …)', doc: '가장 큰 값' },
  ABS: { signature: 'ABS(x)', doc: '절댓값' },
  SQRT: { signature: 'SQRT(x)', doc: '제곱근' },
  EXP: { signature: 'EXP(x)', doc: '지수 함수 e^x' },
  LN: { signature: 'LN(x)', doc: '자연로그' },
  ROUND: { signature: 'ROUND(x, 자릿수)', doc: '반올림(자릿수는 생략하면 0)' },
  CLAMP: { signature: 'CLAMP(x, 최소, 최대)', doc: 'x를 [최소, 최대]로 제한' },
  STEP: { signature: 'STEP(높이, 시작시각)', doc: '시작시각 이후에 높이, 이전에는 0' },
  PULSE: { signature: 'PULSE(높이, 시작시각, 폭)', doc: '[시작, 시작+폭) 구간에서만 높이' },
  RAMP: { signature: 'RAMP(기울기, 시작시각)', doc: '시작시각 이후 기울기 × 경과시간' },
  RANDOM_UNIFORM: { signature: 'RANDOM_UNIFORM(최소, 최대)', doc: '균등 난수(시드로 재현)' },
  RANDOM_NORMAL: { signature: 'RANDOM_NORMAL(평균, 표준편차)', doc: '정규 난수' },
  RANDOM_TRIANGULAR: { signature: 'RANDOM_TRIANGULAR(최소, 최빈, 최대)', doc: '삼각 난수' },
  SMOOTH: { signature: 'SMOOTH(입력, 지연시간)', doc: '1차 지수 평활(입력은 다음 스텝에 반영, 순환을 끊는다)' },
  DELAY1: { signature: 'DELAY1(입력, 지연시간)', doc: '1차 지수 지연' },
  DELAY3: { signature: 'DELAY3(입력, 지연시간)', doc: '3차 지연(평균 지연시간)' },
  GRAPH: { signature: 'GRAPH(x, 테이블이름)', doc: '이름 있는 테이블의 선형 보간(또는 GRAPH(x, [x…], [y…]))' }
}

/** 엔진이 아는 모든 함수 이름. */
export const FUNCTION_NAMES = [...Object.keys(FUNCTIONS), ...SPECIAL_FUNCTIONS].sort()

export interface CompletionState {
  /** 바꿀 글자 범위 [from, to) — 커서 앞의 이름 조각 */
  from: number
  to: number
  items: Completion[]
}

/**
 * 커서 위치에서 자동완성 후보를 만든다. 커서 앞에 이름 조각(영문자·숫자·_)이 있을 때만 후보가 있고, 접두사 일치를 먼저, 부분 일치를 뒤에 둔다.
 * 숫자로 시작하는 조각은 후보가 없다. 최대 `limit`개.
 */
export function completionsAt(
  source: string,
  caret: number,
  variables: { name: string; kind: VarKind; unit?: string }[],
  limit = 8
): CompletionState | null {
  let from = caret
  while (from > 0 && /[A-Za-z0-9_]/.test(source.charAt(from - 1))) from--
  const prefix = source.slice(from, caret)
  if (prefix === '' || /^[0-9]/.test(prefix)) return null
  // 커서 뒤로 이어지는 이름 조각도 바꿀 범위에 넣는다(이름 중간에서 고를 때)
  let to = caret
  while (to < source.length && /[A-Za-z0-9_]/.test(source.charAt(to))) to++
  const q = prefix.toLowerCase()
  const all: Completion[] = [
    ...variables.map((v): Completion => ({ label: v.name, insert: v.name, kind: v.kind, detail: `${v.kind === 'constant' ? '상수' : v.kind === 'level' ? 'Level' : v.kind === 'rate' ? 'Rate' : 'Auxiliary'}${v.unit ? ` · ${v.unit}` : ''}` })),
    ...FUNCTION_NAMES.map((n): Completion => ({ label: n, insert: `${n}(`, kind: 'function', detail: FUNCTION_DOCS[n]?.signature ?? n })),
    ...['TIME', 'DT'].map((n): Completion => ({ label: n, insert: n, kind: 'function', detail: n === 'TIME' ? '현재 시각(일)' : '적분 간격(일)' }))
  ]
  const starts = all.filter((c) => c.label.toLowerCase().startsWith(q) && c.label.toLowerCase() !== q)
  const contains = all.filter((c) => !c.label.toLowerCase().startsWith(q) && c.label.toLowerCase().includes(q))
  const items = [...starts, ...contains].slice(0, limit)
  return items.length === 0 ? null : { from, to, items }
}

/** 후보를 골랐을 때의 새 수식과 커서 위치. */
export function applyCompletion(source: string, state: CompletionState, item: Completion): { source: string; caret: number } {
  const text = source.slice(0, state.from) + item.insert + source.slice(state.to)
  return { source: text, caret: state.from + item.insert.length }
}
