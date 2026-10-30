import { useMemo, useState } from 'react'
import { recordModelNote } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { exportValidationRecord } from '../../lib/fileActions'
import { buildRecordFromState } from '../../lib/validationRecord'
import { useAppStore } from '../../stores/appStore'

/** 검증 기록(VAL-07): 점검·비교의 요약을 프로젝트에 남기고 마크다운·CSV로 내보낸다. 4차 보고서의 재료가 된다. */
export function RecordPanel() {
  const modelId = useAppStore((s) => s.modelId)
  const params = useAppStore((s) => s.params)
  const scenarios = useAppStore((s) => s.scenarios)
  const runSettings = useAppStore((s) => s.runSettings)
  const validation = useAppStore((s) => s.validation)
  const scenarioRuns = useAppStore((s) => s.scenarioRuns)
  const extremes = useAppStore((s) => s.validationExtremes)
  const structure = useAppStore((s) => s.validationStructure)
  const makeRecord = useAppStore((s) => s.makeRecord)
  const clearRecord = useAppStore((s) => s.clearRecord)
  const [message, setMessage] = useState<string | null>(null)
  const desktop = typeof window.spd !== 'undefined'
  const entry = getEntry(modelId)
  const report = validation.report

  // 지금 만들면 무엇이 들어가는지(오래된 결과는 빠진다)
  const preview = useMemo(
    () => buildRecordFromState({ entry, params, scenarios, runSettings, validation, scenarioRuns, extremes, structure, now: new Date(0) }).contents,
    [entry, params, scenarios, runSettings, validation, scenarioRuns, extremes, structure]
  )
  const note = report ? recordModelNote(report, { id: entry.id, version: entry.def.meta.version }) : ''
  const line = (ok: boolean, stale: boolean, label: string) => (ok ? `✓ ${label}` : stale ? `▲ ${label}: 결과가 오래되어 넣지 않습니다(다시 실행하세요)` : `○ ${label}: 실행하지 않음`)

  return (
    <section className="validation-section" aria-label="검증 기록">
      <h2>검증 기록</h2>
      <p className="muted">수행한 점검·비교의 <strong>요약</strong>(전체 시계열은 제외)을 프로젝트에 남깁니다. 합격·불합격이 아니라 지표와 점검 결과, 사람이 적은 체크리스트를 있는 그대로 담습니다.</p>
      <ul className="muted" aria-label="지금 기록에 들어갈 내용">
        <li>{preview.datasets > 0 ? `✓ 데이터 비교 ${preview.datasets}개` : preview.dataMissing ? '▲ 데이터 비교: 대상 시뮬레이션이 최신이 아니라 넣지 않습니다(데이터 비교 탭에서 실행하세요)' : '○ 데이터 비교: 가져온 데이터 없음'}</li>
        <li>{line(preview.extremes, preview.extremesStale, '극단 조건 시험')}</li>
        <li>{line(preview.structure, preview.structureStale, '구조 점검')}</li>
        <li>{preview.presets > 0 ? `✓ 보정 프리셋 ${preview.presets}개(요약)` : '○ 보정 프리셋: 저장한 것 없음'}</li>
        <li>{preview.checklist > 0 ? `✓ 체크리스트 ${preview.checklist}개 항목` : '○ 체크리스트: 적은 항목 없음'}</li>
      </ul>
      <div className="row wrap">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const r = makeRecord()
            setMessage(r.reason)
          }}
        >
          {report ? '기록 다시 만들기' : '기록 만들기'}
        </button>
        {report && (
          <button type="button" className="link" onClick={clearRecord}>
            기록 지우기
          </button>
        )}
        <button type="button" disabled={!report || !desktop} title={!report ? '먼저 기록을 만드세요' : desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'} onClick={() => void exportValidationRecord('md')}>
          마크다운 내보내기…
        </button>
        <button type="button" disabled={!report || !desktop} title={!report ? '먼저 기록을 만드세요' : desktop ? undefined : '데스크톱 앱에서만 사용할 수 있습니다'} onClick={() => void exportValidationRecord('csv')}>
          CSV 내보내기…
        </button>
      </div>
      {message && (
        <div className="field-error" role="alert">
          {message}
        </div>
      )}
      {report ? (
        <div className="validation-record" aria-label="저장된 기록">
          <p>
            <strong>저장된 기록</strong> {report.generatedAt.replace('T', ' ').slice(0, 16)} · 모델 {report.model.id} v{report.model.version} · 대상 {report.target.name}
          </p>
          {note && (
            <p className="field-error" role="alert">
              ▲ 다른 모델 버전: {note}
            </p>
          )}
          <p className="muted">
            데이터 비교 {report.data.length}개 · 극단 조건 {report.extremes ? `${report.extremes.total}개 값(실패 ${report.extremes.counts.fail})` : '없음'} · 구조 점검 {report.structure ? `${report.structure.length}개` : '없음'} · 체크리스트 {report.checklist.length}개 항목 · 보정 프리셋 {report.presets.length}개
          </p>
        </div>
      ) : (
        <p className="muted">아직 만든 기록이 없습니다.</p>
      )}
    </section>
  )
}
