import { useEffect, useMemo, useState } from 'react'
import { REPORT_LIMITS, STATUS_LABELS, type SectionId } from '../../../../shared/reportDoc'
import { reportFileName, reportStateFrom } from '../../lib/report/actions'
import { buildReport } from '../../lib/report/build'
import { makeable, makeMissingResults } from '../../lib/report/make'
import { REPORT_KINDS, type ReportKind } from '../../lib/report/model'
import { renderReportHtml } from '../../lib/report/render'
import { useAppStore } from '../../stores/appStore'
import { useReportStore } from '../../stores/reportStore'

/** 보고서 탭(설계 09의 7장): 종류·설정·절 선택, 자료 상태, 미리보기, HTML 저장. */
export function ReportTab() {
  const settings = useAppStore((s) => s.reports)
  const reportDay = useReportStore((s) => s.reportDay)
  // 설정은 프로젝트의 일부(앱 스토어), 보고 기준일은 화면 상태(reportStore). 화면에서는 하나로 다룬다.
  const report = useMemo(() => {
    const a = useAppStore.getState()
    return {
      ...settings,
      reportDay,
      setKind: a.setReportKind,
      setTitle: a.setReportTitle,
      setAuthor: a.setReportAuthor,
      setSection: a.setReportSection,
      setIncludeStale: a.setReportIncludeStale,
      setChartSize: a.setReportChartSize,
      setReportDay: useReportStore.getState().setReportDay
    }
  }, [settings, reportDay])
  // 보고서에 쓰는 입력이 바뀌면 다시 만든다(원시값이 아니라 참조를 구독한다).
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const runSettings = useAppStore((s) => s.runSettings)
  const scenarios = useAppStore((s) => s.scenarios)
  const scenarioRuns = useAppStore((s) => s.scenarioRuns)
  const adopted = useAppStore((s) => s.adopted)
  const projectName = useAppStore((s) => s.projectName)
  const description = useAppStore((s) => s.projectDescription)
  const busy = useAppStore((s) => s.batch !== null || s.status === 'running')
  const setNotice = useAppStore((s) => s.setNotice)
  const [appName, setAppName] = useState('소프트웨어 프로젝트 시뮬레이터')
  const [view, setView] = useState<'screen' | 'a4'>('screen')
  const [saving, setSaving] = useState(false)
  const desktop = typeof window.spd !== 'undefined'

  useEffect(() => {
    void window.spd?.app.info().then((i) => setAppName(`${i.name} ${i.version}`))
  }, [])

  // 제목을 치는 중에 매번 차트를 다시 그리지 않도록 잠깐 기다린다.
  const [settled, setSettled] = useState(report)
  useEffect(() => {
    const t = setTimeout(() => setSettled(report), 250)
    return () => clearTimeout(t)
  }, [report])

  const built = useMemo(() => {
    const state = reportStateFrom(appName)
    return buildReport(state, {
      kind: settled.kind,
      date: new Date(),
      includeStale: settled.includeStale,
      chartSize: settled.chartSize,
      sections: settled.sections,
      reportDay: settled.reportDay,
      ...(settled.title.trim() ? { title: settled.title } : {}),
      ...(settled.author.trim() ? { author: settled.author } : {})
    })
    // 입력이 바뀌면 다시 만든다. `date`는 만들 때의 시각이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, appName, modelId, params, runSettings, scenarios, scenarioRuns, adopted, projectName, description])

  const html = useMemo(() => renderReportHtml(built.doc), [built])
  const tooBig = html.length > REPORT_LIMITS.maxHtmlBytes
  const kindLabel = REPORT_KINDS.find((k) => k.kind === report.kind)?.label ?? '보고서'
  const needsRuns = makeable(report.kind, built.sections)
  const [makeMessages, setMakeMessages] = useState<string[]>([])
  const [making, setMaking] = useState(false)
  const actuals = useAppStore((s) => s.actuals)
  const reportDays = useMemo(() => actuals.map((a) => a.day), [actuals])

  const saveHtml = async () => {
    if (!window.spd) return
    setSaving(true)
    try {
      const r = await window.spd.files.exportHtml({ suggestedName: reportFileName(projectName, kindLabel), content: html })
      if (r.status === 'saved') setNotice({ kind: 'info', text: `보고서를 저장했습니다: ${r.fileName}` })
      else if (r.status === 'error') setNotice({ kind: 'error', text: r.message })
    } finally {
      setSaving(false)
    }
  }

  const savePdf = async () => {
    if (!window.spd) return
    setSaving(true)
    try {
      const r = await window.spd.report.exportPdf({ suggestedName: reportFileName(projectName, kindLabel), content: html })
      if (r.status === 'saved') setNotice({ kind: 'info', text: `보고서를 저장했습니다: ${r.fileName}` })
      else if (r.status === 'error') setNotice({ kind: 'error', text: r.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="report-tab">
      <section className="report-controls" aria-label="보고서 설정">
        <div className="row wrap">
          <label htmlFor="report-kind">종류</label>
          <select id="report-kind" value={report.kind} onChange={(e) => report.setKind(e.target.value as ReportKind)}>
            {REPORT_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <label htmlFor="report-title">제목</label>
          <input id="report-title" type="text" maxLength={REPORT_LIMITS.title} placeholder={`${projectName} — ${kindLabel}`} value={report.title} onChange={(e) => report.setTitle(e.target.value)} />
          <label htmlFor="report-author">작성자</label>
          <input id="report-author" type="text" maxLength={REPORT_LIMITS.author} placeholder="(선택)" value={report.author} onChange={(e) => report.setAuthor(e.target.value)} />
        </div>

        {report.kind === 'status' && (
          <div className="row wrap">
            <label htmlFor="report-day">보고 기준일</label>
            <select id="report-day" value={report.reportDay ?? ''} onChange={(e) => report.setReportDay(e.target.value === '' ? null : Number(e.target.value))} disabled={reportDays.length === 0}>
              <option value="">최근 보고일</option>
              {reportDays.map((d) => (
                <option key={d} value={d}>
                  {d}일
                </option>
              ))}
            </select>
          </div>
        )}

        <fieldset className="report-sections">
          <legend>절</legend>
          <ul>
            {built.sections.map((s) => (
              <li key={s.id}>
                <label>
                  <input type="checkbox" checked={s.enabled} disabled={s.locked} onChange={(e) => report.setSection(s.id as SectionId, e.target.checked)} />
                  {s.title}
                </label>
                <span className={`status ${s.status}`}>{STATUS_LABELS[s.status]}</span>
                {s.reason && <span className="muted reason">{s.reason}</span>}
                {s.locked && <span className="muted reason">항상 포함</span>}
              </li>
            ))}
          </ul>
          <div className="row wrap">
            <label>
              <input type="checkbox" checked={report.includeStale} onChange={(e) => report.setIncludeStale(e.target.checked)} />
              오래된 결과 포함(경고 표시와 함께)
            </label>
            <label htmlFor="report-chart-size">차트 크기</label>
            <select id="report-chart-size" value={report.chartSize} onChange={(e) => report.setChartSize(e.target.value as 'normal' | 'large')}>
              <option value="normal">보통</option>
              <option value="large">크게</option>
            </select>
          </div>
        </fieldset>

        <div className="row wrap">
          <button
            type="button"
            onClick={() => {
              setMaking(true)
              void makeMissingResults(report.kind).then((m) => {
                setMakeMessages(m)
                setMaking(false)
              })
            }}
            disabled={busy || making || !needsRuns}
            title={needsRuns ? '없거나 오래된 결과를 지금 실행해 채웁니다(시나리오 일괄 실행, 위험 분석 등)' : report.kind === 'status' ? '재예측·시정 조치 시험은 통제 탭에서 직접 실행합니다' : '필요한 결과가 이미 최신입니다'}
          >
            {making ? '만드는 중…' : '필요한 결과 만들기'}
          </button>
          <button type="button" className="primary" onClick={() => void saveHtml()} disabled={!desktop || saving || tooBig} title={desktop ? (tooBig ? '보고서가 너무 큽니다' : undefined) : '데스크톱 앱에서만 사용할 수 있습니다'}>
            HTML로 저장…
          </button>
          <button type="button" className="primary" onClick={() => void savePdf()} disabled={!desktop || saving || tooBig} title={desktop ? (tooBig ? '보고서가 너무 큽니다' : 'A4 PDF로 저장(쪽 번호·개요 포함)') : '데스크톱 앱에서만 사용할 수 있습니다'}>
            {saving ? '저장 중…' : 'PDF로 저장…'}
          </button>
        </div>
      </section>

      <section className="report-preview" aria-label="미리보기">
        {makeMessages.length > 0 && (
          <div className="field-error" role="alert">
            {makeMessages.join(' ')}
          </div>
        )}
        <div className="row">
          <h2 className="section-title">미리보기</h2>
          <button type="button" className={view === 'screen' ? 'active' : ''} aria-pressed={view === 'screen'} onClick={() => setView('screen')}>
            화면
          </button>
          <button type="button" className={view === 'a4' ? 'active' : ''} aria-pressed={view === 'a4'} onClick={() => setView('a4')}>
            A4
          </button>
          <span className="muted">내보내는 파일과 같은 문서입니다.</span>
        </div>
        <div className={`report-frame ${view}`}>
          {/* 스크립트·폼·팝업이 없는 격리된 문서(설계 09의 6.3) */}
          <iframe title="보고서 미리보기" sandbox="" srcDoc={html} />
        </div>
      </section>
    </div>
  )
}
