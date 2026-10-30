import { getEntry } from '../../catalog'
import { docFromBuiltin } from '../../catalog/exportDoc'
import { MODEL_DOC_VERSION, newUserModelId, type ModelDocRaw } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../modelDoc'
import { validateModelDoc } from '../modelDoc'

/** 빈 모델 템플릿: 남은 일을 매일 일정량씩 줄이는 가장 작은 모델(수식·파라미터·완료 조건이 모두 있다). */
export function blankModelDoc(name = '새 모델', now: Date = new Date(), random: () => number = Math.random): ModelDoc {
  const id = newUserModelId(name, random)
  const raw: ModelDocRaw = {
    docVersion: MODEL_DOC_VERSION,
    def: {
      meta: { id, name, version: 1, timeUnit: 'day' },
      time: { start: 0, end: 200, dt: 0.5 },
      constants: { total_work: { value: 100, unit: '태스크', label: '전체 일의 양' }, daily_output: { value: 2, unit: '태스크/일', label: '하루 처리량' } },
      levels: { remaining_work: { init: 'total_work', inflows: [], outflows: ['work_rate'], unit: '태스크' } },
      rates: { work_rate: { expr: 'MIN(daily_output, remaining_work / DT)', unit: '태스크/일' } },
      auxiliaries: {},
      tables: {},
      outputs: []
    },
    info: { description: '', createdAt: now.toISOString() },
    view: { positions: {}, sectors: [], notes: [] },
    spec: {
      params: [
        { name: 'total_work', group: '프로젝트', min: 1, max: 10000, step: 10 },
        { name: 'daily_output', group: '프로젝트', min: 0.1, max: 100, step: 0.1 }
      ],
      variables: [
        { name: 'remaining_work', label: '남은 일', unit: '태스크' },
        { name: 'work_rate', label: '처리율', unit: '태스크/일' }
      ],
      defaultVariable: 'remaining_work',
      completion: { variable: 'remaining_work', op: '<=', value: 1e-6 },
      kpis: [],
      presets: [{ label: '기본', overrides: {} }]
    }
  }
  const v = validateModelDoc(raw)
  if (!v.ok) throw new Error(`빈 모델 템플릿이 올바르지 않습니다: ${v.message}`)
  return v.doc
}

export interface EditSource {
  doc: ModelDoc
  /** 지금 앱에 올라와 있는 같은 id 모델의 버전(0이면 아직 올라와 있지 않다) */
  installedVersion: number
}

/**
 * 편집할 문서를 만든다. 사용자 모델은 **그 자리에서** 고친다(같은 id, 적용하면 버전이 오른다). 내장 모델은 직접 고치지 않고 사본을 만든다
 * ("복제해서 편집", NFR-07·설계 08의 D6).
 */
export function sourceFor(modelId: string, now: Date = new Date()): EditSource {
  const entry = getEntry(modelId)
  if (entry.custom) return { doc: structuredClone(entry.custom.doc), installedVersion: entry.def.meta.version }
  const v = validateModelDoc(docFromBuiltin(entry, { now }))
  if (!v.ok) throw new Error(v.message)
  return { doc: v.doc, installedVersion: 0 }
}
