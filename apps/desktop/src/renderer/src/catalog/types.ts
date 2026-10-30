import type { EvmCredit, KpiSpec, RadarAxis } from '@spd/analysis'
import type { ModelDef, RunResult } from '@spd/sd-engine'
import type { ModelDoc } from '../lib/modelDoc'

export type { EvmCredit, KpiSpec, RadarAxis }

export interface ParamSpec {
  name: string
  min: number
  max: number
  step: number
  integer?: boolean
}

export interface ParamGroup {
  title: string
  params: ParamSpec[]
}

export interface VariableInfo {
  name: string
  label: string
  unit: string
}

export interface Kpis {
  /** 완료 시각(일). 종료 시각까지 끝나지 않으면 null */
  completionDay: number | null
  peakStaff: number
}

export interface Preset {
  label: string
  overrides: Record<string, number>
}

/**
 * Earned Value 어댑터(설계 05, 3.2). 모델마다 변수 이름이 달라 계산 코드는 이것만 본다.
 * 진척률 P(t) = Σ(비율 × 누적 태스크) / 총 태스크, 비용 단위는 맨데이다.
 */
export interface EvmAdapter {
  /** 총 태스크(진척률의 분모) */
  totalTasks(params: Record<string, number>): number
  /** 단계별 누적 태스크 변수와 기본 인정 비율(합 1). 라벨은 입력 화면에 쓴다. */
  credits: (EvmCredit & { label: string })[]
  /** 누적 투입 공수(맨데이) 변수 */
  effortVariable: string
  /** 완료 시각. 종료 시각까지 끝나지 않았으면 null */
  completion(result: RunResult): number | null
}

/**
 * 모델의 규모 입력(CFG-01). 화면은 이것으로 "SLOC로 입력" 보조 입력을 만든다. 규모 단위가 태스크가 아닌 모델은 환산 기준을
 * 책에서 정하지 않았으면 `slocPerUnit`을 null로 두어 사용자가 직접 적게 한다(값을 지어내지 않는다).
 */
export interface SizeInfo {
  /** 규모를 담는 파라미터 이름 */
  param: string
  /** 규모 단위(태스크, FP …) */
  unit: string
  /** 한 단위가 몇 SLOC인지의 기본값. 모르면 null */
  slocPerUnit: number | null
  /** 기본값의 근거(화면에 보인다) */
  source?: string
}

/** 카탈로그의 분류: 프로젝트 모델, 책 3장의 기본 구조 라이브러리(MDL-03), 사용자 모델(설계 08). 모델 선택 목록의 묶음이 된다. */
export type ModelCategory = 'project' | 'structure' | 'user'

export interface ModelEntry {
  id: string
  title: string
  category: ModelCategory
  description: string
  /** 규모 입력 정보. 없으면 SLOC 보조 입력을 보이지 않는다. */
  size?: SizeInfo
  def: ModelDef
  groups: ParamGroup[]
  /** 차트에서 고를 수 있는 변수(표시 순서) */
  variables: VariableInfo[]
  defaultVariable: string
  presets: Preset[]
  /** 실행 표(임시 기록)에 쓰는 요약 지표 */
  kpis(result: RunResult): Kpis
  /** 시나리오 비교에 쓰는 지표 정의 */
  kpiSpecs: KpiSpec[]
  /** 레이더 차트의 축(지표 하나가 한 축). 3개 미만이면 레이더를 그리지 않는다. */
  radarAxes: RadarAxis[]
  /** 계획 기준선·Earned Value 계산에 쓰는 어댑터. 없으면 채택·통제를 쓸 수 없다(사용자 모델에 진척 정의가 없을 때). */
  evm?: EvmAdapter
  /** 사용자 모델이면 그 문서와 내용 해시(프로젝트 파일에 내장하고 Worker에 등록하는 데 쓴다). 내장 모델에는 없다. */
  custom?: { doc: ModelDoc; hash: string }
}
