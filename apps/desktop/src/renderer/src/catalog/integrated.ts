import { lastOf, maxOf, valueAt } from '@spd/analysis'
import { integratedProjectModel } from '@spd/models'
import type { EvmAdapter, KpiSpec, ModelEntry, ParamSpec, RadarAxis } from './types'

type Result = Parameters<KpiSpec['compute']>[0]

/** 시험이 모두 끝났으면 완료 시각, 아니면 null. 완료 Rate가 0이면 끝난 것이다. */
const completedAt = (result: Result): number | null =>
  lastOf(result, 'ctl_completion_rate') === 0 ? lastOf(result, 'ctl_completion_time') : null

/** 완료 시점의 값. 완료하지 못했으면 null. */
const atCompletion = (result: Result, name: string): number | null => {
  const t = completedAt(result)
  return t === null ? null : valueAt(result, name, t)
}

const residualDefects = (r: Result): number | null => {
  const t = completedAt(r)
  return t === null ? null : valueAt(r, 'err_pde', t) + valueAt(r, 'err_detected', t) + valueAt(r, 'err_escaped', t)
}

/** 태스크 하나 = 60라인(0.06 KDSI), 책 p.374 */
const KDSI_PER_TASK = 0.06

const kpiSpecs: KpiSpec[] = [
  { id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => completedAt(r) },
  {
    id: 'scheduleSlip',
    label: '계획 대비 지연',
    unit: '%',
    better: 'lower',
    group: 'schedule',
    decimals: 0,
    compute: (r, p) => {
      const t = completedAt(r)
      const planned = p['planned_duration_days'] as number
      return t === null ? null : (100 * (t - planned)) / planned
    }
  },
  { id: 'totalEffort', label: '총 투입 공수', unit: '맨데이', better: 'lower', group: 'cost', decimals: 0, compute: (r) => atCompletion(r, 'ctl_cum_md') },
  { id: 'residualDefects', label: '잔존 결함 추정', unit: '오류', better: 'lower', group: 'quality', decimals: 0, compute: residualDefects },
  {
    id: 'residualDensity',
    label: '잔존 결함 밀도',
    unit: '오류/KDSI',
    better: 'lower',
    group: 'quality',
    decimals: 1,
    compute: (r, p) => {
      const d = residualDefects(r)
      return d === null ? null : d / ((p['total_tasks'] as number) * KDSI_PER_TASK)
    }
  },
  { id: 'maxPressure', label: '최대 일정 압박', unit: '비율', better: 'lower', group: 'risk', decimals: 2, compute: (r) => maxOf(r, 'ctl_sched_pressure') },
  {
    id: 'exhaustionNearness',
    label: '소진 근접도',
    unit: '비율',
    better: 'lower',
    group: 'risk',
    decimals: 2,
    compute: (r, p) => maxOf(r, 'exh_level') / (p['exh_max_tolerable'] as number)
  },
  { id: 'peakStaff', label: '최대 인원', unit: '명', better: 'none', group: 'risk', decimals: 0, compute: (r) => maxOf(r, 'hr_total') }
]

/**
 * 단계별 인정 비율 0.5/0.2/0.3은 근거가 없는 초기값이다(설계 05, 2.1). 시험 완료만 인정하면 시험이 시작되는
 * 후반까지 진척이 0이라 일정 지수가 의미 없어서 개발·QA·시험 완료에 나누어 인정한다.
 */
const evm: EvmAdapter = {
  totalTasks: (p) => p['total_tasks'] as number,
  credits: [
    { variable: 'prod_tasks_developed', label: '개발 완료', weight: 0.5 },
    { variable: 'prod_tasks_qaed', label: 'QA 완료', weight: 0.2 },
    { variable: 'prod_tasks_tested', label: '시험 완료', weight: 0.3 }
  ],
  effortVariable: 'ctl_cum_md',
  completion: completedAt
}

const radarAxes: RadarAxis[] = [
  { id: 'schedule', label: '일정', kpiId: 'completionDay' },
  { id: 'cost', label: '비용', kpiId: 'totalEffort' },
  { id: 'quality', label: '품질', kpiId: 'residualDefects' },
  { id: 'risk', label: '위험', kpiId: 'exhaustionNearness' }
]

const p = (name: string, min: number, max: number, step: number, integer = false): ParamSpec =>
  integer ? { name, min, max, step, integer } : { name, min, max, step }

export const integratedEntry: ModelEntry = {
  id: 'integrated-project',
  title: '통합 프로젝트 (4섹터 단순판)',
  category: 'project',
  description:
    '책 6.3 Abdel-Hamid 모델의 인력·계획·생산·통제 4개 섹터를 단순화한 모델입니다. 작업량 과소추정, 일정 압박과 소진, 채용·동화 지연이 일정과 품질에 미치는 영향을 실험합니다. 일부 파라미터는 책에 값이 없어 가정한 값이라 결과는 정성적으로 읽으세요.',
  size: { param: 'total_tasks', unit: '태스크', slocPerUnit: 60, source: '책 6.3: 태스크 하나는 약 60라인(0.06 KDSI)' },
  def: integratedProjectModel,
  groups: [
    {
      title: '프로젝트와 계획',
      params: [
        p('total_tasks', 20, 5000, 10, true),
        p('plan_known_fraction', 0.3, 1, 0.05),
        p('planned_duration_days', 30, 1000, 10),
        p('max_tolerable_factor', 1.1, 3, 0.1),
        p('planned_qa_fraction', 0.05, 0.4, 0.05),
        p('plan_dev_prod', 0.1, 2, 0.05),
        p('plan_test_prod', 1, 20, 0.5),
        p('estimate_margin', 0.5, 2, 0.1),
        p('sched_adj_time', 1, 365, 5)
      ]
    },
    {
      title: '인력',
      params: [
        p('initial_pros', 0, 200, 1, true),
        p('initial_new', 0, 200, 1, true),
        p('max_staff', 1, 200, 1, true),
        p('hiring_delay', 1, 365, 5),
        p('assim_delay', 1, 365, 5),
        p('avg_employment_time', 30, 3650, 30),
        p('transfer_delay', 1, 100, 1),
        p('trainers_per_hiree', 0, 1, 0.05),
        p('max_hirees_per_fte', 0, 10, 0.5),
        p('extra_people', 0, 200, 1, true),
        p('extra_people_day', 0, 2000, 10)
      ]
    },
    {
      title: '생산성과 소진',
      params: [
        p('prod_calibration', 0.3, 3, 0.1),
        p('pro_prod', 0.1, 3, 0.1),
        p('new_prod', 0.1, 3, 0.1),
        p('frac_nominal', 0.2, 1, 0.05),
        p('max_boost', 0, 1, 0.05),
        p('max_slack', 0, 0.5, 0.05),
        p('work_rate_adj_time', 1, 60, 1),
        p('exh_max_tolerable', 5, 200, 5),
        p('exh_depletion_delay', 1, 100, 1),
        p('comm_coeff', 0, 0.005, 0.0001)
      ]
    },
    {
      title: '품질',
      params: [
        p('qa_delay', 3, 60, 1),
        p('qa_mp_per_error', 0.05, 2, 0.05),
        p('rework_mp_per_error', 0.05, 3, 0.05),
        p('rework_correction_time', 1, 60, 1),
        p('rework_perception_delay', 1, 60, 1),
        p('bad_fix_fraction', 0, 0.5, 0.025),
        p('err_per_task_start', 0, 5, 0.1),
        p('err_per_task_end', 0, 5, 0.1),
        p('test_plan_md_per_task', 0, 1, 0.01),
        p('test_md_per_error', 0, 1, 0.01)
      ]
    },
    {
      title: '통제',
      params: [p('delay_incorporating', 1, 60, 1)]
    }
  ],
  variables: [
    { name: 'prod_tasks_tested', label: '시험 완료 태스크', unit: '태스크' },
    { name: 'prod_tasks_developed', label: '개발 완료 태스크', unit: '태스크' },
    { name: 'prod_tasks_qaed', label: 'QA 완료 태스크', unit: '태스크' },
    { name: 'hr_total', label: '총 인원', unit: '명' },
    { name: 'hr_new', label: '신입 인원', unit: '명' },
    { name: 'hr_pros', label: '숙련 인원', unit: '명' },
    { name: 'plan_sched_completion', label: '계획 완료일', unit: '일' },
    { name: 'ctl_perceived_job_size', label: '인식한 작업 규모', unit: '태스크' },
    { name: 'ctl_cum_md', label: '누적 투입 공수', unit: '맨데이' },
    { name: 'ctl_sched_pressure', label: '일정 압박', unit: '비율' },
    { name: 'prod_frac_manday', label: '업무 비율', unit: '비율' },
    { name: 'exh_level', label: '소진', unit: '소진일' },
    { name: 'prod_productivity', label: '개발 생산성', unit: '태스크/맨데이' },
    { name: 'err_escaped', label: 'QA를 통과한 오류', unit: '오류' },
    { name: 'err_cum_generated', label: '누적 오류 발생', unit: '오류' }
  ],
  defaultVariable: 'prod_tasks_tested',
  presets: [
    { label: '현재 설정', overrides: {} },
    { label: '과소추정 없음', overrides: { plan_known_fraction: 1 } },
    { label: '일정 촉박(120일)', overrides: { planned_duration_days: 120 } },
    { label: '빠른 채용·동화', overrides: { hiring_delay: 10, assim_delay: 20 } }
  ],
  kpiSpecs,
  radarAxes,
  evm,
  kpis(result) {
    const last = (name: string) => {
      const s = result.series[name]
      return s ? (s[s.length - 1] as number) : NaN
    }
    const staff = result.series['hr_total']
    // 완료 Rate(`ctl_completion_rate`)가 0이면 시험이 모두 끝난 것이다.
    return {
      completionDay: last('ctl_completion_rate') === 0 ? last('ctl_completion_time') : null,
      peakStaff: staff ? Math.max(...staff) : 0
    }
  }
}
