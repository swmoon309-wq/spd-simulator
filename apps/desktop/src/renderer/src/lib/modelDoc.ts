import { compileModel, modelDefSchema, ModelError, type ModelDef } from '@spd/sd-engine'
import { isUserModelId, MODEL_LIMITS, modelContentHash, type ModelDocRaw } from '../../../shared/modelDoc'

/** 엔진 정의까지 확인한 모델 문서. */
export type ModelDoc = Omit<ModelDocRaw, 'def'> & { def: ModelDef }

export type ValidatedModel = { ok: true; doc: ModelDoc; hash: string } | { ok: false; message: string }

/** 완료 조건·지표에 쓸 수 있는 예약 지표 id. 완료일은 완료 조건에서 자동으로 만들어진다. */
export const RESERVED_KPI_IDS = ['completionDay']

const fail = (message: string): ValidatedModel => ({ ok: false, message })

/**
 * 구조를 확인한 모델 문서(`ModelDocRaw`)를 엔진 정의까지 검증한다(설계 08의 4.1): 엔진 스키마, 한도, 컴파일, 앱 연결(`spec`)의 참조.
 * 실패하면 위치(변수·필드)가 든 이유를 돌려준다. 모델 없이는 프로젝트를 열 수 없으므로 열기를 거절하는 데 쓴다.
 */
export function validateModelDoc(raw: ModelDocRaw): ValidatedModel {
  const parsed = modelDefSchema.safeParse(raw.def)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return fail(`모델 정의가 올바르지 않습니다: ${i?.path.join('.') ?? ''} ${i?.message ?? ''}`.trim())
  }
  const def = parsed.data
  if (!isUserModelId(def.meta.id)) return fail(`사용자 모델의 id는 '${'user-'}'로 시작해야 합니다('${def.meta.id}').`)

  const constants = Object.keys(def.constants)
  const flowsAndLevels = [...Object.keys(def.levels), ...Object.keys(def.rates), ...Object.keys(def.auxiliaries)]
  const count = constants.length + flowsAndLevels.length
  if (count > MODEL_LIMITS.variables) return fail(`변수가 ${count}개입니다. 최대 ${MODEL_LIMITS.variables}개까지 쓸 수 있습니다.`)
  const exprs: [string, string][] = [
    ...Object.entries(def.levels).map(([n, l]) => [n, l.init] as [string, string]),
    ...Object.entries(def.rates).map(([n, r]) => [n, r.expr] as [string, string]),
    ...Object.entries(def.auxiliaries).map(([n, a]) => [n, a.expr] as [string, string])
  ]
  for (const [n, e] of exprs) if (e.length > MODEL_LIMITS.expression) return fail(`'${n}'의 수식이 ${e.length}자입니다. 최대 ${MODEL_LIMITS.expression}자입니다.`)
  const tables = Object.entries(def.tables)
  if (tables.length > MODEL_LIMITS.tables) return fail(`테이블이 ${tables.length}개입니다. 최대 ${MODEL_LIMITS.tables}개입니다.`)
  for (const [n, t] of tables) if (t.x.length > MODEL_LIMITS.tablePoints) return fail(`테이블 '${n}'의 점이 ${t.x.length}개입니다. 최대 ${MODEL_LIMITS.tablePoints}개입니다.`)

  try {
    compileModel(def)
  } catch (e) {
    if (e instanceof ModelError) return fail(`모델을 컴파일할 수 없습니다${e.variable ? ` ('${e.variable}')` : ''}: ${e.message}`)
    return fail(`모델을 컴파일할 수 없습니다: ${e instanceof Error ? e.message : String(e)}`)
  }

  const err = checkSpec(def, raw.spec)
  if (err) return fail(`앱 연결 정보(spec)가 올바르지 않습니다: ${err}`)

  const text = (raw.info.description?.length ?? 0) + raw.view.notes.reduce((s, n) => s + n.text.length, 0)
  if (text * 3 > MODEL_LIMITS.textBytes * 3) return fail(`설명·메모가 너무 깁니다(합계 ${MODEL_LIMITS.textBytes}자 이하).`)

  const doc: ModelDoc = { ...raw, def }
  return { ok: true, doc, hash: modelContentHash(doc) }
}

/** `spec`이 가리키는 상수·변수가 모델에 있는지 등을 확인한다. 문제가 없으면 null. */
function checkSpec(def: ModelDef, spec: ModelDocRaw['spec']): string | null {
  const constants = new Set(Object.keys(def.constants))
  const vars = new Set([...Object.keys(def.levels), ...Object.keys(def.rates), ...Object.keys(def.auxiliaries)])

  const seen = new Set<string>()
  for (const p of spec.params) {
    if (!constants.has(p.name)) return `파라미터 '${p.name}'은(는) 상수가 아닙니다.`
    if (seen.has(p.name)) return `파라미터 '${p.name}'이(가) 겹칩니다.`
    seen.add(p.name)
    if (!(p.min <= p.max)) return `파라미터 '${p.name}'의 최솟값이 최댓값보다 큽니다.`
    const v = (def.constants[p.name] as { value: number }).value
    if (v < p.min || v > p.max) return `파라미터 '${p.name}'의 기본값 ${v}이(가) 범위 [${p.min}, ${p.max}] 밖입니다.`
  }
  for (const c of constants) if (!seen.has(c)) return `상수 '${c}'에 파라미터 정의가 없습니다(모든 상수는 파라미터여야 합니다).`

  const needVar = (name: string, what: string): string | null => (vars.has(name) ? null : `${what} '${name}'은(는) 상수가 아닌 변수여야 하며 모델에 있어야 합니다.`)
  for (const v of spec.variables ?? []) {
    const e = needVar(v.name, '그래프 변수')
    if (e) return e
  }
  if (spec.defaultVariable) {
    const list = spec.variables ?? [...vars].map((name) => ({ name }))
    if (!list.some((v) => v.name === spec.defaultVariable)) return `기본 그래프 변수 '${spec.defaultVariable}'이(가) 그래프 변수 목록에 없습니다.`
  }
  if (spec.completion) {
    const e = needVar(spec.completion.variable, '완료 조건의 변수')
    if (e) return e
  }
  const ids = new Set<string>(RESERVED_KPI_IDS)
  for (const k of spec.kpis) {
    if (ids.has(k.id)) return `지표 id '${k.id}'이(가) 겹치거나 예약되어 있습니다.`
    ids.add(k.id)
    const e = needVar(k.variable, `지표 '${k.id}'의 변수`)
    if (e) return e
    if (k.kind === 'atCompletion' && !spec.completion) return `지표 '${k.id}'(완료 시점 값)에는 완료 조건이 필요합니다.`
  }
  if (spec.staffVariable) {
    const e = needVar(spec.staffVariable, '인원 변수')
    if (e) return e
  }
  if (spec.evm) {
    if (!spec.completion) return 'Earned Value 설정에는 완료 조건이 필요합니다.'
    if (!constants.has(spec.evm.totalTasks.param)) return `총 태스크 파라미터 '${spec.evm.totalTasks.param}'은(는) 상수가 아닙니다.`
    for (const c of spec.evm.credits) {
      const e = needVar(c.variable, '진척 인정 변수')
      if (e) return e
    }
    const total = spec.evm.credits.reduce((s, c) => s + c.weight, 0)
    if (Math.abs(total - 1) > 1e-9) return `진척 인정 비율의 합이 ${total}입니다(1이어야 합니다).`
    const e = needVar(spec.evm.effortVariable, '누적 공수 변수')
    if (e) return e
  }
  if (spec.size && !constants.has(spec.size.param)) return `규모 파라미터 '${spec.size.param}'은(는) 상수가 아닙니다.`
  for (const p of spec.presets) for (const k of Object.keys(p.overrides)) if (!constants.has(k)) return `프리셋 '${p.label}'의 '${k}'은(는) 상수가 아닙니다.`
  return null
}
