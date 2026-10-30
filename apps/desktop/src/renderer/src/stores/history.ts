import { create } from 'zustand'
import { getEntry } from '../catalog'
import { busyReason } from './busy'
import type { AppState } from './state'

/**
 * 실행 취소/다시 실행(COM-02). **프로젝트 파일에 저장되는 입력**의 편집만 되돌린다. 실행 결과(실행 표, 시나리오 결과, 위험 분석 등)는
 * 되돌리지 않는다. 입력이 바뀌면 결과는 이미 "오래됨"으로 보이고 다시 실행하면 된다.
 *
 * 스토어를 구독해 입력 필드의 참조가 바뀔 때마다 이전 값을 기록한다(슬라이스는 이 파일을 모른다). 같은 동기 구간(한 번의 클릭이
 * 부른 여러 `set`)은 한 단계로 묶고, 같은 항목을 1초 안에 거푸 고치면(글자를 치거나 값을 올리는 중) 한 단계로 합친다.
 */
export const INPUT_KEYS = ['projectDescription', 'params', 'runSettings', 'scenarios', 'adopted', 'actuals', 'evm', 'revisions', 'risk', 'validation', 'reports'] as const
type InputKey = (typeof INPUT_KEYS)[number]
type Patch = Partial<Pick<AppState, InputKey>>

export const MAX_HISTORY = 100
export const COALESCE_MS = 1000

interface Entry {
  before: Patch
  after: Patch
  /** 바뀐 항목(합치기 판단용). 파라미터와 실행 설정은 항목 이름까지 */
  key: string
  label: string
}

type HistoryStore = Pick<{ subscribe(l: (s: AppState, p: AppState) => void): () => void; getState(): AppState; setState(p: Partial<AppState>): void }, 'subscribe' | 'getState' | 'setState'>

/** 화면(버튼 상태)이 구독하는 요약. 원시값만 담는다. */
export const useHistoryStore = create<{ undoCount: number; redoCount: number; undoLabel: string | null; redoLabel: string | null }>()(() => ({
  undoCount: 0,
  redoCount: 0,
  undoLabel: null,
  redoLabel: null
}))

let store: HistoryStore | null = null
let undoStack: Entry[] = []
let redoStack: Entry[] = []
let pending: { before: Record<string, unknown> } | null = null
let scheduled = false
let applying = false
let replacing = false
let lastEditAt = 0
let now: () => number = () => Date.now()

function publish(): void {
  useHistoryStore.setState({
    undoCount: undoStack.length,
    redoCount: redoStack.length,
    undoLabel: undoStack.at(-1)?.label ?? null,
    redoLabel: redoStack.at(-1)?.label ?? null
  })
}

/** 시험에서 시계를 바꾼다. */
export function setHistoryClock(clock: () => number): void {
  now = clock
}

/** 스토어를 구독해 기록을 시작한다. 앱에서 한 번 부른다(시험은 다시 불러 처음 상태로 되돌린다). */
export function installHistory(target: HistoryStore): void {
  unsubscribe?.()
  store = target
  undoStack = []
  redoStack = []
  pending = null
  scheduled = false
  lastEditAt = 0
  publish()
  unsubscribe = target.subscribe((state, prev) => {
    if (applying || replacing) return
    let changed = false
    for (const k of INPUT_KEYS) {
      if (state[k] === prev[k]) continue
      pending ??= { before: {} }
      if (!(k in pending.before)) pending.before[k] = prev[k]
      changed = true
    }
    if (changed && !scheduled) {
      scheduled = true
      queueMicrotask(finalize)
    }
  })
}
let unsubscribe: (() => void) | null = null

function pathsOf(key: InputKey, a: unknown, b: unknown): string[] {
  if (key === 'params' || key === 'runSettings') {
    const x = a as Record<string, number>
    const y = b as Record<string, number>
    const names = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((n) => x[n] !== y[n])
    return names.map((n) => `${key}.${n}`) // 값이 그대로면 비어 있다(같은 값을 다시 넣은 것)
  }
  return a === b ? [] : [key]
}

const GROUP_LABEL: Record<InputKey, string> = {
  projectDescription: '프로젝트 설명',
  params: '파라미터',
  runSettings: '실행 설정',
  scenarios: '시나리오',
  adopted: '채택 계획',
  actuals: '실적',
  evm: 'EVM 설정',
  revisions: '계획 개정',
  risk: '위험 분석 설정',
  validation: '검증 설정',
  reports: '보고서 설정'
}

function describe(paths: string[], modelId: string): string {
  if (paths.length === 1) {
    const [group, name] = (paths[0] as string).split('.') as [InputKey, string | undefined]
    if (group === 'params' && name) {
      const label = getEntry(modelId).def.constants[name]?.label
      return `${label ?? name} 변경`
    }
    return `${GROUP_LABEL[group]} 변경`
  }
  const groups = [...new Set(paths.map((p) => GROUP_LABEL[p.split('.')[0] as InputKey]))]
  return groups.length <= 2 ? `${groups.join('·')} 변경` : '여러 항목 변경'
}

function finalize(): void {
  scheduled = false
  const tx = pending
  pending = null
  if (!tx || !store || applying || replacing) return
  const state = store.getState()
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  const paths: string[] = []
  for (const k of Object.keys(tx.before) as InputKey[]) {
    const changed = pathsOf(k, tx.before[k], state[k]) // 같은 구간 안에서 되돌아왔거나 같은 값을 다시 넣은 항목은 비어 있다
    if (changed.length === 0) continue
    before[k] = tx.before[k]
    after[k] = state[k]
    paths.push(...changed)
  }
  if (paths.length === 0) return
  const key = paths.join('|')
  const t = now()
  const top = undoStack.at(-1)
  if (top && redoStack.length === 0 && top.key === key && t - lastEditAt < COALESCE_MS) {
    top.after = after as Patch
    // 합치다가 처음 값으로 돌아왔으면 단계를 없앤다.
    if (Object.keys(top.before).every((k) => pathsOf(k as InputKey, top.before[k as InputKey], top.after[k as InputKey]).length === 0)) undoStack.pop()
  } else {
    undoStack.push({ before: before as Patch, after: after as Patch, key, label: describe(paths, state.modelId) })
    if (undoStack.length > MAX_HISTORY) undoStack.shift()
  }
  redoStack = []
  lastEditAt = t
  publish()
}

/** 아직 묶는 중인 편집을 기록에 넣는다. */
function flush(): void {
  if (pending) finalize()
}

/**
 * 프로젝트를 새로 만들거나 열어 입력 전체를 바꿀 때 감싼다. 그 변경은 기록하지 않고 이전 기록은 지운다(다른 프로젝트로는 되돌아갈 수 없다).
 */
export function replaceProject(apply: () => void): void {
  replacing = true
  try {
    apply()
  } finally {
    replacing = false
  }
  undoStack = []
  redoStack = []
  pending = null
  publish()
}

export type HistoryResult = { ok: true; label: string } | { ok: false; message: string }

function busyMessage(s: AppState): string | null {
  const busy = busyReason(s)
  if (busy) return `${busy} 끝난 뒤에 할 수 있습니다.`
  if (s.validationExtremes?.status === 'running' || s.validationCalibration?.status === 'running') return '검증 실행이 끝난 뒤에 할 수 있습니다.'
  return null
}

/** 입력을 patch의 값으로 바꾼다. 입력에 딸린 선택과 결과가 어긋나지 않게 맞춘다. */
function apply(patch: Patch): void {
  if (!store) return
  const s = store.getState()
  const next: Partial<AppState> = { ...patch }
  const scenarios = patch.scenarios ?? s.scenarios
  if (s.activeScenarioId && !scenarios.some((x) => x.id === s.activeScenarioId)) next.activeScenarioId = null
  const datasets = (patch.validation ?? s.validation).datasets
  if (s.validationActiveId && !datasets.some((d) => d.id === s.validationActiveId)) next.validationActiveId = datasets[0]?.id ?? null
  // 채택 계획·개정·실적이 바뀌면 그에 매인 재예측과 조치 시험은 의미가 없다(원래 동작과 같다).
  if ('adopted' in patch || 'revisions' in patch || 'actuals' in patch || 'evm' in patch) {
    next.reforecast = null
    next.actionRun = null
  }
  applying = true
  try {
    store.setState(next)
  } finally {
    applying = false
  }
}

export function undoEdit(): HistoryResult {
  flush()
  if (!store) return { ok: false, message: '기록을 시작하지 않았습니다.' }
  const busy = busyMessage(store.getState())
  if (busy) return { ok: false, message: busy }
  const entry = undoStack.pop()
  if (!entry) return { ok: false, message: '되돌릴 변경이 없습니다.' }
  apply(entry.before)
  redoStack.push(entry)
  publish()
  return { ok: true, label: entry.label }
}

export function redoEdit(): HistoryResult {
  flush()
  if (!store) return { ok: false, message: '기록을 시작하지 않았습니다.' }
  const busy = busyMessage(store.getState())
  if (busy) return { ok: false, message: busy }
  const entry = redoStack.pop()
  if (!entry) return { ok: false, message: '다시 실행할 변경이 없습니다.' }
  apply(entry.after)
  undoStack.push(entry)
  publish()
  return { ok: true, label: entry.label }
}
