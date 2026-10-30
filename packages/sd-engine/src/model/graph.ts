export class CycleError extends Error {
  /** [a, b, a]는 a가 b에, b가 a에 의존함을 뜻한다. */
  readonly cycle: string[]

  constructor(cycle: string[]) {
    super(`순환 참조: ${cycle.join(' → ')}`)
    this.name = 'CycleError'
    this.cycle = cycle
  }
}

/**
 * 의존하는 노드가 먼저 오도록 정렬한다(Kahn). 같은 순위에서는 선언 순서를 유지해 결과가 결정적이다.
 * `depsOf`가 돌려주는 이름 중 `nodes`에 없는 것은 무시한다. 순환이 있으면 경로를 담아 `CycleError`를 던진다.
 */
export function topologicalOrder(
  nodes: readonly string[],
  depsOf: (node: string) => Iterable<string>
): string[] {
  const index = new Map(nodes.map((n, i) => [n, i]))
  const deps = new Map<string, string[]>()
  const dependents = new Map<string, string[]>(nodes.map((n) => [n, []]))
  const pending = new Map<string, number>()

  for (const n of nodes) {
    const ds = [...new Set(depsOf(n))].filter((d) => index.has(d))
    deps.set(n, ds)
    pending.set(n, ds.length)
    for (const d of ds) (dependents.get(d) as string[]).push(n)
  }

  const ready = nodes.filter((n) => pending.get(n) === 0)
  const order: string[] = []
  while (ready.length > 0) {
    let best = 0
    for (let i = 1; i < ready.length; i++) {
      if ((index.get(ready[i] as string) as number) < (index.get(ready[best] as string) as number)) best = i
    }
    const [n] = ready.splice(best, 1) as [string]
    order.push(n)
    for (const m of dependents.get(n) as string[]) {
      const left = (pending.get(m) as number) - 1
      pending.set(m, left)
      if (left === 0) ready.push(m)
    }
  }

  if (order.length < nodes.length) throw new CycleError(findCycle(nodes, deps, new Set(order)))
  return order
}

function findCycle(nodes: readonly string[], deps: Map<string, string[]>, done: Set<string>): string[] {
  const start = nodes.find((n) => !done.has(n)) as string
  const path = [start]
  const seen = new Map<string, number>([[start, 0]])
  let cur = start
  for (;;) {
    // 처리되지 않고 남은 노드는 반드시 남은 노드 중 하나에 의존한다.
    const next = (deps.get(cur) as string[]).find((d) => !done.has(d)) as string
    const at = seen.get(next)
    if (at !== undefined) return [...path.slice(at), next]
    seen.set(next, path.length)
    path.push(next)
    cur = next
  }
}
