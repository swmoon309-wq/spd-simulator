import { useMemo, useState } from 'react'
import { catalogGroups } from '../../catalog'
import { analyze } from '../../lib/modelEdit/analysis'
import { addVariable, changeFlowKind, deleteVariable, renameVariable, setField, setInfo, setMeta, setUnitAliases, type FieldEdit, type VarKind } from '../../lib/modelEdit/commands'
import { addSector, assignToSector, autoLayoutDoc, connect, deleteSector, disconnect, flipFlow, renameSector, sectorOfVariable, setPositions, setSectorColor, toggleSectorCollapsed } from '../../lib/modelEdit/diagramEdit'
import { buildDiagram } from '../../lib/modelEdit/layout'
import { switchModel } from '../../lib/projectActions'
import { askConfirm } from '../../lib/confirm'
import { useAppStore } from '../../stores/appStore'
import { selectCanRedo, selectCanUndo, selectDirty, selectRedoLabel, selectUndoLabel, useEditorStore, type ApplyOutcome } from '../../stores/editorStore'
import { useUiStore } from '../../stores/uiStore'
import { ApplyPanel } from './ApplyPanel'
import { CausalView } from './CausalView'
import { CurveEditor } from './CurveEditor'
import { DiagramView, describeEdge } from './DiagramView'
import { PalettePanel } from './PalettePanel'
import { SectorPanel } from './SectorPanel'
import { ProblemsPanel } from './ProblemsPanel'
import { Properties } from './Properties'
import { SpecEditor } from './SpecEditor'
import { VariableList } from './VariableList'
import { VariableTable } from './VariableTable'

/**
 * 모델 탭(EDT-02·EDT-08, 설계 08의 9장): 변수 목록, 표, 속성(수식 편집기), 앱 연결 정보, 문제 패널, 적용. 편집은 초안에서 하고 "적용"해야 앱의 모델이 된다.
 * 내장 모델은 직접 고치지 않고 사본으로 연다. 이 화면에서 하는 모든 편집은 키보드와 표·목록으로 할 수 있다(캔버스는 뒤 단계).
 */
export function ModelTab() {
  const doc = useEditorStore((s) => s.doc)
  const dirty = useEditorStore(selectDirty)
  const selected = useEditorStore((s) => s.selected)
  const message = useEditorStore((s) => s.message)
  const gate = useEditorStore((s) => s.gate)
  const canUndo = useEditorStore(selectCanUndo)
  const canRedo = useEditorStore(selectCanRedo)
  const undoLabel = useEditorStore(selectUndoLabel)
  const redoLabel = useEditorStore(selectRedoLabel)
  const ed = useEditorStore.getState
  useUiStore((s) => s.modelsVersion) // 내 모델이 바뀌면 "열기" 목록을 다시 그린다
  const currentModelId = useAppStore((s) => s.modelId)
  const [view, setView] = useState<'table' | 'diagram' | 'causal' | 'sectors' | 'curves' | 'palette' | 'spec'>('table')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState<ApplyOutcome | null>(null)
  const [showApply, setShowApply] = useState(false)
  const analysis = useMemo(() => (doc ? analyze(doc) : null), [doc])

  const confirmLeave = async () => !useEditorStore.getState().doc || !selectDirty(useEditorStore.getState()) || (await askConfirm({ message: '저장(적용)하지 않은 편집이 있습니다.', detail: '버리고 다른 모델을 열까요?', ok: '버리고 열기', cancel: '취소' }))
  const open = async (what: 'current' | 'blank' | string) => {
    if (!(await confirmLeave())) return
    setOutcome(null)
    setShowApply(false)
    if (what === 'current') ed().openCurrent()
    else if (what === 'blank') ed().openBlank()
    else ed().openInstalled(what)
  }

  const header = (
    <div className="model-toolbar" role="toolbar" aria-label="모델 편집">
      <label htmlFor="model-open">열기</label>
      <select id="model-open" value="" onChange={(e) => e.target.value && open(e.target.value)}>
        <option value="">모델 고르기…</option>
        <option value="current">현재 프로젝트의 모델{`(${currentModelId})`}</option>
        <option value="blank">빈 모델 만들기</option>
        {catalogGroups()
          .filter((g) => g.label === '내 모델')
          .flatMap((g) => g.entries)
          .map((m) => (
            <option key={m.id} value={m.id}>
              내 모델: {m.title}
            </option>
          ))}
      </select>
      {doc && (
        <>
          <strong className="model-title">
            {doc.def.meta.name} <span className="muted">v{doc.def.meta.version}</span>
            {dirty ? <span className="dirty"> 수정됨</span> : ''}
            {analysis && analysis.unitErrors > 0 ? <span className="bad"> ⚠ 단위 오류 {analysis.unitErrors}건</span> : ''}
          </strong>
          <button type="button" onClick={() => ed().undo()} disabled={!canUndo} title={undoLabel ? `되돌리기: ${undoLabel}` : '되돌릴 편집이 없습니다'}>
            ↶ 되돌리기
          </button>
          <button type="button" onClick={() => ed().redo()} disabled={!canRedo} title={redoLabel ? `다시 하기: ${redoLabel}` : '다시 할 편집이 없습니다'}>
            ↷ 다시 하기
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              ed().check()
              setOutcome(null)
              setShowApply(true)
            }}
          >
            적용…
          </button>
        </>
      )}
    </div>
  )

  if (!doc || !analysis) {
    return (
      <div className="model-tab">
        {header}
        <div className="model-empty">
          <h2>모델 편집기</h2>
          <p>모델의 구조를 직접 고쳐 실험·시나리오·통제·위험 분석·검증에서 쓸 수 있습니다. 내장 모델은 직접 고치지 않고 <strong>사본</strong>으로 엽니다.</p>
          <div className="row">
            <button type="button" className="primary" onClick={() => open('current')}>
              현재 모델의 사본 편집
            </button>
            <button type="button" onClick={() => open('blank')}>
              빈 모델에서 시작
            </button>
          </div>
          <p className="muted">편집기는 모델이 옳음을 보증하지 않습니다. 막는 것은 형식 오류(문법, 정의되지 않은 변수, 순환 참조, 앱 연결의 불일치)뿐이며, 모델이 현실에 맞는지는 검증 탭의 점검과 사람의 판단이 필요합니다.</p>
        </div>
      </div>
    )
  }

  const run = (label: string, cmd: Parameters<ReturnType<typeof ed>['run']>[1], key?: string) => ed().run(label, cmd, key)
  const onField = (name: string, edit: FieldEdit, key?: string) => run(`${name} 수정`, (d) => setField(d, name, edit), key ?? `${edit.field}:${name}`)
  const tableField = (name: string, field: 'unit' | 'value' | 'expr' | 'init', text: string): string | null => {
    if (field === 'value') {
      const n = Number(text)
      if (text.trim() === '' || !Number.isFinite(n)) return '숫자를 입력하세요.'
      return onField(name, { field: 'value', value: n })
    }
    return onField(name, { field, value: text } as FieldEdit)
  }
  const add = (kind: VarKind) => {
    const before = Object.keys(doc.def.constants).length + Object.keys(doc.def.levels).length + Object.keys(doc.def.rates).length + Object.keys(doc.def.auxiliaries).length
    run('변수 추가', (d) => addVariable(d, kind))
    const d2 = ed().doc
    if (d2) {
      const names = [...Object.keys(d2.def.constants), ...Object.keys(d2.def.levels), ...Object.keys(d2.def.rates), ...Object.keys(d2.def.auxiliaries)]
      if (names.length > before) ed().select(names.find((n) => !analysis.variables.some((v) => v.name === n)) ?? null)
    }
  }
  const apply = async (confirmUnitErrors: boolean) => {
    setApplying(true)
    try {
      setOutcome(await ed().apply({ confirmUnitErrors }))
    } finally {
      setApplying(false)
    }
  }
  const justApplied = outcome && outcome.ok ? outcome.entry.id : null

  return (
    <div className="model-tab">
      {header}
      {message && (
        <p className={`notice ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
          <span className="notice-body">{message.text}</span>
          <button type="button" className="link" onClick={() => ed().clearMessage()}>
            닫기
          </button>
        </p>
      )}
      {showApply && gate && (
        <ApplyPanel
          gate={gate}
          outcome={outcome}
          busy={applying}
          onApply={(c) => void apply(c)}
          onClose={() => setShowApply(false)}
          startable={justApplied !== null && currentModelId !== justApplied}
          onStartProject={() => justApplied && void switchModel(justApplied)}
        />
      )}
      <div className="model-body">
        <aside className="panel model-side">
          <VariableList analysis={analysis} selected={selected} onSelect={(n) => ed().select(n)} onAdd={add} />
        </aside>
        <main className="panel model-main">
          <div role="tablist" aria-label="편집 보기" className="subtabs">
            <button type="button" role="tab" aria-selected={view === 'table'} className={`subtab${view === 'table' ? ' active' : ''}`} onClick={() => setView('table')}>
              변수 표
            </button>
            <button type="button" role="tab" aria-selected={view === 'diagram'} className={`subtab${view === 'diagram' ? ' active' : ''}`} onClick={() => setView('diagram')}>
              다이어그램
            </button>
            <button type="button" role="tab" aria-selected={view === 'causal'} className={`subtab${view === 'causal' ? ' active' : ''}`} onClick={() => setView('causal')}>
              인과 루프
            </button>
            <button type="button" role="tab" aria-selected={view === 'sectors'} className={`subtab${view === 'sectors' ? ' active' : ''}`} onClick={() => setView('sectors')}>
              섹터
            </button>
            <button type="button" role="tab" aria-selected={view === 'curves'} className={`subtab${view === 'curves' ? ' active' : ''}`} onClick={() => setView('curves')}>
              그래프 함수
            </button>
            <button type="button" role="tab" aria-selected={view === 'palette'} className={`subtab${view === 'palette' ? ' active' : ''}`} onClick={() => setView('palette')}>
              구조 팔레트
            </button>
            <button type="button" role="tab" aria-selected={view === 'spec'} className={`subtab${view === 'spec' ? ' active' : ''}`} onClick={() => setView('spec')}>
              앱 연결 정보
            </button>
          </div>
          {view === 'table' ? (
            <VariableTable doc={doc} analysis={analysis} selected={selected} onSelect={(n) => ed().select(n)} onField={tableField} />
          ) : view === 'diagram' ? (
            <DiagramView
              doc={doc}
              analysis={analysis}
              selected={selected}
              selectedEdge={selectedEdge}
              onSelect={(n) => ed().select(n)}
              onSelectEdge={setSelectedEdge}
              onMoved={(p) => void run('위치 이동', (d) => setPositions(d, p), `pos:${Object.keys(p).sort().join(',')}`)}
              onConnect={(from, to) => void run('연결', (d) => connect(d, from, to))}
              onAutoLayout={() => ed().replace('자동 배치', autoLayoutDoc(doc))}
              onToggleSector={(id) => void run('섹터 접기·펼치기', (d) => toggleSectorCollapsed(d, id))}
            />
          ) : view === 'causal' ? (
            <CausalView doc={doc} onSelect={(n) => ed().select(n)} />
          ) : view === 'curves' ? (
            <CurveEditor doc={doc} selected={selectedTable} onSelect={setSelectedTable} run={(label, cmd, key) => run(label, cmd, key)} />
          ) : view === 'palette' ? (
            <PalettePanel doc={doc} run={(label, cmd) => run(label, cmd)} />
          ) : view === 'sectors' ? (
            <SectorPanel
              doc={doc}
              selected={selected}
              onAdd={(name, members) => run('섹터 추가', (d) => addSector(d, name, members))}
              onRename={(id, name) => run('섹터 이름', (d) => renameSector(d, id, name))}
              onColor={(id, color) => void run('섹터 색', (d) => setSectorColor(d, id, color), `sector-color:${id}`)}
              onDelete={(id) => void run('섹터 지우기', (d) => deleteSector(d, id))}
              onToggle={(id) => void run('섹터 접기·펼치기', (d) => toggleSectorCollapsed(d, id))}
              onAssign={(v, sec) => void run('섹터에 넣기', (d) => assignToSector(d, v, sec))}
              onSelect={(n) => ed().select(n)}
            />
          ) : (
            <SpecEditor
              doc={doc}
              onSpec={(spec, label, key) => ed().replace(label, { ...doc, spec }, key)}
              onMeta={(patch) => run('모델 설정', (d) => setMeta(d, patch), 'meta')}
              onInfo={(patch) => ed().replace('모델 정보', setInfo(doc, patch), `info:${Object.keys(patch)[0]}`)}
              onUnits={(text) => run('사용자 정의 단위', (d) => setUnitAliases(d, text))}
            />
          )}
          <ProblemsPanel analysis={analysis} onSelect={(n) => ed().select(n)} />
        </main>
        <aside className="panel model-props">
          {selectedEdge && view === 'diagram' ? (
            <EdgePanel
              edge={buildDiagram(doc).edges.find((e) => e.id === selectedEdge) ?? null}
              onDisconnect={(e) => {
                const err = run('연결 지우기', (d) => disconnect(d, e.from, e.to, e.kind))
                if (!err) setSelectedEdge(null)
              }}
              onFlip={(level, flow) => void run('흐름 방향 바꾸기', (d) => flipFlow(d, level, flow))}
            />
          ) : selected ? (
            <Properties
              doc={doc}
              analysis={analysis}
              name={selected}
              onRename={(to) => {
                const err = run('이름 바꾸기', (d) => renameVariable(d, selected, to))
                if (!err) ed().select(to)
                return err
              }}
              onField={(edit, key) => onField(selected, edit, key)}
              onChangeKind={(to) => void run('종류 바꾸기', (d) => changeFlowKind(d, selected, to))}
              sector={sectorOfVariable(doc, selected)}
              sectors={doc.view.sectors.map((x) => ({ id: x.id, name: x.name }))}
              onAssignSector={(sec) => void run('섹터에 넣기', (d) => assignToSector(d, selected, sec))}
              onDelete={(zero) => {
                const err = run('변수 삭제', (d) => deleteVariable(d, selected, { replaceWithZero: zero }))
                if (!err) ed().select(null)
                return err
              }}
            />
          ) : (
            <p className="muted">왼쪽 목록이나 표에서 변수를 고르면 여기서 이름·수식·흐름을 고칠 수 있습니다.</p>
          )}
        </aside>
      </div>
    </div>
  )
}


/** 다이어그램에서 고른 연결선의 설명과 편집(선 지우기, 흐름 방향 바꾸기). 접힌 섹터·구름에 걸린 선은 지울 수 없다. */
function EdgePanel({ edge, onDisconnect, onFlip }: { edge: ReturnType<typeof buildDiagram>['edges'][number] | null; onDisconnect(e: NonNullable<typeof edge>): void; onFlip(level: string, flow: string): void }) {
  if (!edge) return <p className="muted">선택한 연결이 없습니다.</p>
  const aggregated = edge.count > 1 || edge.from.startsWith('sector:') || edge.to.startsWith('sector:')
  const cloud = edge.from.startsWith('cloud:') || edge.to.startsWith('cloud:')
  const level = edge.kind === 'flow' ? (edge.sense === 'in' ? edge.to : edge.from) : null
  const flow = edge.kind === 'flow' ? (edge.sense === 'in' ? edge.from : edge.to) : null
  return (
    <section className="props" aria-label="연결 속성">
      <h3>연결</h3>
      <p>{describeEdge(edge)}</p>
      <p className="muted">연결선은 수식에서 파생됩니다. 선을 지우면 수식의 참조를 0으로 바꾸거나(정보선) Level의 흐름에서 뺍니다(흐름선).</p>
      {aggregated || cloud ? (
        <p className="muted">{cloud ? '구름은 Level에 연결되지 않은 쪽을 나타내는 표시라 지울 수 없습니다.' : '접힌 섹터의 합친 선은 지울 수 없습니다. 섹터를 펼친 뒤 지우세요.'}</p>
      ) : (
        <div className="props-actions">
          <button type="button" className="danger" onClick={() => onDisconnect(edge)}>
            연결 지우기
          </button>
          {level && flow && (
            <button type="button" onClick={() => onFlip(level, flow)}>
              {edge.sense === 'in' ? '유출로 바꾸기' : '유입으로 바꾸기'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
