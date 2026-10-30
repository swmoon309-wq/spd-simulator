import { parseModelDef, type ModelDef } from '@spd/sd-engine'
import brooksJson from './brooks.json'
import integratedJson from './integrated-project.json'
import integratedAiJson from './integrated-project-ai.json'
import productionReworkJson from './production-rework.json'
import learningCurveJson from './learning-curve.json'
import rayleighJson from './rayleigh.json'
import personnelChainJson from './personnel-chain.json'
import defectChainJson from './defect-chain.json'

/** 책 1.4 Brooks 법칙 모델. 인력 추가 시점(`hire_day`)과 인원(`extra_people`)을 덮어써 실험한다. */
export const brooksModel: ModelDef = parseModelDef(brooksJson)

/** 책 6.3 Abdel-Hamid 통합 프로젝트 모델의 4섹터(인력·계획·생산·통제) 단순판. 명세는 docs/02.설계/03 참조. */
export const integratedProjectModel: ModelDef = parseModelDef(integratedJson)

/**
 * 통합 프로젝트 모델에 AI 보조 개발의 생성 가속을 더한 확장(설계 10, P0). `ai_adoption = 0`이면 통합 프로젝트 모델과 모든 변수가 비트 단위로 같다.
 * 새 상수는 모두 "영향 없음"이 기본값이다. 값은 문헌마다 크게 달라 정하지 않고 사용자 입력·분포·보정으로 받는다.
 */
export const integratedProjectAiModel: ModelDef = parseModelDef(integratedAiJson)

// ---- 기본 구조 라이브러리(MDL-03): 책 3장 3.4~3.5의 구조를 하나씩 단독으로 실행해 볼 수 있게 한 작은 모델들 ----

/** 책 3.4.7(그림 3.36): 일을 하면 일부가 잘못되어 발견 전 재작업이 쌓이고, 발견되면 다시 해야 할 일로 돌아간다. */
export const productionReworkModel: ModelDef = parseModelDef(productionReworkJson)

/** 책 3.4.9(그림 3.38~3.39): 진행률에 따라 생산성이 S자로 오르는 학습곡선. */
export const learningCurveModel: ModelDef = parseModelDef(learningCurveJson)

/** 책 3.4.10(그림 3.40): effort rate = 학습 함수 × (추정 총 공수 − 누적 공수), 학습 함수 = 인력 증가 계수 × 시간. */
export const rayleighModel: ModelDef = parseModelDef(rayleighJson)

/** 책 3.5.3.1(그림 3.63)과 3.4.8(그림 3.37): 신입·일반·선임 3단계 인력 체인이 일을 생산한다. */
export const personnelChainModel: ModelDef = parseModelDef(personnelChainJson)

/** 책 3.5.2.1~3.5.2.3(그림 3.56~3.58): 오류 발생(생산과 함께), 검출 효율로 갈라지는 검출·미검출, 검출한 오류의 재작업. */
export const defectChainModel: ModelDef = parseModelDef(defectChainJson)
