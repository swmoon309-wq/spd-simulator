import { compileModel, type CompiledModel, type ModelDef } from '@spd/sd-engine'
import { brooksModel, defectChainModel, integratedProjectAiModel, integratedProjectModel, learningCurveModel, personnelChainModel, productionReworkModel, rayleighModel } from '@spd/models'

/** 화면과 Worker가 함께 쓰는 모델 정의 목록. 사용자 모델은 `registerUserModel`로 더해진다(설계 08의 5.1). */
export const modelDefs: Record<string, ModelDef> = {
  brooks: brooksModel,
  'integrated-project': integratedProjectModel,
  'integrated-project-ai': integratedProjectAiModel,
  'production-rework': productionReworkModel,
  'learning-curve': learningCurveModel,
  rayleigh: rayleighModel,
  'personnel-chain': personnelChainModel,
  'defect-chain': defectChainModel
}

const BUILTIN_IDS = new Set(Object.keys(modelDefs))
const compiled = new Map<string, CompiledModel>()
/** 사용자 모델의 내용 해시. 같은 id에 해시가 다른 정의가 오면 다시 컴파일한다. */
const userHashes = new Map<string, string>()

/**
 * 컴파일 결과를 캐시한다. 상수 덮어쓰기만 다른 실행은 같은 컴파일 결과를 재사용한다.
 * 호출 때마다 정의가 컴파일되는 일이 없도록, 사용자 모델은 해시가 같으면 다시 컴파일하지 않는다.
 */
export function getCompiledModel(modelId: string): CompiledModel {
  let m = compiled.get(modelId)
  if (!m) {
    const def = modelDefs[modelId]
    if (!def) throw new Error(`알 수 없는 모델: ${modelId}`)
    m = compileModel(def)
    compiled.set(modelId, m)
  }
  return m
}

/**
 * 사용자 모델의 정의를 등록한다. 내장 모델 id는 덮어쓸 수 없다. 같은 해시면 아무것도 하지 않고(`false`), 새 정의나 다른 해시면
 * 등록하고 컴파일 캐시를 지운다(`true`). 컴파일되지 않는 정의는 던지고, 기존 등록은 그대로 둔다.
 */
export function registerUserModel(id: string, hash: string, def: ModelDef): boolean {
  if (BUILTIN_IDS.has(id)) throw new Error(`내장 모델 '${id}'은(는) 덮어쓸 수 없습니다`)
  if (userHashes.get(id) === hash && modelDefs[id]) return false
  compileModel(def) // 잘못된 정의는 등록하지 않는다
  modelDefs[id] = def
  userHashes.set(id, hash)
  compiled.delete(id)
  return true
}

export function unregisterUserModel(id: string): void {
  if (BUILTIN_IDS.has(id)) return
  delete modelDefs[id]
  userHashes.delete(id)
  compiled.delete(id)
}

/** 등록된 사용자 모델(Worker를 다시 시작할 때 다시 등록하는 데 쓴다). */
export function registeredUserModels(): { id: string; hash: string; def: ModelDef }[] {
  return [...userHashes].map(([id, hash]) => ({ id, hash, def: modelDefs[id] as ModelDef }))
}
