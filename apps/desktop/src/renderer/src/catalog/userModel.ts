import { lastOf, maxOf, valueAt, type KpiSpec, type RadarAxis } from '@spd/analysis'
import type { RunResult } from '@spd/sd-engine'
import type { KpiKind, ModelSpec } from '../../../shared/modelDoc'
import type { ModelDoc } from '../lib/modelDoc'
import type { EvmAdapter, Kpis, ModelEntry, ParamGroup } from './types'

type Op = NonNullable<ModelSpec['completion']>['op']

const satisfies = (v: number, op: Op, x: number): boolean => (op === '<=' ? v <= x : op === '>=' ? v >= x : op === '<' ? v < x : v > x)

/** 변수가 조건을 처음 만족한 시각(기록 격자의 첫 기록 시각, 보간 없음). 끝까지 만족하지 못하면 null. */
export function completionTimeOf(result: RunResult, c: NonNullable<ModelSpec['completion']>): number | null {
  const s = result.series[c.variable]
  if (!s) return null
  for (let i = 0; i < s.length; i++) if (satisfies(s[i] as number, c.op, c.value)) return result.time[i] as number
  return null
}

function integralOf(result: RunResult, name: string): number {
  const s = result.series[name] as Float64Array
  let sum = 0
  for (let i = 1; i < s.length; i++) sum += (((s[i] as number) + (s[i - 1] as number)) / 2) * ((result.time[i] as number) - (result.time[i - 1] as number))
  return sum
}

function timeOfMax(result: RunResult, name: string): number {
  const s = result.series[name] as Float64Array
  let best = 0
  for (let i = 1; i < s.length; i++) if ((s[i] as number) > (s[best] as number)) best = i
  return result.time[best] as number
}

const GROUP_LABEL = { schedule: '일정', cost: '비용', quality: '품질', risk: '위험' } as const

function computeKind(kind: KpiKind, variable: string, completion: ModelSpec['completion']): KpiSpec['compute'] {
  switch (kind) {
    case 'final':
      return (r) => lastOf(r, variable)
    case 'max':
      return (r) => maxOf(r, variable)
    case 'min':
      return (r) => {
        let m = Infinity
        for (const v of r.series[variable] as Float64Array) if (v < m) m = v
        return m
      }
    case 'atCompletion':
      return (r) => {
        const t = completion ? completionTimeOf(r, completion) : null
        return t === null ? null : valueAt(r, variable, t)
      }
    case 'timeOfMax':
      return (r) => timeOfMax(r, variable)
    case 'integral':
      return (r) => integralOf(r, variable)
  }
}

/**
 * 사용자 모델 문서에서 카탈로그 항목을 합성한다(설계 08의 3.2). 지표는 6종의 선언형이다. 문서는 `validateModelDoc`을 통과한 것이어야 한다.
 * 재예측·시정 조치 시험은 지원하지 않는다(상태 덮어쓰기 어댑터가 없다). `evm`이 없으면 채택·통제는 비활성이다.
 */
export function buildEntry(doc: ModelDoc, hash: string): ModelEntry {
  const { def, spec, info } = doc
  const completion = spec.completion
  const nonConstants = [
    ...Object.entries(def.levels).map(([name, v]) => ({ name, unit: v.unit })),
    ...Object.entries(def.rates).map(([name, v]) => ({ name, unit: v.unit })),
    ...Object.entries(def.auxiliaries).map(([name, v]) => ({ name, unit: v.unit }))
  ]
  const variables = spec.variables ?? nonConstants.map((v) => ({ name: v.name, label: v.name, unit: v.unit ?? '' }))

  const groups: ParamGroup[] = []
  for (const p of spec.params) {
    let g = groups.find((x) => x.title === p.group)
    if (!g) groups.push((g = { title: p.group, params: [] }))
    g.params.push({ name: p.name, min: p.min, max: p.max, step: p.step, ...(p.integer ? { integer: true } : {}) })
  }

  const kpiSpecs: KpiSpec[] = []
  if (completion) kpiSpecs.push({ id: 'completionDay', label: '완료일', unit: '일', better: 'lower', group: 'schedule', decimals: 1, compute: (r) => completionTimeOf(r, completion) })
  for (const k of spec.kpis) kpiSpecs.push({ id: k.id, label: k.label, unit: k.unit, better: k.better, group: k.group, decimals: k.decimals, compute: computeKind(k.kind, k.variable, completion) })

  // 레이더: 좋고 나쁨이 있는 지표를 가진 그룹마다 축 하나(첫 지표). 3개 미만이면 그리지 않는다.
  const axes: RadarAxis[] = []
  for (const group of ['schedule', 'cost', 'quality', 'risk'] as const) {
    const k = kpiSpecs.find((s) => s.group === group && s.better !== 'none')
    if (k) axes.push({ id: group, label: GROUP_LABEL[group], kpiId: k.id })
  }

  const evmSpec = spec.evm
  const evm: EvmAdapter | undefined =
    evmSpec && completion
      ? {
          totalTasks: (p) => p[evmSpec.totalTasks.param] as number,
          credits: evmSpec.credits.map((c) => ({ variable: c.variable, label: c.label, weight: c.weight })),
          effortVariable: evmSpec.effortVariable,
          completion: (r) => completionTimeOf(r, completion)
        }
      : undefined

  const staff = spec.staffVariable
  return {
    id: def.meta.id,
    title: def.meta.name,
    category: 'user',
    description: info.description,
    ...(spec.size ? { size: { param: spec.size.param, unit: spec.size.unit, slocPerUnit: spec.size.slocPerUnit } } : {}),
    def,
    groups,
    variables,
    defaultVariable: spec.defaultVariable ?? (variables[0]?.name as string),
    presets: spec.presets.map((p) => ({ label: p.label, overrides: { ...p.overrides } })),
    kpiSpecs,
    radarAxes: axes.length >= 3 ? axes : [],
    ...(evm ? { evm } : {}),
    custom: { doc, hash },
    kpis(result): Kpis {
      return { completionDay: completion ? completionTimeOf(result, completion) : null, peakStaff: staff && result.series[staff] ? maxOf(result, staff) : 0 }
    }
  }
}
