import { describe, expect, it } from 'vitest'
import { checkInvariants, compileModel, runModel, type ModelDef, type RunResult } from '@spd/sd-engine'
import { defectChainModel, learningCurveModel, personnelChainModel, productionReworkModel, rayleighModel } from '../src'

/**
 * 기본 구조 라이브러리(MDL-03, 책 3.4~3.5). 각 구조는 닫힌 형식의 해나 정확한 관계가 있어 그것으로 확인한다.
 * 책에 이 모델들의 수치 결과는 없으므로 검증은 책이 준 방정식(그림 3.36·3.37·3.38·3.40·3.56~3.63)과의 일치다.
 */
const run = (def: ModelDef, overrides: Record<string, number> = {}, options: { end?: number; dt?: number } = {}): RunResult => runModel(compileModel(def), { overrides, ...options })
const series = (r: RunResult, name: string) => r.series[name] as Float64Array
const last = (r: RunResult, name: string) => series(r, name)[series(r, name).length - 1] as number
const at = (r: RunResult, name: string, day: number) => {
  const i = r.time.findIndex((t) => Math.abs(t - day) < 1e-9)
  if (i < 0) throw new Error(`시각 ${day}가 기록에 없습니다`)
  return series(r, name)[i] as number
}
const maxOf = (r: RunResult, name: string) => Math.max(...series(r, name))
const argMax = (r: RunResult, name: string) => r.time[series(r, name).indexOf(maxOf(r, name))] as number

const ALL: [string, ModelDef][] = [
  ['production-rework', productionReworkModel],
  ['learning-curve', learningCurveModel],
  ['rayleigh', rayleighModel],
  ['personnel-chain', personnelChainModel],
  ['defect-chain', defectChainModel]
]

describe('모든 구조 모델', () => {
  it.each(ALL)('%s: 컴파일되고 id·version이 맞으며 기본 설정으로 끝까지 실행된다', (id, def) => {
    expect(def.meta.id).toBe(id)
    expect(def.meta.version).toBe(1)
    const r = run(def)
    expect(r.meta.completed).toBe(true)
    expect(last(r, 'completion_time')).toBeGreaterThan(0)
  })

  it.each(ALL)('%s: 선언한 불변식이 여러 조건에서 성립한다', (_id, def) => {
    expect(def.invariants?.length ?? 0).toBeGreaterThanOrEqual(def === rayleighModel ? 0 : 1)
    const variants: Record<string, number>[] = [{}]
    const first = Object.keys(def.constants)[0] as string
    variants.push({ [first]: (def.constants[first]?.value as number) * 2 }, { [first]: (def.constants[first]?.value as number) / 2 })
    for (const o of variants) {
      const r = run(def, o)
      for (const c of checkInvariants(def, r, o)) {
        expect(c.missing, c.name).toEqual([])
        expect(c.violated, `${c.name} 최대 위반 ${c.maxViolation} (${JSON.stringify(o)})`).toBe(false)
      }
    }
  })

  it.each(ALL)('%s: 같은 입력은 비트 단위로 같은 결과를 낸다', (_id, def) => {
    const a = run(def)
    const b = run(def)
    for (const name of Object.keys(a.series)) expect(Array.from(series(b, name))).toEqual(Array.from(series(a, name)))
  })
})

describe('생산과 재작업 (3.4.7)', () => {
  it('처음부터 모두 올바르면(f=1) 재작업 없이 작업 규모 ÷ (인원×생산성) = 80일에 끝나고 공수는 인원×80', () => {
    const r = run(productionReworkModel, { fraction_correct: 1 })
    expect(last(r, 'completion_time')).toBeCloseTo(80, 0)
    expect(maxOf(r, 'undiscovered_rework')).toBe(0)
    expect(last(r, 'cum_effort')).toBeCloseTo(10 * last(r, 'completion_time'), 9)
  })

  it('재작업을 곧바로 발견하면(지연 1일) 총 작업이 job/f = 500 통과분이라 100일에 가깝다', () => {
    const t = last(run(productionReworkModel, { discovery_delay: 1 }), 'completion_time')
    expect(t).toBeGreaterThan(100)
    expect(t).toBeLessThan(112)
  })

  it('올바른 비율이 낮을수록, 발견이 늦을수록 늦게 끝나고 미발견 재작업의 정점이 커진다', () => {
    const t = (o: Record<string, number>) => last(run(productionReworkModel, o), 'completion_time')
    expect(t({ fraction_correct: 0.6 })).toBeGreaterThan(t({ fraction_correct: 0.8 }))
    expect(t({ fraction_correct: 0.8 })).toBeGreaterThan(t({ fraction_correct: 0.95 }))
    expect(t({ discovery_delay: 60 })).toBeGreaterThan(t({ discovery_delay: 20 }))
    expect(maxOf(run(productionReworkModel, { discovery_delay: 60 }), 'undiscovered_rework')).toBeGreaterThan(maxOf(run(productionReworkModel), 'undiscovered_rework'))
  })

  it('일을 하는 동안 개발률은 인원×생산성이고 올바른 부분은 그 f배이다', () => {
    const r = run(productionReworkModel)
    expect(at(r, 'task_development', 10)).toBeCloseTo(5, 12)
    expect(at(r, 'correct_task_development', 10)).toBeCloseTo(4, 12)
    expect(at(r, 'incorrect_task_development', 10)).toBeCloseTo(1, 12)
  })

  it('완료하면 올바른 일이 작업 규모에서 허용 오차 안으로 같다', () => {
    const r = run(productionReworkModel)
    expect(400 - last(r, 'correct_tasks')).toBeLessThanOrEqual(0.5)
  })
})

describe('학습곡선 (3.4.9)', () => {
  it('배율이 일정하면(시작=끝=1) 학습 없이 job ÷ (인원×공칭 생산성) = 80일에 끝난다', () => {
    const r = run(learningCurveModel, { initial_efficiency: 1, peak_efficiency: 1 })
    expect(last(r, 'completion_time')).toBeCloseTo(80, 0)
    expect(maxOf(r, 'learning_curve')).toBe(1)
  })

  it('진행률 0에서 시작 배율, 진행률 1에서 학습을 마친 배율이고 그 사이는 S자로 늘어난다', () => {
    const r = run(learningCurveModel)
    const lc = series(r, 'learning_curve')
    expect(lc[0]).toBeCloseTo(0.5, 12)
    expect(last(r, 'learning_curve')).toBeCloseTo(1.2, 12)
    for (let i = 1; i < lc.length; i++) expect(lc[i] as number).toBeGreaterThanOrEqual((lc[i - 1] as number) - 1e-12)
    // 진행률 50%에서 두 값의 가운데(S자의 대칭)
    const pc = series(r, 'percentage_complete')
    const i = pc.findIndex((v) => v >= 0.5)
    expect(lc[i]).toBeCloseTo(0.85, 2)
    // 처음과 끝은 완만하고 가운데가 가파르다
    const at = (p: number) => pc.findIndex((v) => v >= p)
    const slope = (p1: number, p2: number) => ((lc[at(p2)] as number) - (lc[at(p1)] as number)) / (p2 - p1)
    expect(slope(0.45, 0.55)).toBeGreaterThan(slope(0.02, 0.12) * 2)
    expect(slope(0.45, 0.55)).toBeGreaterThan(slope(0.88, 0.98) * 2)
  })

  it('시작 배율이 낮을수록(학습할 것이 많을수록) 늦게 끝난다', () => {
    const t = (o: Record<string, number>) => last(run(learningCurveModel, o), 'completion_time')
    expect(t({ initial_efficiency: 0.3 })).toBeGreaterThan(t({ initial_efficiency: 0.7 }))
    expect(t({ initial_efficiency: 0.5 })).toBeGreaterThan(80)
  })

  it('생산성 = 공칭 생산성 × 학습곡선', () => {
    const r = run(learningCurveModel)
    expect(at(r, 'productivity', 40)).toBeCloseTo(0.5 * at(r, 'learning_curve', 40), 12)
  })
})

describe('Rayleigh 곡선 생성기 (3.4.10)', () => {
  const K = 4000
  const b = 0.0001
  const analytic = (t: number) => K * (1 - Math.exp(-(b * t * t) / 2))

  it('누적 공수가 닫힌 형식의 해 K·(1 − exp(−b·t²/2))를 따른다(Euler 오차 0.3% 이내)', () => {
    const r = run(rayleighModel)
    for (const t of [25, 50, 100, 150, 200, 300, 400]) expect(Math.abs(at(r, 'cum_effort', t) - analytic(t)) / K, `t=${t}`).toBeLessThan(0.003)
  })

  it('dt를 줄이면 해에 더 가까워진다(1차 정확도)', () => {
    const err = (dt: number) => Math.abs(at(run(rayleighModel, {}, { dt }), 'cum_effort', 100) - analytic(100))
    expect(err(0.05)).toBeLessThan(err(0.25) / 3)
  })

  it('인력 곡선의 정점은 t = 1/√b = 100일이고 높이는 K·b·t·e^(−1/2)', () => {
    const r = run(rayleighModel)
    expect(Math.abs(argMax(r, 'effort_rate') - 100)).toBeLessThanOrEqual(2)
    expect(maxOf(r, 'effort_rate')).toBeCloseTo(K * b * 100 * Math.exp(-0.5), 0)
  })

  it('99% 누적 시점은 √(2·ln100/b) ≈ 303.5일이고 완료 시각이 그것이다', () => {
    const r = run(rayleighModel)
    expect(last(r, 'completion_time')).toBeCloseTo(Math.sqrt((2 * Math.log(100)) / b), 0)
    // 완료 비율을 95%로 낮추면 √(2·ln20/b) ≈ 244.8일
    expect(last(run(rayleighModel, { completion_fraction: 0.95 }), 'completion_time')).toBeCloseTo(Math.sqrt((2 * Math.log(20)) / b), 0)
  })

  it('인력 증가 계수를 키우면 정점이 1/√b에 따라 앞당겨지고 높아진다', () => {
    const slow = run(rayleighModel, { manpower_buildup: 0.0001 })
    const fast = run(rayleighModel, { manpower_buildup: 0.0004 })
    expect(argMax(fast, 'effort_rate')).toBeLessThan(argMax(slow, 'effort_rate'))
    expect(Math.abs(argMax(fast, 'effort_rate') - 50)).toBeLessThanOrEqual(2)
    expect(maxOf(fast, 'effort_rate')).toBeGreaterThan(maxOf(slow, 'effort_rate'))
  })

  it('누적 공수는 추정 총 공수를 넘지 않고, 진행 환산(태스크)은 누적 공수 ÷ 태스크당 공수', () => {
    const r = run(rayleighModel)
    expect(maxOf(r, 'cum_effort')).toBeLessThan(K)
    expect(at(r, 'tasks_done', 100)).toBeCloseTo(at(r, 'cum_effort', 100) / 10, 12)
  })
})

describe('인력 체인 3단계 (3.5.3, 3.4.8)', () => {
  /** 승진·채용·이직을 거의 없앤 조건 */
  const frozen = { recruiting_per_day: 0, entry_period: 1e9, associate_period: 1e9, senior_tenure: 1e9 }

  it('체인이 정지하면 인원이 일정하고 완료는 job ÷ (공칭 생산성 × 생산성 환산 인원)이다', () => {
    const r = run(personnelChainModel, frozen, { end: 600 })
    const effective = 6 * 0.6 + 6 * 1 + 6 * 1.3 // 17.4
    expect(at(r, 'total_staff', 100)).toBeCloseTo(18, 4)
    expect(last(r, 'completion_time')).toBeCloseTo(5000 / (0.5 * effective), 0)
  })

  it('신입 단계는 d(E)/dt = 채용 − E/기간 이라 닫힌 형식 E(t) = rτ + (E0 − rτ)·e^(−t/τ)를 따른다', () => {
    const o = { job_size: 1e9, recruiting_per_day: 0.1 }
    const r = run(personnelChainModel, o, { end: 300 })
    const tau = 120
    const rate = 0.1
    for (const t of [50, 100, 200, 300]) {
      const exact = rate * tau + (6 - rate * tau) * Math.exp(-t / tau)
      expect(Math.abs(at(r, 'entry_staff', t) - exact) / exact, `t=${t}`).toBeLessThan(0.01)
    }
  })

  it('인원 보존: 세 단계 합 = 초기 + 누적 채용 − 누적 이직(승진은 이동일 뿐)', () => {
    const r = run(personnelChainModel)
    const total = (i: number) => (series(r, 'entry_staff')[i] as number) + (series(r, 'associate_staff')[i] as number) + (series(r, 'senior_staff')[i] as number)
    for (const i of [0, 100, 600, 1000, 1270]) expect(total(i)).toBeCloseTo(18 + (series(r, 'cum_recruited')[i] as number) - (series(r, 'cum_attrition')[i] as number), 9)
  })

  it('채용을 늘리면 선임이 아니라 신입이 먼저 늘고(체인의 지연), 일찍 끝난다', () => {
    const base = run(personnelChainModel)
    const more = run(personnelChainModel, { recruiting_per_day: 0.3 })
    expect(at(more, 'entry_staff', 60)).toBeGreaterThan(at(base, 'entry_staff', 60))
    expect(at(more, 'senior_staff', 60) - at(base, 'senior_staff', 60)).toBeLessThan(at(more, 'entry_staff', 60) - at(base, 'entry_staff', 60))
    expect(last(more, 'completion_time')).toBeLessThan(last(base, 'completion_time'))
  })

  it('완료하면 채용을 멈춘다', () => {
    const r = run(personnelChainModel)
    expect(last(r, 'recruiting_rate')).toBe(0)
  })
})

describe('결함 발생·검출·재작업 체인 (3.5.2)', () => {
  const total = 1.2 * 500 // 오류 밀도 × 작업 규모 = 600

  it('개발 완료는 작업 규모 ÷ (인원×생산성) = 125일, 오류 발생은 개발률 × 밀도(코플로)', () => {
    const r = run(defectChainModel)
    expect(last(r, 'completion_time')).toBeCloseTo(125, 0)
    expect(at(r, 'defect_generation_rate', 10)).toBeCloseTo(8 * 0.5 * 1.2, 12)
    expect(last(r, 'cum_generated')).toBeCloseTo(total, 6)
  })

  it('검출 효율 e: 검출 못 한 오류 = (1−e)·600, 검출해서 고친 오류 = e·600', () => {
    const r = run(defectChainModel, { detection_efficiency: 0.6 })
    expect(last(r, 'undetected_defects')).toBeCloseTo(0.4 * total, 6)
    expect(last(r, 'reworked_defects')).toBeCloseTo(0.6 * total, 3)
    expect(last(r, 'detected_defects')).toBeLessThan(1e-3)
  })

  it('양 끝: 검출 효율 0이면 모두 빠져나가고 1이면 모두 잡아 고친다', () => {
    const none = run(defectChainModel, { detection_efficiency: 0 })
    expect(last(none, 'undetected_defects')).toBeCloseTo(total, 6)
    expect(maxOf(none, 'detected_defects')).toBe(0)
    const all = run(defectChainModel, { detection_efficiency: 1 })
    expect(last(all, 'undetected_defects')).toBe(0)
    expect(last(all, 'reworked_defects')).toBeCloseTo(total, 3)
  })

  it('고치기까지의 지연이 길수록 검출한 오류가 더 쌓인다', () => {
    const slow = maxOf(run(defectChainModel, { rework_delay: 40 }), 'detected_defects')
    const fast = maxOf(run(defectChainModel, { rework_delay: 5 }), 'detected_defects')
    expect(slow).toBeGreaterThan(fast)
  })

  it('총 공수 = 개발 공수(인원×시간) + 고친 오류 × 오류당 공수', () => {
    const r = run(defectChainModel)
    expect(last(r, 'cum_effort')).toBeCloseTo(8 * last(r, 'completion_time') + 0.5 * last(r, 'reworked_defects'), 3)
  })
})
