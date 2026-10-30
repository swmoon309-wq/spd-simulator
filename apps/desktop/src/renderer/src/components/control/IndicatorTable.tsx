import type { EvmPoint } from '@spd/analysis'
import { formatIndex, formatSigned } from '../../lib/control'

const dev = (x: number) => (x < 0 ? 'bad' : x > 0 ? 'good' : '')

/** 보고일별 PV·EV·AC와 CV·SV·CPI·SPI, 최근 구간 지수. 지수가 1보다 작으면 ▼를 함께 쓴다(색에만 기대지 않는다). */
export function IndicatorTable({ points, cpiWorsening, spiWorsening, trend = 3 }: { points: EvmPoint[]; cpiWorsening: boolean; spiWorsening: boolean; trend?: number }) {
  if (points.length === 0) return <p className="muted">계산할 수 있는 실적이 없습니다.</p>
  const hasRevision = points.some((p) => (p.revision ?? 0) > 0)
  const idx = (x: number | null) => (x === null ? <span title="계산할 수 없음(분모가 0)">–</span> : x < 1 ? <span className="bad">▼ {formatIndex(x)}</span> : <span>{formatIndex(x)}</span>)
  return (
    <section aria-label="Earned Value 지표">
      <h2 className="section-title">Earned Value 지표</h2>
      {(cpiWorsening || spiWorsening) && (
        <p className="drift" role="status">
          <strong>악화 중</strong>: 최근 구간의 {[cpiWorsening && 'CPI', spiWorsening && 'SPI'].filter(Boolean).join('·')}가 연속 {trend}번 하락했습니다.
        </p>
      )}
      <div className="table-scroll">
        <table className="indicator-table">
          <thead>
            <tr>
              <th scope="col">보고일</th>
              {hasRevision && <th scope="col">기준선</th>}
              <th scope="col" className="num">진척률</th>
              <th scope="col" className="num">PV</th>
              <th scope="col" className="num">EV</th>
              <th scope="col" className="num">AC</th>
              <th scope="col" className="num">CV</th>
              <th scope="col" className="num">SV</th>
              <th scope="col" className="num">CPI</th>
              <th scope="col" className="num">SPI</th>
              <th scope="col" className="num">구간 CPI</th>
              <th scope="col" className="num">구간 SPI</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.index}>
                <th scope="row">{p.day}일</th>
                {hasRevision && <td>{p.revision ? `개정 ${p.revision}` : '원'}</td>}
                <td className="num">{(p.progress * 100).toFixed(1)}%</td>
                <td className="num">{Math.round(p.pv).toLocaleString('ko-KR')}</td>
                <td className="num">{Math.round(p.ev).toLocaleString('ko-KR')}</td>
                <td className="num">{Math.round(p.ac).toLocaleString('ko-KR')}</td>
                <td className={`num ${dev(p.cv)}`}>{formatSigned(p.cv)}</td>
                <td className={`num ${dev(p.sv)}`}>{formatSigned(p.sv)}</td>
                <td className="num">{idx(p.cpi)}</td>
                <td className="num">{idx(p.spi)}</td>
                <td className="num">{idx(p.cpiK)}</td>
                <td className="num">{idx(p.spiK)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">단위는 맨데이. PV는 계획의 공수 곡선, EV는 계획이 같은 진척에 도달할 때까지 쓴 공수입니다. CPI = EV/AC, SPI = EV/PV. 구간 지수는 최근 3개 보고 구간의 증분으로 계산합니다.</p>
    </section>
  )
}
