import { calibrationSteps } from '@spd/analysis'
import { getEntry } from '../../catalog'
import { getCompiledModel } from '../../engine/models'
import { riskBaseParams } from '../../lib/risk'
import { calibrationKey, type CalibrationRequest, type CalibrationRun } from '../../lib/validationRuns'
import { fitPresetParams, importPresets, makePreset, MAX_PRESETS, presetOverrides } from '../../lib/presets'
import { parsePresetFile } from '../../../../shared/presetFile'
import { checkRunSettings } from '../../lib/runSettings'
import { rt } from '../runtime'
import type { AppState, SliceCreator } from '../state'

export interface CalibrationSlice {
  /** 파라미터 보정의 결과. 파일에 저장하지 않는다(프리셋만 저장한다). */
  validationCalibration: CalibrationRun | null

  /**
   * 데이터에 맞춰 파라미터를 보정한다(설계 07의 5장). UI를 막지 않게 조금씩 나눠 실행하고 취소할 수 있다(그때까지의 최선이 남는다).
   * 요청이 올바르지 않으면 이유를 돌려주고 실행하지 않는다.
   */
  runCalibration(request: CalibrationRequest): Promise<string | null>
  cancelCalibration(): void
  clearCalibration(): void
  /** 지금의 보정 결과를 프리셋으로 저장한다. 결과가 없거나 오래되었으면 이유를 돌려준다. */
  savePreset(name: string): string | null
  deletePreset(id: string): void
  renamePreset(id: string, name: string): string | null
  /** 프리셋을 새 시나리오로 적용한다(기본 설정은 그대로, 권장). 새 시나리오의 id 또는 이유. */
  applyPresetAsScenario(id: string): { scenarioId: string | null; message: string | null }
  /** 프리셋을 기본 설정에 적용한다(입력값이 바뀐다). 문제가 있으면 이유. */
  applyPresetToBase(id: string): string | null
  /** 내보낸 프리셋 파일의 내용을 가져온다. 더한 개수와 경고(또는 읽지 못한 이유)를 돌려준다. */
  importPresetText(text: string): { added: number; warnings: string[]; error: string | null }
}

export const createCalibrationSlice: SliceCreator<CalibrationSlice> = (set, get) => ({
  validationCalibration: null,

  async runCalibration(request) {
    const s = get()
    if (s.validationCalibration?.status === 'running') return '보정이 실행 중입니다.'
    if (Object.keys(s.paramErrors).length > 0) return '실험 탭의 입력 오류를 먼저 고치세요.'
    const combo = checkRunSettings(s.runSettings)
    if (combo) return combo
    const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
    if (base === null) return '비교 대상 시나리오를 찾을 수 없습니다.'
    const dataset = s.validation.datasets.find((d) => d.id === request.datasetId)
    if (!dataset) return '보정에 쓸 데이터셋을 고르세요.'
    const columns = request.columns.flatMap(({ index, weight }) => {
      const c = dataset.columns[index]
      return c && c.variable !== null ? [{ variable: c.variable, scale: c.scale, points: c.points, weight, label: c.name }] : []
    })
    if (columns.length === 0) return '비교할 열을 하나 이상 고르세요(모델 변수에 연결한 열만 쓸 수 있습니다).'
    if (columns.some((c) => !(c.weight > 0) || !Number.isFinite(c.weight))) return '열의 가중치는 0보다 큰 수여야 합니다.'
    const entry = getEntry(s.modelId)
    const key = calibrationKey(entry, base, s.runSettings, dataset, request)
    const seq = ++rt.calibSeq
    rt.calibCancel = false
    const mine = (st: AppState) => rt.calibSeq === seq && st.validationCalibration?.key === key
    set({ validationCalibration: { key, request, status: 'running', progress: null, result: null, error: null } })
    try {
      const gen = calibrationSteps(
        {
          model: getCompiledModel(s.modelId),
          base,
          options: { end: s.runSettings.end, dt: s.runSettings.dt, seed: s.runSettings.seed },
          params: request.params,
          columns,
          align: { timeUnit: dataset.timeUnit, offsetDay: dataset.offsetDay },
          split: request.split,
          seed: s.runSettings.seed
        },
        () => rt.calibCancel || rt.calibSeq !== seq
      )
      let sliceStart = performance.now()
      for (;;) {
        const step = gen.next()
        if (step.done) {
          if (rt.calibSeq !== seq) return null
          set({ validationCalibration: { key, request, status: step.value.canceled ? 'canceled' : 'done', progress: null, result: step.value, error: null } })
          return null
        }
        // 12ms마다 UI에 양보한다(진행 막대와 취소 버튼이 반응하도록)
        if (performance.now() - sliceStart >= 12) {
          const progress = step.value
          set((st) => (mine(st) ? { validationCalibration: { ...(st.validationCalibration as CalibrationRun), progress } } : {}))
          await new Promise<void>((r) => setTimeout(r, 0))
          sliceStart = performance.now()
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (rt.calibSeq === seq) set({ validationCalibration: { key, request, status: 'error', progress: null, result: null, error: message } })
      return message
    }
  },
  cancelCalibration: () => void (rt.calibCancel = true),
  clearCalibration: () => set({ validationCalibration: null }),

  savePreset(name) {
    const s = get()
    const run = s.validationCalibration
    if (!run?.result || run.status === 'running' || run.status === 'error') return '저장할 보정 결과가 없습니다. 먼저 보정을 실행하세요.'
    if (selectCalibrationStale(s)) return '입력이 바뀌어 보정 결과가 오래되었습니다. 다시 보정한 뒤 저장하세요.'
    if (s.validation.presets.length >= MAX_PRESETS) return `프리셋은 최대 ${MAX_PRESETS}개입니다. 하나를 지운 뒤 저장하세요.`
    if (name.length > 100) return '이름은 100자까지입니다.'
    const dataset = s.validation.datasets.find((d) => d.id === run.request.datasetId)
    const columns = run.request.columns.flatMap(({ index }) => (dataset?.columns[index]?.variable ? [dataset.columns[index]?.variable as string] : []))
    const preset = makePreset({ entry: getEntry(s.modelId), presets: s.validation.presets, name, result: run.result, dataset: dataset?.name ?? '', columns, now: new Date() })
    set({ validation: { ...s.validation, presets: [...s.validation.presets, preset] } })
    return null
  },
  deletePreset: (id) => set((s) => ({ validation: { ...s.validation, presets: s.validation.presets.filter((p) => p.id !== id) } })),
  renamePreset(id, name) {
    const s = get()
    if (name.trim() === '' || name.length > 100) return '이름은 1~100자여야 합니다.'
    if (s.validation.presets.some((p) => p.id !== id && p.name === name.trim())) return '같은 이름의 프리셋이 있습니다.'
    set({ validation: { ...s.validation, presets: s.validation.presets.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) } })
    return null
  },

  applyPresetAsScenario(id) {
    const s = get()
    const preset = s.validation.presets.find((p) => p.id === id)
    if (!preset) return { scenarioId: null, message: '프리셋을 찾을 수 없습니다.' }
    const entry = getEntry(s.modelId)
    if (preset.modelId !== entry.id) return { scenarioId: null, message: `다른 모델('${preset.modelId}')의 프리셋입니다.` }
    const fit = fitPresetParams(entry, preset.name, preset.params)
    const overrides = presetOverrides(s.params, { params: fit.params })
    const scenarioId = get().addScenario()
    if (scenarioId === null) return { scenarioId: null, message: '시나리오를 더 만들 수 없습니다(최대 12개). 하나를 지운 뒤 적용하세요.' }
    get().renameScenario(scenarioId, preset.name) // 이름이 겹치거나 올바르지 않으면 기본 이름을 그대로 둔다
    for (const [name, value] of Object.entries(overrides)) get().setScenarioOverride(scenarioId, name, value)
    get().setScenarioNote(scenarioId, `보정 프리셋 '${preset.name}'(${preset.origin.dataset})`)
    return { scenarioId, message: fit.warnings.length > 0 ? fit.warnings.join(' ') : null }
  },

  applyPresetToBase(id) {
    const s = get()
    const preset = s.validation.presets.find((p) => p.id === id)
    if (!preset) return '프리셋을 찾을 수 없습니다.'
    const entry = getEntry(s.modelId)
    if (preset.modelId !== entry.id) return `다른 모델('${preset.modelId}')의 프리셋입니다.`
    const fit = fitPresetParams(entry, preset.name, preset.params)
    if (Object.keys(fit.params).length === 0) return '이 프리셋에서 쓸 수 있는 파라미터가 없습니다.'
    for (const [name, value] of Object.entries(fit.params)) get().setParam(name, value)
    return fit.warnings.length > 0 ? fit.warnings.join(' ') : null
  },

  importPresetText(text) {
    const parsed = parsePresetFile(text)
    if (!parsed.ok) return { added: 0, warnings: [], error: parsed.message }
    const s = get()
    const out = importPresets(getEntry(s.modelId), parsed.file, s.validation.presets)
    if (out.added > 0) set({ validation: { ...s.validation, presets: out.presets } })
    return { added: out.added, warnings: out.warnings, error: null }
  }
})

/** 보정 결과가 지금 입력으로 만든 것인지(아니면 오래됨). 결과가 없거나 실행 중이면 false. */
export function selectCalibrationStale(s: AppState): boolean {
  const run = s.validationCalibration
  if (!run || run.status === 'running') return false
  const base = riskBaseParams(s.params, s.scenarios, s.validation.targetScenarioId)
  const dataset = s.validation.datasets.find((d) => d.id === run.request.datasetId)
  return base === null || dataset === undefined || calibrationKey(getEntry(s.modelId), base, s.runSettings, dataset, run.request) !== run.key
}
