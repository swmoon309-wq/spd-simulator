import { describe, expect, it } from 'vitest'
import { computeKpis } from '@spd/analysis'
import { compileModel, runModel, type ModelDef } from '@spd/sd-engine'
import { catalog } from '.'
import { evmOf } from './evm'
import { docFromBuiltin } from './exportDoc'
import { buildEntry, completionTimeOf } from './userModel'
import { defaultParams } from '../lib/params'
import { validateModelDoc } from '../lib/modelDoc'
import { modelCaveat } from '../lib/report/caveats'
import { MODEL_DOC_VERSION, MODEL_LIMITS, parseModelFileText, serializeModelFile, type ModelDocRaw } from '../../../shared/modelDoc'

const NOW = new Date('2026-10-23T00:00:00.000Z')
const entryOf = (id: string) => catalog.find((m) => m.id === id)!

/** 작은 모델: x는 매일 k씩 쌓인다(x = k·t). y는 x의 2배, z는 계단 모양. */
function mini(over: Partial<ModelDocRaw['spec']> = {}, defOver: Partial<ModelDef> = {}): ModelDocRaw {
  const def: ModelDef = {
    meta: { id: 'user-mini-00000001', name: '작은 모델', version: 1, timeUnit: 'day' },
    time: { start: 0, end: 20, dt: 0.5 },
    constants: { k: { value: 2, unit: 'FP/일' }, target: { value: 10 } },
    levels: { x: { init: '0', inflows: ['r'], outflows: [], unit: 'FP' } },
    rates: { r: { expr: 'k', unit: 'FP/일' } },
    auxiliaries: { y: { expr: 'x * 2', unit: 'FP' }, bump: { expr: 'IF(TIME < 5, 1, 3)', unit: '명' } },
    tables: {},
    outputs: [],
    ...defOver
  }
  return {
    docVersion: MODEL_DOC_VERSION,
    def: def as unknown as Record<string, unknown>,
    info: { description: '시험용', createdAt: NOW.toISOString() },
    view: { positions: {}, sectors: [], notes: [] },
    spec: {
      params: [
        { name: 'k', group: '입력', min: 0.1, max: 10, step: 0.1 },
        { name: 'target', group: '입력', min: 1, max: 100, step: 1 }
      ],
      kpis: [],
      presets: [{ label: '빠르게', overrides: { k: 4 } }],
      ...over
    }
  }
}

const valid = (raw: ModelDocRaw) => {
  const v = validateModelDoc(raw)
  if (!v.ok) throw new Error(v.message)
  return v
}

describe('내장 모델의 사본 (docFromBuiltin)', () => {
  it.each(catalog.filter((m) => m.category !== 'user').map((m) => [m.id, m] as const))('%s: 검증을 통과하고 같은 입력에서 비트 단위로 같은 결과를 낸다', (_id, original) => {
    const raw = docFromBuiltin(original, { now: NOW, random: () => 0.1 })
    const v = valid(raw)
    expect(v.doc.def.meta.id.startsWith('user-')).toBe(true)
    expect(raw.info.basedOn).toBe(`${original.id}@${original.def.meta.version}`)
    const copy = buildEntry(v.doc, v.hash)
    expect(copy.category).toBe('user')
    expect(copy.groups.flatMap((g) => g.params.map((p) => p.name)).sort()).toEqual(original.groups.flatMap((g) => g.params.map((p) => p.name)).sort())
    const params = defaultParams(original)
    const a = runModel(compileModel(original.def), { overrides: params })
    const b = runModel(compileModel(copy.def), { overrides: defaultParams(copy) })
    expect(Object.keys(b.series).sort()).toEqual(Object.keys(a.series).sort())
    for (const name of Object.keys(a.series)) expect(Array.from(b.series[name] as Float64Array), name).toEqual(Array.from(a.series[name] as Float64Array))
  })

  it('원본은 바꾸지 않는다(깊은 복사)', () => {
    const brooks = entryOf('brooks')
    const before = JSON.stringify(brooks.def)
    docFromBuiltin(brooks, { now: NOW })
    expect(JSON.stringify(brooks.def)).toBe(before)
    expect(brooks.def.meta.id).toBe('brooks')
  })

  it('Brooks 사본: 완료일·총 공수·최대 인원·채택에 쓰는 완료 시각이 내장과 같다', () => {
    const brooks = entryOf('brooks')
    const v = valid(docFromBuiltin(brooks, { now: NOW }))
    const copy = buildEntry(v.doc, v.hash)
    const run = runModel(compileModel(brooks.def), { overrides: defaultParams(brooks) })
    const mine = computeKpis(copy.kpiSpecs, run, defaultParams(copy))
    const theirs = computeKpis(brooks.kpiSpecs, run, defaultParams(brooks))
    // 선언형 완료일은 "조건을 처음 만족한 기록 시각"(보간 없음, 설계 08의 3.2)이라 내장 모델의 완료 시계 Level(격자 사이 값)과 최대 dt만큼 다르다.
    const dt = brooks.def.time.dt
    expect(Math.abs((mine['completionDay'] as number) - (theirs['completionDay'] as number))).toBeLessThanOrEqual(dt)
    expect(Math.abs((mine['totalEffort'] as number) / (theirs['totalEffort'] as number) - 1)).toBeLessThan(0.01)
    expect(mine['peakStaff']).toBe(theirs['peakStaff'])
    expect(copy.kpis(run).peakStaff).toBe(brooks.kpis(run).peakStaff)
    expect(Math.abs((evmOf(copy).completion(run) as number) - (evmOf(brooks).completion(run) as number))).toBeLessThanOrEqual(dt)
    expect(evmOf(copy).credits).toEqual(evmOf(brooks).credits)
    expect(evmOf(copy).totalTasks(defaultParams(copy))).toBe(evmOf(brooks).totalTasks(defaultParams(brooks)))
    // 종료 시각 안에 끝나지 않으면 둘 다 null
    const cut = runModel(compileModel(brooks.def), { overrides: defaultParams(brooks), end: 100 })
    expect(evmOf(copy).completion(cut)).toBeNull()
  })

  it('지표를 옮기지 못하는 모델은 완료 조건·진척 없이 구조만 옮긴다(채택·통제 비활성)', () => {
    const integrated = entryOf('integrated-project')
    const copy = buildEntry(valid(docFromBuiltin(integrated, { now: NOW })).doc, 'h')
    expect(copy.evm).toBeUndefined()
    expect(copy.kpiSpecs).toEqual([])
    expect(copy.size).toEqual(integrated.size && { param: integrated.size.param, unit: integrated.size.unit, slocPerUnit: integrated.size.slocPerUnit })
  })
})

describe('지표 6종과 완료 조건', () => {
  const run = (raw: ModelDocRaw, overrides: Record<string, number> = {}) => {
    const v = valid(raw)
    const entry = buildEntry(v.doc, v.hash)
    const result = runModel(compileModel(entry.def), { overrides: { ...defaultParams(entry), ...overrides } })
    return { entry, result, kpi: (id: string) => computeKpis(entry.kpiSpecs, result, defaultParams(entry))[id] }
  }
  const kpi = (id: string, kind: ModelDocRaw['spec']['kpis'][number]['kind'], variable: string) => ({ id, label: id, unit: '', kind, variable, better: 'none' as const, group: 'cost' as const, decimals: 1 })

  it('완료일은 변수가 조건을 처음 만족한 기록 시각이다', () => {
    const { kpi: k, entry, result } = run(mini({ completion: { variable: 'x', op: '>=', value: 10 } }))
    expect(k('completionDay')).toBe(5) // x = 2t
    expect(entry.kpis(result).completionDay).toBe(5)
    expect(completionTimeOf(result, { variable: 'x', op: '>', value: 10 })).toBe(5.5)
    expect(completionTimeOf(result, { variable: 'x', op: '>=', value: 1e9 })).toBeNull()
  })

  it('완료 조건이 없으면 완료일 지표도 없다', () => {
    const { entry, result } = run(mini())
    expect(entry.kpiSpecs).toEqual([])
    expect(entry.kpis(result).completionDay).toBeNull()
  })

  it('final·max·min·timeOfMax·integral·atCompletion', () => {
    const raw = mini({
      completion: { variable: 'x', op: '>=', value: 10 },
      kpis: [kpi('fin', 'final', 'x'), kpi('mx', 'max', 'bump'), kpi('mn', 'min', 'bump'), kpi('tmax', 'timeOfMax', 'bump'), kpi('int', 'integral', 'r'), kpi('atc', 'atCompletion', 'y')]
    })
    const { kpi: k } = run(raw)
    expect(k('fin')).toBe(40) // 20일 × 2
    expect(k('mx')).toBe(3)
    expect(k('mn')).toBe(1)
    expect(k('tmax')).toBe(5) // 처음 최댓값이 되는 시각
    expect(k('int')).toBeCloseTo(40, 9) // r = 2를 20일 동안
    expect(k('atc')).toBe(20) // 완료 시각 5의 y = 2 × 10
  })

  it('완료하지 못하면 완료 시점 값도 null이다', () => {
    const { kpi: k } = run(mini({ completion: { variable: 'x', op: '>=', value: 10 }, kpis: [kpi('atc', 'atCompletion', 'y')] }), { k: 0.1 })
    expect(k('completionDay')).toBeNull()
    expect(k('atc')).toBeNull()
  })

  it('레이더는 좋고 나쁨이 있는 지표가 3개 이상 그룹에 있을 때만 만든다', () => {
    const g = (id: string, group: 'schedule' | 'cost' | 'quality' | 'risk') => ({ ...kpi(id, 'final', 'x'), group, better: 'lower' as const })
    const two = buildEntry(valid(mini({ completion: { variable: 'x', op: '>=', value: 10 }, kpis: [g('a', 'cost')] })).doc, 'h')
    expect(two.radarAxes).toEqual([])
    const four = buildEntry(valid(mini({ completion: { variable: 'x', op: '>=', value: 10 }, kpis: [g('a', 'cost'), g('b', 'quality'), g('c', 'risk')] })).doc, 'h')
    expect(four.radarAxes.map((a) => a.id)).toEqual(['schedule', 'cost', 'quality', 'risk'])
    expect(four.radarAxes.map((a) => a.kpiId)).toEqual(['completionDay', 'a', 'b', 'c'])
  })

  it('파라미터 묶음·그래프 변수·프리셋·진척 정의', () => {
    const raw = mini({
      completion: { variable: 'x', op: '>=', value: 10 },
      evm: { totalTasks: { param: 'target' }, credits: [{ variable: 'x', label: '쌓인 양', weight: 1 }], effortVariable: 'y' },
      defaultVariable: 'y'
    })
    const entry = buildEntry(valid(raw).doc, 'h')
    expect(entry.groups).toEqual([{ title: '입력', params: [{ name: 'k', min: 0.1, max: 10, step: 0.1 }, { name: 'target', min: 1, max: 100, step: 1 }] }])
    expect(entry.variables.map((v) => [v.name, v.unit])).toEqual([['x', 'FP'], ['r', 'FP/일'], ['y', 'FP'], ['bump', '명']])
    expect(entry.defaultVariable).toBe('y')
    expect(entry.presets).toEqual([{ label: '빠르게', overrides: { k: 4 } }])
    expect(evmOf(entry).totalTasks({ target: 80 })).toBe(80)
  })
})

describe('검증 (validateModelDoc)', () => {
  const msg = (raw: ModelDocRaw) => {
    const v = validateModelDoc(raw)
    return v.ok ? null : v.message
  }
  it('올바른 문서는 통과하고 내용 해시가 같은 입력에 안정적이다', () => {
    const a = valid(mini())
    const b = valid(JSON.parse(JSON.stringify(mini())))
    expect(a.hash).toBe(b.hash)
    expect(a.hash).toHaveLength(16)
  })

  it('user- 접두사가 없는 id는 거절한다', () => {
    const raw = mini()
    expect(msg({ ...raw, def: { ...raw.def, meta: { ...(raw.def['meta'] as object), id: 'brooks' } } })).toMatch(/user-/)
  })

  it('엔진 스키마를 어기면 위치와 함께 거절한다', () => {
    const raw = mini()
    expect(msg({ ...raw, def: { ...raw.def, time: { start: 0, end: 10, dt: -1 } } })).toMatch(/time\.dt/)
  })

  it('정의되지 않은 변수는 변수 이름과 위치를 알린다', () => {
    const m = msg(mini({}, { auxiliaries: { y: { expr: 'x * nope' } } }))
    expect(m).toMatch(/'y'/)
    expect(m).toMatch(/위치/)
  })

  it('순환 참조는 거절한다', () => {
    expect(msg(mini({}, { auxiliaries: { a: { expr: 'b' }, b: { expr: 'a' } } }))).toMatch(/컴파일/)
  })

  it('상수에 파라미터 정의가 없거나, 기본값이 범위 밖이거나, 상수가 아닌 파라미터는 거절한다', () => {
    const raw = mini()
    expect(msg({ ...raw, spec: { ...raw.spec, params: raw.spec.params.slice(0, 1) } })).toMatch(/'target'.*파라미터 정의/)
    expect(msg({ ...raw, spec: { ...raw.spec, params: [{ name: 'k', group: 'g', min: 5, max: 9, step: 1 }, ...raw.spec.params.slice(1)] } })).toMatch(/기본값 2/)
    expect(msg({ ...raw, spec: { ...raw.spec, params: [...raw.spec.params, { name: 'x', group: 'g', min: 0, max: 1, step: 1 }] } })).toMatch(/상수가 아닙니다/)
    expect(msg({ ...raw, spec: { ...raw.spec, params: [...raw.spec.params, { name: 'k', group: 'g', min: 0, max: 5, step: 1 }] } })).toMatch(/겹칩니다/)
  })

  it('spec이 없는 변수·예약된 지표 id·완료 조건 없는 완료 시점 지표·합이 1이 아닌 진척은 거절한다', () => {
    const k = (over: object) => ({ id: 'a', label: 'a', unit: '', kind: 'final' as const, variable: 'x', better: 'none' as const, group: 'cost' as const, decimals: 0, ...over })
    expect(msg(mini({ completion: { variable: 'nope', op: '>=', value: 1 } }))).toMatch(/완료 조건의 변수/)
    expect(msg(mini({ kpis: [k({ id: 'completionDay' })] }))).toMatch(/예약/)
    expect(msg(mini({ kpis: [k({ variable: 'k' })] }))).toMatch(/상수가 아닌 변수/)
    expect(msg(mini({ kpis: [k({ kind: 'atCompletion' })] }))).toMatch(/완료 조건이 필요/)
    const evm = { totalTasks: { param: 'target' }, credits: [{ variable: 'x', label: 'l', weight: 0.5 }], effortVariable: 'y' }
    expect(msg(mini({ completion: { variable: 'x', op: '>=', value: 1 }, evm }))).toMatch(/합이 0.5/)
    expect(msg(mini({ evm: { ...evm, credits: [{ variable: 'x', label: 'l', weight: 1 }] } }))).toMatch(/완료 조건이 필요/)
    expect(msg(mini({ presets: [{ label: 'p', overrides: { zzz: 1 } }] }))).toMatch(/'zzz'/)
  })

  it('한도: 변수 한도 초과, 수식 1001자, 테이블 점 101개', () => {
    const aux = Object.fromEntries(Array.from({ length: MODEL_LIMITS.variables - 1 }, (_, i) => [`a${i}`, { expr: '1' }]))
    expect(msg(mini({ params: mini().spec.params }, { auxiliaries: aux }))).toMatch(/변수가 \d+개입니다/)
    expect(msg(mini({}, { auxiliaries: { y: { expr: `1${' + 1'.repeat(400)}` } } }))).toMatch(/1001자|수식이/)
    const pts = Array.from({ length: 101 }, (_, i) => i)
    expect(msg(mini({}, { tables: { t: { x: pts, y: pts } } }))).toMatch(/점이 101개/)
  })

  it('수식 중첩이 64단계를 넘으면 거절한다(파일이 파서 스택을 넘기지 못한다)', () => {
    const deep = (n: number) => `${'('.repeat(n)}x${')'.repeat(n)}`
    expect(msg(mini({}, { auxiliaries: { y: { expr: deep(63) } } }))).toBeNull()
    expect(msg(mini({}, { auxiliaries: { y: { expr: deep(65) } } }))).toMatch(/너무 깊게 중첩/)
  })

  it('사용자 모델의 보고서 문구는 보정·검증되지 않았을 수 있다고 알리고 원본을 적는다', () => {
    const entry = buildEntry(valid(docFromBuiltin(entryOf('brooks'), { now: NOW, name: '내 Brooks' })).doc, 'h')
    const text = modelCaveat(entry)
    expect(text).toContain("'내 Brooks'(버전 1)")
    expect(text).toContain('원본: brooks@1')
    expect(text).toMatch(/보정·검증되지 않았을 수 있으며/)
  })

  it('파일 왕복 뒤에도 같은 모델이다', () => {
    const raw = mini({ completion: { variable: 'x', op: '>=', value: 10 } })
    const r = parseModelFileText(serializeModelFile(raw))
    expect(r.ok && valid(r.doc).hash).toBe(valid(raw).hash)
  })
})
