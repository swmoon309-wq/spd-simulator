import { useState } from 'react'
import { MAX_ACTUAL_ROWS, type ActualRow } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { applyIncrement, mergeActuals, type ParsedActuals } from '../../lib/actualsCsv'
import { exportActualsCsv, readActualsCsv } from '../../lib/fileActions'
import { useAppStore } from '../../stores/appStore'

interface Pending extends ParsedActuals {
  fileName: string
}

/** 실적 CSV 가져오기·내보내기와 증분 입력. */
export function ActualsToolbar() {
  const modelId = useAppStore((s) => s.modelId)
  const actuals = useAppStore((s) => s.actuals)
  const setActuals = useAppStore((s) => s.setActuals)
  const setNotice = useAppStore((s) => s.setNotice)
  const desktop = typeof window.spd !== 'undefined'
  const credits = getEntry(modelId).evm?.credits ?? []
  const [pending, setPending] = useState<Pending | null>(null)
  const [incOpen, setIncOpen] = useState(false)

  const finish = (p: Pending, rows: ActualRow[] | null, how: string) => {
    setPending(null)
    if (rows === null || !setActuals(rows)) {
      setNotice({ kind: 'error', text: `실적이 최대 ${MAX_ACTUAL_ROWS}건을 넘어 가져오지 않았습니다.` })
      return
    }
    const details = p.ignored.length > 0 ? [`맞지 않아 무시한 열: ${p.ignored.join(', ')}`] : []
    setNotice({ kind: details.length > 0 ? 'warning' : 'info', text: `'${p.fileName}'에서 실적 ${p.rows.length}건을 ${how}.`, ...(details.length > 0 ? { details } : {}) })
  }

  const onImport = async () => {
    const parsed = await readActualsCsv()
    if (!parsed) return
    if (actuals.length === 0) finish(parsed, parsed.rows, '가져왔습니다')
    else setPending(parsed)
  }

  return (
    <div className="actuals-toolbar">
      <div className="row wrap">
        <button type="button" onClick={() => void onImport()} disabled={!desktop} title={desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'}>
          CSV 가져오기…
        </button>
        <button type="button" onClick={() => void exportActualsCsv()} disabled={!desktop || actuals.length === 0}>
          CSV 내보내기…
        </button>
        <button type="button" aria-pressed={incOpen} onClick={() => setIncOpen(!incOpen)}>
          증분 입력
        </button>
      </div>
      {pending && (
        <div className="confirm" role="alert">
          이미 입력한 실적 {actuals.length}건이 있습니다. 가져온 {pending.rows.length}건을
          <button type="button" onClick={() => finish(pending, mergeActuals(actuals, pending.rows, 'append'), '덧붙였습니다')}>
            덧붙이기
          </button>
          <button type="button" className="danger" onClick={() => finish(pending, mergeActuals(actuals, pending.rows, 'replace'), '교체했습니다')}>
            교체
          </button>
          <button type="button" onClick={() => setPending(null)}>
            취소
          </button>
          <span className="muted">(덧붙이기는 같은 보고일을 새 값으로 덮습니다)</span>
        </div>
      )}
      {incOpen && <IncrementForm credits={credits} actuals={actuals} onAdd={(row) => setActuals([...actuals, row])} />}
    </div>
  )
}

/** 이번 구간의 증분을 입력하면 이전 누적에 더해 누적 행으로 추가한다. */
function IncrementForm({ credits, actuals, onAdd }: { credits: { variable: string; label: string }[]; actuals: ActualRow[]; onAdd(row: ActualRow): void }) {
  const [days, setDays] = useState('7')
  const [cum, setCum] = useState<Record<string, string>>({})
  const [effort, setEffort] = useState('0')
  const [headcount, setHeadcount] = useState('')
  const [defects, setDefects] = useState('')
  const [error, setError] = useState<string | null>(null)
  const last = actuals[actuals.length - 1]

  const num = (raw: string): number | null => (raw.trim() === '' || !Number.isFinite(Number(raw)) ? null : Number(raw))
  const submit = () => {
    const d = num(days)
    const e = num(effort)
    if (d === null || d <= 0) return setError('경과 일수는 0보다 커야 합니다.')
    if (e === null || e < 0) return setError('이번 구간 공수는 0 이상이어야 합니다.')
    const inc: Record<string, number> = {}
    for (const c of credits) {
      const raw = cum[c.variable] ?? ''
      const v = raw.trim() === '' ? 0 : num(raw)
      if (v === null || v < 0) return setError(`${c.label}은(는) 0 이상의 수여야 합니다.`)
      inc[c.variable] = v
    }
    const hc = num(headcount)
    const df = num(defects)
    if ((headcount.trim() !== '' && (hc === null || hc < 0)) || (defects.trim() !== '' && (df === null || df < 0))) return setError('인원·결함은 0 이상의 수여야 합니다.')
    if (actuals.length >= MAX_ACTUAL_ROWS) return setError(`보고는 최대 ${MAX_ACTUAL_ROWS}건입니다.`)
    setError(null)
    onAdd(applyIncrement(last, { days: d, cum: inc, effort: e, ...(hc !== null ? { headcount: hc } : {}), ...(df !== null ? { defects: df } : {}) }, credits))
    setCum({})
    setEffort('0')
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="field" key={id}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" step="any" value={value} onChange={(e) => set(e.target.value)} />
    </div>
  )
  return (
    <fieldset className="increment-form">
      <legend>증분 입력 — 이전 보고{last ? `(${last.day}일)` : ''}에 더해 누적 행으로 추가합니다</legend>
      <div className="alert-settings-grid">
        {field('inc-days', '경과 일수', days, setDays)}
        {credits.map((c) => field(`inc-${c.variable}`, `${c.label} 증가`, cum[c.variable] ?? '', (v) => setCum({ ...cum, [c.variable]: v })))}
        {field('inc-effort', '이번 구간 공수(맨데이)', effort, setEffort)}
        {field('inc-headcount', '투입 인원(현재, 선택)', headcount, setHeadcount)}
        {field('inc-defects', '결함 증가(선택)', defects, setDefects)}
      </div>
      {error && (
        <div className="field-error" role="alert">
          {error}
        </div>
      )}
      <button type="button" className="primary" onClick={submit}>
        누적 행으로 추가
      </button>
    </fieldset>
  )
}
