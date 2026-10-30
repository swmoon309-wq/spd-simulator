import { useEffect, useState } from 'react'
import type { ModelSpec } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../../lib/modelDoc'
import { MODEL_LIMITS } from '../../../../shared/modelDoc'
import { suggestRange, unitAliasesToText } from '../../lib/modelEdit/commands'
import { CommitInput } from './CommitInput'

type Section = 'info' | 'params' | 'vars' | 'completion' | 'evm' | 'presets'
const SECTIONS: [Section, string][] = [
  ['info', '모델 정보'],
  ['params', '파라미터'],
  ['vars', '그래프 변수'],
  ['completion', '완료·지표'],
  ['evm', '진척(통제)'],
  ['presets', '프리셋·규모']
]

export interface SpecEditorProps {
  doc: ModelDoc
  /** spec을 바꾼다(편집 이력에 한 단계로 기록된다) */
  onSpec(next: ModelSpec, label: string, key?: string): void
  onMeta(patch: { name?: string; end?: number; dt?: number; start?: number }): string | null
  onInfo(patch: { description?: string; author?: string }): void
  /** 사용자 정의 단위(줄마다 `이름 = 단위`)를 바꾼다. 거절되면 이유 */
  onUnits(text: string): string | null
}

const num = (t: string): number | null => (t.trim() !== '' && Number.isFinite(Number(t)) ? Number(t) : null)
const NUM_ERR = '숫자를 입력하세요.'

function NumField({ label, value, onValue, className }: { label: string; value: number; onValue(v: number): void; className?: string }) {
  return <CommitInput label={label} value={String(value)} className={className ?? 'narrow'} mono onCommit={(t) => (num(t) === null ? NUM_ERR : void onValue(num(t) as number))} />
}

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T | ''; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {value === '' && <option value="">(선택)</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** 여러 줄 글 입력: 포커스를 잃을 때 반영한다(거절되면 이유를 보이고 되돌린다). */
function UnitAliasesField({ value, onCommit }: { value: string; onCommit(text: string): string | null }) {
  const [text, setText] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => {
    setText(value)
    setProblem(null)
  }, [value])
  return (
    <>
      <textarea
        id="m-units"
        rows={2}
        spellCheck={false}
        className="mono"
        value={text}
        aria-invalid={problem !== null}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === value) return
          const r = onCommit(text)
          if (r) {
            setProblem(r)
            setText(value)
          } else setProblem(null)
        }}
      />
      {problem && (
        <span role="alert" className="field-error">
          {problem}
        </span>
      )}
    </>
  )
}

/**
 * 앱 연결 정보(`spec`) 편집(EDT-08, 설계 08의 3.2): 파라미터 범위·그룹, 그래프 변수, 완료 조건·지표(6종), 진척(Earned Value), 프리셋·규모. 모든 상수는
 * 파라미터여야 하고 완료 조건이 없으면 진척을 쓸 수 없는 등 맞지 않는 것은 적용 게이트가 이유와 함께 막는다.
 */
export function SpecEditor({ doc, onSpec, onMeta, onInfo, onUnits }: SpecEditorProps) {
  const [section, setSection] = useState<Section>('info')
  const { def, spec } = doc
  const constants = Object.keys(def.constants)
  const nonConstants = [...Object.keys(def.levels), ...Object.keys(def.rates), ...Object.keys(def.auxiliaries)]
  const varOpts = nonConstants.map((n) => ({ value: n, label: n }))
  const paramOpts = constants.map((n) => ({ value: n, label: n }))
  const unitOf = (n: string) => def.levels[n]?.unit ?? def.rates[n]?.unit ?? def.auxiliaries[n]?.unit ?? ''
  const set = (next: ModelSpec, label: string, key?: string) => onSpec(next, label, key)

  return (
    <section className="spec-editor" aria-label="앱 연결 정보">
      <div role="tablist" aria-label="앱 연결 정보 항목" className="subtabs">
        {SECTIONS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={section === id} className={`subtab${section === id ? ' active' : ''}`} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === 'info' && (
        <div className="spec-pane">
          <div className="field-row">
            <label htmlFor="m-name">모델 이름</label>
            <CommitInput id="m-name" label="모델 이름" value={def.meta.name} onCommit={(t) => onMeta({ name: t })} />
          </div>
          <div className="field-row">
            <label htmlFor="m-author">작성자</label>
            <CommitInput id="m-author" label="작성자" value={doc.info.author ?? ''} placeholder="(선택)" onCommit={(t) => void onInfo({ author: t })} />
          </div>
          <div className="field-block">
            <label htmlFor="m-desc">설명</label>
            <textarea id="m-desc" rows={3} maxLength={5000} value={doc.info.description} onChange={(e) => onInfo({ description: e.target.value })} />
          </div>
          <div className="field-row">
            <label>시간(일)</label>
            <span className="inline-fields">
              시작 <NumField label="시작 시각" value={def.time.start} onValue={(v) => void onMeta({ start: v })} />
              종료 <NumField label="종료 시각" value={def.time.end} onValue={(v) => void onMeta({ end: v })} />
              간격 dt <NumField label="적분 간격" value={def.time.dt} onValue={(v) => void onMeta({ dt: v })} />
            </span>
          </div>
          <div className="field-block">
            <label htmlFor="m-units">사용자 정의 단위(줄마다 <code>이름 = 단위</code>)</label>
            <UnitAliasesField value={unitAliasesToText(def)} onCommit={onUnits} />
            <span className="muted">예: 인월 = 명·월. 맨데이·비율·배·FTE·신입은 기본으로 정의되어 있습니다. 단위 검사에만 쓰입니다.</span>
          </div>
          <p className="muted">모델 id: {def.meta.id} · 버전 {def.meta.version}{doc.info.basedOn ? ` · 원본 ${doc.info.basedOn}` : ''}</p>
        </div>
      )}

      {section === 'params' && (
        <div className="spec-pane">
          <p className="muted">모든 상수는 입력 화면의 파라미터입니다. 범위는 입력 검사와 위험 분석·극단 조건 시험의 기준이 됩니다.</p>
          <table className="var-table">
            <thead>
              <tr>
                <th scope="col">상수</th>
                <th scope="col">값</th>
                <th scope="col">그룹</th>
                <th scope="col">최소</th>
                <th scope="col">최대</th>
                <th scope="col">간격</th>
                <th scope="col">정수</th>
              </tr>
            </thead>
            <tbody>
              {spec.params.map((p, i) => {
                const v = def.constants[p.name]?.value
                const out = v !== undefined && (v < p.min || v > p.max)
                const edit = (patch: Partial<typeof p>, key: string) => set({ ...spec, params: spec.params.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, `파라미터 ${p.name} 수정`, `param:${p.name}:${key}`)
                return (
                  <tr key={p.name}>
                    <th scope="row">{p.name}</th>
                    <td className={out ? 'bad' : ''} title={out ? '기본값이 범위 밖입니다' : undefined}>
                      {v}
                      {out && ' ✖'}
                    </td>
                    <td>
                      <CommitInput label={`${p.name} 그룹`} value={p.group} onCommit={(t) => (t.trim() === '' ? '그룹 이름이 비어 있습니다.' : void edit({ group: t }, 'group'))} className="narrow" />
                    </td>
                    <td>
                      <NumField label={`${p.name} 최소`} value={p.min} onValue={(x) => edit({ min: x }, 'min')} />
                    </td>
                    <td>
                      <NumField label={`${p.name} 최대`} value={p.max} onValue={(x) => edit({ max: x }, 'max')} />
                    </td>
                    <td>
                      <NumField label={`${p.name} 간격`} value={p.step} onValue={(x) => (x > 0 ? edit({ step: x }, 'step') : undefined)} />
                    </td>
                    <td>
                      <input type="checkbox" aria-label={`${p.name} 정수만`} checked={p.integer === true} onChange={(e) => edit(e.target.checked ? { integer: true } : { integer: undefined }, 'integer')} />
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => v !== undefined && edit(suggestRange(v), 'range')} title="값을 기준으로 범위 다시 제안">
                        범위 제안
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {spec.params.length === 0 && <p className="muted">상수가 없습니다.</p>}
        </div>
      )}

      {section === 'vars' && (
        <div className="spec-pane">
          <label className="check">
            <input
              type="checkbox"
              checked={spec.variables === undefined}
              onChange={(e) => {
                if (e.target.checked) {
                  const { variables: _v, ...rest } = spec
                  set(rest, '그래프 변수: 모두')
                } else set({ ...spec, variables: nonConstants.map((n) => ({ name: n, label: n, unit: unitOf(n) })) }, '그래프 변수 직접 고르기')
              }}
            />{' '}
            상수가 아닌 모든 변수를 그래프에서 고를 수 있게 한다(이름 그대로)
          </label>
          {spec.variables && (
            <table className="var-table">
              <thead>
                <tr>
                  <th scope="col">쓰기</th>
                  <th scope="col">변수</th>
                  <th scope="col">표시 이름</th>
                  <th scope="col">단위</th>
                  <th scope="col">기본</th>
                </tr>
              </thead>
              <tbody>
                {nonConstants.map((n) => {
                  const at = spec.variables?.findIndex((v) => v.name === n) ?? -1
                  const entry = at >= 0 ? spec.variables?.[at] : undefined
                  const toggle = (on: boolean) => {
                    const cur = spec.variables ?? []
                    const list = on ? nonConstants.filter((x) => x === n || cur.some((v) => v.name === x)).map((x) => cur.find((v) => v.name === x) ?? { name: x, label: x, unit: unitOf(x) }) : cur.filter((v) => v.name !== n)
                    const next: ModelSpec = { ...spec, variables: list }
                    if (!on && spec.defaultVariable === n) delete next.defaultVariable
                    set(next, `그래프 변수 ${n} ${on ? '추가' : '제외'}`)
                  }
                  const edit = (patch: Partial<{ label: string; unit: string }>, key: string) => set({ ...spec, variables: spec.variables?.map((v) => (v.name === n ? { ...v, ...patch } : v)) }, `그래프 변수 ${n} 수정`, `var:${n}:${key}`)
                  return (
                    <tr key={n}>
                      <td>
                        <input type="checkbox" aria-label={`${n} 그래프에서 쓰기`} checked={entry !== undefined} onChange={(e) => toggle(e.target.checked)} />
                      </td>
                      <th scope="row">{n}</th>
                      <td>{entry && <CommitInput label={`${n} 표시 이름`} value={entry.label} onCommit={(t) => (t.trim() === '' ? '비어 있습니다.' : void edit({ label: t }, 'label'))} />}</td>
                      <td>{entry && <CommitInput label={`${n} 단위`} value={entry.unit} className="narrow" onCommit={(t) => void edit({ unit: t }, 'unit')} />}</td>
                      <td>{entry && <input type="radio" name="default-var" aria-label={`${n}을 기본 그래프 변수로`} checked={spec.defaultVariable === n} onChange={() => set({ ...spec, defaultVariable: n }, '기본 그래프 변수')} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {!spec.variables && (
            <div className="field-row">
              <label>기본 그래프 변수</label>
              <Select label="기본 그래프 변수" value={spec.defaultVariable ?? ''} options={varOpts} onChange={(v) => set({ ...spec, defaultVariable: v }, '기본 그래프 변수')} />
            </div>
          )}
        </div>
      )}

      {section === 'completion' && (
        <div className="spec-pane">
          <h4>완료 조건</h4>
          <p className="muted">변수가 조건을 처음 만족한 기록 시각이 완료일입니다. 없으면 완료일·채택·통제를 쓸 수 없습니다.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={spec.completion !== undefined}
              onChange={(e) => {
                if (e.target.checked) set({ ...spec, completion: { variable: nonConstants[0] ?? '', op: '<=', value: 0 } }, '완료 조건 켜기')
                else {
                  const { completion: _c, evm: _e, ...rest } = spec
                  set({ ...rest, kpis: spec.kpis.filter((k) => k.kind !== 'atCompletion') }, '완료 조건 끄기')
                }
              }}
            />{' '}
            완료 조건 사용
          </label>
          {spec.completion && (
            <div className="field-row">
              <Select label="완료 조건 변수" value={spec.completion.variable} options={varOpts} onChange={(v) => set({ ...spec, completion: { ...(spec.completion as NonNullable<ModelSpec['completion']>), variable: v } }, '완료 조건 변수')} />
              <Select label="완료 조건 비교" value={spec.completion.op} options={(['<=', '>=', '<', '>'] as const).map((o) => ({ value: o, label: o }))} onChange={(o) => set({ ...spec, completion: { ...(spec.completion as NonNullable<ModelSpec['completion']>), op: o } }, '완료 조건 비교')} />
              <NumField label="완료 조건 값" value={spec.completion.value} onValue={(v) => set({ ...spec, completion: { ...(spec.completion as NonNullable<ModelSpec['completion']>), value: v } }, '완료 조건 값', 'completion:value')} />
            </div>
          )}
          <div className="field-row">
            <label>인원 변수</label>
            <Select label="인원 변수(최대 인원 요약)" value={spec.staffVariable ?? ''} options={varOpts} onChange={(v) => set({ ...spec, staffVariable: v }, '인원 변수')} />
            {spec.staffVariable && (
              <button type="button" className="link" onClick={() => { const { staffVariable: _s, ...rest } = spec; set(rest, '인원 변수 없애기') }}>
                없애기
              </button>
            )}
          </div>
          <h4>
            지표 ({spec.kpis.length}/{MODEL_LIMITS.kpis})
          </h4>
          <p className="muted">종류 6가지 중에서 고릅니다. 다른 계산이 필요하면 모델에 보조 변수를 만들고 마지막 값·최댓값으로 봅니다.</p>
          {spec.kpis.map((k, i) => {
            const edit = (patch: Partial<typeof k>, key: string) => set({ ...spec, kpis: spec.kpis.map((x, j) => (j === i ? { ...x, ...patch } : x)) }, `지표 ${k.id} 수정`, `kpi:${i}:${key}`)
            return (
              <div key={i} className="kpi-row">
                <CommitInput label={`지표 ${i + 1} id`} value={k.id} className="narrow" mono onCommit={(t) => (/^[A-Za-z][A-Za-z0-9_]*$/.test(t) ? void edit({ id: t }, 'id') : '영문자로 시작하는 영문자·숫자·_')} />
                <CommitInput label={`지표 ${i + 1} 이름`} value={k.label} onCommit={(t) => (t.trim() === '' ? '비어 있습니다.' : void edit({ label: t }, 'label'))} />
                <CommitInput label={`지표 ${i + 1} 단위`} value={k.unit} className="narrow" onCommit={(t) => void edit({ unit: t }, 'unit')} />
                <Select label={`지표 ${i + 1} 종류`} value={k.kind} options={[{ value: 'final', label: '마지막 값' }, { value: 'max', label: '최댓값' }, { value: 'min', label: '최솟값' }, { value: 'atCompletion', label: '완료 시점 값' }, { value: 'timeOfMax', label: '최댓값의 시각' }, { value: 'integral', label: '시간 적분' }]} onChange={(v) => edit({ kind: v }, 'kind')} />
                <Select label={`지표 ${i + 1} 변수`} value={k.variable} options={varOpts} onChange={(v) => edit({ variable: v }, 'variable')} />
                <Select label={`지표 ${i + 1} 좋고 나쁨`} value={k.better} options={[{ value: 'lower', label: '낮을수록 좋음' }, { value: 'higher', label: '높을수록 좋음' }, { value: 'none', label: '판정 안 함' }]} onChange={(v) => edit({ better: v }, 'better')} />
                <Select label={`지표 ${i + 1} 그룹`} value={k.group} options={[{ value: 'schedule', label: '일정' }, { value: 'cost', label: '비용' }, { value: 'quality', label: '품질' }, { value: 'risk', label: '위험' }]} onChange={(v) => edit({ group: v }, 'group')} />
                <NumField label={`지표 ${i + 1} 소수 자릿수`} value={k.decimals} onValue={(v) => (Number.isInteger(v) && v >= 0 && v <= 6 ? edit({ decimals: v }, 'decimals') : undefined)} className="tiny" />
                <button type="button" className="link" onClick={() => set({ ...spec, kpis: spec.kpis.filter((_, j) => j !== i) }, `지표 ${k.id} 지우기`)}>
                  지우기
                </button>
              </div>
            )
          })}
          <button
            type="button"
            disabled={spec.kpis.length >= MODEL_LIMITS.kpis || nonConstants.length === 0}
            onClick={() => {
              let n = 1
              while (spec.kpis.some((k) => k.id === `kpi${n}`)) n++
              set({ ...spec, kpis: [...spec.kpis, { id: `kpi${n}`, label: `지표 ${n}`, unit: '', kind: 'final', variable: nonConstants[0] as string, better: 'none', group: 'cost', decimals: 1 }] }, '지표 추가')
            }}
          >
            + 지표 추가
          </button>
        </div>
      )}

      {section === 'evm' && (
        <div className="spec-pane">
          <p className="muted">진척(Earned Value)을 정의하면 계획 채택과 통제 탭을 쓸 수 있습니다. 완료 조건이 필요합니다. 진척률 = Σ(비율 × 단계별 누적 태스크) ÷ 총 태스크.</p>
          <label className="check">
            <input
              type="checkbox"
              checked={spec.evm !== undefined}
              disabled={spec.completion === undefined && spec.evm === undefined}
              onChange={(e) => {
                if (e.target.checked) set({ ...spec, evm: { totalTasks: { param: constants[0] ?? '' }, credits: [{ variable: nonConstants[0] ?? '', label: '진척', weight: 1 }], effortVariable: nonConstants[0] ?? '' } }, '진척 정의 켜기')
                else {
                  const { evm: _e, ...rest } = spec
                  set(rest, '진척 정의 끄기')
                }
              }}
            />{' '}
            진척(통제) 정의 사용{spec.completion === undefined && spec.evm === undefined ? ' — 먼저 완료 조건이 필요합니다' : ''}
          </label>
          {spec.evm &&
            (() => {
              const evm = spec.evm
              const total = evm.credits.reduce((s, c) => s + c.weight, 0)
              const up = (next: NonNullable<ModelSpec['evm']>, label: string, key?: string) => set({ ...spec, evm: next }, label, key)
              return (
                <>
                  <div className="field-row">
                    <label>총 태스크</label>
                    <Select label="총 태스크 파라미터" value={evm.totalTasks.param} options={paramOpts} onChange={(v) => up({ ...evm, totalTasks: { param: v } }, '총 태스크 파라미터')} />
                  </div>
                  <div className="field-row">
                    <label>누적 공수</label>
                    <Select label="누적 공수 변수" value={evm.effortVariable} options={varOpts} onChange={(v) => up({ ...evm, effortVariable: v }, '누적 공수 변수')} />
                  </div>
                  <h4>진척 인정 단계</h4>
                  {evm.credits.map((c, i) => (
                    <div key={i} className="kpi-row">
                      <Select label={`단계 ${i + 1} 변수`} value={c.variable} options={varOpts} onChange={(v) => up({ ...evm, credits: evm.credits.map((x, j) => (j === i ? { ...x, variable: v } : x)) }, '진척 단계 변수')} />
                      <CommitInput label={`단계 ${i + 1} 이름`} value={c.label} onCommit={(t) => (t.trim() === '' ? '비어 있습니다.' : void up({ ...evm, credits: evm.credits.map((x, j) => (j === i ? { ...x, label: t } : x)) }, '진척 단계 이름', `credit:${i}:label`))} />
                      <NumField label={`단계 ${i + 1} 비율`} value={c.weight} onValue={(v) => up({ ...evm, credits: evm.credits.map((x, j) => (j === i ? { ...x, weight: v } : x)) }, '진척 단계 비율', `credit:${i}:weight`)} />
                      <button type="button" className="link" disabled={evm.credits.length <= 1} onClick={() => up({ ...evm, credits: evm.credits.filter((_, j) => j !== i) }, '진척 단계 지우기')}>
                        지우기
                      </button>
                    </div>
                  ))}
                  <p className={Math.abs(total - 1) > 1e-9 ? 'bad' : 'muted'}>비율 합: {Number(total.toFixed(6))}{Math.abs(total - 1) > 1e-9 ? ' — 1이어야 합니다' : ''}</p>
                  <button type="button" disabled={evm.credits.length >= 8} onClick={() => up({ ...evm, credits: [...evm.credits, { variable: nonConstants[0] as string, label: `단계 ${evm.credits.length + 1}`, weight: 0 }] }, '진척 단계 추가')}>
                    + 단계 추가
                  </button>
                </>
              )
            })()}
        </div>
      )}

      {section === 'presets' && (
        <div className="spec-pane">
          <h4>
            프리셋 ({spec.presets.length}/{MODEL_LIMITS.presets})
          </h4>
          <p className="muted">입력 화면에서 한 번에 적용하는 파라미터 묶음입니다.</p>
          {spec.presets.map((p, i) => (
            <fieldset key={i} className="preset">
              <legend>
                <CommitInput label={`프리셋 ${i + 1} 이름`} value={p.label} onCommit={(t) => (t.trim() === '' ? '비어 있습니다.' : void set({ ...spec, presets: spec.presets.map((x, j) => (j === i ? { ...x, label: t } : x)) }, '프리셋 이름', `preset:${i}:label`))} />
              </legend>
              {Object.entries(p.overrides).map(([name, value]) => (
                <span key={name} className="inline-fields">
                  {name} =
                  <NumField label={`${p.label}의 ${name}`} value={value} onValue={(v) => set({ ...spec, presets: spec.presets.map((x, j) => (j === i ? { ...x, overrides: { ...x.overrides, [name]: v } } : x)) }, '프리셋 값', `preset:${i}:${name}`)} />
                  <button type="button" className="link" onClick={() => set({ ...spec, presets: spec.presets.map((x, j) => (j === i ? { ...x, overrides: Object.fromEntries(Object.entries(x.overrides).filter(([n]) => n !== name)) } : x)) }, '프리셋 항목 지우기')}>
                    ×
                  </button>
                </span>
              ))}
              <Select
                label={`${p.label}에 파라미터 추가`}
                value=""
                options={paramOpts.filter((o) => !(o.value in p.overrides))}
                onChange={(n) => set({ ...spec, presets: spec.presets.map((x, j) => (j === i ? { ...x, overrides: { ...x.overrides, [n]: def.constants[n]?.value ?? 0 } } : x)) }, '프리셋 항목 추가')}
              />
              <button type="button" className="link" onClick={() => set({ ...spec, presets: spec.presets.filter((_, j) => j !== i) }, '프리셋 지우기')}>
                프리셋 지우기
              </button>
            </fieldset>
          ))}
          <button type="button" disabled={spec.presets.length >= MODEL_LIMITS.presets} onClick={() => set({ ...spec, presets: [...spec.presets, { label: `프리셋 ${spec.presets.length + 1}`, overrides: {} }] }, '프리셋 추가')}>
            + 프리셋 추가
          </button>
          <h4>규모 입력(SLOC 환산 보조)</h4>
          <label className="check">
            <input
              type="checkbox"
              checked={spec.size !== undefined}
              onChange={(e) => {
                if (e.target.checked) set({ ...spec, size: { param: constants[0] ?? '', unit: '태스크', slocPerUnit: null } }, '규모 입력 켜기')
                else {
                  const { size: _s, ...rest } = spec
                  set(rest, '규모 입력 끄기')
                }
              }}
            />{' '}
            규모를 담는 파라미터가 있다
          </label>
          {spec.size && (
            <div className="field-row">
              <Select label="규모 파라미터" value={spec.size.param} options={paramOpts} onChange={(v) => set({ ...spec, size: { ...(spec.size as NonNullable<ModelSpec['size']>), param: v } }, '규모 파라미터')} />
              <CommitInput label="규모 단위" value={spec.size.unit} className="narrow" onCommit={(t) => (t.trim() === '' ? '비어 있습니다.' : void set({ ...spec, size: { ...(spec.size as NonNullable<ModelSpec['size']>), unit: t } }, '규모 단위', 'size:unit'))} />
              <CommitInput label="한 단위의 SLOC(모르면 비움)" value={spec.size.slocPerUnit === null ? '' : String(spec.size.slocPerUnit)} className="narrow" placeholder="모름" mono onCommit={(t) => (t.trim() === '' ? void set({ ...spec, size: { ...(spec.size as NonNullable<ModelSpec['size']>), slocPerUnit: null } }, '규모 환산') : num(t) === null ? NUM_ERR : void set({ ...spec, size: { ...(spec.size as NonNullable<ModelSpec['size']>), slocPerUnit: num(t) as number } }, '규모 환산'))} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
