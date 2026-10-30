import { describe, expect, it } from 'vitest'
import { brooksModel, integratedProjectModel } from '@spd/models'
import { compileModel, runModel, SimulationError, type ModelDef, type RunResult } from '@spd/sd-engine'
import {
  checkConservation,
  checkDtSensitivity,
  checkNegativeLevels,
  checkNumeric,
  checkStatic,
  checkUnits,
  countStatuses,
  lastOf,
  runStructureChecks,
  type KpiSpec
} from '../src'

/** 테스트용 모델. 단위를 모두 갖춘 올바른 모델에서 시작해 한 곳씩 깨뜨린다. */
type Parts = {
  constants?: Record<string, { value: number; unit?: string }>
  levels?: Record<string, { init: string; inflows?: string[]; outflows?: string[]; unit?: string }>
  rates?: Record<string, { expr: string; unit?: string }>
  auxiliaries?: Record<string, { expr: string; unit?: string }>
  outputs?: string[]
  invariants?: ModelDef['invariants']
  time?: Partial<ModelDef['time']>
}
const def = (p: Parts = {}): ModelDef => ({
  meta: { id: 't', name: 't', version: 1, timeUnit: 'day' },
  time: { start: 0, end: 10, dt: 0.25, ...p.time },
  constants: p.constants ?? { total: { value: 100, unit: '개' }, k: { value: 0.1, unit: '1/일' } },
  levels: Object.fromEntries(Object.entries(p.levels ?? { a: { init: 'total', outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move'], unit: '개' } }).map(([n, l]) => [n, { init: l.init, inflows: l.inflows ?? [], outflows: l.outflows ?? [], ...(l.unit ? { unit: l.unit } : {}) }])),
  rates: p.rates ?? { move: { expr: 'k * a', unit: '개/일' } },
  auxiliaries: p.auxiliaries ?? {},
  tables: {},
  outputs: p.outputs ?? ['a', 'b'],
  ...(p.invariants ? { invariants: p.invariants } : {})
})
const run = (d: ModelDef, overrides: Record<string, number> = {}) => runModel(compileModel(d), { overrides })
const inv = (tolerance = 1e-9): ModelDef['invariants'] => [{ name: 'mass', label: 'a + b = total', lhs: [{ variable: 'a', coef: 1 }, { variable: 'b', coef: 1 }], rhs: [{ variable: 'total', coef: 1 }], tolerance }]

describe('S1 단위 일관성', () => {
  it('올바른 모델은 통과한다', () => {
    const f = checkUnits(def())
    expect(f).toMatchObject({ id: 'S1', title: '단위 일관성', status: 'pass', items: [] })
    expect(f.notChecked.join(' ')).toContain('숫자 리터럴은 단위 미정')
    expect(f.checked).toContain('수식의 항별 단위 일치')
  })
  it('단위가 없는 변수는 주의로 찾는다(상수·Level·Rate·Auxiliary 모두)', () => {
    const f = checkUnits(def({ constants: { total: { value: 100 }, k: { value: 0.1, unit: '1/일' } }, levels: { a: { init: 'total', outflows: ['move'] }, b: { init: '0', inflows: ['move'], unit: '개' } }, rates: { move: { expr: 'k * a', unit: '개/일' } }, auxiliaries: { x: { expr: 'a + b' } } }))
    expect(f.status).toBe('warn')
    const items = f.items.join('\n')
    for (const v of ['total', 'a', 'x']) expect(items).toContain(`단위 없음: ${v}`)
    expect(items).not.toContain('단위 없음: move')
  })
  it('빈 문자열 단위도 없는 것으로 본다', () => {
    expect(checkUnits(def({ constants: { total: { value: 100, unit: ' ' }, k: { value: 0.1, unit: '1/일' } } })).items.join()).toContain('total')
  })
  it('Level에 연결된 흐름의 단위가 Level 단위/일이 아니면 실패다', () => {
    const f = checkUnits(def({ rates: { move: { expr: 'k * a', unit: '개' } } })) // 개/일이어야 한다
    expect(f.status).toBe('fail')
    expect(f.items.join('\n')).toContain("'개/일'이어야")
    expect(f.items.join('\n')).toContain("'move'")
  })
  it('인원(명)은 맨데이/일(= 명)이므로 맨데이 Level에 연결할 수 있다', () => {
    const d = def({
      constants: { crew: { value: 5, unit: '명' } },
      levels: { cum: { init: '0', inflows: ['total_crew'], unit: '맨데이' } },
      auxiliaries: { total_crew: { expr: 'crew', unit: '명' } },
      rates: {},
      outputs: ['cum']
    })
    expect(checkUnits(d).status).toBe('pass')
    expect(checkUnits({ ...d, levels: { cum: { init: '0', inflows: ['total_crew'], outflows: [], unit: '개' } } }).status).toBe('fail')
  })
  it('수식 안의 단위 불일치(명 + 일)를 실패로 찾는다 — 예전 부분 점검은 놓치던 것', () => {
    const d = def({ constants: { crew: { value: 5, unit: '명' }, tau: { value: 3, unit: '일' } }, auxiliaries: { mix: { expr: 'crew + tau', unit: '명' } }, rates: {}, levels: { a: { init: '0', inflows: [], outflows: [], unit: '개' } }, outputs: ['mix'] })
    const f = checkUnits(d)
    expect(f.status).toBe('fail')
    expect(f.items.join('\n')).toContain('명 ≠ 일')
    expect(f.summary).toContain('단위가 맞지 않는 곳 1개')
  })
  it('단위가 없는 변수를 쓰는 수식은 검사하지 못해 주의로 알린다(오류로 단정하지 않는다)', () => {
    const d = def({ constants: { crew: { value: 5 } }, auxiliaries: { twice: { expr: 'crew * 2', unit: '명' } }, rates: {}, levels: { a: { init: '0', inflows: [], outflows: [], unit: '개' } }, outputs: ['twice'] })
    const f = checkUnits(d)
    expect(f.status).toBe('warn')
    expect(f.items.join('\n')).toContain('검사하지 못했습니다')
  })
  it('내장 모델은 통과한다(모든 변수에 단위, 수식 안의 단위도 맞음)', () => {
    expect(checkUnits(brooksModel).status).toBe('pass')
    expect(checkUnits(integratedProjectModel).status).toBe('pass')
  })
})

describe('S2 보존 법칙', () => {
  it('선언이 없으면 정보', () => {
    const d = def()
    expect(checkConservation(d, run(d), {})).toMatchObject({ id: 'S2', status: 'info' })
  })
  it('성립하면 통과하고 최대 위반을 알린다', () => {
    const d = def({ invariants: inv() })
    const f = checkConservation(d, run(d), {})
    expect(f.status).toBe('pass')
    expect(f.summary).toContain('1개')
  })
  it('깨진 모델(유입이 유출의 두 배)의 위반을 검출한다', () => {
    const d = def({ levels: { a: { init: 'total', outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move2'], unit: '개' } }, rates: { move: { expr: 'k * a', unit: '개/일' }, move2: { expr: '2 * k * a', unit: '개/일' } }, invariants: inv() })
    const f = checkConservation(d, run(d), {})
    expect(f.status).toBe('fail')
    expect(f.items[0]).toContain('a + b = total')
    expect(f.items[0]).toMatch(/처음 [\d.]+일/)
  })
  it('기록하지 않은 변수가 있으면 주의로 알린다', () => {
    const d = def({ invariants: inv() })
    const f = checkConservation(d, runModel(compileModel(d), { record: ['a'] }), {})
    expect(f.status).toBe('warn')
    expect(f.items[0]).toContain('기록되지 않은 변수(b)')
  })
  it('두 실제 모델의 선언된 불변식이 성립한다', () => {
    const b = checkConservation(brooksModel, runModel(compileModel(brooksModel), {}), {})
    const i = checkConservation(integratedProjectModel, runModel(compileModel(integratedProjectModel), {}), {})
    expect([b.status, i.status]).toEqual(['pass', 'pass'])
    expect(i.summary).toContain('4개')
  })
})

describe('S3 Level 음수', () => {
  it('음수가 되는 Level을 최솟값과 시각으로 찾는다', () => {
    // a는 1에서 시작해 일정한 유출 0.5로 줄어 2일에 0, 이후 음수
    const d = def({ constants: {}, levels: { a: { init: '1', outflows: ['drain'], unit: '개' } }, rates: { drain: { expr: '0.5', unit: '개/일' } }, outputs: ['a'] })
    const f = checkNegativeLevels(d, run(d))
    expect(f.status).toBe('fail')
    expect(f.items).toHaveLength(1)
    expect(f.items[0]).toContain('a: 최솟값 -4')
  })
  it('허용 오차 안의 부동소수 잡음은 통과', () => {
    const d = def()
    expect(checkNegativeLevels(d, run(d)).status).toBe('pass')
    const r = run(d)
    ;(r.series['a'] as Float64Array)[3] = -1e-9
    expect(checkNegativeLevels(d, r).status).toBe('pass')
    expect(checkNegativeLevels(d, r, 1e-12).status).toBe('fail')
  })
  it('두 실제 모델의 기본 실행은 통과한다', () => {
    expect(checkNegativeLevels(brooksModel, runModel(compileModel(brooksModel), {})).status).toBe('pass')
    expect(checkNegativeLevels(integratedProjectModel, runModel(compileModel(integratedProjectModel), {})).status).toBe('pass')
  })
})

describe('S4 적분 간격 민감도', () => {
  /** a는 지수 감쇠 dA/dt = −k·a. 지표는 종료 시각의 a. Euler 오차는 dt에 비례한다 */
  const decay = (dt: number, k = 1, end = 1) => compileModel(def({ constants: { total: { value: 1, unit: '개' }, k: { value: k, unit: '1/일' } }, levels: { a: { init: 'total', outflows: ['out'], unit: '개' } }, rates: { out: { expr: 'k * a', unit: '개/일' } }, outputs: ['a'], time: { end, dt } }))
  const kpi: KpiSpec = { id: 'final', label: '최종 a', unit: '', better: 'none', group: 'quality', decimals: 4, compute: (r: RunResult) => lastOf(r, 'a') }
  const check = (dt: number) => checkDtSensitivity({ model: decay(dt), params: {}, options: {}, kpis: [kpi] })

  it('dt가 충분히 작으면 통과한다(상대 변화 1% 이하)', () => {
    const f = check(0.01) // 0.99^100 vs 0.995^200
    expect(f.status).toBe('pass')
    expect(f.summary).toContain('0.0')
  })
  it('중간이면 주의(1% 초과 5% 이하)', () => {
    const f = check(0.1) // 0.9^10 = 0.34868 vs 0.95^20 = 0.35849 → 2.8%
    expect(f.status).toBe('warn')
    expect(f.items[0]).toMatch(/상대 변화 2\.\d+%/)
  })
  it('dt가 너무 크면 실패한다(5% 초과)', () => {
    const f = check(0.5) // 0.5^2 vs 0.75^4
    expect(f.status).toBe('fail')
    expect(f.summary).toContain('최대')
  })
  it('경계: 통과·주의의 기준은 1%, 주의·실패의 기준은 5%이다', () => {
    // dt = 0.02: 0.98^50 = 0.36417, 0.99^100 = 0.36603 → 0.51% → 통과
    expect(check(0.02).status).toBe('pass')
    // dt = 0.2: 0.8^5 = 0.32768 vs 0.9^10 = 0.34868 → 6.0% → 실패
    expect(check(0.2).status).toBe('fail')
    // dt = 0.05: 0.95^20 = 0.35849 vs 0.975^40 = 0.36410 → 1.5% → 주의
    expect(check(0.05).status).toBe('warn')
  })
  it('한쪽에서만 지표를 계산할 수 있으면 실패다', () => {
    const flaky: KpiSpec = { ...kpi, id: 'flaky', label: '끝났는가', compute: (r) => (r.meta.dt >= 0.2 ? null : 1) }
    const f = checkDtSensitivity({ model: decay(0.2), params: {}, options: {}, kpis: [flaky] })
    expect(f.status).toBe('fail')
    expect(f.items.join('\n')).toContain('끝났는가')
  })
  it('지표가 없으면 정보, 실행이 수치 오류로 멈추면 실패', () => {
    expect(checkDtSensitivity({ model: decay(0.1), params: {}, options: {}, kpis: [] }).status).toBe('info')
    const exploding = compileModel(def({ constants: { total: { value: 1, unit: '개' } }, levels: { a: { init: 'total', inflows: ['grow'], unit: '개' } }, rates: { grow: { expr: 'a / (5 - TIME)', unit: '개/일' } }, outputs: ['a'], time: { end: 10, dt: 0.25 } }))
    const f = checkDtSensitivity({ model: exploding, params: {}, options: {}, kpis: [kpi] })
    expect(f.status).toBe('fail')
    expect(f.summary).toContain('중단')
  })
  it('두 실제 모델은 통과한다(dt 0.25)', () => {
    const done = (rate: string, time: string): KpiSpec => ({ id: 'done', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, rate) <= 1e-6 ? lastOf(r, time) : null) })
    expect(checkDtSensitivity({ model: compileModel(brooksModel), params: {}, options: {}, kpis: [done('requirements', 'completion_time')] }).status).toBe('pass')
    const integrated: KpiSpec = { id: 'done', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null) }
    expect(checkDtSensitivity({ model: compileModel(integratedProjectModel), params: {}, options: {}, kpis: [integrated] }).status).toBe('pass')
  })
})

describe('S5 구조 정적 점검', () => {
  it('올바른 모델은 통과한다', () => {
    expect(checkStatic(compileModel(def()))).toMatchObject({ id: 'S5', status: 'pass', items: [] })
  })
  it('쓰이지 않는 상수·보조 변수를 찾는다', () => {
    const d = def({ constants: { total: { value: 100, unit: '개' }, k: { value: 0.1, unit: '1/일' }, spare: { value: 1, unit: '개' } }, auxiliaries: { dead: { expr: 'a + b', unit: '개' } } })
    const f = checkStatic(compileModel(d))
    expect(f.status).toBe('warn')
    expect(f.items.join('\n')).toContain('spare: 쓰이지 않는 상수')
    expect(f.items.join('\n')).toContain('dead: 쓰이지 않는 보조 변수')
  })
  it('출력이나 화면이 읽는 변수는 쓰이는 것으로 본다', () => {
    const d = def({ constants: { total: { value: 100, unit: '개' }, k: { value: 0.1, unit: '1/일' }, spare: { value: 1, unit: '개' } }, auxiliaries: { shown: { expr: 'a + b', unit: '개' } }, outputs: ['a', 'b'] })
    expect(checkStatic(compileModel(d)).items.join('\n')).toContain('shown')
    const f = checkStatic(compileModel(d), ['shown', 'spare'])
    expect(f.status).toBe('pass')
    const asOutput = checkStatic(compileModel({ ...d, outputs: ['a', 'b', 'shown'] }), ['spare'])
    expect(asOutput.status).toBe('pass')
  })
  it('SMOOTH·DELAY의 입력으로만 쓰는 변수도 쓰이는 것이다', () => {
    const d = def({ constants: { total: { value: 100, unit: '개' }, k: { value: 0.1, unit: '1/일' }, lag: { value: 3, unit: '일' } }, auxiliaries: { smoothed: { expr: 'SMOOTH(a, lag)', unit: '개' } }, outputs: ['smoothed', 'b'] })
    const f = checkStatic(compileModel(d))
    expect(f.items.join('\n')).not.toContain('lag')
    expect(f.items.join('\n')).not.toContain('a:')
  })
  it('어디에도 이어지지 않는 Rate를 찾는다', () => {
    const d = def({ rates: { move: { expr: 'k * a', unit: '개/일' }, orphan: { expr: 'k', unit: '개/일' } } })
    const f = checkStatic(compileModel(d))
    expect(f.items.join('\n')).toContain('orphan: 어떤 Level·수식·출력에도 이어지지 않는 Rate')
    expect(f.items.join('\n')).not.toContain('move:')
  })
  it('유입·유출이 없는 Level을 찾는다', () => {
    const d = def({ levels: { a: { init: 'total', outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move'], unit: '개' }, frozen: { init: '5', unit: '개' } } })
    expect(checkStatic(compileModel(d)).items.join('\n')).toContain('frozen: 유입·유출이 없는 Level')
  })
  it('두 실제 모델은 경고가 없다', () => {
    expect(checkStatic(compileModel(brooksModel)).status).toBe('pass')
    expect(checkStatic(compileModel(integratedProjectModel)).status).toBe('pass')
  })
})

describe('S6 수치 건전성', () => {
  it('올바른 모델은 통과한다', () => {
    const d = def()
    expect(checkNumeric(d, run(d)).status).toBe('pass')
  })
  it('Level 초기값이 음수이면 주의', () => {
    const d = def({ levels: { a: { init: '-3', outflows: ['move'], unit: '개' }, b: { init: '0', inflows: ['move'], unit: '개' } } })
    const f = checkNumeric(d, run(d))
    expect(f.status).toBe('warn')
    expect(f.items[0]).toContain('a: Level 초기값이 음수(-3)')
  })
  it('시각 0의 값이 유한하지 않으면 실패(실행 결과를 직접 확인)', () => {
    const d = def()
    const r = run(d)
    ;(r.series['move'] as Float64Array)[0] = NaN
    const f = checkNumeric(d, r)
    expect(f.status).toBe('fail')
    expect(f.items[0]).toContain('move: 시각 0의 값이 NaN')
  })
  it('0으로 나누는 모델은 시뮬레이션이 오류로 멈춘다(S6이 아니라 실행 오류)', () => {
    const d = def({ rates: { move: { expr: 'k * a * a / (a - 100)', unit: '개/일' } } })
    expect(() => run(d)).toThrow(SimulationError)
  })
})

describe('전체 점검', () => {
  const kpi: KpiSpec = { id: 'final', label: '최종 b', unit: '', better: 'none', group: 'quality', decimals: 2, compute: (r) => lastOf(r, 'b') }
  it('올바른 모델은 여섯 점검이 모두 통과한다', () => {
    const rep = runStructureChecks({ model: compileModel(def({ invariants: inv(), time: { dt: 0.01, end: 5 } })), params: {}, options: {}, kpis: [kpi] })
    expect(rep.runError).toBeNull()
    expect(rep.findings.map((f) => f.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
    expect(countStatuses(rep.findings)).toEqual({ pass: 6, warn: 0, fail: 0, info: 0 })
  })
  it('모든 점검이 "확인한 것"과 "확인하지 못한 것"을 함께 낸다', () => {
    const rep = runStructureChecks({ model: compileModel(def()), params: {}, options: {}, kpis: [kpi] })
    for (const f of rep.findings) {
      expect(f.checked.length, f.id).toBeGreaterThan(10)
      expect(f.notChecked.length, f.id).toBeGreaterThan(0)
      expect(f.title.length).toBeGreaterThan(0)
    }
  })
  it('실행이 멈추면 실행이 필요한 점검은 실패로 알리고 나머지는 그대로 한다', () => {
    const d = def({ rates: { move: { expr: 'k * a * a / (a - 100)', unit: '개/일' } }, invariants: inv() })
    const rep = runStructureChecks({ model: compileModel(d), params: {}, options: {}, kpis: [kpi] })
    expect(rep.runError).toContain('0으로 나누기')
    const by = Object.fromEntries(rep.findings.map((f) => [f.id, f]))
    expect(by['S1']!.status).toBe('pass')
    expect(by['S5']!.status).toBe('pass')
    for (const id of ['S2', 'S3', 'S4', 'S6']) {
      expect(by[id]!.status, id).toBe('fail')
      expect(by[id]!.summary, id).toContain('중단')
    }
  })
  it('대상 시나리오의 파라미터를 쓴다(상수를 바꾸면 불변식의 총량도 따라간다)', () => {
    const rep = runStructureChecks({ model: compileModel(def({ invariants: inv(), time: { dt: 0.01, end: 5 } })), params: { total: 250 }, options: {}, kpis: [kpi] })
    expect(rep.findings.find((f) => f.id === 'S2')!.status).toBe('pass')
  })
  it('두 실제 모델은 여섯 점검이 모두 통과한다(알려진 경고 없음)', () => {
    const brooks: KpiSpec = { id: 'done', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, 'requirements') <= 1e-6 ? lastOf(r, 'completion_time') : null) }
    const integrated: KpiSpec = { id: 'done', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null) }
    for (const [m, k] of [[brooksModel, brooks], [integratedProjectModel, integrated]] as const) {
      const rep = runStructureChecks({ model: compileModel(m), params: {}, options: {}, kpis: [k] })
      expect(rep.runError).toBeNull()
      expect(countStatuses(rep.findings), m.meta.id).toEqual({ pass: 6, warn: 0, fail: 0, info: 0 })
    }
  })
  it('통합 모델은 다른 시나리오(인원 상한 1명, 초기 인원 0명)에서도 중단 없이 점검된다', () => {
    const k: KpiSpec = { id: 'done', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => (lastOf(r, 'ctl_completion_rate') === 0 ? lastOf(r, 'ctl_completion_time') : null) }
    for (const params of [{ max_staff: 1 }, { initial_pros: 0 }, { total_tasks: 1500 }] as Record<string, number>[]) {
      const rep = runStructureChecks({ model: compileModel(integratedProjectModel), params, options: {}, kpis: [k] })
      expect(rep.runError).toBeNull()
      expect(rep.findings.find((f) => f.id === 'S2')!.status, JSON.stringify(params)).toBe('pass')
      expect(rep.findings.find((f) => f.id === 'S3')!.status, JSON.stringify(params)).toBe('pass')
    }
  })
})
