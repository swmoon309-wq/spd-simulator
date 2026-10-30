export interface AtomicFs {
  writeFile(path: string, data: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(path: string): Promise<void>
}

/**
 * 임시 파일에 쓴 뒤 이름을 바꿔, 쓰는 도중 실패해도 기존 파일이 깨지지 않게 한다.
 * 실패하면 임시 파일을 지우고 오류를 그대로 던진다.
 */
export async function writeFileAtomic(fs: AtomicFs, path: string, data: string): Promise<void> {
  const tmp = `${path}.${process.pid}.tmp`
  try {
    await fs.writeFile(tmp, data)
    await fs.rename(tmp, path)
  } catch (e) {
    await fs.rm(tmp).catch(() => undefined)
    throw e
  }
}
