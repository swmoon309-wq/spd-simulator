import { lastOf, maxOf, valueAt } from '@spd/analysis'
import { brooksModel } from '@spd/models'
import type { EvmAdapter, KpiSpec, ModelEntry, RadarAxis } from './types'

/** 요구사항이 모두 구현되어 끝났으면 완료 시각, 아니면 null */
const completedAt = (result: Parameters<KpiSpec['compute']>[0]): number | null =>
  lastOf(result, 'requirements') <= 1e-6 ? lastOf(result, 'completion_time') : null

const kpiSpecs: KpiSpec[] = [
  {
    id: 'completionDay',
    label: '완료일',
    unit: '일',
    better: 'lower',
    group: 'schedule',
    decimals: 1,
    compute: (r) => completedAt(r)
  },
  {
    id: 'totalEffort',
    label: '총 투입 공수',
    unit: '맨데이',
    better: 'lower',
    group: 'cost',
    decimals: 0,
    compute: (r) => {
      const t = completedAt(r)
      return t === null ? null : valueAt(r, 'cum_effort', t)
    }
  },
  {
    id: 'peakStaff',
    label: '최대 인원',
    unit: '명',
    better: 'none',
    group: 'risk',
    decimals: 0,
    compute: (r) => maxOf(r, 'total_personnel')
  }
]

const evm: EvmAdapter = {
  totalTasks: (p) => p['initial_requirements'] as number,
  credits: [{ variable: 'developed_software', label: '개발 완료 규모', weight: 1 }],
  effortVariable: 'cum_effort',
  completion: completedAt
}

/** 축이 둘뿐이라 레이더는 그리지 않는다(3개 이상일 때만). */
const radarAxes: RadarAxis[] = [
  { id: 'schedule', label: '일정', kpiId: 'completionDay' },
  { id: 'cost', label: '비용', kpiId: 'totalEffort' }
]

export const brooksEntry: ModelEntry = {
  id: 'brooks',
  title: 'Brooks 법칙',
  category: 'project',
  description:
    '프로젝트 도중 인원을 추가하면 훈련과 의사소통 오버헤드 때문에 오히려 늦어질 수 있는지 실험하는 모델입니다. (Madachy 1.4)',
  def: brooksModel,
  // 책에 FP와 SLOC의 환산 기준이 없다. 언어·조직마다 다르므로 기본값 없이 사용자가 적는다.
  size: { param: 'initial_requirements', unit: 'FP', slocPerUnit: null },
  groups: [
    {
      title: '프로젝트',
      params: [{ name: 'initial_requirements', min: 1, max: 100000, step: 10 }]
    },
    {
      title: '인력과 추가 투입',
      params: [
        { name: 'initial_experienced', min: 0, max: 200, step: 1, integer: true },
        { name: 'initial_new', min: 0, max: 200, step: 1, integer: true },
        { name: 'extra_people', min: 0, max: 500, step: 1, integer: true },
        { name: 'hire_day', min: 0, max: 400, step: 5 }
      ]
    },
    {
      title: '생산성과 오버헤드',
      params: [
        { name: 'nominal_productivity', min: 0.001, max: 10, step: 0.01 },
        { name: 'new_productivity_factor', min: 0, max: 5, step: 0.1 },
        { name: 'experienced_productivity_factor', min: 0, max: 5, step: 0.1 },
        { name: 'comm_overhead_coeff', min: 0, max: 0.01, step: 0.0001 },
        { name: 'training_overhead', min: 0, max: 1, step: 0.05 },
        { name: 'assimilation_time', min: 1, max: 365, step: 1 }
      ]
    }
  ],
  variables: [
    { name: 'developed_software', label: '개발 완료 규모', unit: 'FP' },
    { name: 'requirements', label: '남은 요구사항', unit: 'FP' },
    { name: 'software_development_rate', label: '개발률', unit: 'FP/일' },
    { name: 'cum_effort', label: '누적 투입 공수', unit: '맨데이' },
    { name: 'total_personnel', label: '총 인원', unit: '명' },
    { name: 'new_personnel', label: '신입 인원', unit: '명' },
    { name: 'experienced_personnel', label: '숙련 인원', unit: '명' },
    { name: 'communication_overhead', label: '의사소통 오버헤드', unit: '비율' }
  ],
  defaultVariable: 'software_development_rate',
  presets: [
    { label: '추가 없음', overrides: { extra_people: 0 } },
    { label: '5명 추가', overrides: { extra_people: 5 } },
    { label: '10명 추가', overrides: { extra_people: 10 } }
  ],
  kpiSpecs,
  radarAxes,
  evm,
  kpis(result) {
    const last = (name: string) => {
      const s = result.series[name]
      return s ? (s[s.length - 1] as number) : NaN
    }
    const finished = last('requirements') <= 1e-6
    const staff = result.series['total_personnel']
    return {
      completionDay: finished ? last('completion_time') : null,
      peakStaff: staff ? Math.max(...staff) : 0
    }
  }
}
