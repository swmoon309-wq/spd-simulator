import type { EvmPoint, Status } from '@spd/analysis'
import { formatIndex, formatSigned } from '../../lib/control'

export const STATUS_TEXT: Record<Status, string> = { none: '–', normal: '정상', warn: '주의', critical: '위험' }
const STATUS_MARK: Record<Status, string> = { none: '', normal: '●', warn: '▲', critical: '■' }

/** 보고 기준일의 핵심 지표. 상태는 색과 글자·기호를 함께 쓴다. */
export function KpiCards({ point, status }: { point: EvmPoint | null; status: Status }) {
  const idx = (x: number | null | undefined) => (x === undefined ? '–' : formatIndex(x))
  const cards: { label: string; value: string; tone?: string; title?: string }[] = [
    { label: 'CPI', value: idx(point?.cpi), tone: point?.cpi != null && point.cpi < 1 ? 'bad' : undefined, title: 'EV / AC. 1보다 작으면 계획보다 공수를 더 썼습니다' },
    { label: 'SPI', value: idx(point?.spi), tone: point?.spi != null && point.spi < 1 ? 'bad' : undefined, title: 'EV / PV. 1보다 작으면 계획보다 느립니다' },
    { label: 'CV', value: point ? `${formatSigned(point.cv)} 맨데이` : '–', tone: point && point.cv < 0 ? 'bad' : undefined },
    { label: 'SV', value: point ? `${formatSigned(point.sv)} 맨데이` : '–', tone: point && point.sv < 0 ? 'bad' : undefined },
    { label: '진척률', value: point ? `${(point.progress * 100).toFixed(1)}%` : '–' }
  ]
  return (
    <section className="kpi-cards" aria-label="핵심 지표">
      {cards.map((c) => (
        <div key={c.label} className="kpi-card" title={c.title}>
          <div className="muted">{c.label}</div>
          <div className={`kpi-value ${c.tone ?? ''}`}>{c.value}</div>
        </div>
      ))}
      <div className={`kpi-card status-${status}`}>
        <div className="muted">상태</div>
        <div className="kpi-value">
          <span aria-hidden="true">{STATUS_MARK[status]} </span>
          {STATUS_TEXT[status]}
        </div>
      </div>
    </section>
  )
}
