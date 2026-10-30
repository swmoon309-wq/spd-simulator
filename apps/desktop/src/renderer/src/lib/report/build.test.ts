import { describe, expect, it } from 'vitest'
import { compileModel, runModel } from '@spd/sd-engine'
import { catalog, getEntry } from '../../catalog'
import { modelDefs } from '../../engine/models'
import { createAdoption } from '../adoption'
import { defaultRiskSettings } from '../risk'
import { defaultParams } from '../params'
import { defaultRunSettings } from '../runSettings'
import { BASE_ID, taskFor, type ScenarioInputs, type ScenarioRun } from '../scenarioRunner'
import { buildComparison, formatValue } from '../scenarioCompare'
import { buildReport } from './build'
import { renderReportHtml } from './render'
import { EMPTY_CONTROL_STATE, EMPTY_RISK_STATE, type ReportOptions, type ReportState } from './model'

const DATE = new Date('2026-10-22T05:00:00.000Z')

function stateFor(modelId = 'brooks', over: Partial<ReportState> = {}, ran: 'all' | 'base' | 'none' = 'all'): ReportState {
  const entry = getEntry(modelId)
  const params = defaultParams(entry)
  const runSettings = defaultRunSettings(entry)
  const scenarios = [{ id: 's1', name: '5명 추가', note: '지연 만회', overrides: modelId === 'brooks' ? { extra_people: 5 } : { [Object.keys(params)[0] as string]: (params[Object.keys(params)[0] as string] as number) * 1.1 } }]
  const inputs: ScenarioInputs = { modelId, params, settings: runSettings, scenarios }
  const scenarioRuns: Record<string, ScenarioRun | undefined> = {}
  const ids = ran === 'all' ? [BASE_ID, 's1'] : ran === 'base' ? [BASE_ID] : []
  for (const id of ids) {
    const task = taskFor(inputs, id)!
    scenarioRuns[id] = { result: runModel(compileModel(modelDefs[modelId] as never), { overrides: task.params, end: task.settings.end, dt: task.settings.dt, seed: task.settings.seed }), resultKey: task.key, resultParams: task.params, phase: 'idle', progress: 1 }
  }
  return { entry, projectName: '내 프로젝트', description: '고객 A의 일정 검토', params, runSettings, scenarios, scenarioRuns, adopted: null, risk: EMPTY_RISK_STATE(defaultRiskSettings()), control: EMPTY_CONTROL_STATE, validation: null, appName: '소프트웨어 프로젝트 시뮬레이터 0.1.0', ...over }
}
const opts = (over: Partial<ReportOptions> = {}): ReportOptions => ({ kind: 'plan', date: DATE, ...over })
const ids = (r: ReturnType<typeof buildReport>) => r.doc.sections.map((s) => s.id)
const section = (r: ReturnType<typeof buildReport>, id: string) => r.doc.sections.find((s) => s.id === id)!
const text = (r: ReturnType<typeof buildReport>) => JSON.stringify(r.doc)

describe('계획서 요약 (RPT-01)', () => {
  it('최신인 절만 기본으로 켜지고 읽을 때·만든 조건은 항상 들어간다', () => {
    const r = buildReport(stateFor(), opts())
    expect(ids(r)).toEqual(['overview', 'inputs', 'baseline', 'scenarios', 'reading', 'conditions']) // 채택 계획이 없어 adopted는 꺼짐
    expect(r.sections.find((s) => s.id === 'adopted')).toMatchObject({ status: 'na', enabled: false })
    expect(r.sections.filter((s) => s.locked).map((s) => s.id)).toEqual(['reading', 'conditions'])
    expect(r.doc.title).toBe('내 프로젝트 — 계획서 요약')
  })

  it('개요: 프로젝트·모델·설명과 현재 입력의 기준 실행 요약(화면과 같은 값 274.1일)', () => {
    const r = buildReport(stateFor(), opts({ author: '홍길동' }))
    const o = section(r, 'overview')
    expect(o.blocks[0]).toMatchObject({ kind: 'keyValues' })
    expect(text(r)).toContain('고객 A의 일정 검토')
    expect(text(r)).toContain('완료일 274.1일')
    expect(text(r)).toContain('홍길동')
  })

  it('입력: 그룹별 표, 기본값과 다른 값은 굵게 표시하고 개수를 알린다', () => {
    const state = stateFor()
    const r = buildReport({ ...state, params: { ...state.params, extra_people: 7 } }, opts())
    const inputs = section(r, 'inputs')
    const tables = inputs.blocks.filter((b) => b.kind === 'table')
    expect(tables.map((t) => t.kind === 'table' && t.caption)).toEqual(state.entry.groups.map((g) => g.title))
    const row = tables.flatMap((t) => (t.kind === 'table' ? t.rows : [])).find((row) => row[0] === '추가 투입 인원')!
    expect(row[1]).toEqual({ text: '7 명', tone: 'strong' })
    expect(row[2]).toBe('0 명')
    expect(JSON.stringify(inputs.blocks)).toContain('굵게 표시한 값은 기본값과 다릅니다(1개: 추가 투입 인원)')
  })

  it('기준 실행 결과: 지표 표와 시계열 차트(SVG, 대체 문장)', () => {
    const b = section(buildReport(stateFor(), opts()), 'baseline')
    expect(b.blocks[0]).toMatchObject({ kind: 'table', caption: '지표' })
    const chart = b.blocks.find((x) => x.kind === 'chart')!
    expect(chart).toMatchObject({ kind: 'chart' })
    if (chart.kind === 'chart') {
      expect(chart.svg.startsWith('<svg')).toBe(true)
      expect(chart.alt).toContain('기준 실행의')
    }
  })

  it('채택 계획: 없으면 해당 없음, 있으면 요약과 채택 뒤 바뀐 입력', () => {
    const state = stateFor()
    const task = taskFor({ modelId: 'brooks', params: state.params, settings: state.runSettings, scenarios: state.scenarios }, BASE_ID)!
    const made = createAdoption({ entry: state.entry, scenarioId: '@base', scenarioName: '기준', task, run: state.scenarioRuns[BASE_ID], now: DATE })
    expect(made.ok).toBe(true)
    const adopted = made.ok ? made.adopted : null
    const same = buildReport({ ...state, adopted }, opts())
    const a = section(same, 'adopted')
    expect(a.status).toBe('fresh')
    expect(JSON.stringify(a.blocks)).toContain('채택한 시나리오')
    expect(JSON.stringify(a.blocks)).toContain('계획 완료 274.1일')
    const drift = buildReport({ ...state, adopted, params: { ...state.params, extra_people: 3 } }, opts())
    expect(JSON.stringify(section(drift, 'adopted').blocks)).toContain('채택한 뒤 바뀐 입력이 1개')
  })

  it('시나리오 절: 기준과 다른 값과 메모', () => {
    const s = section(buildReport(stateFor(), opts()), 'scenarios')
    expect(JSON.stringify(s.blocks)).toContain('5명 추가')
    expect(JSON.stringify(s.blocks)).toContain('지연 만회')
    expect(JSON.stringify(s.blocks)).toContain('추가 투입 인원')
  })
})

describe('시나리오 비교 (RPT-02)', () => {
  const o = opts({ kind: 'scenarios' })

  it('모두 실행했으면 비교표·차트가 최신으로 들어가고 값이 화면의 포맷과 같다', () => {
    const state = stateFor()
    const r = buildReport(state, o)
    expect(ids(r)).toEqual(['overview', 'scenarios', 'comparison', 'charts', 'reading', 'conditions'])
    expect(r.sections.find((s) => s.id === 'comparison')?.status).toBe('fresh')
    const comparison = buildComparison(state.entry, { modelId: 'brooks', params: state.params, settings: state.runSettings, scenarios: state.scenarios }, state.scenarioRuns)
    const spec = comparison.groups[0]!.rows[0]!.spec
    const baseText = formatValue(spec, comparison.columns[0]!.kpis![spec.id] ?? null)
    const table = section(r, 'comparison').blocks.find((b) => b.kind === 'table')!
    expect(table.kind === 'table' && table.rows[0]![1]).toBe(baseText.replace(/ /g, '\u00a0')) // 값과 단위 사이는 줄바꿈하지 않는 공백
    // 시나리오 칸에는 차이가 화살표와 판정 글자로 함께 나온다(색에만 의존하지 않는다)
    const cell = table.kind === 'table' ? table.rows[0]![2] : ''
    expect(typeof cell === 'object' ? cell.text : cell).toMatch(/\([▲▼＝] .*\)/)
    expect(table.kind === 'table' && table.columns.map((c) => c.label)).toEqual(['지표', '기준', '5명 추가'])
  })

  it('차트: 일정·비용 막대와 시계열이 들어가고 각 차트에 값 표가 있다(Brooks는 축이 둘이라 레이더 없음)', () => {
    const charts = section(buildReport(stateFor(), o), 'charts').blocks.filter((b) => b.kind === 'chart')
    const titles = charts.map((c) => (c.kind === 'chart' ? c.title : ''))
    expect(titles[0]).toBe('완료일 비교')
    expect(titles.some((t) => t.includes('실행 겹쳐 보기'))).toBe(true)
    expect(titles.some((t) => t.includes('레이더'))).toBe(false)
    for (const c of charts) if (c.kind === 'chart') expect(c.table).toBeDefined()
  })

  it('입력이 바뀌어 결과가 오래되면 숫자를 싣지 않고 이유를 적는다(기본 꺼짐)', () => {
    const state = stateFor()
    const stale = { ...state, params: { ...state.params, extra_people: 2 } }
    const r = buildReport(stale, o)
    const info = r.sections.find((s) => s.id === 'comparison')!
    expect(info).toMatchObject({ status: 'stale', enabled: false, defaultOn: false })
    expect(info.reason).toContain('오래된 결과')
    // 사용자가 켜도 숫자는 싣지 않는다
    const forced = buildReport(stale, { ...o, sections: { comparison: true, charts: true } })
    const cmp = section(forced, 'comparison')
    expect(cmp.blocks).toHaveLength(1)
    expect(JSON.stringify(cmp.blocks)).toContain('숫자를 싣지 않았습니다')
    expect(JSON.stringify(cmp.blocks)).not.toContain('274.1')
    expect(section(forced, 'charts').blocks.some((b) => b.kind === 'chart')).toBe(false)
  })

  it('"오래된 결과 포함"을 켜면 경고 표시와 함께 숫자를 싣는다', () => {
    const state = stateFor()
    const stale = { ...state, params: { ...state.params, extra_people: 2 } }
    const r = buildReport(stale, { ...o, includeStale: true, sections: { comparison: true } })
    const cmp = section(r, 'comparison')
    expect(cmp.status).toBe('stale')
    expect(cmp.blocks[0]).toMatchObject({ kind: 'callout', title: '오래된 결과 포함' })
    const table = cmp.blocks.find((b) => b.kind === 'table')!
    // 시나리오가 직접 정한 값(추가 5명)은 기준을 바꿔도 그대로라서 그 결과는 최신이다.
    expect(table.kind === 'table' && table.columns.map((c) => c.label)).toEqual(['지표', '기준 (오래됨)', '5명 추가'])
  })

  it('실행하지 않았으면 없음이고, 일부만 했으면 일부 없음으로 알린다', () => {
    const none = buildReport(stateFor('brooks', {}, 'none'), o)
    expect(none.sections.find((s) => s.id === 'comparison')).toMatchObject({ status: 'missing', enabled: false })
    expect(none.sections.find((s) => s.id === 'comparison')?.reason).toContain('실행하지 않았습니다')
    const part = buildReport(stateFor('brooks', {}, 'base'), o)
    const info = part.sections.find((s) => s.id === 'comparison')!
    expect(info.status).toBe('stale')
    expect(info.reason).toContain('아직 실행하지 않음: 5명 추가')
  })

  it('통합 모델은 축이 셋 이상이라 레이더가 들어간다', () => {
    const charts = section(buildReport(stateFor('integrated-project'), o), 'charts').blocks.filter((b) => b.kind === 'chart')
    expect(charts.some((c) => c.kind === 'chart' && c.title.includes('레이더'))).toBe(true)
  })
})

describe('읽을 때와 만든 조건', () => {
  it('고정 문구와 모델별 문구가 항상 있다', () => {
    for (const [id, expected] of [['brooks', '274일'], ['integrated-project', '보정되지 않았습니다'], ['rayleigh', '학습용 모델']] as const) {
      const reading = section(buildReport(stateFor(id), opts()), 'reading')
      const t = JSON.stringify(reading.blocks)
      expect(t).toContain('예측이 아니라')
      expect(t).toContain('합격·불합격을 선언하지 않고')
      expect(t).toContain(expected)
    }
  })

  it('최신이 아니거나 빠진 자료 목록이 나온다', () => {
    const r = buildReport(stateFor('brooks', {}, 'none'), opts({ kind: 'scenarios' }))
    const callout = section(r, 'reading').blocks.find((b) => b.kind === 'callout')!
    expect(callout.kind === 'callout' && callout.text).toContain('지표 비교: 없음')
    expect(callout.kind === 'callout' && callout.text).toContain('싣지 않음')
  })

  it('만든 조건: 앱, 모델 버전, 실행 설정, 만든 시각', () => {
    const c = section(buildReport(stateFor(), opts()), 'conditions')
    const t = JSON.stringify(c.blocks)
    expect(t).toContain('소프트웨어 프로젝트 시뮬레이터 0.1.0')
    expect(t).toContain('brooks v1')
    expect(t).toContain('종료 시각 400일')
    expect(t).toContain('2026-10-22T05:00:00.000Z')
  })
})

describe('보고서 전체', () => {
  it('같은 입력은 같은 문서와 같은 HTML이다(결정적)', () => {
    const a = buildReport(stateFor(), opts({ kind: 'scenarios' }))
    const b = buildReport(stateFor(), opts({ kind: 'scenarios' }))
    expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc))
    expect(renderReportHtml(a.doc)).toBe(renderReportHtml(b.doc))
  })

  it('프로젝트 이름·메모의 HTML 문자가 문서에 문자 그대로(이스케이프되어) 나온다', () => {
    const evil = '<script>alert(1)</script>'
    const state = stateFor()
    const r = buildReport({ ...state, projectName: evil, description: evil, scenarios: [{ ...state.scenarios[0]!, name: evil, note: evil }] }, opts({ kind: 'scenarios', title: evil, author: evil }))
    const html = renderReportHtml(r.doc)
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('선택하지 않은 절은 빠지고 제목·작성자는 길이가 제한된다', () => {
    const r = buildReport(stateFor(), opts({ sections: { inputs: false, scenarios: false }, title: '가'.repeat(500), author: '나'.repeat(500) }))
    expect(ids(r)).toEqual(['overview', 'baseline', 'reading', 'conditions'])
    expect(r.doc.title).toHaveLength(200)
    expect(r.doc.meta.author).toHaveLength(100)
  })

  it('카탈로그의 모든 모델에서 두 보고서가 예외 없이 만들어지고 HTML이 나온다', () => {
    for (const entry of catalog) {
      for (const kind of ['plan', 'scenarios'] as const) {
        const r = buildReport(stateFor(entry.id), opts({ kind, sections: Object.fromEntries(['overview', 'inputs', 'baseline', 'adopted', 'scenarios', 'comparison', 'charts'].map((s) => [s, true])) }))
        const html = renderReportHtml(r.doc)
        expect(html.length, `${entry.id} ${kind}`).toBeGreaterThan(2000)
        expect(html).not.toContain('<script')
        expect(r.doc.sections.at(-1)?.id).toBe('conditions')
      }
    }
  })
})
