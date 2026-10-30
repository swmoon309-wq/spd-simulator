import { checkModelUnits, compileModel, lintModel, runModel, type LintIssue, type ModelDef, type UnitIssue } from '@spd/sd-engine'
import { kindOf as kindIn, type VarKind } from './commands'
import type { ModelDoc } from '../modelDoc'

/** 편집 화면이 보이는 문제: 구조(lint)와 단위 검사의 결과. 단위 검사는 정보(`info`)도 낸다. */
export type ModelIssue = (Omit<LintIssue, 'severity'> | Omit<UnitIssue, 'severity'>) & { severity: 'error' | 'warning' | 'info'; suggestion?: string }

export interface Analysis {
  issues: ModelIssue[]
  /** 변수별 문제(변수가 없는 모델 전체의 문제는 `''` 키) */
  byVariable: Map<string, ModelIssue[]>
  errors: number
  warnings: number
  /** 단위 오류 개수(확정된 불일치). 적용할 때 확인을 받는다 */
  unitErrors: number
  /** 정보(단위 선언 없음·단위 제안 등) 개수 */
  infos: number
  kindOf(name: string): VarKind | null
  variables: { name: string; kind: VarKind; unit?: string }[]
  /** 시각 0의 값(모든 변수). 모델을 실행할 수 없으면 null */
  start: Record<string, number> | null
}

/** 시각 0의 모든 변수 값. 컴파일·실행이 안 되면 null(문제는 lint가 따로 알린다). */
export function valuesAtStart(def: ModelDef): Record<string, number> | null {
  try {
    const result = runModel(compileModel(def), { end: def.time.start + def.time.dt })
    const out: Record<string, number> = {}
    for (const [n, c] of Object.entries(def.constants)) out[n] = c.value
    for (const [n, s] of Object.entries(result.series)) out[n] = s[0] as number
    return out
  } catch {
    return null
  }
}

/** 편집 화면이 쓰는 분석 결과(문제, 종류 조회, 변수 목록, 시각 0 값). 입력이 같으면 같다. */
export function analyze(doc: ModelDoc): Analysis {
  const issues: ModelIssue[] = [...lintModel(doc.def), ...checkModelUnits(doc.def)]
  const byVariable = new Map<string, ModelIssue[]>()
  for (const i of issues) {
    const k = i.variable ?? ''
    byVariable.set(k, [...(byVariable.get(k) ?? []), i])
  }
  const d = doc.def
  const variables: Analysis['variables'] = [
    ...Object.entries(d.constants).map(([name, c]) => ({ name, kind: 'constant' as const, ...(c.unit ? { unit: c.unit } : {}) })),
    ...Object.entries(d.levels).map(([name, l]) => ({ name, kind: 'level' as const, ...(l.unit ? { unit: l.unit } : {}) })),
    ...Object.entries(d.rates).map(([name, r]) => ({ name, kind: 'rate' as const, ...(r.unit ? { unit: r.unit } : {}) })),
    ...Object.entries(d.auxiliaries).map(([name, a]) => ({ name, kind: 'auxiliary' as const, ...(a.unit ? { unit: a.unit } : {}) }))
  ]
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const unitErrors = issues.filter((i) => i.severity === 'error' && i.code.startsWith('unit-')).length
  const lintErrors = errors - unitErrors
  return { issues, byVariable, errors, warnings, unitErrors, infos: issues.length - errors - warnings, kindOf: (n) => kindIn(d, n), variables, start: lintErrors === 0 ? valuesAtStart(d) : null }
}
