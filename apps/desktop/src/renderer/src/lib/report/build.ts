import type { ReportDoc, ReportSection, SectionId } from '../../../../shared/reportDoc'
import { buildComparison } from '../scenarioCompare'
import type { BuildResult, ReportOptions, ReportState, SectionInfo } from './model'
import { REPORT_KINDS } from './model'
import { riskCompareSection, riskConvergenceSection, riskInputsSection, riskResultsSection, riskSensitivitySection, riskTargetsSection } from './riskSections'
import { statusActionsSection, statusAlertsSection, statusChartsSection, statusForecastSection, statusIndicatorsSection } from './statusSections'
import { validationSection } from './validationSections'
import { adoptedSection, baselineSection, chartsSection, comparisonSection, conditionsSection, inputsSection, overviewSection, readingSection, runBaseline, scenariosSection, type Built } from './sections'

interface SectionPlan {
  id: SectionId
  title: string
  build(): Built
  /** 항상 들어간다(끌 수 없다) */
  locked?: boolean
}

/**
 * 보고서를 만든다(설계 09의 3·4장). 종류마다 절 구성이 정해져 있고, 절마다 자료 상태(최신·오래됨·없음·해당 없음)를 판단한다.
 * 켜진 절만 문서에 들어가며 기본은 최신인 절만 켠다. 오래된 결과는 `includeStale`이 아니면 숫자를 싣지 않고 이유만 적는다.
 * 순수 함수다(입력이 같으면 같은 문서). 기준 실행만은 현재 입력으로 그 자리에서 계산한다(재현 가능하고 몇 ms라서).
 */
export function buildReport(state: ReportState, options: ReportOptions): BuildResult {
  const baseline = runBaseline(state)
  const comparison = buildComparison(state.entry, { modelId: state.entry.id, params: state.params, settings: state.runSettings, scenarios: state.scenarios }, state.scenarioRuns)

  const plans: SectionPlan[] =
    options.kind === 'risk'
      ? [
          { id: 'overview', title: '개요', build: () => overviewSection(state, options, baseline) },
          { id: 'riskInputs', title: '불확실한 입력(분포)', build: () => riskInputsSection(state) },
          { id: 'riskResults', title: '결과 분포', build: () => riskResultsSection(state, options) },
          { id: 'riskTargets', title: '목표 달성 확률', build: () => riskTargetsSection(state, options) },
          { id: 'riskSensitivity', title: '민감도', build: () => riskSensitivitySection(state, options) },
          { id: 'riskConvergence', title: '수렴 진단', build: () => riskConvergenceSection(state, options) },
          { id: 'riskCompare', title: '시나리오 간 비교 확률', build: () => riskCompareSection(state, options) }
        ]
      : options.kind === 'status'
        ? [
            { id: 'overview', title: '개요', build: () => overviewSection(state, options, baseline) },
            { id: 'statusIndicators', title: '보고일 기준 지표', build: () => statusIndicatorsSection(state, options) },
            { id: 'statusCharts', title: '추이 차트', build: () => statusChartsSection(state, options) },
            { id: 'statusAlerts', title: '경고', build: () => statusAlertsSection(state, options) },
            { id: 'statusForecast', title: '완료 예측과 재예측', build: () => statusForecastSection(state, options) },
            { id: 'statusActions', title: '시정 조치와 기준선 개정', build: () => statusActionsSection(state, options) }
          ]
        : options.kind === 'plan'
      ? [
          { id: 'overview', title: '개요', build: () => overviewSection(state, options, baseline) },
          { id: 'inputs', title: '입력', build: () => inputsSection(state) },
          { id: 'baseline', title: '기준 실행 결과', build: () => baselineSection(state, options, baseline) },
          { id: 'adopted', title: '채택 계획', build: () => adoptedSection(state) },
          { id: 'scenarios', title: '시나리오', build: () => scenariosSection(state) }
        ]
      : [
          { id: 'overview', title: '개요', build: () => overviewSection(state, options, baseline) },
          { id: 'scenarios', title: '시나리오 목록과 기준과 다른 값', build: () => scenariosSection(state) },
          { id: 'comparison', title: '지표 비교', build: () => comparisonSection(state, options, comparison) },
          { id: 'charts', title: '차트', build: () => chartsSection(state, options, comparison) },
          { id: 'adopted', title: '채택 계획', build: () => adoptedSection(state) }
        ]

  plans.push({ id: 'validation', title: '모델 검증', build: () => validationSection(state) })
  const built = plans.map((p) => ({ plan: p, built: p.build() }))
  const enabledOf = (id: SectionId, status: Built['status']): boolean => options.sections?.[id] ?? status === 'fresh'

  const sections: SectionInfo[] = built.map(({ plan, built: b }) => ({
    id: plan.id,
    title: plan.title,
    status: b.status,
    reason: b.reason,
    defaultOn: b.status === 'fresh',
    locked: false,
    enabled: enabledOf(plan.id, b.status)
  }))

  const bodySections: ReportSection[] = built.filter((_, i) => sections[i]?.enabled).map(({ plan, built: b }) => ({ id: plan.id, title: plan.title, status: b.status, blocks: b.blocks }))

  const notFresh = built.flatMap(({ plan, built: b }, i) => (b.status === 'fresh' ? [] : [{ title: plan.title, status: b.status, included: sections[i]?.enabled === true, reason: b.reason }]))
  const reading = readingSection(state, notFresh)
  const conditions = conditionsSection(state, options)
  const tail: ReportSection[] = [
    { id: 'reading', title: '이 보고서를 읽을 때', status: 'fresh', blocks: reading.blocks },
    { id: 'conditions', title: '만든 조건', status: 'fresh', blocks: conditions.blocks }
  ]
  sections.push({ id: 'reading', title: '이 보고서를 읽을 때', status: 'fresh', reason: null, defaultOn: true, locked: true, enabled: true }, { id: 'conditions', title: '만든 조건', status: 'fresh', reason: null, defaultOn: true, locked: true, enabled: true })

  const kind = REPORT_KINDS.find((k) => k.kind === options.kind)
  const title = (options.title?.trim() || `${state.projectName} — ${kind?.title ?? ''}`).slice(0, 200)
  const doc: ReportDoc = {
    title,
    subtitle: state.entry.title,
    meta: {
      ...(options.author?.trim() ? { author: options.author.trim().slice(0, 100) } : {}),
      date: options.date.toISOString(),
      app: state.appName,
      model: { id: state.entry.id, name: state.entry.title, version: state.entry.def.meta.version }
    },
    sections: [...bodySections, ...tail]
  }
  return { doc, sections }
}
