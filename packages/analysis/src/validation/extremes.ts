import { checkInvariants, ModelError, Simulation, SimulationError, type CompiledModel, type RunResult } from '@spd/sd-engine'
import { computeKpis, type KpiSpec, type KpiValues } from '../scenario/kpi'

/**
 * 극단 조건 시험(설계 07의 4.1, VAL-03): 폼의 파라미터마다 허용 범위 양 끝과 범위 밖(0, ×10, ×0.1)의 값으로 **한 번에 하나씩**
 * 바꿔 실행하고 기계적 결함(수치 오류, 음수 Level, 불변식 위반, 끝나지 않음)을 분류한다. "말이 되는 거동인가"는 자동으로 판단하지
 * 못한다 — 표는 결함만 잡고 지표를 함께 보여 사람이 읽게 한다.
 */

export interface ExtremeParam {
  name: string
  /** 폼의 허용 범위 */
  min: number
  max: number
  integer?: boolean
}

export type ExtremeLevel = 'min' | 'max' | 'zero' | 'x10' | 'x0.1'

export const EXTREME_LEVEL_LABEL: Record<ExtremeLevel, string> = { min: '최소', max: '최대', zero: '0', x10: '×10', 'x0.1': '×0.1' }
export const EXTREME_LEVELS: ExtremeLevel[] = ['min', 'max', 'zero', 'x10', 'x0.1']

export interface ExtremeCase {
  name: string
  value: number
  /** 이 값이 해당하는 수준들(같은 값이면 하나로 합친다) */
  levels: ExtremeLevel[]
  /** 허용 범위 안인가(경계 포함). 범위 안의 오류는 모델 결함, 범위 밖의 오류는 정보다 */
  inRange: boolean
}

/**
 * 시험할 값의 목록. 파라미터마다 최소·최대·0·현재 값의 ×10·×0.1을 만들고, 값이 같으면 하나로 합친다(수준 이름은 모두 남김).
 * 정수 파라미터는 반올림한다. 범위 안인지는 이름이 아니라 실제 값으로 가른다(예: 0이 허용 범위의 최소면 범위 안).
 */
export function planExtremes(params: ExtremeParam[], base: Record<string, number>): ExtremeCase[] {
  const out: ExtremeCase[] = []
  for (const p of params) {
    const current = base[p.name] ?? 0
    // 0.1 × 0.1 = 0.010000000000000002 같은 부동소수 잡음이 화면에 보이지 않도록 유효숫자 12자리로 맞춘다.
    const fit = (v: number) => (p.integer ? Math.round(v) : Number(v.toPrecision(12)))
    const wanted: [ExtremeLevel, number][] = [['min', p.min], ['max', p.max], ['zero', 0], ['x10', fit(current * 10)], ['x0.1', fit(current * 0.1)]]
    const byValue = new Map<number, ExtremeCase>()
    for (const [level, raw] of wanted) {
      const value = Object.is(raw, -0) ? 0 : raw
      const existing = byValue.get(value)
      if (existing) existing.levels.push(level)
      else byValue.set(value, { name: p.name, value, levels: [level], inRange: value >= p.min && value <= p.max })
    }
    out.push(...byValue.values())
  }
  return out
}

export type CellStatus = 'pass' | 'warn' | 'fail' | 'info'

export interface ExtremeCell {
  case: ExtremeCase
  status: CellStatus
  /** 판정의 이유(통과면 비어 있음) */
  reasons: string[]
  /** 수치 오류·모델 오류의 메시지와 위치 */
  error: { message: string; variable?: string; time?: number } | null
  /** 음수가 된 Level(최솟값과 처음 시각) */
  negativeLevels: { name: string; min: number; time: number }[]
  /** 허용 오차를 넘은 불변식 이름 */
  violatedInvariants: string[]
  /** 종료 시각 안에 끝났는가(완료 지표를 알 때만 의미 있다). 모르면 null */
  finished: boolean | null
  /** 오류 없이 끝난 실행의 지표. 오류면 null */
  kpis: KpiValues | null
}

export interface ExtremeInput {
  model: CompiledModel
  /** 대상 시나리오의 유효 파라미터 */
  base: Record<string, number>
  options: { end?: number; dt?: number; seed?: number }
  kpis: KpiSpec[]
  /** "끝났는가"를 판단하는 지표 id(null이면 끝나지 않음). 기본 `completionDay` */
  completionKpiId?: string
  /** Level 음수 허용 오차(기본 1e-6) */
  levelTolerance?: number
}

const RANK: Record<CellStatus, number> = { pass: 0, info: 1, warn: 2, fail: 3 }

/** 한 값으로 실행해 판정한다. 수치·모델 오류는 던지지 않고 판정에 담는다. */
export function runExtremeCase(input: ExtremeInput, c: ExtremeCase): ExtremeCell {
  const tol = input.levelTolerance ?? 1e-6
  const params = { ...input.base, [c.name]: c.value }
  let result: RunResult
  try {
    result = new Simulation(input.model, { overrides: params, ...input.options }).run()
  } catch (e) {
    if (e instanceof SimulationError || e instanceof ModelError) {
      const error = { message: e.message, ...(e instanceof SimulationError ? { variable: e.variable, time: e.time } : e.variable !== undefined ? { variable: e.variable } : {}) }
      return {
        case: c,
        status: c.inRange ? 'fail' : 'info',
        reasons: [c.inRange ? `허용 범위 안의 값에서 오류: ${e.message}` : `허용 범위 밖의 값에서 오류(예상된 거동일 수 있음): ${e.message}`],
        error,
        negativeLevels: [],
        violatedInvariants: [],
        finished: null,
        kpis: null
      }
    }
    throw e
  }

  const negativeLevels: ExtremeCell['negativeLevels'] = []
  for (const name of Object.keys(input.model.def.levels)) {
    const s = result.series[name]
    if (!s) continue
    let min = Infinity
    let at = 0
    for (let i = 0; i < s.length; i++) if ((s[i] as number) < min) { min = s[i] as number; at = result.time[i] as number }
    if (min < -tol) negativeLevels.push({ name, min, time: at })
  }
  const violatedInvariants = checkInvariants(input.model.def, result, params).filter((x) => x.violated).map((x) => x.label)
  const kpis = computeKpis(input.kpis, result, params)
  const completionId = input.completionKpiId ?? 'completionDay'
  const finished = completionId in kpis ? kpis[completionId] !== null : null

  const reasons: string[] = []
  let status: CellStatus = 'pass'
  const raise = (s: CellStatus, reason: string) => {
    if (RANK[s] > RANK[status]) status = s
    reasons.push(reason)
  }
  for (const n of negativeLevels) raise('warn', `${n.name}이(가) 음수가 됨(최솟값 ${n.min.toPrecision(4)}, ${n.time}일)`)
  for (const v of violatedInvariants) raise('warn', `불변식 위반: ${v}`)
  if (finished === false) raise(c.inRange ? 'warn' : 'info', '종료 시각 안에 끝나지 않음')
  return { case: c, status, reasons, error: null, negativeLevels, violatedInvariants, finished, kpis }
}

/** 실행하지 않고 값만 만들어 결과를 다시 볼 때(셀 상세) 쓴다. 오류면 던진다. */
export function simulateExtreme(input: Pick<ExtremeInput, 'model' | 'base' | 'options'>, c: ExtremeCase): RunResult {
  return new Simulation(input.model, { overrides: { ...input.base, [c.name]: c.value }, ...input.options }).run()
}

export interface ExtremeSummary {
  counts: Record<CellStatus, number>
  /** 실패한 셀(범위 안의 오류) */
  failures: ExtremeCell[]
}

export function summarizeExtremes(cells: ExtremeCell[]): ExtremeSummary {
  const counts: Record<CellStatus, number> = { pass: 0, warn: 0, fail: 0, info: 0 }
  for (const c of cells) counts[c.status]++
  return { counts, failures: cells.filter((c) => c.status === 'fail') }
}
