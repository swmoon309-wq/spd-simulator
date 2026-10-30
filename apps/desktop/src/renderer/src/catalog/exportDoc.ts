import type { ModelSpec } from '../../../shared/modelDoc'
import { MODEL_DOC_VERSION, newUserModelId, type ModelDocRaw } from '../../../shared/modelDoc'
import type { ModelEntry } from './types'

/**
 * 내장 모델에서 선언형 앱 연결 정보 중 **지표·완료 조건·진척**은 코드로 짜여 있어 일반적으로는 옮길 수 없다(예: 계획 대비 지연은
 * 파라미터를 읽는 식). 그래서 완료 조건을 변수 조건 하나로 옮길 수 있고 지표가 6종 안에 드는 모델만 여기에 적는다. 나머지 모델은
 * 구조·파라미터·변수·프리셋·규모만 옮기고 지표·완료 조건·진척은 비운다(편집기에서 사용자가 정의한다).
 */
const BUILTIN_HINTS: Record<string, Pick<ModelSpec, 'completion' | 'kpis' | 'staffVariable' | 'evm'>> = {
  brooks: {
    completion: { variable: 'requirements', op: '<=', value: 1e-6 },
    kpis: [
      { id: 'totalEffort', label: '총 투입 공수', unit: '맨데이', kind: 'atCompletion', variable: 'cum_effort', better: 'lower', group: 'cost', decimals: 0 },
      { id: 'peakStaff', label: '최대 인원', unit: '명', kind: 'max', variable: 'total_personnel', better: 'none', group: 'risk', decimals: 0 }
    ],
    staffVariable: 'total_personnel',
    evm: { totalTasks: { param: 'initial_requirements' }, credits: [{ variable: 'developed_software', label: '개발 완료 규모', weight: 1 }], effortVariable: 'cum_effort' }
  }
}

/**
 * 내장 모델의 사본을 사용자 모델 문서로 만든다("복제해서 편집", NFR-07·설계 08의 2장). 계산 정의(`def`)는 그대로 두고 id·이름·버전만
 * 새로 정한다. 같은 입력의 결과는 원본과 비트 단위로 같다.
 */
export function docFromBuiltin(entry: ModelEntry, options: { name?: string; now?: Date; random?: () => number } = {}): ModelDocRaw {
  const name = options.name ?? `${entry.title} 사본`
  const id = newUserModelId(name, options.random)
  const hints = BUILTIN_HINTS[entry.id]
  const def = structuredClone(entry.def)
  def.meta = { ...def.meta, id, name, version: 1 }
  const spec: ModelSpec = {
    params: entry.groups.flatMap((g) => g.params.map((p) => ({ name: p.name, group: g.title, min: p.min, max: p.max, step: p.step, ...(p.integer ? { integer: true } : {}) }))),
    variables: entry.variables.map((v) => ({ name: v.name, label: v.label, unit: v.unit })),
    defaultVariable: entry.defaultVariable,
    kpis: hints?.kpis ?? [],
    ...(hints?.completion ? { completion: hints.completion } : {}),
    ...(hints?.staffVariable ? { staffVariable: hints.staffVariable } : {}),
    ...(hints?.evm ? { evm: hints.evm } : {}),
    ...(entry.size ? { size: { param: entry.size.param, unit: entry.size.unit, slocPerUnit: entry.size.slocPerUnit } } : {}),
    presets: entry.presets.map((p) => ({ label: p.label, overrides: { ...p.overrides } }))
  }
  return {
    docVersion: MODEL_DOC_VERSION,
    def: def as unknown as Record<string, unknown>,
    info: { description: entry.description, createdAt: (options.now ?? new Date()).toISOString(), basedOn: `${entry.id}@${entry.def.meta.version}` },
    view: { positions: {}, sectors: [], notes: [] },
    spec
  }
}
