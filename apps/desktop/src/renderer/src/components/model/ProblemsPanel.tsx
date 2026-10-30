import type { Analysis } from '../../lib/modelEdit/analysis'

/** 문제 패널(설계 08의 9장): 오류·경고 목록. 항목을 누르면 그 변수를 고른다. */
export function ProblemsPanel({ analysis, onSelect }: { analysis: Analysis; onSelect(name: string): void }) {
  const { errors, warnings, infos, unitErrors } = analysis
  const issues = analysis.issues.filter((i) => i.severity !== 'info')
  const infoItems = analysis.issues.filter((i) => i.severity === 'info')
  return (
    <section className="problems" aria-label="문제">
      <h3>
        문제 <span className={errors > 0 ? 'bad' : 'muted'}>✖ {errors}</span> <span className={warnings > 0 ? 'warn' : 'muted'}>⚠ {warnings}</span> <span className="muted">ⓘ {infos}</span>
        {unitErrors > 0 && <span className="bad"> · 단위 오류 {unitErrors}</span>}
      </h3>
      {issues.length === 0 ? (
        <p className="muted">문제가 없습니다.{infoItems.length > 0 ? ` (참고 ${infoItems.length}건)` : ''}</p>
      ) : (
        <ul>
          {issues.map((i, n) => (
            <li key={n} className={i.severity}>
              <span aria-hidden="true">{i.severity === 'error' ? '✖' : '⚠'}</span>
              <span className="sr-only">{i.severity === 'error' ? '오류' : '경고'}</span>{' '}
              {i.variable ? (
                <button type="button" className="link" onClick={() => onSelect(i.variable as string)}>
                  {i.variable}
                </button>
              ) : (
                <span className="muted">모델</span>
              )}
              {i.range ? ` (위치 ${i.range[0] + 1})` : ''}: {i.message}
            </li>
          ))}
        </ul>
      )}
      {infoItems.length > 0 && (
        <details className="problems-info">
          <summary>참고 {infoItems.length}건(단위 선언 없음·단위 제안 등)</summary>
          <ul>
            {infoItems.map((i, n) => (
              <li key={n} className="info">
                <span aria-hidden="true">ⓘ</span>{' '}
                {i.variable && (
                  <button type="button" className="link" onClick={() => onSelect(i.variable as string)}>
                    {i.variable}
                  </button>
                )}
                : {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
