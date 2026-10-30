import { diffFromBase, type Scenario } from '@spd/analysis'
import type { ModelEntry } from '../catalog'
import { formatNumber } from './params'

export interface DiffRow {
  name: string
  label: string
  unit: string
  /** 기본 설정의 값(표시용 문자열) */
  base: string
  /** 시나리오의 값(표시용 문자열) */
  value: string
}

/** 시나리오가 기본 설정과 달라지는 항목을 `기준값 → 시나리오값`으로 나열한다(SCN-06). */
export function diffRows(entry: ModelEntry, base: Record<string, number>, scenario: Pick<Scenario, 'overrides'>): DiffRow[] {
  return diffFromBase(base, scenario).map((d) => {
    const c = entry.def.constants[d.name]
    return { name: d.name, label: c?.label ?? d.name, unit: c?.unit ?? '', base: formatNumber(d.base), value: formatNumber(d.value) }
  })
}
