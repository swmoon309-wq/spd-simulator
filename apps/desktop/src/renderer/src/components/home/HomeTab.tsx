import { useCallback, useEffect, useMemo, useState } from 'react'
import { catalogGroups, getEntry } from '../../catalog'
import type { RecentEntry } from '../../../../shared/ipc'
import { MAX_DESCRIPTION } from '../../../../shared/projectFile'
import { unitNote } from '../../lib/modelEdit/unitStatus'
import { builtInExamples } from '../../lib/examples'
import { summarizeLastRun } from '../../lib/homeSummary'
import { openExample, openProject, openRecent, startProject } from '../../lib/projectActions'
import { selectIsDirty, useAppStore } from '../../stores/appStore'
import { useUiStore } from '../../stores/uiStore'

export type HomeTarget = 'experiment' | 'scenarios' | 'control'

/** 시작 화면: 지금 프로젝트의 요약, 새 프로젝트, 열기와 최근 목록, 내장 예제(PRJ-01~04). */
export function HomeTab({ onNavigate }: { onNavigate(target: HomeTarget): void }) {
  return (
    <div className="home">
      <ProjectCard onNavigate={onNavigate} />
      <div className="home-side">
        <NewProject onStarted={() => onNavigate('experiment')} />
        <OpenPanel onOpened={() => onNavigate('experiment')} />
        <Examples onOpened={() => onNavigate('experiment')} />
      </div>
    </div>
  )
}

/** PRJ-04: 지금 프로젝트의 요약 카드. 설명은 여기서 고친다. */
function ProjectCard({ onNavigate }: { onNavigate(target: HomeTarget): void }) {
  const modelId = useAppStore((s) => s.modelId)
  const name = useAppStore((s) => s.projectName)
  const file = useAppStore((s) => s.projectFile)
  const dirty = useAppStore(selectIsDirty)
  const description = useAppStore((s) => s.projectDescription)
  const setDescription = useAppStore((s) => s.setProjectDescription)
  const runs = useAppStore((s) => s.runs)
  const scenarioCount = useAppStore((s) => s.scenarios.length)
  const adoptedName = useAppStore((s) => s.adopted?.scenarioName ?? null)
  const actualCount = useAppStore((s) => s.actuals.length)
  const entry = getEntry(modelId)
  const summary = useMemo(() => summarizeLastRun(entry, runs), [entry, runs])

  return (
    <section className="home-card" aria-label="현재 프로젝트">
      <div className="home-card-head">
        <h2>{name}</h2>
        {dirty && <span className="dirty">수정됨</span>}
        <span className="muted">{file ?? '아직 저장하지 않았습니다'}</span>
      </div>
      <div className="muted">
        모델: {entry.title}
        {unitNote(entry) && <span className="bad"> ⚠ {unitNote(entry)}</span>}
      </div>

      <label className="home-field" htmlFor="project-description">
        설명
      </label>
      <textarea
        id="project-description"
        rows={3}
        maxLength={MAX_DESCRIPTION}
        placeholder="이 프로젝트가 무엇인지 적어 두세요(선택)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <h3>마지막 실행</h3>
      {summary ? (
        <>
          <div className="muted">{summary.name}</div>
          <dl className="summary-grid">
            {summary.items.map((it) => (
              <div key={it.heading} className="summary-item">
                <dt>
                  {it.heading} · {it.label}
                </dt>
                <dd>
                  <span className="summary-value">{it.value}</span> {it.value !== '–' && it.value !== '미완료' && <span className="muted">{it.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="muted">아직 실행 결과가 없습니다. 실험 탭에서 실행하세요.</p>
      )}

      <h3>구성</h3>
      <ul className="home-facts">
        <li>시나리오 {scenarioCount}개</li>
        <li>채택 계획: {adoptedName ?? '없음'}</li>
        <li>실적 {actualCount}건</li>
      </ul>
      <div className="row wrap">
        <button type="button" className="primary" onClick={() => onNavigate('experiment')}>
          실험으로
        </button>
        <button type="button" onClick={() => onNavigate('scenarios')}>
          시나리오
        </button>
        <button type="button" onClick={() => onNavigate('control')} disabled={adoptedName === null} title={adoptedName === null ? '시나리오를 채택하면 통제 화면을 쓸 수 있습니다' : undefined}>
          통제
        </button>
      </div>
    </section>
  )
}

/** PRJ-01: 이름·모델·설명으로 새 프로젝트를 시작한다. */
function NewProject({ onStarted }: { onStarted(): void }) {
  const currentModel = useAppStore((s) => s.modelId)
  useUiStore((s) => s.modelsVersion) // 내 모델이 올라오거나 내려가면 목록을 다시 그린다
  const [name, setName] = useState('')
  const [modelId, setModelId] = useState(currentModel)
  const [description, setDescription] = useState('')

  const start = async () => {
    if (await startProject(modelId, { name, description })) {
      setName('')
      setDescription('')
      onStarted()
    }
  }

  return (
    <section className="home-card" aria-label="새 프로젝트">
      <h2>새 프로젝트</h2>
      <label className="home-field" htmlFor="new-name">
        이름
      </label>
      <input id="new-name" type="text" maxLength={100} placeholder="이름 없는 프로젝트" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="home-field" htmlFor="new-model">
        모델
      </label>
      <select id="new-model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
        {catalogGroups().map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.entries.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <label className="home-field" htmlFor="new-description">
        설명
      </label>
      <textarea id="new-description" rows={2} maxLength={MAX_DESCRIPTION} placeholder="선택" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="row">
        <button type="button" className="primary" onClick={() => void start()}>
          만들기
        </button>
      </div>
      <p className="muted">이름은 처음 저장할 때 파일 이름의 기본값이 됩니다.</p>
    </section>
  )
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

/** PRJ-02: 파일 열기와 최근 목록. */
function OpenPanel({ onOpened }: { onOpened(): void }) {
  const desktop = typeof window.spd !== 'undefined'
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const refresh = useCallback(async () => {
    setRecent((await window.spd?.recent.list()) ?? [])
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  const open = async (id: string) => {
    if (await openRecent(id)) onOpened()
    await refresh() // 없어진 파일은 main이 목록에서 뺐다
  }

  return (
    <section className="home-card" aria-label="열기">
      <h2>열기</h2>
      <div className="row">
        <button type="button" onClick={() => void openProject().then(refresh)} disabled={!desktop} title={desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'}>
          파일에서 열기…
        </button>
        {recent.length > 0 && (
          <button
            type="button"
            className="link"
            onClick={() => void window.spd?.recent.clear().then(refresh)}
            title="목록만 지웁니다. 파일은 지워지지 않습니다."
          >
            목록 지우기
          </button>
        )}
      </div>
      <h3>최근 프로젝트</h3>
      {!desktop ? (
        <p className="muted">데스크톱 앱에서만 사용할 수 있습니다.</p>
      ) : recent.length === 0 ? (
        <p className="muted">최근에 열거나 저장한 프로젝트가 여기에 나타납니다.</p>
      ) : (
        <ul className="recent-list">
          {recent.map((r) => (
            <li key={r.id} className={r.missing ? 'dim' : ''}>
              <button type="button" className="recent-item" onClick={() => void open(r.id)} disabled={r.missing} title={r.missing ? '파일을 찾을 수 없습니다' : undefined}>
                <span className="recent-name">{r.fileName}</span>
                <span className="muted">
                  {r.folder} · {r.missing ? '파일 없음' : formatWhen(r.openedAt)}
                </span>
              </button>
              <button type="button" className="link" onClick={() => void window.spd?.recent.remove(r.id).then(refresh)} aria-label={`${r.fileName}을(를) 최근 목록에서 빼기`}>
                빼기
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** PRJ-03: 내장 예제. 항상 복사본으로 열린다(NFR-07). */
function Examples({ onOpened }: { onOpened(): void }) {
  const [examples] = useState(() => builtInExamples())
  return (
    <section className="home-card" aria-label="예제">
      <h2>예제</h2>
      <ul className="example-list">
        {examples.map((e) => (
          <li key={e.id}>
            <div>
              <strong>{e.title}</strong>
              <div className="muted">{e.summary}</div>
            </div>
            <button type="button" onClick={() => void openExample(e).then((ok) => ok && onOpened())}>
              복사본으로 열기
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">예제 원본은 바뀌지 않습니다. 고친 내용은 복사본에 저장됩니다.</p>
    </section>
  )
}
