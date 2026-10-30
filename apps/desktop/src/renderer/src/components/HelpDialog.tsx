import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '../../../shared/ipc'
import { HELP_TOPICS, type HelpTopic } from '../../../shared/menuCommands'
import { acceleratorFor, formatAccelerator, SHORTCUT_LABELS } from '../../../shared/shortcuts'
import { EXAMPLE_GUIDES, GLOSSARY, HELP_TOPIC_LABELS, searchGlossary } from '../lib/help'
import { useUiStore } from '../stores/uiStore'
import { Modal } from './Modal'

/** 도움말(COM-06): 용어 설명(검색), 예제 안내, 단축키, 앱 정보. 앱 안에 들어 있어 네트워크 없이 열린다. */
export function HelpDialog({ initialTopic }: { initialTopic: HelpTopic }) {
  const close = useUiStore((s) => s.closeDialog)
  const [topic, setTopic] = useState<HelpTopic>(initialTopic)
  // 메뉴에서 다른 항목을 골라 같은 창이 다시 열리면 그 주제로 바꾼다.
  useEffect(() => setTopic(initialTopic), [initialTopic])

  return (
    <Modal title="도움말" onClose={close} wide>
      <div className="help-tabs" role="tablist" aria-label="도움말 주제">
        {HELP_TOPICS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={topic === t} className={`tab${topic === t ? ' active' : ''}`} onClick={() => setTopic(t)}>
            {HELP_TOPIC_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="help-body" role="tabpanel">
        {topic === 'glossary' && <Glossary />}
        {topic === 'examples' && <Examples />}
        {topic === 'shortcuts' && <Shortcuts />}
        {topic === 'about' && <About />}
      </div>
    </Modal>
  )
}

function Glossary() {
  const [query, setQuery] = useState('')
  const found = useMemo(() => searchGlossary(query), [query])
  const groups = useMemo(() => {
    const map = new Map<string, typeof found>()
    for (const t of found) map.set(t.group, [...(map.get(t.group) ?? []), t])
    return [...map.entries()]
  }, [found])
  return (
    <>
      <input type="search" className="help-search" placeholder="용어 검색(예: CPI, 시드, 백분위)" aria-label="용어 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
      {found.length === 0 ? (
        <p className="muted">찾는 용어가 없습니다.</p>
      ) : (
        groups.map(([group, terms]) => (
          <section key={group} aria-label={group}>
            <h3>{group}</h3>
            <dl className="glossary">
              {terms.map((t) => (
                <div key={t.term}>
                  <dt>
                    {t.term}
                    {t.alias && <span className="muted"> {t.alias}</span>}
                  </dt>
                  <dd>{t.meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
      <p className="muted">용어 {GLOSSARY.length}개. 화면에서 쓰는 뜻으로 풀이했습니다.</p>
    </>
  )
}

function Examples() {
  const openHome = useUiStore((s) => s.setTab)
  const close = useUiStore((s) => s.closeDialog)
  return (
    <>
      {EXAMPLE_GUIDES.map((g) => (
        <section key={g.title}>
          <h3>{g.title}</h3>
          <ol>
            {g.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </section>
      ))}
      <button
        type="button"
        onClick={() => {
          openHome('home')
          close()
        }}
      >
        홈에서 예제 열기
      </button>
    </>
  )
}

function Shortcuts() {
  const isMac = (window.spd?.platform ?? navigator.platform).toLowerCase().includes('mac') || (window.spd?.platform ?? '') === 'darwin'
  return (
    <>
      <table className="shortcut-table" aria-label="단축키">
        <tbody>
          {SHORTCUT_LABELS.map(([command, label]) => {
            const acc = acceleratorFor(command, isMac)
            return (
              <tr key={command}>
                <td>{label}</td>
                <td className="num">{acc ? <kbd>{formatAccelerator(acc, isMac)}</kbd> : '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted">글자를 입력하는 칸에서 실행 취소(다시 실행)를 누르면 그 칸의 글자 편집을 먼저 되돌립니다. 단축키는 데스크톱 앱의 메뉴에서도 같은 항목으로 쓸 수 있습니다.</p>
    </>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.spd?.app.info().then(setInfo)
  }, [])
  return (
    <>
      <h3>소프트웨어 프로젝트 시뮬레이터</h3>
      <p>시스템 다이내믹스로 소프트웨어 프로젝트의 일정·인력·품질을 시뮬레이션하고, 정책 시나리오를 비교하고, 진행 중인 프로젝트를 통제하고, 위험을 분석하고, 모델을 검증합니다. 모든 계산은 이 컴퓨터에서 이루어지며 네트워크가 필요 없습니다.</p>
      {info ? (
        <dl className="glossary">
          <div>
            <dt>버전</dt>
            <dd>{info.version}</dd>
          </div>
          <div>
            <dt>실행 환경</dt>
            <dd>
              Electron {info.electron} · {info.platform}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted">버전 정보는 데스크톱 앱에서만 볼 수 있습니다.</p>
      )}
      <p className="muted">모델은 Madachy, 『Software Process Dynamics』(2008)를 바탕으로 합니다.</p>
    </>
  )
}
