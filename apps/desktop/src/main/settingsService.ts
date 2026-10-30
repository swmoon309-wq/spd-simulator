import { writeFileAtomic } from './atomicWrite'
import { DEFAULT_SETTINGS, mergeSettings, sanitizeSettings, type Settings } from '../shared/settings'

export interface SettingsDeps {
  /** 설정을 저장하는 파일(앱 데이터 폴더 아래) */
  file: string
  fs: {
    readFile(path: string): Promise<string>
    writeFile(path: string, data: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    rm(path: string): Promise<void>
  }
}

/**
 * 사용자 설정 파일(COM-03). 처음 읽을 때 한 번 불러 기억한다. 파일이 없거나 깨졌거나 값이 올바르지 않으면 기본값을 쓰고,
 * 저장하지 못해도 이번 실행 동안은 바뀐 설정을 쓴다(설정은 앱을 막을 만한 일이 아니다).
 */
export class SettingsService {
  private current: Settings | null = null

  constructor(private readonly deps: SettingsDeps) {}

  async get(): Promise<Settings> {
    if (this.current) return this.current
    try {
      this.current = sanitizeSettings(JSON.parse(await this.deps.fs.readFile(this.deps.file)))
    } catch {
      this.current = { ...DEFAULT_SETTINGS }
    }
    return this.current
  }

  async update(patch: unknown): Promise<Settings> {
    this.current = mergeSettings(await this.get(), patch)
    try {
      await writeFileAtomic(this.deps.fs, this.deps.file, JSON.stringify(this.current, null, 2) + '\n')
    } catch {
      // 저장하지 못해도 이번 실행에서는 바뀐 설정을 쓴다.
    }
    return this.current
  }
}
