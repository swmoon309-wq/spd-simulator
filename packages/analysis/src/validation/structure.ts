import { checkInvariants, checkModelUnits, Simulation, SimulationError, ModelError, type CompiledModel, type ModelDef, type RunResult } from '@spd/sd-engine'
import { computeKpis, type KpiSpec } from '../scenario/kpi'

/**
 * 구조 점검 S1~S6(설계 07의 4.3). 모든 점검은 **무엇을 확인했고 무엇은 확인하지 못했는지**를 함께 낸다. 기계적 결함만 잡고,
 * 모델이 현실에 맞는지는 판단하지 않는다(설계 0장).
 */

/** 통과 / 주의 / 실패 / 정보(점검할 것이 없거나 점검하지 못함). */
export type StructureStatus = 'pass' | 'warn' | 'fail' | 'info'

export type StructureId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'

export interface StructureFinding {
  id: StructureId
  title: string
  status: StructureStatus
  /** 한 줄 결과 */
  summary: string
  /** 문제가 된 항목(변수 이름과 이유) */
  items: string[]
  /** 확인한 것 */
  checked: string
  /** 확인하지 못한 것 */
  notChecked: string[]
}

export interface StructureInput {
  model: CompiledModel
  /** 대상 시나리오의 유효 파라미터(상수 덮어쓰기) */
  params: Record<string, number>
  /** 실행 설정 */
  options: { end?: number; dt?: number; seed?: number }
  /** 적분 간격 민감도(S4)에서 비교할 지표 */
  kpis: KpiSpec[]
  /** 화면·지표가 읽는 변수. 쓰이지 않는 변수 점검(S5)에서 제외한다 */
  usedExternally?: string[]
  /** Level 음수·초기값 점검의 허용 오차(기본 1e-6) */
  levelTolerance?: number
}

export interface StructureReport {
  findings: StructureFinding[]
  /** 대상 시나리오 실행이 중단된 이유(없으면 null). 중단되면 실행이 필요한 점검(S2·S3·S4·S6)은 실패로 낸다 */
  runError: string | null
}

export const DT_PASS = 0.01
export const DT_WARN = 0.05
export const DEFAULT_LEVEL_TOLERANCE = 1e-6

const base = (id: StructureId, title: string): Pick<StructureFinding, 'id' | 'title'> => ({ id, title })

// ---------- S1 단위 일관성 ----------

/**
 * S1 단위 일관성(설계 07의 4.3을 설계 08의 6.3이 교체): 수식 안의 항별 단위 일치(`checkModelUnits`). 확정된 불일치(더하는 항, MIN·MAX·IF의 분기, SMOOTH
 * 지연시간, GRAPH의 입력·출력, Level의 유입·유출과 초기값, 선언한 단위와 수식에서 추론한 단위)는 실패, 단위가 없거나 읽을 수 없어 검사하지 못한 것은 주의,
 * 모두 맞으면 통과다.
 */
export function checkUnits(def: ModelDef): StructureFinding {
  const found = checkModelUnits(def)
  const errors = found.filter((i) => i.severity === 'error')
  const warnings = found.filter((i) => i.severity === 'warning')
  const missing = found.filter((i) => i.code === 'unit-missing')
  const items = [...errors.map((i) => i.message), ...warnings.map((i) => i.message), ...missing.map((i) => `단위 없음: ${i.variable}`)]
  const status: StructureStatus = errors.length > 0 ? 'fail' : warnings.length > 0 || missing.length > 0 ? 'warn' : 'pass'
  const parts = [errors.length > 0 ? `단위가 맞지 않는 곳 ${errors.length}개` : '', warnings.length > 0 ? `검사하지 못한 곳 ${warnings.length}개` : '', missing.length > 0 ? `단위가 없는 변수 ${missing.length}개` : ''].filter(Boolean)
  return {
    ...base('S1', '단위 일관성'),
    status,
    summary: status === 'pass' ? '모든 변수에 단위가 있고 수식 안의 항별 단위와 Level의 유입·유출 단위가 맞습니다.' : parts.join(', '),
    items,
    checked: '수식의 항별 단위 일치(더하기·빼기·비교, MIN·MAX·IF의 분기, SMOOTH·DELAY의 지연시간, GRAPH의 입력·출력), Level의 유입·유출("Level 단위/일")과 초기값, 선언한 단위와 수식에서 추론한 단위의 일치.',
    notChecked: [
      '숫자 리터럴은 단위 미정으로 보고 넘어간다(0이 아닌 숫자를 더하는 식은 정보로만 알린다)',
      '단위가 없는 변수를 쓰는 수식은 추론하지 못한다(주의로 알린다)',
      '같은 단위를 다른 이름으로 쓴 경우: 별칭을 모델의 units에 선언하지 않으면 다른 단위로 읽는다',
      'GRAPH의 인라인 형식은 단위를 실을 수 없어 입력·출력이 무차원이라고 본다(이름 있는 테이블은 xUnit·yUnit을 쓴다)'
    ]
  }
}

// ---------- 실행이 필요한 점검의 공통 ----------

const stopped = (id: StructureId, title: string, message: string, notChecked: string[]): StructureFinding => ({
  ...base(id, title),
  status: 'fail',
  summary: `시뮬레이션이 중단되어 점검하지 못했습니다: ${message}`,
  items: [],
  checked: '대상 시나리오를 실행해 점검하려 했습니다.',
  notChecked
})

// ---------- S2 보존 법칙 ----------

export function checkConservation(def: ModelDef, result: RunResult, params: Record<string, number>): StructureFinding {
  const checks = checkInvariants(def, result, params)
  const notChecked = ['모델이 선언하지 않은 보존 법칙(선언은 모델 JSON의 invariants)']
  if (checks.length === 0) {
    return { ...base('S2', '보존 법칙'), status: 'info', summary: '이 모델에는 선언된 불변식이 없어 점검할 것이 없습니다.', items: [], checked: '선언된 불변식이 있는지.', notChecked }
  }
  const violated = checks.filter((c) => c.violated)
  const skipped = checks.filter((c) => c.missing.length > 0)
  const items = [
    ...violated.map((c) => `${c.label}: 최대 위반 ${c.maxViolation.toExponential(2)} > 허용 ${c.tolerance.toExponential(1)} (처음 ${c.firstViolationTime}일)`),
    ...skipped.map((c) => `${c.label}: 기록되지 않은 변수(${c.missing.join(', ')})가 있어 점검하지 못했습니다`)
  ]
  const status: StructureStatus = violated.length > 0 ? 'fail' : skipped.length > 0 ? 'warn' : 'pass'
  const worst = Math.max(...checks.map((c) => (Number.isFinite(c.maxViolation) ? c.maxViolation : 0)))
  return {
    ...base('S2', '보존 법칙'),
    status,
    summary: status === 'pass' ? `선언된 불변식 ${checks.length}개가 모든 시점에서 성립합니다(최대 위반 ${worst.toExponential(1)}).` : `불변식 ${checks.length}개 중 위반 ${violated.length}개${skipped.length > 0 ? `, 점검하지 못한 ${skipped.length}개` : ''}`,
    items,
    checked: `선언된 불변식 ${checks.length}개를 기록한 모든 시점에서 평가해 최대 위반을 허용 오차와 비교했습니다.`,
    notChecked
  }
}

// ---------- S3 Level 음수 ----------

export function checkNegativeLevels(def: ModelDef, result: RunResult, tolerance = DEFAULT_LEVEL_TOLERANCE): StructureFinding {
  const items: string[] = []
  for (const name of Object.keys(def.levels)) {
    const s = result.series[name]
    if (!s) continue
    let min = Infinity
    let at = 0
    for (let i = 0; i < s.length; i++) {
      if ((s[i] as number) < min) {
        min = s[i] as number
        at = result.time[i] as number
      }
    }
    if (min < -tolerance) items.push(`${name}: 최솟값 ${min.toPrecision(4)} (${at}일)`)
  }
  return {
    ...base('S3', 'Level 음수'),
    status: items.length > 0 ? 'fail' : 'pass',
    summary: items.length > 0 ? `음수가 된 Level ${items.length}개` : 'Level이 모두 0 이상입니다.',
    items,
    checked: `대상 시나리오 실행에서 모든 Level이 −${tolerance} 아래로 내려가지 않았는지.`,
    notChecked: ['다른 파라미터 값에서의 음수(극단 조건 시험이 확인)', '음수가 되어도 말이 되는 변수(예: 순변화)인지의 판단']
  }
}

// ---------- S4 적분 간격 민감도 ----------

export function checkDtSensitivity(input: StructureInput): StructureFinding {
  const { model, params, options, kpis } = input
  const dt = options.dt ?? model.def.time.dt
  const notChecked = ['가장 작은 시간 상수 대비 dt(책: dt는 가장 작은 시간 상수의 1/2 미만, 안전하게는 1/3)는 수식에서 읽지 못합니다', '실행 설정의 다른 값(종료 시각, 시드)']
  const title = '적분 간격 민감도'
  if (kpis.length === 0) return { ...base('S4', title), status: 'info', summary: '비교할 지표가 없습니다.', items: [], checked: 'dt와 dt/2로 실행한 지표의 차이.', notChecked }
  const run = (d: number) => new Simulation(model, { overrides: params, ...options, dt: d }).run()
  let a: RunResult
  let b: RunResult
  try {
    a = run(dt)
    b = run(dt / 2)
  } catch (e) {
    if (e instanceof SimulationError || e instanceof ModelError) return stopped('S4', title, e.message, notChecked)
    throw e
  }
  const va = computeKpis(kpis, a, params)
  const vb = computeKpis(kpis, b, params)
  const items: string[] = []
  let worst = 0
  let worstId = ''
  let mismatched = false
  for (const spec of kpis) {
    const x = va[spec.id] ?? null
    const y = vb[spec.id] ?? null
    if (x === null && y === null) continue
    if (x === null || y === null) {
      mismatched = true
      items.push(`${spec.label}: dt = ${dt}에서는 ${x === null ? '계산할 수 없고' : '계산되며'} dt/2에서는 ${y === null ? '계산할 수 없습니다' : '계산됩니다'}`)
      continue
    }
    const rel = Math.abs(x - y) / Math.max(Math.abs(y), 1e-12)
    if (rel > worst) {
      worst = rel
      worstId = spec.label
    }
    if (rel > DT_PASS) items.push(`${spec.label}: dt ${dt} → ${x.toPrecision(5)}, dt/2 → ${y.toPrecision(5)} (상대 변화 ${(rel * 100).toFixed(2)}%)`)
  }
  const status: StructureStatus = mismatched || worst > DT_WARN ? 'fail' : worst > DT_PASS ? 'warn' : 'pass'
  return {
    ...base('S4', title),
    status,
    summary:
      status === 'pass'
        ? `dt ${dt}와 ${dt / 2}의 지표 차이가 최대 ${(worst * 100).toFixed(3)}%로 ${DT_PASS * 100}% 이하입니다.`
        : `dt를 절반으로 줄이면 지표가 ${mismatched ? '계산 여부가 달라집니다' : `최대 ${(worst * 100).toFixed(2)}%(${worstId}) 변합니다`}.`,
    items,
    checked: `dt = ${dt}와 dt/2로 실행해 지표 ${kpis.length}개의 상대 변화를 비교했습니다(≤ ${DT_PASS * 100}% 통과, ≤ ${DT_WARN * 100}% 주의, 초과 실패).`,
    notChecked
  }
}

// ---------- S5 구조 정적 점검 ----------

export function checkStatic(model: CompiledModel, usedExternally: string[] = []): StructureFinding {
  const { def } = model
  const used = new Set<string>([...def.outputs, ...usedExternally])
  for (const f of model.flows) for (const d of [...f.expr.algebraicDeps, ...f.expr.delayedDeps]) used.add(d)
  for (const l of model.levels) {
    for (const d of [...l.init.algebraicDeps, ...l.init.delayedDeps]) used.add(d)
    for (const s of [...l.inflows, ...l.outflows]) used.add(model.names[s] as string)
  }

  const items: string[] = []
  for (const name of Object.keys(def.constants)) if (!used.has(name)) items.push(`${name}: 쓰이지 않는 상수(어떤 수식·초기값·출력에도 없음)`)
  for (const name of Object.keys(def.auxiliaries)) if (!used.has(name)) items.push(`${name}: 쓰이지 않는 보조 변수`)
  for (const name of Object.keys(def.rates)) if (!used.has(name)) items.push(`${name}: 어떤 Level·수식·출력에도 이어지지 않는 Rate`)
  for (const [name, l] of Object.entries(def.levels)) if (l.inflows.length === 0 && l.outflows.length === 0) items.push(`${name}: 유입·유출이 없는 Level(초기값에서 변하지 않음)`)

  return {
    ...base('S5', '구조 정적 점검'),
    status: items.length > 0 ? 'warn' : 'pass',
    summary: items.length > 0 ? `확인할 항목 ${items.length}개` : '쓰이지 않는 변수, 연결되지 않은 Rate, 흐름이 없는 Level이 없습니다.',
    items,
    checked: '컴파일된 의존 관계에서 쓰이지 않는 상수·보조 변수, 어디에도 이어지지 않는 Rate, 유입·유출이 없는 Level을 찾았습니다.',
    notChecked: ['쓰이지 않는 변수에만 쓰이는 변수(전이적 사용)', '변수 이름만으로 의미가 맞는지(예: 이름과 다른 일을 하는 수식)']
  }
}

// ---------- S6 수치 건전성 ----------

export function checkNumeric(def: ModelDef, result: RunResult, tolerance = DEFAULT_LEVEL_TOLERANCE): StructureFinding {
  const bad: string[] = []
  const negative: string[] = []
  for (const [name, s] of Object.entries(result.series)) {
    const v = s[0] as number
    if (!Number.isFinite(v)) bad.push(`${name}: 시각 0의 값이 ${v}`)
    else if (name in def.levels && v < -tolerance) negative.push(`${name}: Level 초기값이 음수(${v})`)
  }
  const items = [...bad, ...negative]
  return {
    ...base('S6', '수치 건전성'),
    status: bad.length > 0 ? 'fail' : negative.length > 0 ? 'warn' : 'pass',
    summary: items.length === 0 ? '시각 0의 모든 Level·Rate·보조 변수가 유한하고 Level 초기값이 0 이상입니다.' : `문제 ${items.length}개`,
    items,
    checked: '시각 0의 모든 변수 값이 유한한 수인지, Level 초기값이 0 이상인지.',
    notChecked: ['실행 중간의 발산(실행 중 유한성은 시뮬레이션이 매 스텝 검사해 오류로 멈춥니다)']
  }
}

// ---------- 전체 ----------

/** S1~S6을 모두 실행한다. 대상 시나리오 실행이 중단되면 실행이 필요한 점검은 실패로 낸다. */
export function runStructureChecks(input: StructureInput): StructureReport {
  const { model, params, options } = input
  const tol = input.levelTolerance ?? DEFAULT_LEVEL_TOLERANCE
  let result: RunResult | null = null
  let runError: string | null = null
  try {
    result = new Simulation(model, { overrides: params, ...options }).run()
  } catch (e) {
    if (e instanceof SimulationError || e instanceof ModelError) runError = e.message
    else throw e
  }
  const needsRun = (id: StructureId, title: string, notChecked: string[], f: (r: RunResult) => StructureFinding): StructureFinding =>
    result ? f(result) : stopped(id, title, runError ?? '알 수 없는 오류', notChecked)
  const findings: StructureFinding[] = [
    checkUnits(model.def),
    needsRun('S2', '보존 법칙', ['선언된 불변식'], (r) => checkConservation(model.def, r, params)),
    needsRun('S3', 'Level 음수', ['Level 값'], (r) => checkNegativeLevels(model.def, r, tol)),
    checkDtSensitivity(input),
    checkStatic(model, input.usedExternally),
    needsRun('S6', '수치 건전성', ['시각 0의 값'], (r) => checkNumeric(model.def, r, tol))
  ]
  return { findings, runError }
}

/** 점검 결과의 상태별 개수. */
export function countStatuses(findings: StructureFinding[]): Record<StructureStatus, number> {
  const out: Record<StructureStatus, number> = { pass: 0, warn: 0, fail: 0, info: 0 }
  for (const f of findings) out[f.status]++
  return out
}
