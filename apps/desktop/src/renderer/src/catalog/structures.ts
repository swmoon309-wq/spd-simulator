import { lastOf, maxOf, valueAt } from '@spd/analysis'
import { defectChainModel, learningCurveModel, personnelChainModel, productionReworkModel, rayleighModel } from '@spd/models'
import type { EvmAdapter, KpiSpec, Kpis, ModelEntry, ParamGroup, ParamSpec, Preset, RadarAxis, SizeInfo, VariableInfo } from './types'

/**
 * 기본 구조 라이브러리(MDL-03, 책 3장 3.4~3.5). 구조를 하나씩 단독으로 실행해 특징적인 행동을 보는 작은 모델들이다. 모두
 * "일을 하는 작은 프로젝트" 모양(작업 규모, 완료일, 공수)으로 만들어 시나리오 비교·위험 분석·통제를 그대로 쓸 수 있다.
 */
type Result = Parameters<KpiSpec['compute']>[0]

const p = (name: string, min: number, max: number, step: number, integer = false): ParamSpec => (integer ? { name, min, max, step, integer } : { name, min, max, step })

/** 책 6.3(p.374): 태스크 하나는 약 60라인(0.06 KDSI). 규모를 SLOC로 환산하는 보조 입력(CFG-01)의 기본값. */
const TASK_SIZE: Omit<SizeInfo, 'param'> = { unit: '태스크', slocPerUnit: 60, source: '책 6.3: 태스크 하나는 약 60라인(0.06 KDSI)' }

/** 값이 `name` 변수의 마지막 값이 0 이하이면 끝난 것이라고 보고 `completion_time`을 완료 시각으로 쓴다. */
const finishedWhenZero = (name: string) => (r: Result): number | null => (lastOf(r, name) <= 1e-6 ? lastOf(r, 'completion_time') : null)

const atCompletion = (done: (r: Result) => number | null, name: string) => (r: Result): number | null => {
  const t = done(r)
  return t === null ? null : valueAt(r, name, t)
}

const completionSpec = (done: (r: Result) => number | null): KpiSpec => ({ id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: done })

const effortSpec = (done: (r: Result) => number | null, label = '총 투입 공수'): KpiSpec => ({
  id: 'totalEffort',
  label,
  unit: '맨데이',
  better: 'lower',
  group: 'cost',
  decimals: 0,
  compute: atCompletion(done, 'cum_effort')
})

const peakSpec = (variable: string, label = '최대 인원'): KpiSpec => ({ id: 'peakStaff', label, unit: '명', better: 'none', group: 'risk', decimals: 0, compute: (r) => maxOf(r, variable) })

const kpisOf = (done: (r: Result) => number | null, staffVariable: string) => (result: Result): Kpis => ({ completionDay: done(result), peakStaff: maxOf(result, staffVariable) })

const jobSize = (param = 'job_size'): ParamSpec => p(param, 10, 5000, 10, true)

interface StructureOptions {
  id: string
  title: string
  description: string
  def: ModelEntry['def']
  size?: SizeInfo
  groups: ParamGroup[]
  variables: VariableInfo[]
  defaultVariable: string
  presets: Preset[]
  done: (r: Result) => number | null
  staffVariable: string
  kpiSpecs: KpiSpec[]
  radarAxes: RadarAxis[]
  evm: EvmAdapter
}

function structure(o: StructureOptions): ModelEntry {
  return {
    id: o.id,
    title: o.title,
    category: 'structure',
    description: o.description,
    ...(o.size ? { size: o.size } : {}),
    def: o.def,
    groups: o.groups,
    variables: o.variables,
    defaultVariable: o.defaultVariable,
    presets: o.presets,
    kpiSpecs: o.kpiSpecs,
    radarAxes: o.radarAxes,
    evm: o.evm,
    kpis: kpisOf(o.done, o.staffVariable)
  }
}

// ---- 1. 생산과 재작업 (3.4.7, 그림 3.36) ----
const prDone = (r: Result): number | null => (lastOf(r, 'finished') === 1 ? lastOf(r, 'completion_time') : null)

export const productionReworkEntry = structure({
  id: 'production-rework',
  title: '생산과 재작업 (기본 구조)',
  description:
    '책 3.4.7: 일을 하면 일부가 잘못되어 "발견 전 재작업"이 쌓이고, 발견되면 다시 해야 할 일로 돌아가 여러 번 순환합니다. 올바르게 끝내는 비율과 재작업을 발견하는 데 걸리는 시간을 바꿔 일정이 얼마나 늘어나는지 보세요.',
  def: productionReworkModel,
  size: { param: 'job_size', ...TASK_SIZE },
  groups: [
    { title: '작업과 인력', params: [jobSize(), p('staff', 1, 200, 1, true), p('productivity', 0.05, 5, 0.05)] },
    { title: '재작업', params: [p('fraction_correct', 0.3, 1, 0.05), p('discovery_delay', 1, 200, 1), p('completion_tolerance', 0.01, 5, 0.01)] }
  ],
  variables: [
    { name: 'correct_tasks', label: '올바르게 끝난 일', unit: '태스크' },
    { name: 'tasks_to_do', label: '해야 할 일', unit: '태스크' },
    { name: 'undiscovered_rework', label: '발견 전 재작업', unit: '태스크' },
    { name: 'task_development', label: '개발률', unit: '태스크/일' },
    { name: 'rework_discovery', label: '재작업 발견률', unit: '태스크/일' },
    { name: 'cum_effort', label: '누적 투입 공수', unit: '맨데이' }
  ],
  defaultVariable: 'undiscovered_rework',
  presets: [
    { label: '기준(80%)', overrides: {} },
    { label: '처음부터 올바르게(100%)', overrides: { fraction_correct: 1 } },
    { label: '품질 낮음(60%)', overrides: { fraction_correct: 0.6 } },
    { label: '재작업 늦게 발견(60일)', overrides: { discovery_delay: 60 } }
  ],
  done: prDone,
  staffVariable: 'staff_level',
  kpiSpecs: [
    completionSpec(prDone),
    effortSpec(prDone),
    { id: 'peakRework', label: '발견 전 재작업 최대량', unit: '태스크', better: 'lower', group: 'quality', decimals: 1, compute: (r) => maxOf(r, 'undiscovered_rework') },
    peakSpec('staff_level')
  ],
  radarAxes: [
    { id: 'schedule', label: '일정', kpiId: 'completionDay' },
    { id: 'cost', label: '비용', kpiId: 'totalEffort' },
    { id: 'quality', label: '재작업', kpiId: 'peakRework' }
  ],
  evm: { totalTasks: (q) => q['job_size'] as number, credits: [{ variable: 'correct_tasks', label: '올바르게 끝난 일', weight: 1 }], effortVariable: 'cum_effort', completion: prDone }
})

// ---- 2. 학습곡선 (3.4.9, 그림 3.38~3.39) ----
const lcDone = finishedWhenZero('tasks_remaining')

export const learningCurveEntry = structure({
  id: 'learning-curve',
  title: '인력 학습곡선 (기본 구조)',
  description:
    '책 3.4.9: 일이 진행될수록 숙련되어 생산성이 오르는 되먹임입니다. 생산성 배율이 진행률의 S자 함수로 시작 값에서 학습을 마친 값까지 오릅니다(책 그림 3.39의 모양을 매끈한 S자 곡선으로 두었고 수치는 책의 값이 아닙니다). 시작 배율을 낮춰 학습 비용을 보세요.',
  def: learningCurveModel,
  size: { param: 'job_size', ...TASK_SIZE },
  groups: [
    { title: '작업과 인력', params: [jobSize(), p('staff', 1, 200, 1, true), p('nominal_productivity', 0.05, 5, 0.05)] },
    { title: '학습', params: [p('initial_efficiency', 0.1, 2, 0.05), p('peak_efficiency', 0.1, 3, 0.05)] }
  ],
  variables: [
    { name: 'tasks_completed', label: '끝난 일', unit: '태스크' },
    { name: 'tasks_remaining', label: '남은 일', unit: '태스크' },
    { name: 'learning_curve', label: '학습곡선(생산성 배율)', unit: '배' },
    { name: 'productivity', label: '생산성', unit: '태스크/맨데이' },
    { name: 'development_rate', label: '개발률', unit: '태스크/일' },
    { name: 'percentage_complete', label: '진행률', unit: '비율' },
    { name: 'cum_effort', label: '누적 투입 공수', unit: '맨데이' }
  ],
  defaultVariable: 'learning_curve',
  presets: [
    { label: '기준(0.5 → 1.2)', overrides: {} },
    { label: '학습 효과 없음', overrides: { initial_efficiency: 1, peak_efficiency: 1 } },
    { label: '학습할 것이 많음(0.3)', overrides: { initial_efficiency: 0.3 } },
    { label: '빠르게 익숙해짐(0.8)', overrides: { initial_efficiency: 0.8 } }
  ],
  done: lcDone,
  staffVariable: 'staff_level',
  kpiSpecs: [
    completionSpec(lcDone),
    effortSpec(lcDone),
    {
      id: 'learningDelay',
      label: '학습 효과로 늘어난 기간',
      unit: '일',
      better: 'lower',
      group: 'schedule',
      decimals: 1,
      // 같은 인원·공칭 생산성에서 학습 효과가 없을 때(배율 1)의 기간과의 차이. 음수면 학습으로 오히려 빨라진 것이다.
      compute: (r, q) => {
        const t = lcDone(r)
        return t === null ? null : t - (q['job_size'] as number) / ((q['staff'] as number) * (q['nominal_productivity'] as number))
      }
    },
    peakSpec('staff_level')
  ],
  radarAxes: [
    { id: 'schedule', label: '일정', kpiId: 'completionDay' },
    { id: 'cost', label: '비용', kpiId: 'totalEffort' },
    { id: 'learning', label: '학습 지연', kpiId: 'learningDelay' }
  ],
  evm: { totalTasks: (q) => q['job_size'] as number, credits: [{ variable: 'tasks_completed', label: '끝난 일', weight: 1 }], effortVariable: 'cum_effort', completion: lcDone }
})

// ---- 3. Rayleigh 곡선 생성기 (3.4.10, 그림 3.40) ----
/** 누적 공수가 완료 비율에 이르면 완료 시계(`completion_clock`)가 0이 되어 멈춘다. */
const rayDone = (r: Result): number | null => (lastOf(r, 'completion_clock') === 0 ? lastOf(r, 'completion_time') : null)

export const rayleighEntry = structure({
  id: 'rayleigh',
  title: 'Rayleigh 인력 곡선 (기본 구조)',
  description:
    '책 3.4.10: 투입 공수율 = 학습 함수 × (추정 총 공수 − 누적 공수), 학습 함수 = 인력 증가 계수 × 시간. 투입 인력이 종 모양으로 올랐다가 줄고 누적 공수는 S자가 됩니다. 정점 시각은 1/√(인력 증가 계수)이고 단위는 1/일²입니다. 누적 공수가 추정치에 점근하므로 완료는 99%(설정 가능)에 이른 시점으로 봅니다.',
  def: rayleighModel,
  groups: [
    { title: '추정', params: [p('estimated_total_effort', 100, 200000, 100), p('manpower_buildup', 0.00001, 0.01, 0.00001), p('effort_per_task', 1, 100, 1), p('completion_fraction', 0.5, 0.99, 0.01)] }
  ],
  variables: [
    { name: 'effort_rate', label: '투입 공수율(인력)', unit: '맨데이/일' },
    { name: 'cum_effort', label: '누적 투입 공수', unit: '맨데이' },
    { name: 'learning_function', label: '학습 함수', unit: '1/일' },
    { name: 'tasks_done', label: '진척(태스크 환산)', unit: '태스크' }
  ],
  defaultVariable: 'effort_rate',
  presets: [
    { label: '기준(정점 100일)', overrides: {} },
    { label: '완만한 증가(계수 절반)', overrides: { manpower_buildup: 0.00005 } },
    { label: '급한 증가(계수 4배)', overrides: { manpower_buildup: 0.0004 } },
    { label: '큰 프로젝트(8,000 맨데이)', overrides: { estimated_total_effort: 8000 } }
  ],
  done: rayDone,
  staffVariable: 'effort_rate',
  kpiSpecs: [
    completionDay(rayDone),
    effortSpec(rayDone),
    peakSpec('effort_rate', '최대 투입 인력'),
    {
      id: 'peakDay',
      label: '인력 정점 시각',
      unit: '일',
      better: 'none',
      group: 'schedule',
      decimals: 0,
      compute: (r) => {
        const s = r.series['effort_rate'] as Float64Array
        let best = 0
        for (let i = 1; i < s.length; i++) if ((s[i] as number) > (s[best] as number)) best = i
        return r.time[best] as number
      }
    }
  ],
  radarAxes: [
    { id: 'schedule', label: '일정', kpiId: 'completionDay' },
    { id: 'cost', label: '비용', kpiId: 'totalEffort' }
  ],
  evm: { totalTasks: (q) => (q['estimated_total_effort'] as number) / (q['effort_per_task'] as number), credits: [{ variable: 'tasks_done', label: '진척(태스크 환산)', weight: 1 }], effortVariable: 'cum_effort', completion: rayDone }
})

function completionDay(done: (r: Result) => number | null): KpiSpec {
  return completionSpec(done)
}

// ---- 4. 인력 체인 3단계 (3.5.3.1, 그림 3.63 + 3.4.8) ----
const pcDone = finishedWhenZero('tasks_remaining')

export const personnelChainEntry = structure({
  id: 'personnel-chain',
  title: '인력 체인 3단계 (기본 구조)',
  description:
    '책 3.5.3.1: 신입 → 일반 → 선임으로 승진하는 보존된 인력 체인입니다. 채용은 신입으로 들어오고 선임만 이직합니다(승진은 단계 사이 이동). 단계마다 생산성이 달라 인원이 늘어도 생산성 환산 인원은 승진 지연만큼 늦게 따라옵니다(3.4.8의 인력 × 생산성 = 개발률).',
  def: personnelChainModel,
  size: { param: 'job_size', ...TASK_SIZE },
  groups: [
    { title: '작업', params: [p('job_size', 100, 50000, 100, true), p('nominal_productivity', 0.05, 5, 0.05)] },
    { title: '초기 인원', params: [p('initial_entry', 0, 200, 1, true), p('initial_associate', 0, 200, 1, true), p('initial_senior', 0, 200, 1, true)] },
    { title: '채용과 승진·이직', params: [p('recruiting_per_day', 0, 5, 0.05), p('entry_period', 10, 1000, 10), p('associate_period', 10, 2000, 10), p('senior_tenure', 30, 10000, 30)] },
    { title: '단계별 생산성 배율', params: [p('entry_productivity', 0.1, 3, 0.05), p('associate_productivity', 0.1, 3, 0.05), p('senior_productivity', 0.1, 3, 0.05)] }
  ],
  variables: [
    { name: 'total_staff', label: '총 인원', unit: '명' },
    { name: 'entry_staff', label: '신입', unit: '명' },
    { name: 'associate_staff', label: '일반', unit: '명' },
    { name: 'senior_staff', label: '선임', unit: '명' },
    { name: 'effective_staff', label: '생산성 환산 인원', unit: '명' },
    { name: 'tasks_completed', label: '끝난 일', unit: '태스크' },
    { name: 'development_rate', label: '개발률', unit: '태스크/일' },
    { name: 'cum_effort', label: '누적 투입 공수', unit: '맨데이' },
    { name: 'cum_recruited', label: '누적 채용', unit: '명' },
    { name: 'cum_attrition', label: '누적 이직', unit: '명' }
  ],
  defaultVariable: 'total_staff',
  presets: [
    { label: '기준', overrides: {} },
    { label: '채용 3배(0.3명/일)', overrides: { recruiting_per_day: 0.3 } },
    { label: '빠른 승진(신입 60일)', overrides: { entry_period: 60 } },
    { label: '이직 많음(선임 300일)', overrides: { senior_tenure: 300 } }
  ],
  done: pcDone,
  staffVariable: 'total_staff',
  kpiSpecs: [completionSpec(pcDone), effortSpec(pcDone), peakSpec('total_staff')],
  radarAxes: [
    { id: 'schedule', label: '일정', kpiId: 'completionDay' },
    { id: 'cost', label: '비용', kpiId: 'totalEffort' }
  ],
  evm: { totalTasks: (q) => q['job_size'] as number, credits: [{ variable: 'tasks_completed', label: '끝난 일', weight: 1 }], effortVariable: 'cum_effort', completion: pcDone }
})

// ---- 5. 결함 체인 (3.5.2.1~3.5.2.3, 그림 3.56~3.58) ----
const dcDone = finishedWhenZero('tasks_remaining')

export const defectChainEntry = structure({
  id: 'defect-chain',
  title: '결함 발생·검출·재작업 (기본 구조)',
  description:
    '책 3.5.2: 오류는 개발률 × 오류 밀도로 일과 함께 생기고(코플로), 검출 효율에 따라 검출된 오류와 빠져나간 오류로 갈라지며(split flow), 검출된 오류는 시간이 지나 재작업으로 고쳐집니다. 검출 효율은 대체로 50~90%입니다. 총 공수에는 오류를 고친 공수도 포함됩니다.',
  def: defectChainModel,
  size: { param: 'job_size', ...TASK_SIZE },
  groups: [
    { title: '작업과 인력', params: [jobSize(), p('staff', 1, 200, 1, true), p('productivity', 0.05, 5, 0.05)] },
    { title: '오류', params: [p('defect_density', 0, 10, 0.1), p('detection_efficiency', 0, 1, 0.05), p('rework_delay', 1, 100, 1), p('rework_effort_per_defect', 0, 5, 0.05)] }
  ],
  variables: [
    { name: 'tasks_developed', label: '개발 완료', unit: '태스크' },
    { name: 'cum_generated', label: '누적 오류 발생', unit: '오류' },
    { name: 'undetected_defects', label: '검출 못 한 오류', unit: '오류' },
    { name: 'detected_defects', label: '검출했지만 고치기 전', unit: '오류' },
    { name: 'reworked_defects', label: '고친 오류', unit: '오류' },
    { name: 'development_rate', label: '개발률', unit: '태스크/일' },
    { name: 'defect_generation_rate', label: '오류 발생률', unit: '오류/일' },
    { name: 'cum_effort', label: '누적 투입 공수', unit: '맨데이' }
  ],
  defaultVariable: 'undetected_defects',
  presets: [
    { label: '기준(검출 60%)', overrides: {} },
    { label: '검출 효율 높음(90%)', overrides: { detection_efficiency: 0.9 } },
    { label: '검출 효율 낮음(30%)', overrides: { detection_efficiency: 0.3 } },
    { label: '오류 밀도 2배', overrides: { defect_density: 2.4 } }
  ],
  done: dcDone,
  staffVariable: 'staff_level',
  kpiSpecs: [
    completionSpec(dcDone),
    // 개발이 끝난 뒤에도 검출한 오류를 마저 고치므로 실행이 끝난 시점의 누적 공수를 총 공수로 본다.
    { id: 'totalEffort', label: '총 투입 공수(오류 재작업 포함)', unit: '맨데이', better: 'lower', group: 'cost', decimals: 0, compute: (r) => (dcDone(r) === null ? null : lastOf(r, 'cum_effort')) },
    { id: 'escapedDefects', label: '검출 못 한 오류', unit: '오류', better: 'lower', group: 'quality', decimals: 0, compute: (r) => (dcDone(r) === null ? null : lastOf(r, 'undetected_defects')) },
    { id: 'peakBacklog', label: '고치기 전 오류의 최대량', unit: '오류', better: 'lower', group: 'quality', decimals: 1, compute: (r) => maxOf(r, 'detected_defects') },
    peakSpec('staff_level')
  ],
  radarAxes: [
    { id: 'schedule', label: '일정', kpiId: 'completionDay' },
    { id: 'cost', label: '비용', kpiId: 'totalEffort' },
    { id: 'quality', label: '결함', kpiId: 'escapedDefects' }
  ],
  evm: { totalTasks: (q) => q['job_size'] as number, credits: [{ variable: 'tasks_developed', label: '개발 완료', weight: 1 }], effortVariable: 'cum_effort', completion: dcDone }
})

export const structureEntries: ModelEntry[] = [productionReworkEntry, learningCurveEntry, rayleighEntry, personnelChainEntry, defectChainEntry]
