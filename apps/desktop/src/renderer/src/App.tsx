import { useEffect } from 'react'
import { catalog, catalogGroups, getEntry } from './catalog'
import { ParamForm } from './components/ParamForm'
import { ProjectBar } from './components/ProjectBar'
import { ReferencePanel } from './components/ReferencePanel'
import { ControlTab } from './components/control/ControlTab'
import { HelpDialog } from './components/HelpDialog'
import { HomeTab } from './components/home/HomeTab'
import { SettingsDialog } from './components/SettingsDialog'
import { RiskTab } from './components/risk/RiskTab'
import { ValidationTab } from './components/validation/ValidationTab'
import { ScenarioTab } from './components/scenarios/ScenarioTab'
import { DataTable } from './components/DataTable'
import { ModelTab } from './components/model/ModelTab'
import { ReportTab } from './components/report/ReportTab'
import { UserModelNotice } from './components/UserModelNotice'
import { TabErrorBoundary } from './components/TabErrorBoundary'
import { RunControls } from './components/RunControls'
import { RunTable } from './components/RunTable'
import { TimeSeriesChart } from './components/TimeSeriesChart'
import { exportComparisonCsv, importReferenceCsv } from './lib/fileActions'
import { unitNote } from './lib/modelEdit/unitStatus'
import { checkDraftRecovery, startDraftAutosave } from './lib/modelEdit/draft'
import { loadModelLibrary } from './lib/modelActions'
import { checkRecovery } from './lib/recoveryActions'
import { switchModel } from './lib/projectActions'
import { useAppStore } from './stores/appStore'
import { useSettingsStore } from './stores/settingsStore'
import { useUiStore } from './stores/uiStore'

const TABS = [
  ['home', '홈'],
  ['experiment', '실험'],
  ['scenarios', '시나리오'],
  ['control', '통제'],
  ['risk', '위험 분석'],
  ['validation', '검증'],
  ['report', '보고서'],
  ['model', '모델']
] as const

/** 결과를 읽는 화면(사용자 모델 안내를 머리에 둔다) */
const RESULT_TABS: ReadonlySet<string> = new Set(['scenarios', 'control', 'risk', 'validation'])

const TAB_LABELS: Record<(typeof TABS)[number][0], string> = Object.fromEntries(TABS) as Record<(typeof TABS)[number][0], string>

export function App() {
  const modelId = useAppStore((s) => s.modelId)
  const runs = useAppStore((s) => s.runs)
  const references = useAppStore((s) => s.references)
  const live = useAppStore((s) => s.live)
  const chartVariable = useAppStore((s) => s.chartVariable)
  const setChartVariable = useAppStore((s) => s.setChartVariable)
  const runBaselineOnce = useAppStore((s) => s.runBaselineOnce)
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  const dialog = useUiStore((s) => s.dialog)
  const openSettings = useUiStore((s) => s.openSettings)
  const openHelp = useUiStore((s) => s.openHelp)
  const modelsVersion = useUiStore((s) => s.modelsVersion)
  const initSettings = useSettingsStore((s) => s.init)
  const entry = getEntry(modelId)
  const desktop = typeof window.spd !== 'undefined'
  const desktopTitle = '데스크톱 앱에서만 사용할 수 있습니다'
  const variable = entry.variables.find((v) => v.name === chartVariable) ?? (entry.variables[0] as (typeof entry.variables)[number])

  useEffect(() => {
    runBaselineOnce()
  }, [runBaselineOnce])

  // 저장된 설정(테마)을 읽어 적용한다.
  useEffect(() => {
    void initSettings()
  }, [initSettings])

  // 메뉴의 "모델" 항목에 쓸 모델 목록과 현재 모델을 main에 알린다(COM-01).
  useEffect(() => {
    window.spd?.menu.update({ models: catalog.map((m) => ({ id: m.id, title: m.title })), modelId })
  }, [modelId, modelsVersion])

  // 내 모델 목록(앱 데이터 폴더)을 읽어 앱에 올린다(COM-04)
  useEffect(() => {
    void loadModelLibrary().then(() => checkDraftRecovery())
  }, [])

  // 편집 중인 모델 초안을 자동 저장한다(비정상 종료 대비)
  useEffect(() => startDraftAutosave(), [])

  // 비정상 종료로 남은 자동 저장본이 있으면 시작할 때 복구할지 묻는다.
  useEffect(() => {
    void checkRecovery()
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>소프트웨어 프로젝트 시뮬레이터</h1>
        <div className="model-picker">
          <label htmlFor="model">모델</label>
          <select id="model" value={modelId} onChange={(e) => void switchModel(e.target.value)}>
            {catalogGroups().map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.entries.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                    {unitNote(m) ? ` ⚠ ${unitNote(m)}` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => openHelp()} title="도움말(용어 설명·예제 안내·단축키)">
            도움말
          </button>
          <button type="button" onClick={openSettings} title="설정(테마)">
            설정
          </button>
        </div>
      </header>

      <ProjectBar />

      <div className="tabs" role="tablist" aria-label="작업 화면">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className={`tab${tab === id ? ' active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {RESULT_TABS.has(tab) && <UserModelNotice />}
      <TabErrorBoundary key={tab} tabLabel={TAB_LABELS[tab]}>
      {tab === 'home' ? (
        <div role="tabpanel" id="panel-home" aria-labelledby="tab-home" className="tabpanel">
          <HomeTab onNavigate={setTab} />
        </div>
      ) : tab === 'model' ? (
        <div role="tabpanel" id="panel-model" aria-labelledby="tab-model" className="tabpanel">
          <ModelTab />
        </div>
      ) : tab === 'report' ? (
        <div role="tabpanel" id="panel-report" aria-labelledby="tab-report" className="tabpanel">
          <ReportTab />
        </div>
      ) : tab === 'validation' ? (
        <div role="tabpanel" id="panel-validation" aria-labelledby="tab-validation" className="tabpanel">
          <ValidationTab />
        </div>
      ) : tab === 'risk' ? (
        <div role="tabpanel" id="panel-risk" aria-labelledby="tab-risk" className="tabpanel">
          <RiskTab />
        </div>
      ) : tab === 'control' ? (
        <div role="tabpanel" id="panel-control" aria-labelledby="tab-control" className="tabpanel">
          <ControlTab />
        </div>
      ) : tab === 'scenarios' ? (
        <div role="tabpanel" id="panel-scenarios" aria-labelledby="tab-scenarios" className="tabpanel">
          <ScenarioTab />
        </div>
      ) : (
      <div className="app-body" role="tabpanel" id="panel-experiment" aria-labelledby="tab-experiment">
        <aside className="panel side" aria-label="설정과 실행">
          <p className="desc">{entry.description}</p>
          <RunControls />
          <ParamForm />
        </aside>

        <main className="panel main">
          <div className="chart-toolbar">
            <label htmlFor="variable">그래프 변수</label>
            <select id="variable" value={variable.name} onChange={(e) => setChartVariable(e.target.value)}>
              {entry.variables.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.label} ({v.unit})
                </option>
              ))}
            </select>
            <div className="toolbar-actions">
              <button
                type="button"
                onClick={() => void exportComparisonCsv()}
                disabled={!desktop || !runs.some((r) => r.visible)}
                title={desktop ? '표시 중인 실행의 이 변수를 CSV 한 파일로 저장' : desktopTitle}
              >
                비교 CSV 저장…
              </button>
              <button type="button" onClick={() => void importReferenceCsv()} disabled={!desktop} title={desktop ? '실제 프로젝트 데이터 등 외부 CSV를 그래프에 겹쳐 표시' : desktopTitle}>
                기준 행동 가져오기…
              </button>
            </div>
          </div>
          <TimeSeriesChart runs={runs} references={references} live={live} variable={variable} />
          <RunTable />
          <DataTable />
          <ReferencePanel />
        </main>
      </div>
      )}
      </TabErrorBoundary>
      {dialog?.kind === 'settings' && <SettingsDialog />}
      {dialog?.kind === 'help' && <HelpDialog initialTopic={dialog.topic} />}
    </div>
  )
}
