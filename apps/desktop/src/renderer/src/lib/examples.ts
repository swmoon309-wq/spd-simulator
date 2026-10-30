import { cloneEvmSettings, DEFAULT_EVM_SETTINGS, sanitizeOverrides, type Scenario } from '@spd/analysis'
import { catalog, type ModelEntry } from '../catalog'
import type { ProjectFile } from '../../../shared/projectFile'
import { defaultParams, paramSpecs } from './params'
import { buildProjectFile } from './projectApply'
import { defaultRunSettings } from './runSettings'

/** 내장 예제 한 건(PRJ-03). 파일이 아니라 코드에서 만들어 지므로 지우거나 고칠 수 없다(NFR-07). */
export interface Example {
  id: string
  title: string
  summary: string
  modelId: string
  /** 복사본으로 열 프로젝트 내용 */
  file: ProjectFile
  /** 연 뒤에 실험 탭의 "한 번에 실행"을 모두 실행해 결과를 겹쳐 보인다(SC-02) */
  runPresets: boolean
}

/**
 * 모델의 프리셋(추가 인원, 일정 촉박 등)을 시나리오로 가진 프로젝트를 만든다. 기본 설정과 같은 프리셋("추가 없음")은 기준과
 * 같으므로 시나리오로 만들지 않는다.
 */
export function exampleFor(entry: ModelEntry, now = new Date()): Example {
  const params = defaultParams(entry)
  const bounds = paramSpecs(entry).map((x) => ({ name: x.name, min: x.min, max: x.max, ...(x.integer ? { integer: true } : {}) }))
  const scenarios: Scenario[] = []
  for (const preset of entry.presets) {
    const { overrides } = sanitizeOverrides(params, preset.overrides, bounds)
    if (Object.keys(overrides).length === 0 || scenarios.some((s) => s.name === preset.label)) continue
    scenarios.push({ id: `s${scenarios.length + 1}`, name: preset.label, overrides })
  }
  const title = `${entry.title} 예제`
  const file = buildProjectFile({
    entry,
    name: title,
    description: entry.description,
    createdAt: now.toISOString(),
    params,
    runSettings: defaultRunSettings(entry),
    chartVariable: entry.defaultVariable,
    scenarios,
    adopted: null,
    actuals: [],
    evm: cloneEvmSettings(DEFAULT_EVM_SETTINGS),
    revisions: [],
    now
  })
  return {
    id: entry.id,
    title,
    summary: scenarios.length > 0 ? `시나리오 ${scenarios.length}개(${scenarios.map((s) => s.name).join(', ')})가 미리 들어 있습니다.` : '기본 설정으로 시작합니다.',
    modelId: entry.id,
    file,
    runPresets: entry.presets.length > 1
  }
}

/** 내장 모델마다 예제 하나(사용자 모델은 내장 예제가 없다). */
export function builtInExamples(now = new Date()): Example[] {
  return catalog.filter((entry) => entry.category !== 'user').map((entry) => exampleFor(entry, now))
}
