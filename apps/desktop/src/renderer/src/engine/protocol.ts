import type { ConstantChange, InputSpec, McResult, ObservedState, ReforecastOutcome } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import type { ModelDoc } from '../lib/modelDoc'

export interface RunOptions {
  end?: number
  dt?: number
  seed?: number
}

export interface RunRequest {
  id: number
  modelId: string
  overrides: Record<string, number>
  /** 종료 시각·적분 간격·시드. 없으면 모델 기본값 */
  options?: RunOptions
  /** true면 시각 0의 상태에서 멈춘 채 시작한다(스텝 실행). 계속하거나 스텝을 요청해야 진행한다. */
  startPaused?: boolean
}

/**
 * 재예측 요청(설계 05의 7.3 E5). Worker가 기준선(`overrides`, `options`)을 보고일까지 실행해 스냅샷하고, 관측값으로 Level을
 * 덮어쓰고 κ를 곱해 종료 시각까지 이어서 실행한다. `kappas`마다 한 번씩 실행해 범위를 낸다.
 */
export interface ReforecastRequest {
  id: number
  modelId: string
  overrides: Record<string, number>
  options?: RunOptions
  observed: ObservedState
  kappas: { name: string; kappa: number }[]
  /** 이어 실행 시작에서 추가로 바꿀 상수 */
  constants?: Record<string, number>
  /** 시각별 상수 변경(시정 조치 시험, 8장) */
  changes?: ConstantChange[]
}

/**
 * Monte Carlo 요청(설계 06의 4.2). Worker가 입력 분포에서 표본을 뽑아 모델을 `n`번 실행하고 카탈로그의 지표를 계산한다.
 * 취소(`cancel`)하면 그때까지 끝난 반복의 결과를 돌려준다.
 */
export interface McRequest {
  id: number
  modelId: string
  /** 대상 시나리오의 유효 파라미터(불확실한 입력은 표본이 덮어쓴다) */
  overrides: Record<string, number>
  /** 종료 시각·dt */
  options: { end?: number; dt?: number }
  inputs: InputSpec[]
  n: number
  seed: number
  /** 시계열 띠를 모을 변수(1일 간격). 없으면 모으지 않는다. */
  band?: { variable: string } | null
}

/**
 * 사용자 모델 등록(설계 08의 5.1). 이후 요청의 `modelId`로 쓴다. 해시가 같으면 다시 컴파일하지 않는다. 계산 정의(`def`)뿐 아니라 지표 정의(`spec`)도
 * 필요해서(Monte Carlo가 지표를 계산한다) 문서 전체를 보낸다.
 */
export interface RegisterModelRequest {
  id: string
  hash: string
  doc: ModelDoc
}

export type WorkerIn =
  | ({ type: 'registerModel' } & RegisterModelRequest)
  | ({ type: 'run' } & RunRequest)
  | ({ type: 'reforecast' } & ReforecastRequest)
  | ({ type: 'montecarlo' } & McRequest)
  | { type: 'cancel'; id: number }
  /** 실행 중인 `run`의 일시정지·계속·스텝(`steps`만큼 진행하고 멈춘다. 일시정지가 아니면 먼저 멈춘다). */
  | { type: 'control'; id: number; action: 'pause' | 'resume' | 'step'; steps?: number }

export type WorkerOut =
  | { type: 'progress'; id: number; time: number; fraction: number; values: Record<string, number> }
  | { type: 'done'; id: number; result: RunResult }
  | { type: 'reforecastDone'; id: number; outcome: ReforecastOutcome }
  /** Monte Carlo 진행. `snapshot`은 지금까지 끝난 반복의 결과(가끔만 붙는다) */
  | { type: 'mcProgress'; id: number; completed: number; total: number; snapshot?: McResult }
  | { type: 'mcDone'; id: number; result: McResult; canceled: boolean }
  | { type: 'error'; id: number; message: string }
