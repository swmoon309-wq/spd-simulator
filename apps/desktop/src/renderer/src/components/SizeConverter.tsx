import { useState } from 'react'
import type { ModelEntry } from '../catalog'
import { formatNumber } from '../lib/params'
import { parsePositive, sizeSpecOf, slocToUnits, unitsToSloc } from '../lib/sizeConversion'
import { useAppStore } from '../stores/appStore'

/**
 * "SLOC로 입력" 보조 입력(CFG-01). 코드 규모(SLOC)와 단위당 SLOC를 적으면 모델의 규모 단위로 환산해 규모 입력에 넣는다.
 * 단위당 SLOC는 모델마다 기본값이 다르고(태스크는 책의 60), 기준이 없으면 비워 두어 사용자가 적게 한다.
 */
export function SizeConverter({ entry }: { entry: ModelEntry }) {
  const found = sizeSpecOf(entry)
  const sizeValue = useAppStore((s) => (found ? (s.params[found.size.param] as number) : 0))
  const setParam = useAppStore((s) => s.setParam)
  const [sloc, setSloc] = useState('')
  const [perUnit, setPerUnit] = useState<string>(found?.size.slocPerUnit != null ? String(found.size.slocPerUnit) : '')
  const [applied, setApplied] = useState<string | null>(null)
  if (!found) return null
  const { size, spec } = found

  const result = sloc.trim() === '' ? null : slocToUnits(spec, sloc, perUnit)
  const currentSloc = unitsToSloc(sizeValue, parsePositive(perUnit))

  return (
    <details className="size-helper">
      <summary>SLOC로 입력</summary>
      <div className="size-helper-body">
        <label htmlFor="size-sloc">코드 규모 (SLOC)</label>
        <input id="size-sloc" type="text" inputMode="numeric" value={sloc} placeholder="예: 24000" onChange={(e) => setSloc(e.target.value)} />
        <label htmlFor="size-per-unit">단위당 SLOC (SLOC/{size.unit})</label>
        <input id="size-per-unit" type="text" inputMode="decimal" value={perUnit} placeholder={size.slocPerUnit === null ? `필수(${size.unit} 하나가 몇 줄인지)` : undefined} onChange={(e) => setPerUnit(e.target.value)} />
        {size.source && <div className="muted">기본값 근거: {size.source}</div>}
        {size.slocPerUnit === null && <div className="muted">이 모델의 규모 단위({size.unit})는 책에 SLOC 환산 기준이 없습니다. 조직의 실측값(언어·도메인마다 다릅니다)을 적으세요.</div>}
        {result && 'value' in result && (
          <div role="status">
            = <strong>{formatNumber(result.value)}</strong> {size.unit}
          </div>
        )}
        {result && 'error' in result && (
          <div className="field-error" role="alert">
            {result.error}
          </div>
        )}
        <div className="row">
          <button
            type="button"
            disabled={!result || 'error' in result}
            onClick={() => {
              if (result && 'value' in result) {
                setParam(size.param, result.value)
                setApplied(`규모를 ${formatNumber(result.value)}${size.unit}(으)로 바꿨습니다.`)
              }
            }}
          >
            규모에 적용
          </button>
        </div>
        {applied && (
          <div className="hint" role="status">
            {applied}
          </div>
        )}
        {currentSloc !== null && (
          <div className="muted">
            지금 규모 {formatNumber(sizeValue)}
            {size.unit} ≈ {currentSloc.toLocaleString('ko-KR')} SLOC
          </div>
        )}
      </div>
    </details>
  )
}
