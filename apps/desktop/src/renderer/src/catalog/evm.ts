import type { EvmAdapter, ModelEntry } from './types'

/** 채택·통제를 쓸 수 없는 모델이면 이유, 쓸 수 있으면 null(진척 정의가 없는 사용자 모델). */
export function controlUnsupported(entry: ModelEntry): string | null {
  return entry.evm ? null : '이 모델에는 진척(Earned Value) 정의가 없어 계획 채택과 통제를 쓸 수 없습니다. 모델의 완료 조건과 진척 인정 변수를 정의하면 쓸 수 있습니다.'
}

/** Earned Value 어댑터. 채택·통제 경로에서만 부른다(앞에서 `controlUnsupported`로 막는다). 없으면 프로그래밍 오류다. */
export function evmOf(entry: ModelEntry): EvmAdapter {
  if (!entry.evm) throw new Error(`모델 '${entry.id}'에는 Earned Value 정의가 없습니다`)
  return entry.evm
}
