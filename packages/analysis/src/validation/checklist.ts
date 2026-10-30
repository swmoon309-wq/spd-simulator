/**
 * 수동 체크리스트(설계 07의 4.3). 책 2.8.1의 표 2-4(목적 적합성)·2-5(현실과의 일관성)·2-6(유용성)의 시험 항목을 이 앱에서 확인할 수
 * 있는 형태로 풀어 쓴 것이다. 항목마다 **미확인 / 확인 / 문제 있음**과 메모를 기록한다. 책은 시험 하나로는 모델을 검증할 수 없고 여러
 * 시험을 함께 봐야 한다고 말한다 — 이 목록은 합격 판정이 아니라 빠뜨린 시험이 없는지 점검하는 용도이다.
 */

export type ChecklistStatus = 'unchecked' | 'ok' | 'problem'

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatus, string> = { unchecked: '미확인', ok: '확인', problem: '문제 있음' }
export const CHECKLIST_STATUS_MARK: Record<ChecklistStatus, string> = { unchecked: '○', ok: '✓', problem: '▲' }

export type ChecklistGroup = 'suitability' | 'reality' | 'utility'
export const CHECKLIST_GROUP_LABEL: Record<ChecklistGroup, string> = {
  suitability: '목적에 맞는가 (표 2-4)',
  reality: '현실과 일치하는가 (표 2-5)',
  utility: '쓸모가 있는가 (표 2-6)'
}

export interface ChecklistItem {
  /** 파일에 저장하는 안정적인 식별자 */
  id: string
  group: ChecklistGroup
  /** 구조를 보는 시험인가, 행동(시간에 따른 결과)을 보는 시험인가 */
  focus: 'structure' | 'behavior'
  title: string
  /** 통과 기준(책의 기준을 풀어 쓴 문장) */
  criterion: string
  /** 이 앱에서 확인하는 방법 */
  help: string
}

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: 'dimensional-consistency', group: 'suitability', focus: 'structure', title: '차원(단위) 일관성', criterion: '수식의 모든 항이 올바른 단위로 계산되어 모델의 균형이 맞는다.', help: '구조 점검 S1이 수식 안의 항별 단위 일치와 Level–흐름의 단위 관계를 확인한다. 숫자 리터럴과 단위가 없는 변수를 쓰는 수식은 확인하지 못하므로 직접 본다.' },
  { id: 'extreme-equations', group: 'suitability', focus: 'structure', title: '수식의 극단 조건', criterion: '극단 값을 넣어도 수식이 말이 된다.', help: '극단·교란 시험 탭의 극단 조건 시험이 오류를 찾는다. 거동이 말이 되는지는 셀을 열어 직접 본다.' },
  { id: 'boundary-adequacy', group: 'suitability', focus: 'structure', title: '경계의 적절성', criterion: '연구 목적에 필요한 변수, 피드백, 정책 수단이 모델 안에 들어 있다.', help: '모델의 파라미터와 변수 목록을 보고 질문에 답하는 데 빠진 것이 없는지 판단한다.' },
  { id: 'parameter-sensitivity-behavior', group: 'suitability', focus: 'behavior', title: '파라미터 민감도: 행동', criterion: '합리적인 범위에서 파라미터를 바꿨을 때 모델 행동이 어떻게 달라지는지 확인했다.', help: '위험 분석 탭의 민감도(토네이도·스윕)와 극단·교란 시험의 반응을 본다.' },
  { id: 'parameter-sensitivity-policy', group: 'suitability', focus: 'behavior', title: '파라미터 민감도: 정책 결론', criterion: '합리적인 파라미터 변화에서 정책 결론이 유지되는지 확인했다.', help: '위험 분석 탭의 시나리오 간 비교(우열이 뒤바뀌는 비율)로 본다.' },
  { id: 'structural-sensitivity-behavior', group: 'suitability', focus: 'behavior', title: '구조 민감도: 행동', criterion: '합리적인 대안 구조에서 모델 행동이 어떻게 달라지는지 확인했다.', help: '모델 편집기(4차) 전에는 구조를 직접 바꾼 모델을 따로 만들어 비교한다.' },
  { id: 'structural-sensitivity-policy', group: 'suitability', focus: 'behavior', title: '구조 민감도: 정책 결론', criterion: '합리적인 대안 구조에서 정책 결론이 유지되는지 확인했다.', help: '구조를 바꾼 모델에서 시나리오 비교를 다시 해 본다.' },
  { id: 'face-validity', group: 'reality', focus: 'structure', title: '구조의 현실성(얼굴 타당성)', criterion: '흐름과 Level, 정보 피드백, 지연이 시스템을 잘 아는 사람에게 실제와 닮아 보인다.', help: '모델 설명과 변수 목록을 시스템을 아는 사람과 함께 검토한다.' },
  { id: 'parameter-values', group: 'reality', focus: 'structure', title: '파라미터 값의 근거', criterion: '파라미터가 실제 시스템에서 알아볼 수 있는 개념이고, 값이 가진 최선의 정보와 맞는다.', help: '파라미터 폼의 단위와 범위, 데이터 비교의 보정 결과(식별 가능성 진단)를 본다.' },
  { id: 'reference-modes', group: 'reality', focus: 'behavior', title: '기준 행동 재현', criterion: '연구의 출발이 된 문제 행동, 과거 정책에 대한 반응, 예상한 행동을 모델이 스스로 재현한다.', help: '데이터 비교 탭에서 실제 데이터와 겹쳐 보고 오차 지표를 확인한다.' },
  { id: 'surprise-behavior', group: 'reality', focus: 'behavior', title: '예상 밖 행동의 해석', criterion: '예상 밖 행동이 나오면 가능한 새 행동을 드러낸 것인지, 모델이 틀려 고쳐야 하는 것인지 가려냈다.', help: '교란 시험의 반응과 극단 조건 셀의 그래프에서 이유를 찾는다.' },
  { id: 'extreme-simulations', group: 'reality', focus: 'behavior', title: '극단 조건·정책에서의 행동', criterion: '극단적인 조건이나 정책에서도 모델이 합리적으로 행동한다.', help: '극단·교란 시험 탭의 극단 조건 시험과 교란 시험을 본다.' },
  { id: 'statistical-tests', group: 'reality', focus: 'behavior', title: '실제 데이터와의 통계적 일치', criterion: '모델 출력이 실제 데이터와 같은 통계적 특성을 보인다.', help: '데이터 비교의 RMSE, 정규화 RMSE, MRE, NSE, Theil 분해를 본다. 상관만으로 판단하지 않는다.' },
  { id: 'audience-fit', group: 'utility', focus: 'structure', title: '사용자에게 맞는 규모와 복잡도', criterion: '모델의 크기, 단순함 또는 복잡함, 집계 수준이 사용할 사람에게 적절하다.', help: '모델을 실제로 쓸 사람의 입장에서 판단한다.' },
  { id: 'counterintuitive-behavior', group: 'utility', focus: 'behavior', title: '반직관적 행동의 설명', criterion: '일부 정책에서 반직관적으로 보이는 반응이 나오더라도 결국 실제 시스템 구조의 결과로 설명된다.', help: '예: Brooks 법칙 모델에서 인력을 더하면 오히려 늦어지는 반응을 교란 시험으로 확인한다.' },
  { id: 'generates-insight', group: 'utility', focus: 'behavior', title: '새로운 통찰', criterion: '모델이 시스템에 대한 새로운 통찰을 낼 수 있다.', help: '분석 결과에서 이전에 몰랐던 것을 배웠는지 되돌아본다.' }
]

export interface ChecklistEntry {
  id: string
  status: ChecklistStatus
  note: string
}

export const MAX_CHECKLIST_NOTE = 500

const byId = new Map(CHECKLIST_ITEMS.map((i) => [i.id, i]))
export const checklistItem = (id: string): ChecklistItem | undefined => byId.get(id)

/** 처음 상태(미확인, 메모 없음)인 항목은 저장하지 않으므로, 저장된 목록에 없는 항목은 처음 상태로 본다. */
export function entryFor(entries: ChecklistEntry[], id: string): ChecklistEntry {
  return entries.find((e) => e.id === id) ?? { id, status: 'unchecked', note: '' }
}

/** 항목 하나를 바꾼 새 목록. 처음 상태가 되면 목록에서 뺀다(정의 순서 유지). */
export function withChecklistEntry(entries: ChecklistEntry[], id: string, patch: Partial<Pick<ChecklistEntry, 'status' | 'note'>>): ChecklistEntry[] {
  const next = { ...entryFor(entries, id), ...patch }
  const rest = entries.filter((e) => e.id !== id)
  const isDefault = next.status === 'unchecked' && next.note === ''
  const merged = isDefault ? rest : [...rest, next]
  const order = new Map(CHECKLIST_ITEMS.map((i, k) => [i.id, k]))
  return merged.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
}

/** 상태별 개수(정의된 모든 항목 기준). */
export function checklistCounts(entries: ChecklistEntry[]): Record<ChecklistStatus, number> {
  const out: Record<ChecklistStatus, number> = { unchecked: 0, ok: 0, problem: 0 }
  for (const item of CHECKLIST_ITEMS) out[entryFor(entries, item.id).status]++
  return out
}
