import type { Node } from './ast'
import { ExprError } from './errors'
import { FUNCTIONS, interpolate, isKnownFunction, type Table } from './functions'
import { parse } from './parser'
import type { Runtime, StateStore } from './runtime'

type Fn = (rt: Runtime) => number

export interface CompileEnv {
  /** 변수 이름 → `Runtime.values` 슬롯. 없으면 undefined. */
  resolve(name: string): number | undefined
  /** 지연·평활 함수가 상태를 등록하는 저장소(모델 전체가 공유). */
  state: StateStore
  /** `GRAPH(x, 이름)`으로 참조하는 이름 있는 테이블. */
  tables?: Record<string, Table>
}

export interface CompiledExpr {
  source: string
  eval: Fn
  /** 현재 스텝의 값에 직접 의존하는 변수. 평가 순서(위상 정렬)와 순환 참조 검사에 쓴다. */
  algebraicDeps: string[]
  /** SMOOTH·DELAY의 입력처럼 상태를 거쳐 다음 스텝에 영향을 주는 변수. 순환을 끊는다. */
  delayedDeps: string[]
}

/** 수식을 컴파일한다. 문법·이름·인자 개수 오류는 `ExprError`로 던진다. */
export function compile(source: string, env: CompileEnv): CompiledExpr {
  const ast = parse(source)
  const algebraic = new Set<string>()
  const delayed = new Set<string>()
  const fn = new Generator(source, env, delayed).gen(ast, algebraic)
  return { source, eval: fn, algebraicDeps: [...algebraic], delayedDeps: [...delayed] }
}

class Generator {
  constructor(
    private readonly source: string,
    private readonly env: CompileEnv,
    private readonly delayed: Set<string>
  ) {}

  private fail(detail: string, pos: number): never {
    throw new ExprError(detail, pos, this.source)
  }

  gen(node: Node, deps: Set<string>): Fn {
    switch (node.kind) {
      case 'num': {
        const v = node.value
        return () => v
      }
      case 'var':
        return this.variable(node.name, node.pos, deps)
      case 'unary': {
        const a = this.gen(node.arg, deps)
        if (node.op === '-') return (rt) => -a(rt)
        if (node.op === '+') return a
        return (rt) => (a(rt) === 0 ? 1 : 0)
      }
      case 'binary': {
        const l = this.gen(node.left, deps)
        const r = this.gen(node.right, deps)
        switch (node.op) {
          case '+':
            return (rt) => l(rt) + r(rt)
          case '-':
            return (rt) => l(rt) - r(rt)
          case '*':
            return (rt) => l(rt) * r(rt)
          case '/':
            return (rt) => l(rt) / r(rt)
          case '^':
            return (rt) => Math.pow(l(rt), r(rt))
          case '<':
            return (rt) => (l(rt) < r(rt) ? 1 : 0)
          case '>':
            return (rt) => (l(rt) > r(rt) ? 1 : 0)
          case '<=':
            return (rt) => (l(rt) <= r(rt) ? 1 : 0)
          case '>=':
            return (rt) => (l(rt) >= r(rt) ? 1 : 0)
          case '=':
            return (rt) => (l(rt) === r(rt) ? 1 : 0)
          case '<>':
            return (rt) => (l(rt) !== r(rt) ? 1 : 0)
          case 'AND':
            return (rt) => (l(rt) !== 0 && r(rt) !== 0 ? 1 : 0)
          case 'OR':
            return (rt) => (l(rt) !== 0 || r(rt) !== 0 ? 1 : 0)
        }
        break
      }
      case 'call':
        return this.call(node.name, node.args, node.pos, deps)
      case 'array':
        return this.fail('배열은 GRAPH의 인자로만 쓸 수 있습니다', node.pos)
    }
    return this.fail('지원하지 않는 수식입니다', (node as Node).pos)
  }

  private variable(name: string, pos: number, deps: Set<string>): Fn {
    if (name === 'TIME') return (rt) => rt.time
    if (name === 'DT') return (rt) => rt.dt
    const slot = this.env.resolve(name)
    if (slot === undefined) this.fail(`정의되지 않은 변수 '${name}'`, pos)
    deps.add(name)
    return (rt) => rt.values[slot] as number
  }

  private call(rawName: string, args: Node[], pos: number, deps: Set<string>): Fn {
    const name = rawName.toUpperCase()
    if (!isKnownFunction(name)) this.fail(`알 수 없는 함수 '${rawName}'`, pos)
    switch (name) {
      case 'GRAPH':
        return this.graph(args, pos, deps)
      case 'SMOOTH':
      case 'DELAY1':
        return this.firstOrder(name, args, pos)
      case 'DELAY3':
        return this.delay3(args, pos)
    }

    const spec = FUNCTIONS[name]
    if (!spec) return this.fail(`알 수 없는 함수 '${rawName}'`, pos)
    if (args.length < spec.min || args.length > spec.max) {
      const range = spec.max === Infinity ? `${spec.min}개 이상` : spec.min === spec.max ? `${spec.min}개` : `${spec.min}~${spec.max}개`
      this.fail(`${name}의 인자는 ${range}여야 하는데 ${args.length}개입니다`, pos)
    }
    const impl = spec.impl
    const a = args.map((n) => this.gen(n, deps))
    const [a0, a1, a2] = a as [Fn, Fn, Fn]
    switch (a.length) {
      case 1:
        return (rt) => impl(rt, a0(rt))
      case 2:
        return (rt) => impl(rt, a0(rt), a1(rt))
      case 3:
        return (rt) => impl(rt, a0(rt), a1(rt), a2(rt))
      default:
        return (rt) => impl(rt, ...a.map((f) => f(rt)))
    }
  }

  private graph(args: Node[], pos: number, deps: Set<string>): Fn {
    if (args.length !== 2 && args.length !== 3) {
      this.fail(`GRAPH의 인자는 (x, 테이블이름) 또는 (x, [x좌표], [y좌표])여야 합니다`, pos)
    }
    const x = this.gen(args[0] as Node, deps)
    let table: Table
    if (args.length === 3) {
      table = { x: this.constArray(args[1] as Node), y: this.constArray(args[2] as Node) }
    } else {
      const ref = args[1] as Node
      if (ref.kind !== 'var') this.fail('GRAPH의 두 번째 인자는 테이블 이름이어야 합니다', ref.pos)
      const found = this.env.tables?.[ref.name]
      if (!found) this.fail(`정의되지 않은 테이블 '${ref.name}'`, ref.pos)
      table = found
    }
    this.validateTable(table, pos)
    const f = interpolate(table)
    return (rt) => f(x(rt))
  }

  private validateTable(t: Table, pos: number): void {
    if (t.x.length !== t.y.length) this.fail('GRAPH의 x와 y 개수가 다릅니다', pos)
    if (t.x.length < 2) this.fail('GRAPH에는 점이 2개 이상 필요합니다', pos)
    for (let i = 1; i < t.x.length; i++) {
      if (!((t.x[i] as number) > (t.x[i - 1] as number))) {
        this.fail('GRAPH의 x 좌표는 엄격히 오름차순이어야 합니다', pos)
      }
    }
  }

  private constArray(node: Node): number[] {
    if (node.kind !== 'array') this.fail('상수 배열 [a, b, ...]이 필요합니다', node.pos)
    return node.items.map((n) => this.constEval(n))
  }

  private constEval(node: Node): number {
    switch (node.kind) {
      case 'num':
        return node.value
      case 'unary':
        if (node.op === '-') return -this.constEval(node.arg)
        if (node.op === '+') return this.constEval(node.arg)
        break
      case 'binary': {
        const l = this.constEval(node.left)
        const r = this.constEval(node.right)
        if (node.op === '+') return l + r
        if (node.op === '-') return l - r
        if (node.op === '*') return l * r
        if (node.op === '/') return l / r
        if (node.op === '^') return Math.pow(l, r)
        break
      }
    }
    return this.fail('배열의 값은 숫자 상수여야 합니다', node.pos)
  }

  /** SMOOTH(x, d), DELAY1(x, d): 1차 지수 지연. 값은 상태이고 입력은 다음 스텝에 반영된다. */
  private firstOrder(name: string, args: Node[], pos: number): Fn {
    if (args.length !== 2) this.fail(`${name}의 인자는 (입력, 지연시간) 2개여야 합니다`, pos)
    const input = this.gen(args[0] as Node, this.delayed)
    const delay = this.gen(args[1] as Node, this.delayed)
    const i = this.env.state.alloc(1)
    this.env.state.add({
      init: (rt) => {
        rt.state[i] = input(rt)
      },
      update: (rt, next) => {
        const s = rt.state[i] as number
        const d = Math.max(delay(rt), rt.dt)
        next[i] = s + ((input(rt) - s) * rt.dt) / d
      }
    })
    return (rt) => (rt.initializing ? input(rt) : (rt.state[i] as number))
  }

  /** DELAY3(x, d): 평균 지연 d의 3차 지연(1차 지연 3단, 단당 d/3). */
  private delay3(args: Node[], pos: number): Fn {
    if (args.length !== 2) this.fail('DELAY3의 인자는 (입력, 지연시간) 2개여야 합니다', pos)
    const input = this.gen(args[0] as Node, this.delayed)
    const delay = this.gen(args[1] as Node, this.delayed)
    const i = this.env.state.alloc(3)
    this.env.state.add({
      init: (rt) => {
        const x = input(rt)
        rt.state[i] = x
        rt.state[i + 1] = x
        rt.state[i + 2] = x
      },
      update: (rt, next) => {
        const tau = Math.max(delay(rt) / 3, rt.dt)
        const k = rt.dt / tau
        const s1 = rt.state[i] as number
        const s2 = rt.state[i + 1] as number
        const s3 = rt.state[i + 2] as number
        next[i] = s1 + (input(rt) - s1) * k
        next[i + 1] = s2 + (s1 - s2) * k
        next[i + 2] = s3 + (s2 - s3) * k
      }
    })
    return (rt) => (rt.initializing ? input(rt) : (rt.state[i + 2] as number))
  }
}
