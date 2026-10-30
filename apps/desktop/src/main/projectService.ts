import { basename } from 'node:path'
import { writeFileAtomic } from './atomicWrite'
import type { OpenResult, SaveResult } from '../shared/ipc'
import {
  PROJECT_EXTENSION,
  parseProjectJson,
  projectFileSchema,
  serializeProject,
  type ProjectFile
} from '../shared/projectFile'

export interface ProjectDeps {
  pickOpenPath(): Promise<string | null>
  pickSavePath(defaultName: string): Promise<string | null>
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
    stat(path: string): Promise<{ size: number }>
  }
}

/** 파일 크기 상한. 프로젝트 파일은 설정만 담으므로 작다. */
const MAX_BYTES = 5 * 1024 * 1024

/** `.spd.json`으로 끝나지 않으면 맞춘다(`a.json` → `a.spd.json`, `a` → `a.spd.json`). */
export function ensureExtension(path: string): string {
  if (path.endsWith(PROJECT_EXTENSION)) return path
  if (path.endsWith('.json')) return path.slice(0, -'.json'.length) + PROJECT_EXTENSION
  return path + PROJECT_EXTENSION
}

export function defaultFileName(projectName: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'
  return safe + PROJECT_EXTENSION
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 프로젝트 파일 저장·열기. Electron에 의존하지 않아 대화상자와 파일 시스템을 주입해 시험한다.
 * 현재 파일 경로는 여기서만 기억하고 renderer에는 파일 이름만 돌려준다.
 * 저장할 때 `meta.name`은 파일 이름(확장자 제외)으로 맞춘다.
 */
export class ProjectService {
  private currentPath: string | null = null

  constructor(private readonly deps: ProjectDeps) {}

  get path(): string | null {
    return this.currentPath
  }

  reset(): void {
    this.currentPath = null
  }

  async open(): Promise<OpenResult> {
    const path = await this.deps.pickOpenPath()
    if (path === null) return { status: 'canceled' }
    return this.openPath(path)
  }

  /** 대화상자 없이 경로의 프로젝트를 연다(최근 목록). */
  async openPath(path: string): Promise<OpenResult> {
    try {
      const { size } = await this.deps.fs.stat(path)
      if (size > MAX_BYTES) {
        return { status: 'error', message: `파일이 너무 큽니다(${Math.round(size / 1024)} KB). 프로젝트 파일이 아닌 것 같습니다.` }
      }
      const parsed = parseProjectJson(await this.deps.fs.readFile(path))
      if (!parsed.ok) return { status: 'error', message: parsed.message }
      this.currentPath = path
      return { status: 'opened', fileName: basename(path), project: parsed.project }
    } catch (e) {
      return { status: 'error', message: `파일을 읽지 못했습니다: ${message(e)}` }
    }
  }

  async save(project: ProjectFile): Promise<SaveResult> {
    return this.currentPath === null ? this.saveAs(project) : this.write(this.currentPath, project)
  }

  async saveAs(project: ProjectFile): Promise<SaveResult> {
    const picked = await this.deps.pickSavePath(defaultFileName(project.meta.name))
    if (picked === null) return { status: 'canceled' }
    return this.write(ensureExtension(picked), project)
  }

  /** 임시 파일에 쓴 뒤 이름을 바꿔, 쓰는 도중 실패해도 기존 파일이 깨지지 않게 한다. */
  private async write(path: string, project: ProjectFile): Promise<SaveResult> {
    const valid = projectFileSchema.safeParse(project)
    if (!valid.success) return { status: 'error', message: '저장할 프로젝트 내용이 올바르지 않습니다.' }
    // 프로젝트 이름은 파일 이름을 따른다. 파일을 옮기거나 이름을 바꿔도 안과 밖이 어긋나지 않는다.
    const fileName = basename(path)
    const name = fileName.endsWith(PROJECT_EXTENSION) ? fileName.slice(0, -PROJECT_EXTENSION.length) : fileName
    const data: ProjectFile = { ...valid.data, meta: { ...valid.data.meta, name: name || valid.data.meta.name } }
    try {
      await writeFileAtomic(this.deps.fs, path, serializeProject(data))
    } catch (e) {
      return { status: 'error', message: `저장하지 못했습니다: ${message(e)}` }
    }
    this.currentPath = path
    return { status: 'saved', fileName: basename(path) }
  }
}
