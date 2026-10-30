import { brooksEntry } from './brooks'
import { integratedEntry } from './integrated'
import { integratedAiEntry } from './integratedAi'
import { structureEntries } from './structures'
import type { ModelEntry } from './types'

export * from './types'

export const catalog: ModelEntry[] = [brooksEntry, integratedEntry, integratedAiEntry, ...structureEntries]

/** 모델 선택 목록의 묶음(프로젝트 모델, 기본 구조 라이브러리). 비어 있는 묶음은 뺀다. */
export function catalogGroups(): { label: string; entries: ModelEntry[] }[] {
  return [
    { label: '프로젝트 모델', entries: catalog.filter((m) => m.category === 'project') },
    { label: '기본 구조 라이브러리(책 3장)', entries: catalog.filter((m) => m.category === 'structure') },
    { label: '내 모델', entries: catalog.filter((m) => m.category === 'user') }
  ].filter((g) => g.entries.length > 0)
}

/** 사용자 모델 항목을 등록한다. 같은 id가 있으면 바꾼다. 내장 모델 id는 거절한다. */
export function registerEntry(entry: ModelEntry): void {
  if (entry.category !== 'user') throw new Error('사용자 모델만 등록할 수 있습니다')
  const i = catalog.findIndex((m) => m.id === entry.id)
  if (i >= 0) {
    if (catalog[i]?.category !== 'user') throw new Error(`내장 모델 '${entry.id}'은(는) 바꿀 수 없습니다`)
    catalog[i] = entry
  } else catalog.push(entry)
}

export function unregisterEntry(id: string): void {
  const i = catalog.findIndex((m) => m.id === id && m.category === 'user')
  if (i >= 0) catalog.splice(i, 1)
}

export function getEntry(id: string): ModelEntry {
  const e = catalog.find((m) => m.id === id)
  if (!e) throw new Error(`알 수 없는 모델: ${id}`)
  return e
}
