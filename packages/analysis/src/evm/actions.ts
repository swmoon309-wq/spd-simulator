/** 이어 실행 중 특정 시각에 상수를 바꾸는 변경 하나(설계 05의 8장, E5의 "상수 변경 목록"). */
export interface ConstantChange {
  /** 이 시각(일)부터 적용. 이어 실행 시작 시각 이하이면 시작 때 적용한다. */
  day: number
  name: string
  value: number
}

export type ActionKind = 'staffing' | 'overtime' | 'qa'

export interface ActionField {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  integer?: boolean
}

export interface ActionDef {
  kind: ActionKind
  label: string
  description: string
  /** 이 조치를 지원하는 모델 */
  models: string[]
  /** 조치마다 다른 입력(시작일은 공통이라 따로 둔다) */
  fields: ActionField[]
}

/** 2차에서 시험하는 시정 조치(설계 05의 8.1). 범위 축소는 모델 수식 변경이 먼저 필요해 제외했다. */
export const ACTIONS: ActionDef[] = [
  {
    kind: 'staffing',
    label: '인력 보강',
    description: '시작일에 신입 인원을 한 번에 추가한다. 늦게 투입하면 교육·소통 부담으로 오히려 늦어질 수 있다(Brooks 법칙).',
    models: ['integrated-project', 'integrated-project-ai', 'brooks'],
    fields: [{ key: 'people', label: '추가 인원', unit: '명', min: 1, max: 200, step: 1, integer: true }]
  },
  {
    kind: 'overtime',
    label: '야근 허용 확대',
    description: '시작일부터 일정 압박에 따른 최대 과로 증가율을 바꾼다. 일정은 줄 수 있지만 소진과 오류가 늘 수 있다.',
    models: ['integrated-project', 'integrated-project-ai'],
    fields: [{ key: 'maxBoost', label: '최대 과로 증가율', unit: '비율', min: 0, max: 1, step: 0.05 }]
  },
  {
    kind: 'qa',
    label: 'QA 축소',
    description: '시작일부터 계획 QA 인력 비율을 줄인다. 일정은 줄 수 있지만 잔존 결함이 늘 수 있다.',
    models: ['integrated-project', 'integrated-project-ai'],
    fields: [{ key: 'qaFraction', label: '계획 QA 비율', unit: '비율', min: 0, max: 0.4, step: 0.01 }]
  }
]

export const MAX_CANDIDATES = 6

export function actionsFor(modelId: string): ActionDef[] {
  return ACTIONS.filter((a) => a.models.includes(modelId))
}

export const getAction = (kind: ActionKind): ActionDef => ACTIONS.find((a) => a.kind === kind) as ActionDef

/** 조치 한 건의 입력: 종류, 조치별 값, 시작일. */
export interface ActionInput {
  kind: ActionKind
  values: Record<string, number>
  /** 조치를 시작하는 시각(일). 보고일 이후여야 한다. */
  day: number
}

export interface ActionContext {
  modelId: string
  /** 보고일(이어 실행을 시작하는 시각) */
  atDay: number
  /** 종료 시각 */
  end: number
}

/** 입력 검사. 문제가 없으면 null. */
export function validateAction(input: ActionInput, ctx: ActionContext): string | null {
  const def = ACTIONS.find((a) => a.kind === input.kind)
  if (!def) return `알 수 없는 조치입니다: ${input.kind}`
  if (!def.models.includes(ctx.modelId)) return `이 모델은 '${def.label}'을(를) 지원하지 않습니다`
  for (const f of def.fields) {
    const v = input.values[f.key]
    if (v === undefined || !Number.isFinite(v)) return `${f.label}을(를) 입력하세요`
    if (f.integer && !Number.isInteger(v)) return `${f.label}은(는) 정수여야 합니다`
    if (v < f.min || v > f.max) return `${f.label}은(는) ${f.min} ~ ${f.max} 범위여야 합니다`
  }
  if (!Number.isFinite(input.day)) return '시작일을 입력하세요'
  if (input.day < ctx.atDay) return `시작일은 보고일(${ctx.atDay}일) 이후여야 합니다`
  if (input.day >= ctx.end) return `시작일은 종료 시각(${ctx.end}일)보다 이르러야 합니다`
  return null
}

/** 조치를 상수 변경 목록으로 바꾼다. 입력은 `validateAction`을 통과해야 한다. */
export function actionChanges(input: ActionInput, ctx: Pick<ActionContext, 'modelId'>): ConstantChange[] {
  const v = input.values
  switch (input.kind) {
    case 'staffing': {
      const dayName = ctx.modelId === 'brooks' ? 'hire_day' : 'extra_people_day'
      return [
        { day: input.day, name: 'extra_people', value: v['people'] as number },
        { day: input.day, name: dayName, value: input.day }
      ]
    }
    case 'overtime':
      return [{ day: input.day, name: 'max_boost', value: v['maxBoost'] as number }]
    case 'qa':
      return [{ day: input.day, name: 'planned_qa_fraction', value: v['qaFraction'] as number }]
  }
}

/** 화면과 개정 이력에 쓰는 한 줄 설명. */
export function describeAction(input: ActionInput): string {
  const v = input.values
  switch (input.kind) {
    case 'staffing':
      return `인력 보강 +${v['people']}명 (${input.day}일)`
    case 'overtime':
      return `야근 허용 확대: 최대 과로 증가율 ${v['maxBoost']} (${input.day}일부터)`
    case 'qa':
      return `QA 축소: 계획 QA 비율 ${v['qaFraction']} (${input.day}일부터)`
  }
}

/** 입력 폼의 처음 값. 현재 모델 상수에서 시작해 조금 바꾼 값을 제안한다. */
export function defaultActionValues(kind: ActionKind, params: Record<string, number>): Record<string, number> {
  switch (kind) {
    case 'staffing':
      return { people: 3 }
    case 'overtime':
      return { maxBoost: Math.min(1, Math.round(((params['max_boost'] ?? 0.7) + 0.2) * 100) / 100) }
    case 'qa':
      return { qaFraction: Math.round(Math.max(0, (params['planned_qa_fraction'] ?? 0.15) / 2) * 100) / 100 }
  }
}
