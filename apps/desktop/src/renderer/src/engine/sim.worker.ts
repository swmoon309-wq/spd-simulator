import { applyControl, executeMonteCarlo, executeReforecast, executeRun, newRunControl, type RunControl } from './execute'
import { applyRegisterModel } from './registerModel'
import type { WorkerIn, WorkerOut } from './protocol'

// lib "DOM"과 "WebWorker"는 함께 쓸 수 없어 필요한 부분만 좁게 선언한다.
const ctx = self as unknown as {
  postMessage(message: WorkerOut, transfer?: Transferable[]): void
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null
}

const cancelled = new Set<number>()
/** 실행 중인 `run`의 일시정지·스텝 제어. 끝나면 지운다. */
const controls = new Map<number, RunControl>()

ctx.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'registerModel') {
    try {
      applyRegisterModel(msg)
    } catch {
      // 잘못된 정의는 renderer가 등록 전에 걸러 낸다. 여기서 실패하면 그 모델의 요청이 "알 수 없는 모델" 오류로 알려 준다.
    }
    return
  }
  if (msg.type === 'cancel') {
    cancelled.add(msg.id)
    controls.get(msg.id)?.wake?.() // 멈춰 있어도 취소를 알아차리게 깨운다
    return
  }
  if (msg.type === 'control') {
    const control = controls.get(msg.id)
    if (control) applyControl(control, msg.action, msg.steps)
    return
  }
  if (msg.type === 'reforecast') {
    executeReforecast(msg, { post: (m, transfer) => ctx.postMessage(m, transfer ?? []) })
    return
  }
  if (msg.type === 'montecarlo') {
    void executeMonteCarlo(msg, {
      post: (m, transfer) => ctx.postMessage(m, transfer ?? []),
      isCancelled: () => cancelled.has(msg.id),
      yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
      now: () => performance.now()
    }).finally(() => cancelled.delete(msg.id))
    return
  }
  const control = newRunControl()
  controls.set(msg.id, control)
  void executeRun(msg, {
    post: (m, transfer) => ctx.postMessage(m, transfer ?? []),
    isCancelled: () => cancelled.has(msg.id),
    yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
    now: () => performance.now(),
    control
  }).finally(() => {
    cancelled.delete(msg.id)
    controls.delete(msg.id)
  })
}
