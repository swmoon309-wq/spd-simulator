import type { McHandle, RunHandle } from '../engine/engineClient'
import { createControl, ResultCache } from '../lib/scenarioRunner'

/**
 * 슬라이스들이 함께 쓰는 실행 핸들·번호·취소 요청(화면 상태가 아니라서 스토어 밖에 둔다).
 * 프로젝트를 새로 만들거나 열 때 번호를 되돌리고, 진행 중인 실행을 멈출 때 취소 핸들을 쓴다.
 */
export const rt = {
  /** 진행 중인 단일 실행의 핸들 */
  handle: null as RunHandle | null,
  runSeq: 0,
  refSeq: 0,
  batchControl: null as ReturnType<typeof createControl> | null,
  /** 극단 조건 시험의 실행 번호와 취소 요청. 프로젝트가 바뀌면 번호가 달라져 늦게 끝난 결과를 버린다. */
  extremesSeq: 0,
  extremesCancel: false,
  /** 보정 실행의 번호와 취소 요청 */
  calibSeq: 0,
  calibCancel: false,
  /** 진행 중인 위험 분석(Monte Carlo)의 취소 핸들 */
  riskControl: null as McHandle | null,
  /** 입력이 같은 시나리오 실행 결과의 캐시. 프로젝트를 바꾸면 비운다. */
  resultCache: new ResultCache()
}
