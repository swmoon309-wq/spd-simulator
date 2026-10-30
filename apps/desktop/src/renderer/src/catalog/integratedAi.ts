import { lastOf, valueAt } from '@spd/analysis'
import { integratedProjectAiModel } from '@spd/models'
import { integratedEntry } from './integrated'
import type { KpiSpec, ModelEntry, ParamSpec } from './types'

type Result = Parameters<KpiSpec['compute']>[0]

/** 시험이 모두 끝난 시점의 비용 누계. 끝나지 않았거나 비용 단가를 하나도 정하지 않았으면(합계 0) null이라 비교 표에 값이 없다. */
const costAtCompletion = (name: string) => (r: Result): number | null => {
  if (lastOf(r, 'ctl_completion_rate') !== 0) return null
  if (lastOf(r, 'cost_total_cum') === 0) return null
  return valueAt(r, name, lastOf(r, 'ctl_completion_time'))
}

const EMPTY = '미완료/단가 없음'

/** 비용 지표(설계 10의 P4). 단가는 모두 입력이므로 기본값(0)에서는 값이 없다. */
const costKpis: KpiSpec[] = [
  { id: 'totalCost', label: '총 비용', unit: '만원', better: 'lower', group: 'cost', decimals: 0, emptyLabel: EMPTY, compute: costAtCompletion('cost_total_cum') },
  { id: 'laborCost', label: '인건비', unit: '만원', better: 'lower', group: 'cost', decimals: 0, emptyLabel: EMPTY, compute: costAtCompletion('cost_labor_cum') },
  { id: 'reviewCost', label: '그중 AI 출력 검토 인건비', unit: '만원', better: 'lower', group: 'cost', decimals: 0, emptyLabel: EMPTY, compute: costAtCompletion('cost_review_cum') },
  { id: 'tokenCost', label: 'AI 토큰 비용', unit: '만원', better: 'lower', group: 'cost', decimals: 0, emptyLabel: EMPTY, compute: costAtCompletion('cost_token_cum') },
  { id: 'infraCost', label: 'AI 이용료·인프라', unit: '만원', better: 'lower', group: 'cost', decimals: 0, emptyLabel: EMPTY, compute: costAtCompletion('cost_infra_cum') },
  {
    id: 'costPerTask',
    label: '태스크당 총 비용',
    unit: '만원/태스크',
    better: 'lower',
    group: 'cost',
    decimals: 1,
    emptyLabel: EMPTY,
    compute: (r, p) => {
      const c = costAtCompletion('cost_total_cum')(r)
      return c === null ? null : c / (p['total_tasks'] as number)
    }
  }
]

const p = (name: string, min: number, max: number, step: number): ParamSpec => ({ name, min, max, step })

/**
 * 통합 프로젝트 모델에 AI 보조 개발의 **생성 가속**(P0)과 **검토 부하·오류 탈출**(P1), **규모 의존 검출 효율**(P1b), **기술 부채**(P2), **계획이 믿는 효과와 실제의 차이**(P3)를 더한 확장(설계 10). 지표·진척 정의·화면 구성은 통합 프로젝트 모델과 같고,
 * 파라미터와 변수만 AI 항목이 더해진다. 새 상수의 기본값은 모두 "영향 없음"(검토 노력 0이면 검토도 부하도 없다)이라 값을 바꾸기 전에는 통합 프로젝트 모델과 같은 결과가 나온다.
 */
export const integratedAiEntry: ModelEntry = {
  ...integratedEntry,
  id: 'integrated-project-ai',
  title: '통합 프로젝트 + AI 보조 (확장, 보정 전)',
  description:
    '통합 프로젝트 모델(4섹터 단순판)에 AI 코딩 도구가 개발 속도에 미치는 영향을 더한 확장입니다. AI 적용 비율, 숙련자·신입별 생성 가속, 반복·재시도 오버헤드를 정하면 태스크당 사람 개발 시간이 달라지고, AI 출력을 숙련자가 검토하는 노력·검토 용량·검토 깊이가 오류가 빠져나가는 정도를 정합니다(생성이 빨라질수록 검토가 병목이 되고, 혼잡하면 덜 꼼꼼히 봅니다). 기본값은 모두 영향 없음이며 값은 문헌마다 크게 달라 정하지 않았습니다. 조직의 실측으로 보정하거나 위험 분석의 분포로 범위를 보세요. 큰 프로젝트에서 QA가 오류를 덜 잡고 시험에서 늦게 발견할수록 처리가 비싸지는 효과도 넣을 수 있습니다(AI와 무관하게 적용). 새 코드가 쌓는 기술 부채가 생산성을 깎고 오류를 늘리며, 리팩터링으로 갚을 수 있습니다(AI 적용 비율에 대한 적정점이 생길 수 있습니다). 계획이 믿는 생성 가속을 실제와 다르게 정하면 계획 오판이 일정·비용·오류로 나타납니다. 비용 층(맨데이 단가, 토큰 비용, 이용료·인프라)은 일정·품질 동역학에 영향을 주지 않는 출력 전용이며, 단가를 정하기 전에는 비용 지표가 나오지 않습니다(설계 10).',
  def: integratedProjectAiModel,
  groups: [
    ...integratedEntry.groups,
    {
      title: 'AI 보조 개발',
      params: [p('ai_adoption', 0, 1, 0.05), p('ai_gen_pro', 0.5, 3, 0.05), p('ai_gen_new', 0.5, 3, 0.05), p('ai_iter_overhead', 0, 2, 0.05)]
    },
    {
      title: 'AI 보조 개발: 검토와 오류',
      params: [
        p('ai_review_md_nominal', 0, 2, 0.01),
        p('ai_review_cap_fraction', 0.05, 1, 0.05),
        p('ai_review_perception_delay', 1, 60, 1),
        p('ai_verify_skill', 0, 20, 0.5),
        p('ai_miss_floor', 0, 1, 0.05),
        p('ai_err_raw_mult', 0.2, 3, 0.1)
      ]
    },
    {
      title: '검증과 규모(AI 사용과 무관하게 적용)',
      params: [p('ai_scale_ref', 20, 5000, 20), p('ai_scale_exponent', 0, 1.5, 0.05), p('ai_late_rework_mult', 0.5, 10, 0.5)]
    },
    {
      title: '계획과 인식',
      params: [p('ai_gen_perceived', 0.5, 5, 0.1)]
    },
    {
      title: '비용(출력 전용 · 일정·품질에 영향 없음)',
      params: [p('cost_md_rate', 0, 500, 1), p('cost_token_per_task', 0, 50, 0.1), p('cost_seat_per_day', 0, 10, 0.05), p('cost_infra_per_day', 0, 500, 1)]
    },
    {
      title: '기술 부채',
      params: [
        p('td_per_task', 0, 1, 0.01),
        p('td_compound', 0, 5, 0.1),
        p('ai_td_pro', 0.5, 5, 0.1),
        p('ai_td_new', 0.5, 10, 0.1),
        p('td_refactor_fraction', 0, 0.6, 0.05),
        p('td_refactor_prod', 0.1, 5, 0.1),
        p('td_obsolescence_time', 30, 3650, 30),
        p('td_sensitivity', 0, 3, 0.1),
        p('td_base_size', 0, 5000, 50),
        p('td_initial_ratio', 0, 1, 0.05)
      ]
    }
  ],
  kpiSpecs: [...integratedEntry.kpiSpecs, ...costKpis],
  variables: [
    ...integratedEntry.variables,
    { name: 'ai_dev_time_mult', label: '수작업 대비 개발 사람 시간', unit: '배' },
    { name: 'ai_gen_mix', label: '현재 인원 구성의 생성 가속', unit: '배' },
    { name: 'ai_load_ratio', label: '검토 부하 비율(수요÷용량)', unit: '비율' },
    { name: 'ai_depth', label: '검토 깊이', unit: '비율' },
    { name: 'prod_mp_review', label: '검토에 쓰는 인력', unit: '맨데이/일' },
    { name: 'ai_review_miss', label: '검토를 빠져나가는 오류 비율', unit: '비율' },
    { name: 'ai_err_factor', label: 'AI로 인한 오류 발생 배수', unit: '배' },
    { name: 'ai_scale_detect_mult', label: '규모에 따른 QA 검출 효율 배수', unit: '배' },
    { name: 'ctl_initial_estimate_md', label: '초기 맨데이 추정(계획)', unit: '맨데이' },
    { name: 'plan_dev_prod_eff', label: '계획이 쓰는 개발 생산성', unit: '태스크/맨데이' },
    { name: 'td_level', label: '기술 부채', unit: '태스크' },
    { name: 'td_ratio', label: '기술 부채 비율', unit: '비율' },
    { name: 'td_prod_mult', label: '부채로 인한 생산성 배수', unit: '배' },
    { name: 'td_err_mult', label: '부채로 인한 오류 배수', unit: '배' },
    { name: 'prod_mp_refactor', label: '리팩터링에 쓰는 인력', unit: '맨데이/일' },
    { name: 'cost_total_cum', label: '누적 총 비용', unit: '만원' },
    { name: 'cost_labor_cum', label: '누적 인건비', unit: '만원' },
    { name: 'cost_review_cum', label: '누적 AI 출력 검토 인건비', unit: '만원' },
    { name: 'cost_token_cum', label: '누적 AI 토큰 비용', unit: '만원' },
    { name: 'cost_infra_cum', label: '누적 AI 이용료·인프라', unit: '만원' },
    { name: 'cost_total_rate', label: '일 비용', unit: '만원/일' }
  ],
  presets: [
    { label: '현재 설정(AI 없음)', overrides: {} },
    { label: '예시: AI 전면 적용(숙련 1.3배·신입 1.6배)', overrides: { ai_adoption: 1, ai_gen_pro: 1.3, ai_gen_new: 1.6 } },
    { label: '예시: 반복 오버헤드가 이득을 깎음', overrides: { ai_adoption: 1, ai_gen_pro: 1.6, ai_gen_new: 1.6, ai_iter_overhead: 0.35 } },
    { label: '예시: 익숙한 코드의 숙련자는 느려짐(0.85배)', overrides: { ai_adoption: 1, ai_gen_pro: 0.85, ai_gen_new: 1.2 } },
    { label: '예시: 검토 용량이 넉넉함(가속 2배, 검토 0.15)', overrides: { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, ai_review_md_nominal: 0.15, ai_review_cap_fraction: 0.5 } },
    { label: '예시: 규모가 커져 QA가 덜 잡고 후기 발견이 2배 비쌈', overrides: { ai_scale_ref: 100, ai_scale_exponent: 0.5, ai_late_rework_mult: 2 } },
    { label: '예시: AI가 실제로는 빨라지지 않는데 계획은 2배로 믿음', overrides: { ai_adoption: 1, ai_gen_pro: 1, ai_gen_new: 1, ai_gen_perceived: 2 } },
    { label: '예시: 기대가 정확함(실제 2배, 계획도 2배)', overrides: { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, ai_gen_perceived: 2 } },
    { label: '예시: 부채를 많이 만드는 AI(가속 2배, 숙련자 5배, 부채 발생 0.1)', overrides: { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, td_per_task: 0.1, ai_td_pro: 5, ai_td_new: 5, td_compound: 1 } },
    { label: '예시: 위 설정 + 리팩터링 20%', overrides: { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, td_per_task: 0.1, ai_td_pro: 5, ai_td_new: 5, td_compound: 1, td_refactor_fraction: 0.2 } },
    { label: '예시: 단가만 입력(AI 없음, 맨데이 40·토큰 2·이용료 0.5·인프라 20)', overrides: { cost_md_rate: 40, cost_token_per_task: 2, cost_seat_per_day: 0.5, cost_infra_per_day: 20 } },
    { label: '예시: AI 전면 적용(가속 2배) + 같은 단가', overrides: { ai_adoption: 1, ai_gen_pro: 2, ai_gen_new: 2, cost_md_rate: 40, cost_token_per_task: 2, cost_seat_per_day: 0.5, cost_infra_per_day: 20 } },
    { label: '예시: 검토가 병목(가속 3배, 용량 0.15)', overrides: { ai_adoption: 1, ai_gen_pro: 3, ai_gen_new: 3, ai_review_md_nominal: 0.15, ai_review_cap_fraction: 0.15 } }
  ]
}
