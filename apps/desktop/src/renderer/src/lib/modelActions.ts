import { getEntry } from '../catalog'
import { docFromBuiltin } from '../catalog/exportDoc'
import type { ModelEntry } from '../catalog'
import { MODEL_DOC_VERSION, newUserModelId, parseModelFileText, serializeModelFile, type ModelDocRaw } from '../../../shared/modelDoc'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'
import { askConfirm } from './confirm'
import { installUserModel, isInstalled, withNewId } from './modelRegistry'

const store = () => useAppStore.getState()
const note = (kind: 'info' | 'warning' | 'error', text: string, details?: string[]) => store().setNotice({ kind, text, ...(details ? { details } : {}) })

const unavailable = () => note('error', '모델 파일 기능은 데스크톱 앱에서만 사용할 수 있습니다.')

const metaOf = (doc: ModelDocRaw) => doc.def['meta'] as { id: string; name: string; version: number }

/** 모델을 올린 뒤 메뉴·목록 화면이 다시 그려지게 알린다. */
const touched = () => useUiStore.getState().modelsChanged()

/**
 * 시작할 때 내 모델 목록을 읽어 앱에 올린다(설계 08의 4.2). 올리지 못한 모델은 건너뛰고 이유를 알린다. 브라우저(개발용)에서는 아무것도 하지 않는다.
 */
export async function loadModelLibrary(): Promise<void> {
  const spd = window.spd
  if (!spd) return
  const r = await spd.models.list()
  if (r.status === 'error') {
    note('warning', `내 모델 목록을 읽지 못했습니다. ${r.message}`)
    return
  }
  const problems: string[] = []
  const ids: string[] = []
  for (const m of r.models) {
    const out = installUserModel(m.doc)
    if (out.ok) ids.push(out.entry.id)
    else problems.push(`${metaOf(m.doc).name}: ${out.message}`)
  }
  useUiStore.getState().setLibraryIds(ids)
  if (r.skipped > 0) problems.push(`읽을 수 없는 모델 파일 ${r.skipped}개를 건너뛰었습니다.`)
  if (problems.length > 0) note('warning', '내 모델 일부를 불러오지 못했습니다.', problems)
  touched()
}

/** 모델 문서를 앱에 올리고 내 모델 목록(앱 데이터 폴더)에 저장한다. 앱에 올렸으면 그 항목과, 목록에 저장하지 못했으면 그 이유를 돌려준다. */
async function installAndSave(raw: ModelDocRaw): Promise<{ entry: ModelEntry; saveProblem: string | null } | null> {
  const out = installUserModel(raw)
  if (!out.ok) {
    note('error', `모델을 사용할 수 없습니다. ${out.message}`)
    return null
  }
  const saved = await window.spd?.models.save(raw)
  const saveProblem = saved && saved.status === 'error' ? `내 모델 목록에 저장하지 못했습니다(이 실행에서만 쓸 수 있습니다). ${saved.message}` : null
  if (!saveProblem) useUiStore.getState().addLibraryId(out.entry.id)
  touched()
  return { entry: out.entry, saveProblem }
}

/** 결과 안내: 목록에 저장하지 못했으면 경고로 합쳐 보인다. */
const report = (text: string, saveProblem: string | null) => (saveProblem ? note('warning', `${text} 다만 ${saveProblem}`) : note('info', text))

/** 모델 파일(`.spd-model.json`)을 가져온다. 같은 id의 모델이 이미 있으면 새 id를 발급한다(설계 08의 4.2). */
export async function importModelFile(): Promise<void> {
  const spd = window.spd
  if (!spd) return unavailable()
  const r = await spd.files.importJson()
  if (r.status === 'canceled') return
  if (r.status === 'error') return note('error', r.message)
  const parsed = parseModelFileText(r.content)
  if (!parsed.ok) return note('error', `'${r.fileName}'을(를) 가져올 수 없습니다. ${parsed.message}`)
  let doc = parsed.doc
  const id = metaOf(doc).id
  const renamed = typeof id === 'string' && isInstalled(id)
  if (renamed) doc = withNewId(doc)
  const made = await installAndSave(doc)
  if (made) report(`모델 '${made.entry.title}'을(를) 가져왔습니다. 모델 선택의 "내 모델"에서 고를 수 있습니다.${renamed ? ' 같은 id의 모델이 있어 새 id를 발급했습니다.' : ''}`, made.saveProblem)
}

/** 현재 모델을 모델 파일로 내보낸다. 내장 모델은 사본 문서로 만들어 내보낸다(내보낸 파일은 사용자 모델이다). */
export async function exportModelFile(): Promise<void> {
  const spd = window.spd
  if (!spd) return unavailable()
  const entry = getEntry(store().modelId)
  const doc = entry.custom ? entry.custom.doc : docFromBuiltin(entry, { name: entry.title })
  const r = await spd.files.exportJson({ suggestedName: `${entry.title}.spd-model.json`, content: serializeModelFile(doc as ModelDocRaw) })
  if (r.status === 'saved') note('info', `모델 파일을 저장했습니다: ${r.fileName}`)
  else if (r.status === 'error') note('error', r.message)
}

/** 사용자 모델의 사본 문서: 새 id, 이름에 "사본", 버전 1. 계산 정의는 그대로다. */
function copyOfUser(entry: ModelEntry, random: () => number = Math.random): ModelDocRaw {
  const doc = structuredClone(entry.custom!.doc) as unknown as ModelDocRaw
  const name = `${entry.title} 사본`.slice(0, 100)
  const meta = doc.def['meta'] as { id: string; name: string; version: number }
  doc.def['meta'] = { ...meta, id: newUserModelId(name, random), name, version: 1 }
  doc.info = { ...doc.info, createdAt: new Date().toISOString(), basedOn: `${entry.id}@${entry.def.meta.version}` }
  return { ...doc, docVersion: MODEL_DOC_VERSION }
}

/** 현재 모델을 복제해 내 모델로 저장한다("복제해서 편집", NFR-07). 지금 쓰는 프로젝트는 바뀌지 않는다. */
export async function cloneModel(): Promise<void> {
  const spd = window.spd
  if (!spd) return unavailable()
  const entry = getEntry(store().modelId)
  const doc = entry.custom ? copyOfUser(entry) : docFromBuiltin(entry)
  const made = await installAndSave(doc)
  if (made) report(`'${made.entry.title}'을(를) 내 모델로 만들었습니다. 모델 선택의 "내 모델"에서 새 프로젝트를 시작할 수 있습니다.`, made.saveProblem)
}

/**
 * 현재 모델을 내 모델 목록에서 지운다. 목록의 파일만 지우고 지금 프로젝트는 계속 이 모델을 쓴다(저장하면 프로젝트 파일에 담긴다).
 * 앱을 다시 시작하면 목록에서 사라진다. 내장 모델은 지울 수 없다.
 */
export async function deleteModelFromLibrary(): Promise<void> {
  const spd = window.spd
  if (!spd) return unavailable()
  const entry = getEntry(store().modelId)
  if (entry.category !== 'user') return note('error', '내장 모델은 지울 수 없습니다. 내 모델만 지울 수 있습니다.')
  if (!useUiStore.getState().libraryIds.includes(entry.id)) return note('info', '이 모델은 내 모델 목록에 없습니다(프로젝트에 담긴 모델입니다).')
  if (!(await askConfirm({ message: `내 모델 '${entry.title}'을(를) 목록에서 지울까요?`, detail: '이 프로젝트는 계속 이 모델을 쓰고, 저장하면 프로젝트 파일에 담깁니다.', ok: '지우기', cancel: '취소' }))) return
  await spd.models.remove(entry.id)
  useUiStore.getState().removeLibraryId(entry.id)
  note('info', `'${entry.title}'을(를) 내 모델 목록에서 지웠습니다.`)
  touched()
}
