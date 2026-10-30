import { Rng } from '../rng'

/** 수식 평가에 필요한 실행 상태. 러너가 한 스텝마다 갱신한다. */
export interface Runtime {
  /** 변수 슬롯(상수, Level, Rate, Auxiliary 현재값) */
  values: Float64Array
  /** 지연·평활 함수의 내부 상태 */
  state: Float64Array
  time: number
  dt: number
  rng: Rng
  /** true이면 지연·평활 함수가 상태 대신 입력을 그대로 반환한다(초기화 스윕용). */
  initializing: boolean
}

export interface Stateful {
  /** 상태를 입력 값으로 정상 상태 초기화한다. */
  init(rt: Runtime): void
  /** 다음 스텝 상태를 `next`에 쓴다. `rt.state`는 읽기만 한다. */
  update(rt: Runtime, next: Float64Array): void
}

/** 한 모델의 모든 수식이 공유하는 상태 저장소. */
export class StateStore {
  private size = 0
  private readonly items: Stateful[] = []
  private next = new Float64Array(0)

  get stateSize(): number {
    return this.size
  }

  /** 등록된 지연·평활 함수의 개수. */
  get count(): number {
    return this.items.length
  }

  alloc(count: number): number {
    const base = this.size
    this.size += count
    return base
  }

  add(item: Stateful): void {
    this.items.push(item)
  }

  initAll(rt: Runtime): void {
    for (const item of this.items) item.init(rt)
  }

  /** 모든 상태를 같은 시점의 값으로 계산한 뒤 한꺼번에 반영한다(순서 무관). */
  updateAll(rt: Runtime): void {
    if (this.next.length !== this.size) this.next = new Float64Array(this.size)
    for (const item of this.items) item.update(rt, this.next)
    rt.state.set(this.next)
  }
}

export interface RuntimeOptions {
  slots: number
  store: StateStore
  dt: number
  time?: number
  seed?: number
}

/** 모든 수식을 컴파일한 뒤(상태 크기가 확정된 뒤) 호출한다. */
export function createRuntime(opts: RuntimeOptions): Runtime {
  return {
    values: new Float64Array(opts.slots),
    state: new Float64Array(opts.store.stateSize),
    time: opts.time ?? 0,
    dt: opts.dt,
    rng: new Rng(opts.seed ?? 1),
    initializing: false
  }
}
