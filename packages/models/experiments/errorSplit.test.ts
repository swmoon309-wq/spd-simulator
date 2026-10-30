import { describe, expect, it } from 'vitest'
import { compileModel, runModel, type RunResult } from '@spd/sd-engine'
import { integratedProjectAiModel } from '../src'

/**
 * 설계 10 7.2 실험: 오류 흐름을 구현/스펙으로 나눈 변형이 정책 순위를 바꾸는가.
 * 실행: `SPD_EXPERIMENT=1 npx vitest run experiments --silent=false` (기본 시험에서는 건너뛴다, 약 17초).
 * 변형은 이 파일 안에서만 만든다(내장 모델은 건드리지 않는다). spec_split=0이면 단일 흐름.
 * 스펙 오류는 QA(코드 검토 기반)를 거치지 않고 곧바로 QA 통과 풀(err_escaped)로 들어가 시험에서 늦게 발견된다.
 * 스펙 검토 투자는 스펙 오류 발생을 줄이며, 단일 흐름에서는 같은 양만큼 전체 발생을 줄인다(공정한 비교).
 */
const model = JSON.parse(JSON.stringify(integratedProjectAiModel)) as any
const c = model.constants
c.spec_split = { value: 0, unit: '배', label: '분리(0/1)' }
c.spec_share = { value: 0, unit: '비율', label: '스펙 오류 몫' }
c.spec_review_x = { value: 0, unit: '비율', label: '스펙 검토 강도' }
c.spec_review_eff = { value: 0.8, unit: '비율', label: '스펙 검토 효과' }
c.spec_review_cost = { value: 0.1, unit: '비율', label: '스펙 검토 인력 몫' }
const A = model.auxiliaries
const R = model.rates
A.err_raw_rate = { expr: 'prod_dev_rate * err_per_task_nominal * err_mix_mult * err_pressure_mult * ai_err_factor * td_err_mult', unit: '오류/일' }
R.err_gen_rate = { expr: 'err_raw_rate * (1 - spec_share * spec_review_eff * spec_review_x)', unit: '오류/일' }
R.err_spec_rate = { expr: 'spec_split * err_raw_rate * spec_share * (1 - spec_review_eff * spec_review_x)', unit: '오류/일' }
R.err_impl_rate = { expr: 'err_gen_rate - err_spec_rate', unit: '오류/일' }
model.levels.err_pde.inflows = ['err_impl_rate']
c.spec_late_mult = { value: 1, unit: '배', label: '스펙 오류 후기 발견 배수' }
model.levels.err_spec_pool = { init: '0', inflows: ['err_spec_rate'], outflows: ['err_spec_found_rate'], unit: '오류' }
A.err_spec_density = { expr: 'err_spec_pool / MAX(prod_tasks_qaed - prod_tasks_tested, 1)', unit: '오류/태스크' }
R.err_spec_found_rate = { expr: 'MIN(prod_test_rate * err_spec_density, err_spec_pool / DT)', unit: '오류/일' }
A.prod_test_mp_per_task = { expr: '(test_plan_md_per_task + err_escaped_density * test_md_per_error * ai_late_rework_mult + err_spec_density * test_md_per_error * spec_late_mult) / MAX(prod_loss_mult, 0.05)', unit: '맨데이/태스크' }
A.ai_avail_mp = { expr: 'MAX(0, hr_avail_mp - prod_mp_review - spec_review_x * spec_review_cost * hr_total)', unit: '명' }
const compiled = compileModel(model)

const END = 600
const last = (r: RunResult, n: string) => (r.series[n] as Float64Array)[(r.series[n] as Float64Array).length - 1] as number
const atCompletion = (r: RunResult, n: string) => {
  const t = last(r, 'ctl_completion_time')
  const i = r.time.findIndex((x) => x >= t - 1e-9)
  return (r.series[n] as Float64Array)[i] as number
}

const AI = { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, ai_err_raw_mult: 1.5, ai_review_md_nominal: 0.1, td_per_task: 0.1, td_compound: 1, ai_td_pro: 1.5, ai_td_new: 1.5 }
const POLICIES: Record<string, Record<string, number>> = {
  기준: {},
  'AI 절반': { ai_adoption: 0.5 },
  '스펙 검토': { spec_review_x: 1 },
  'QA 증원': { planned_qa_fraction: 0.25 },
  '깊은 코드검토': { ai_review_md_nominal: 0.25 },
  리팩터링: { td_refactor_fraction: 0.1 },
}
const STAFF: Record<string, Record<string, number>> = {
  고정: { hiring_delay: 5000, initial_pros: 10, initial_new: 0, max_staff: 10 },
  채용: {},
}

const run = (split: number, share: number, late: number, staff: string, pol: string) =>
  runModel(compiled, { overrides: { ...AI, ...STAFF[staff], spec_split: split, spec_share: share, spec_late_mult: late, ...POLICIES[pol] }, end: END })

const runSingle = (L: number, share: number, staff: string, pol: string) =>
  runModel(compiled, { overrides: { ...AI, ...STAFF[staff], spec_split: 0, spec_share: share, ai_late_rework_mult: L, ...POLICIES[pol] }, end: END })
/** 단일 흐름의 후기 배수를, 기준 정책 완료일이 변형(분리)과 같아지도록 맞춘다. 못 맞추면 NaN. */
const calibrate = (target: number, share: number, staff: string): number => {
  let lo = 1
  let hi = 30
  const f = (L: number) => last(runSingle(L, share, staff, '기준'), 'ctl_completion_time')
  if (target < f(lo) - 1e-9 || target > f(hi) + 1e-9) return NaN
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

type Row = { staff: string; share: number; late: number; metric: string; single: string; split: string; changed: boolean }
const rows: Row[] = []
const calib: string[] = []
const METRICS: Record<string, (r: RunResult) => number> = {
  완료일: (r) => last(r, 'ctl_completion_time'),
  공수: (r) => atCompletion(r, 'ctl_cum_md'),
  잔존오류: (r) => atCompletion(r, 'err_escaped') + atCompletion(r, 'err_pde') + atCompletion(r, 'err_spec_pool'),
}

const RUN = process.env.SPD_EXPERIMENT === '1'
describe.skipIf(!RUN)('오류 종류 분리 실험', () => {
  it('spec_split=0, 스펙 몫 0이면 변형은 원래 모델과 같다', () => {
    const o = runModel(compileModel(integratedProjectAiModel), { overrides: AI, end: END })
    const v = runModel(compiled, { overrides: { ...AI }, end: END })
    expect(last(v, 'ctl_completion_time')).toBe(last(o, 'ctl_completion_time'))
    expect(last(v, 'ctl_cum_md')).toBe(last(o, 'ctl_cum_md'))
  })

  it('정책 순위 표', () => {
    const order = (vals: Record<string, number>) => Object.keys(vals).sort((a, b) => vals[a]! - vals[b]!)
    for (const staff of Object.keys(STAFF))
      for (const share of [0.2, 0.4, 0.6])
        for (const late of [1, 2, 4, 8]) {
          const L = calibrate(last(run(1, share, late, staff, '기준'), 'ctl_completion_time'), share, staff)
          calib.push(`${staff} 몫${share} 스펙후기${late} → 단일 후기배수 ${L.toFixed(2)}`)
          for (const [mn, f] of Object.entries(METRICS)) {
            if (Number.isNaN(L)) continue
            const s: Record<string, number> = {}
            const p: Record<string, number> = {}
            for (const pol of Object.keys(POLICIES)) {
              s[pol] = f(runSingle(L, share, staff, pol))
              p[pol] = f(run(1, share, late, staff, pol))
            }
            const os = order(s)
            const op = order(p)
            rows.push({ staff, share, late, metric: mn, single: os.join('<'), split: op.join('<'), changed: os[0] !== op[0] })
          }
        }
    const lines = rows.map((r) => `${r.staff} 몫${r.share} 스펙후기${r.late} ${r.metric}: 1위 ${r.single.split('<')[0]} → ${r.split.split('<')[0]}${r.changed ? '  ★변경' : ''}`)
    console.log('\n' + calib.join('\n') + '\n' + lines.join('\n'))
    const full = rows.filter((r) => r.single !== r.split).length
    console.log(`\n전체 ${rows.length}칸 중 1위 변경 ${rows.filter((r) => r.changed).length}, 순위 어딘가 변경 ${full}`)
    expect(rows.length).toBeGreaterThan(0)
  }, 600000)
})

describe.skipIf(!RUN)('경계 칸 점검', () => {
  it('차이 크기', () => {
    const out: string[] = []
    for (const [staff, share, late] of [['고정', 0.2, 2], ['채용', 0.4, 1]] as const)
      for (const split of [0, 1])
        out.push(`${staff} 몫${share} 스펙후기${late} split${split}: ` + Object.keys(POLICIES).map((p) => {
          const r = run(split, share, late, staff, p)
          return `${p} 완료${last(r, 'ctl_completion_time').toFixed(1)} 공수${atCompletion(r, 'ctl_cum_md').toFixed(0)} 잔존${(atCompletion(r, 'err_escaped') + atCompletion(r, 'err_pde') + atCompletion(r, 'err_spec_pool')).toFixed(1)}`
        }).join(' | '))
    console.log('\n' + out.join('\n'))
  })
})

describe.skipIf(!RUN)('뒤집힘 크기', () => {
  it('상위 정책 간 격차', () => {
    const out: string[] = []
    for (const [staff, share, late] of [['고정', 0.4, 8], ['채용', 0.4, 8], ['고정', 0.2, 4]] as const) {
      const L = calibrate(last(run(1, share, late, staff, '기준'), 'ctl_completion_time'), share, staff)
      for (const [name, fn] of [['단일', (p: string) => runSingle(L, share, staff, p)], ['분리', (p: string) => run(1, share, late, staff, p)]] as const)
        out.push(`${staff} 몫${share} 후기${late} ${name}: ` + ['기준', '깊은 코드검토', '스펙 검토', '리팩터링'].map((p) => `${p} ${last(fn(p), 'ctl_completion_time').toFixed(1)}일/${atCompletion(fn(p), 'ctl_cum_md').toFixed(0)}`).join(' | '))
    }
    console.log('\n' + out.join('\n'))
  })
})
