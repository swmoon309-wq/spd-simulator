import { runStructureChecks, type StructureFinding } from '@spd/analysis'
import { checkModelUnits, compileModel, lintModel, runModel } from '@spd/sd-engine'
import { buildEntry } from '../../catalog/userModel'
import { externallyUsedVariables } from '../validationRuns'
import { validateModelDoc, type ModelDoc } from '../modelDoc'
import type { ModelDocRaw } from '../../../../shared/modelDoc'

export type GateStatus = 'pass' | 'fail' | 'info' | 'skipped'

export interface GateStep {
  id: 'lint' | 'spec' | 'trial' | 'units' | 'structure'
  label: string
  status: GateStatus
  /** 실패하면 적용을 막는가 */
  blocking: boolean
  details: string[]
}

export interface GateResult {
  steps: GateStep[]
  /** 막는 단계가 모두 통과했는가 */
  canApply: boolean
  /** 통과했으면 적용할 문서의 검증 결과(내용 해시 포함) */
  validated: { doc: ModelDoc; hash: string } | null
  /** 구조 점검 결과(막지 않고 보인다). 실행하지 못했으면 null */
  structure: StructureFinding[] | null
  /** 확정된 단위 불일치 개수. 0보다 크면 **확인을 받아야** 적용할 수 있다(D5: 오류가 있어도 근거가 있으면 어길 수 있다) */
  unitErrors: number
}

const STRUCTURE_STATUS = { pass: '통과', warn: '주의', fail: '실패', info: '정보' } as const

/**
 * 적용 게이트(설계 08의 8.1). 순서대로 확인한다: ① 구조 오류(`lintModel` 오류 0) ② 앱 연결(`spec`)과 컴파일 ③ 기본값으로 끝까지 시험 실행 — 이 셋은 **적용을
 * 막는다**. ④ 단위 검사(M2): 확정된 불일치는 오류로 보이되 **막지 않고 확인을 받는다**(D5), 추론하지 못한 것은 경고. ⑤ 구조 점검 S1~S6은 **막지 않고 결과를 보인다**(D3: 검증은 판단이며 점검이 놓치는 것도 함께 보인다).
 * 앞 단계가 실패하면 뒤의 막는 단계는 건너뛴다.
 */
export function runApplyGate(doc: ModelDoc): GateResult {
  const steps: GateStep[] = []
  const add = (s: GateStep) => void steps.push(s)

  // ① 구조 오류
  const issues = lintModel(doc.def)
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  add({
    id: 'lint',
    label: '구조 오류 검사',
    status: errors.length === 0 ? (warnings.length > 0 ? 'info' : 'pass') : 'fail',
    blocking: true,
    details: errors.length > 0 ? errors.map((i) => `${i.variable ? `'${i.variable}': ` : ''}${i.message}`) : warnings.length > 0 ? [`경고 ${warnings.length}건(적용을 막지 않습니다): ${warnings.slice(0, 5).map((w) => w.message).join(' / ')}${warnings.length > 5 ? ' …' : ''}`] : []
  })
  const skip = (id: GateStep['id'], label: string, blocking: boolean, why: string) => add({ id, label, status: 'skipped', blocking, details: [why] })
  if (errors.length > 0) {
    skip('spec', '앱 연결(spec) 검사', true, '구조 오류를 먼저 고치세요.')
    skip('trial', '기본값 시험 실행', true, '구조 오류를 먼저 고치세요.')
    skip('units', '단위 검사', false, '구조 오류를 먼저 고치세요.')
    skip('structure', '구조 점검(S1~S6)', false, '구조 오류를 먼저 고치세요.')
    return { steps, canApply: false, validated: null, structure: null, unitErrors: 0 }
  }

  // ② 앱 연결
  const v = validateModelDoc(doc as ModelDocRaw)
  add({ id: 'spec', label: '앱 연결(spec) 검사', status: v.ok ? 'pass' : 'fail', blocking: true, details: v.ok ? [] : [v.message] })
  if (!v.ok) {
    skip('trial', '기본값 시험 실행', true, '앱 연결 정보를 먼저 고치세요.')
    skip('units', '단위 검사', false, '앱 연결 정보를 먼저 고치세요.')
    skip('structure', '구조 점검(S1~S6)', false, '앱 연결 정보를 먼저 고치세요.')
    return { steps, canApply: false, validated: null, structure: null, unitErrors: 0 }
  }

  // ③ 시험 실행
  const entry = buildEntry(v.doc, v.hash)
  const params = Object.fromEntries(Object.entries(v.doc.def.constants).map(([n, c]) => [n, c.value]))
  const trial: GateStep = { id: 'trial', label: '기본값 시험 실행', status: 'pass', blocking: true, details: [] }
  let completed: boolean | null = null
  try {
    const result = runModel(compileModel(v.doc.def), { overrides: params })
    const done = entry.kpis(result).completionDay
    completed = v.doc.spec.completion ? done !== null : null
    if (completed === false) {
      trial.status = 'info'
      trial.details = ['기본값으로는 종료 시각 안에 완료 조건을 만족하지 못했습니다(완료일이 없습니다). 종료 시각이나 완료 조건을 확인하세요. 적용은 막지 않습니다.']
    }
  } catch (e) {
    trial.status = 'fail'
    trial.details = [e instanceof Error ? e.message : String(e)]
  }
  add(trial)
  if (trial.status === 'fail') {
    skip('units', '단위 검사', false, '시험 실행 오류를 먼저 고치세요.')
    skip('structure', '구조 점검(S1~S6)', false, '시험 실행 오류를 먼저 고치세요.')
    return { steps, canApply: false, validated: null, structure: null, unitErrors: 0 }
  }

  // ④ 단위: 막지 않는다. 확정된 불일치(오류)가 있으면 적용할 때 확인을 받는다(D5).
  const unitIssues = checkModelUnits(v.doc.def)
  const unitErr = unitIssues.filter((i) => i.severity === 'error')
  const unitWarn = unitIssues.filter((i) => i.severity === 'warning')
  const unitInfo = unitIssues.filter((i) => i.severity === 'info')
  add({
    id: 'units',
    label: '단위 검사',
    status: unitErr.length > 0 ? 'fail' : unitWarn.length > 0 ? 'info' : 'pass',
    blocking: false,
    details: [
      ...unitErr.map((i) => `${i.variable ? `'${i.variable}': ` : ''}${i.message}`),
      ...unitWarn.map((i) => `${i.variable ? `'${i.variable}': ` : ''}${i.message}`),
      ...(unitErr.length > 0 ? ['단위 오류는 적용을 막지 않지만 확인이 필요합니다. 책 2.6.5는 원칙이 도움이며 근거가 있으면 어길 수 있다고 봅니다. 오류가 있는 모델은 어디서나 표시됩니다.'] : []),
      ...(unitInfo.length > 0 && unitErr.length === 0 && unitWarn.length === 0 ? [`참고 ${unitInfo.length}건(단위 선언 없음·제안). 문제 패널의 참고에서 볼 수 있습니다.`] : [])
    ]
  })

  // ⑤ 구조 점검(막지 않는다)
  let structure: StructureFinding[] | null = null
  const st: GateStep = { id: 'structure', label: '구조 점검(S1~S6)', status: 'pass', blocking: false, details: [] }
  try {
    structure = runStructureChecks({
      model: compileModel(v.doc.def),
      params,
      options: { end: v.doc.def.time.end, dt: v.doc.def.time.dt, seed: 1 },
      kpis: entry.kpiSpecs,
      usedExternally: externallyUsedVariables(entry)
    }).findings
    const fails = structure.filter((f) => f.status === 'fail')
    const warns = structure.filter((f) => f.status === 'warn')
    st.status = fails.length > 0 ? 'fail' : warns.length > 0 ? 'info' : 'pass'
    st.details = structure.filter((f) => f.status !== 'pass').map((f) => `${f.id} ${f.title}: ${STRUCTURE_STATUS[f.status]} — ${f.summary}`)
    if (fails.length > 0) st.details.push('실패한 점검이 있어도 적용은 막지 않습니다. 결과를 확인하고 판단하세요.')
  } catch (e) {
    st.status = 'info'
    st.details = [`구조 점검을 실행하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`]
  }
  add(st)
  return { steps, canApply: true, validated: v, structure, unitErrors: unitErr.length }
}
