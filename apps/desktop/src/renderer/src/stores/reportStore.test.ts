import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REPORT_KINDS } from '../lib/report/model'
import { selectIsDirty, useAppStore } from './appStore'
import { useReportStore } from './reportStore'
import { defaultReportSettings } from '../lib/reportSettings'

vi.mock('../engine/engineClient', async () => {
  const { compileModel, runModel } = await import('@spd/sd-engine')
  const { modelDefs } = await import('../engine/models')
  return {
    startRun: (req: { modelId: string; overrides: Record<string, number>; options?: Record<string, number> }) => ({
      promise: Promise.resolve(runModel(compileModel(modelDefs[req.modelId] as never), { overrides: req.overrides, ...req.options })),
      cancel() {}
    })
  }
})

const store = () => useAppStore.getState()
const reports = () => store().reports
beforeEach(async () => {
  await store().newProject('brooks')
  useReportStore.setState({ reportDay: null })
})

describe('보고서 설정 (RPT-07)', () => {
  it('처음 값은 계획서 요약, 빈 제목·작성자, 절 선택 없음', () => {
    expect(reports()).toEqual(defaultReportSettings())
    expect(selectIsDirty(store())).toBe(false)
  })

  it('종류를 바꾸면 절 선택이 처음 값으로 돌아간다', () => {
    store().setReportSection('inputs', false)
    expect(reports().sections).toEqual({ inputs: false })
    store().setReportKind('scenarios')
    expect(reports().kind).toBe('scenarios')
    expect(reports().sections).toEqual({})
  })

  it('모르는 종류는 무시한다', () => {
    store().setReportKind('없는종류' as never)
    expect(reports().kind).toBe('plan')
  })

  it('제목·작성자·오래된 결과 포함·차트 크기', () => {
    store().setReportTitle('제목')
    store().setReportAuthor('나')
    store().setReportIncludeStale(true)
    store().setReportChartSize('large')
    expect(reports()).toMatchObject({ title: '제목', author: '나', includeStale: true, chartSize: 'large' })
  })

  it('제목과 작성자는 길이 한도에서 자른다', () => {
    store().setReportTitle('가'.repeat(300))
    store().setReportAuthor('나'.repeat(300))
    expect(reports().title).toHaveLength(200)
    expect(reports().author).toHaveLength(100)
  })

  it('설정을 바꾸면 프로젝트가 수정됨이 되고, 파일에 저장된다', () => {
    store().setReportTitle('월간 보고')
    store().setReportSection('baseline', false)
    expect(selectIsDirty(store())).toBe(true)
    const file = store().buildProjectFile()
    expect(file.reports).toEqual({ kind: 'plan', title: '월간 보고', author: '', sections: { baseline: false }, includeStale: false, chartSize: 'normal' })
  })

  it('처음 값이면 파일에 null로 쓴다', () => {
    store().setReportTitle('x')
    store().setReportTitle('')
    expect(store().buildProjectFile().reports).toBeNull()
  })

  it('저장한 파일을 열면 설정이 돌아오고 수정됨이 아니다. 새 프로젝트는 처음 값', async () => {
    store().setReportKind('risk')
    store().setReportTitle('위험 보고')
    store().setReportChartSize('large')
    const file = JSON.parse(JSON.stringify(store().buildProjectFile()))
    await store().newProject('brooks')
    expect(reports()).toEqual(defaultReportSettings())
    expect(await store().loadProjectFile(file, 'p.spd.json')).toBe(true)
    expect(reports()).toMatchObject({ kind: 'risk', title: '위험 보고', chartSize: 'large' })
    expect(selectIsDirty(store())).toBe(false)
  })

  it('알 수 없는 종류·절은 버리고 경고한다', async () => {
    const file = { ...store().buildProjectFile(), reports: { kind: '미래', title: 't', author: '', sections: { inputs: true, 없는절: true }, includeStale: false, chartSize: 'normal' as const } }
    expect(await store().loadProjectFile(file, 'p.spd.json')).toBe(true)
    expect(reports()).toMatchObject({ kind: 'plan', title: 't', sections: { inputs: true } })
    expect(store().notice?.details?.join(' ')).toMatch(/보고서 종류|보고서 절/)
  })

  it('실행 취소로 되돌릴 수 있다', async () => {
    store().setReportTitle('바꿈')
    await new Promise((r) => setTimeout(r, 0))
    const { performHistory } = await import('../lib/historyActions')
    performHistory('undo')
    expect(reports().title).toBe('')
  })

  it('보고 기준일은 화면 상태라 파일에 들어가지 않는다', () => {
    useReportStore.getState().setReportDay(50)
    expect(selectIsDirty(store())).toBe(false)
    expect(store().buildProjectFile().reports).toBeNull()
  })

  it('종류 목록에 이름·제목이 있다', () => {
    for (const k of REPORT_KINDS) expect(k.label.length + k.title.length).toBeGreaterThan(0)
  })
})
