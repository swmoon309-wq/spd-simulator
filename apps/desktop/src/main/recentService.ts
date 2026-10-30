import { createHash } from 'node:crypto'
import { basename, dirname } from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import type { RecentEntry } from '../shared/ipc'

export interface RecentDeps {
  /** 목록을 저장하는 파일(앱 데이터 폴더 아래) */
  file: string
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    stat(path: string): Promise<unknown>
  }
  now(): Date
}

export const MAX_RECENT = 10

interface Stored {
  path: string
  openedAt: string
}

/** 경로를 renderer에 넘기지 않으려고 경로에서 만든 짧은 식별자를 쓴다. */
export function recentId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

/**
 * 최근에 열거나 저장한 프로젝트 파일의 목록(PRJ-02). 앱 데이터 폴더의 JSON 파일에 둔다. renderer에는 파일 이름과 폴더 이름만
 * 알리고 경로는 main만 안다. 목록은 편의 기능이라 읽거나 쓰지 못해도 오류로 알리지 않고 없는 것으로 다룬다.
 */
export class RecentService {
  private items: Stored[] | null = null

  constructor(private readonly deps: RecentDeps) {}

  private async load(): Promise<Stored[]> {
    if (this.items) return this.items
    let items: Stored[] = []
    try {
      const raw: unknown = JSON.parse(await this.deps.fs.readFile(this.deps.file))
      const list = typeof raw === 'object' && raw !== null ? (raw as { items?: unknown }).items : null
      if (Array.isArray(list)) {
        const seen = new Set<string>()
        for (const it of list) {
          const { path, openedAt } = (it ?? {}) as Partial<Stored>
          if (typeof path !== 'string' || path === '' || typeof openedAt !== 'string' || seen.has(path)) continue
          seen.add(path)
          items.push({ path, openedAt })
        }
        items = items.slice(0, MAX_RECENT)
      }
    } catch {
      items = []
    }
    this.items = items
    return items
  }

  private async save(): Promise<void> {
    try {
      await writeFileAtomic(this.deps.fs, this.deps.file, JSON.stringify({ version: 1, items: this.items ?? [] }, null, 2) + '\n')
    } catch {
      // 목록을 저장하지 못해도 프로젝트 작업에는 영향이 없다.
    }
  }

  /** 가장 최근 것부터. 파일이 없어진 항목은 `missing`으로 표시한다(지우지는 않는다). */
  async list(): Promise<RecentEntry[]> {
    const items = await this.load()
    return Promise.all(
      items.map(async (it) => ({
        id: recentId(it.path),
        fileName: basename(it.path),
        folder: basename(dirname(it.path)),
        openedAt: it.openedAt,
        missing: await this.deps.fs.stat(it.path).then(
          () => false,
          () => true
        )
      }))
    )
  }

  /** 맨 앞에 넣는다. 이미 있으면 앞으로 옮긴다. */
  async add(path: string): Promise<void> {
    const items = await this.load()
    this.items = [{ path, openedAt: this.deps.now().toISOString() }, ...items.filter((it) => it.path !== path)].slice(0, MAX_RECENT)
    await this.save()
  }

  /** 식별자에 해당하는 경로. 없으면 null. */
  async resolve(id: string): Promise<string | null> {
    return (await this.load()).find((it) => recentId(it.path) === id)?.path ?? null
  }

  async remove(id: string): Promise<void> {
    const items = await this.load()
    this.items = items.filter((it) => recentId(it.path) !== id)
    await this.save()
  }

  async clear(): Promise<void> {
    this.items = []
    await this.save()
  }
}
