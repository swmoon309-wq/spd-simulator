import { checkModelUnits, findReferences, lintModel, type ModelDef } from '@spd/sd-engine'
import { catalog } from '../../catalog'
import { MODEL_LIMITS } from '../../../../shared/modelDoc'
import type { ModelDoc } from '../modelDoc'
import { kindOf, suggestRange, variableNames, type EditResult } from './commands'
import { addSector } from './diagramEdit'

/**
 * 구조 템플릿(EDT-05, 설계 08의 10.1): 책 3.3의 **일반 흐름 과정 9종**, 3.4의 기반 구조 일부(S자 성장·지연·평활), 그리고 라이브러리 모델(MDL-03의 기본
 * 구조 5종과 프로젝트 모델)을 **접두사를 붙여** 현재 모델에 삽입한다. 삽입은 순수 함수이고, 입력 **포트**는 기존 변수에 연결할 수 있으며, 삽입 직후
 * 구조 오류와 단위 검사 결과를 알린다. 시간 설정은 현재 모델의 것을 유지한다.
 */

export type TemplateGroup = 'generic' | 'infra' | 'structure' | 'project'

export const TEMPLATE_GROUP_LABEL: Record<TemplateGroup, string> = {
  generic: '일반 흐름 과정(책 3.3)',
  infra: '기반 구조(책 3.4)',
  structure: '기본 구조 라이브러리(책 3장, MDL-03)',
  project: '프로젝트 모델 전체'
}

export interface TemplatePort {
  /** 템플릿 안의 변수 이름(상수 또는 Auxiliary 입력, 또는 연결해 둘 출력) */
  name: string
  role: 'input' | 'output'
  hint: string
}

export interface TemplateParam {
  min: number
  max: number
  step: number
  integer?: boolean
  group?: string
}

export interface Template {
  id: string
  group: TemplateGroup
  title: string
  /** 근거(책의 절·그림) */
  source: string
  description: string
  /** 접두사의 제안값 */
  prefix: string
  elements: Pick<ModelDef, 'constants' | 'levels' | 'rates' | 'auxiliaries' | 'tables'> & { invariants?: NonNullable<ModelDef['invariants']>; outputs?: string[] }
  ports: TemplatePort[]
  /** 상수의 파라미터 범위(없으면 값에서 제안) */
  params?: Record<string, TemplateParam>
}

/** 일반 템플릿이 쓰는 이름 없는 기본 단위. 입력 포트를 단위 있는 변수에 연결하면 이 말을 그 단위로 바꿔 쓴다. */
export const GENERIC_UNIT = '단위'
const U = GENERIC_UNIT
const lvl = (init: string, inflows: string[], outflows: string[], unit = U) => ({ init, inflows, outflows, unit })
const rate = (expr: string, unit = `${U}/일`) => ({ expr, unit })
const inv = (name: string, label: string, lhs: string[], rhs: string[]) => ({ name, label, lhs: lhs.map((variable) => ({ variable, coef: 1 })), rhs: rhs.map((variable) => ({ variable, coef: 1 })), tolerance: 1e-6 })

const tpl = (t: Omit<Template, 'elements'> & { elements: Partial<Template['elements']> }): Template => ({ ...t, elements: { constants: {}, levels: {}, rates: {}, auxiliaries: {}, tables: {}, ...t.elements } })

/** 책 3.3의 일반 흐름 과정 9종(식은 책 그림의 식 그대로)과 3.4의 기반 구조 일부. */
export const GENERIC_TEMPLATES: Template[] = [
  tpl({
    id: 'rate-level', group: 'generic', title: '비율과 Level(Rate and Level System)', source: '책 3.3.1, 그림 3.2', prefix: 'rl_',
    description: 'Level 하나와 흐름 하나. 모든 기본 구조의 바탕이 되는 stock-and-flow입니다. level(t) = level(t−dt) + rate·dt. 흐름의 크기만 정하면 Level이 그 양만큼 쌓입니다.',
    elements: { constants: { initial_amount: { value: 0, unit: U }, flow_rate: { value: 2, unit: `${U}/일` } }, levels: { stock: lvl('initial_amount', ['net_flow'], []) }, rates: { net_flow: rate('flow_rate') } },
    ports: [{ name: 'flow_rate', role: 'input', hint: '흐름의 크기. 다른 변수에 연결할 수 있습니다' }, { name: 'stock', role: 'output', hint: '쌓인 양' }]
  }),
  tpl({
    id: 'flow-chain', group: 'generic', title: '흐름 체인(Flow Chain, 다단계)', source: '책 3.3.2, 그림 3.3', prefix: 'fc_',
    description: 'Level과 흐름이 번갈아 이어진 보존적 체인. 한 Level의 유출이 다음 Level의 유입입니다. 흐름 = 앞 Level ÷ 지연으로 두었고, 모든 Level의 합이 들어온 총량과 같다는 불변식을 선언했습니다.',
    elements: {
      constants: { entry_rate: { value: 2, unit: `${U}/일` }, delay_1: { value: 5, unit: '일' }, delay_2: { value: 8, unit: '일' } },
      levels: { stage_1: lvl('0', ['entry'], ['move_1']), stage_2: lvl('0', ['move_1'], ['move_2']), stage_3: lvl('0', ['move_2'], []), entered: lvl('0', ['entry'], []) },
      rates: { entry: rate('entry_rate'), move_1: rate('stage_1 / delay_1'), move_2: rate('stage_2 / delay_2') },
      invariants: [inv('conserved', '단계의 합 = 들어온 총량', ['stage_1', 'stage_2', 'stage_3'], ['entered'])]
    },
    ports: [{ name: 'entry_rate', role: 'input', hint: '체인으로 들어오는 흐름' }, { name: 'stage_3', role: 'output', hint: '마지막 단계에 쌓인 양' }]
  }),
  tpl({
    id: 'compounding', group: 'generic', title: '복리 과정(Compounding Process)', source: '책 3.3.3, 그림 3.4', prefix: 'cp_',
    description: 'Level에서 자기 유입으로 되먹임하는 양의 피드백. inflow = level · growth fraction. 지수 성장을 만듭니다(사용자 수, 비용 증가, 소프트웨어 엔트로피 …).',
    elements: { constants: { initial_amount: { value: 10, unit: U }, growth_fraction: { value: 0.02, unit: '1/일' } }, levels: { stock: lvl('initial_amount', ['growth'], []) }, rates: { growth: rate('stock * growth_fraction') } },
    ports: [{ name: 'growth_fraction', role: 'input', hint: '기간당 성장 비율(다른 변수의 함수로 바꿀 수 있습니다)' }, { name: 'stock', role: 'output', hint: '성장하는 양' }]
  }),
  tpl({
    id: 'draining', group: 'generic', title: '배출 과정(Draining Process)', source: '책 3.3.4, 그림 3.5', prefix: 'dr_',
    description: 'Level에서 자기 유출로 되먹임하는 음의 피드백. outflow = level · draining fraction(= level ÷ 지연). 지연과 지수 감쇠의 바탕입니다(인원 이탈, 승진, 기술 상실 …).',
    elements: { constants: { initial_amount: { value: 100, unit: U }, draining_fraction: { value: 0.05, unit: '1/일' } }, levels: { stock: lvl('initial_amount', [], ['drain']) }, rates: { drain: rate('stock * draining_fraction') } },
    ports: [{ name: 'draining_fraction', role: 'input', hint: '기간당 빠져나가는 비율(1 ÷ 시간 상수)' }, { name: 'stock', role: 'output', hint: '남은 양' }]
  }),
  tpl({
    id: 'production', group: 'generic', title: '생산 과정(Production Process)', source: '책 3.3.5, 그림 3.6', prefix: 'pr_',
    description: '일이 만들어지는 속도 = 투입한 자원 × 생산성. production rate = resources · productivity. 자원은 다른 흐름 체인의 Level이나 변수에 연결할 수 있습니다.',
    elements: { constants: { resources: { value: 10, unit: '명' }, productivity: { value: 0.5, unit: '태스크/맨데이' } }, levels: { tasks_completed: lvl('0', ['production_rate'], [], '태스크') }, rates: { production_rate: rate('resources * productivity', '태스크/일') } },
    ports: [{ name: 'resources', role: 'input', hint: '투입 자원(인원). 인력 Level에 연결하세요' }, { name: 'productivity', role: 'input', hint: '자원 하나가 하루에 하는 일' }, { name: 'tasks_completed', role: 'output', hint: '끝난 일' }]
  }),
  tpl({
    id: 'adjustment', group: 'generic', title: '조정 과정(Adjustment Process)', source: '책 3.3.6, 그림 3.7', prefix: 'aj_',
    description: '목표에 다가가는 균형 피드백. inflow = (goal − level) · adjustment fraction(또는 ÷ 조정 지연). 간격이 클 때 빠르고 좁아질수록 느려집니다(채용, 인식 형성 …).',
    elements: { constants: { goal: { value: 100, unit: U }, adjustment_fraction: { value: 0.1, unit: '1/일' }, initial_amount: { value: 0, unit: U } }, levels: { stock: lvl('initial_amount', ['adjustment'], []) }, rates: { adjustment: rate('(goal - stock) * adjustment_fraction') } },
    ports: [{ name: 'goal', role: 'input', hint: '목표값. 다른 변수에 연결할 수 있습니다' }, { name: 'stock', role: 'output', hint: '조정되는 값' }]
  }),
  tpl({
    id: 'coflow', group: 'generic', title: '코플로(Coflow Process)', source: '책 3.3.7, 그림 3.8', prefix: 'cf_',
    description: '다른 흐름(host)과 함께 일어나는 종속 흐름. flow 2 = flow 1 · conversion coefficient. 산출물과 결함, 노력 소모 추적 등에 쓰입니다.',
    elements: {
      constants: { host_rate: { value: 2, unit: `${U}/일` }, conversion: { value: 0.5, unit: '부산물/단위' } },
      levels: { host_total: lvl('0', ['host_flow'], []), coflow_total: lvl('0', ['coflow_flow'], [], '부산물') },
      rates: { host_flow: rate('host_rate'), coflow_flow: rate('host_flow * conversion', '부산물/일') }
    },
    ports: [{ name: 'host_rate', role: 'input', hint: '함께 흐르는 대상(host) 흐름' }, { name: 'conversion', role: 'input', hint: '변환 계수' }]
  }),
  tpl({
    id: 'split-flow', group: 'generic', title: '분할 흐름(Split Flow Process)', source: '책 3.3.8, 그림 3.9', prefix: 'sf_',
    description: '한 Level에서 나가는 흐름을 여러 갈래로 나눕니다. outflow 1 = f(split fraction), outflow 2 = f(1 − split fraction). 전체 흐름은 보존되며 세 Level의 합이 처음 양과 같다는 불변식을 선언했습니다(결함 검출 필터, 인력 배분 …).',
    elements: {
      constants: { initial_amount: { value: 100, unit: U }, delay_time: { value: 5, unit: '일' }, split_fraction: { value: 0.7, unit: '비율' } },
      levels: { input_level: lvl('initial_amount', [], ['out_1', 'out_2']), output_1: lvl('0', ['out_1'], []), output_2: lvl('0', ['out_2'], []) },
      rates: { out_1: rate('input_level / delay_time * split_fraction'), out_2: rate('input_level / delay_time * (1 - split_fraction)') },
      invariants: [inv('conserved', '입력 + 출력 1 + 출력 2 = 처음 양', ['input_level', 'output_1', 'output_2'], ['initial_amount'])]
    },
    ports: [{ name: 'split_fraction', role: 'input', hint: '첫째 갈래로 가는 비율' }, { name: 'output_1', role: 'output', hint: '첫째 갈래의 양' }, { name: 'output_2', role: 'output', hint: '둘째 갈래의 양' }]
  }),
  tpl({
    id: 'cyclic-loop', group: 'generic', title: '순환 고리(Cyclic Loop)', source: '책 3.3.9, 그림 3.10', prefix: 'cl_',
    description: '흐름의 일부가 처음 Level로 되돌아가는 고리(반복 개발, 재작업, 진화). 검토를 거쳐 일부는 통과하고 일부는 되돌아갑니다. 세 Level의 합이 처음 양과 같다는 불변식을 선언했습니다.',
    elements: {
      constants: { initial_amount: { value: 100, unit: U }, forward_delay: { value: 6, unit: '일' }, review_delay: { value: 3, unit: '일' }, rework_fraction: { value: 0.25, unit: '비율' } },
      levels: { work: lvl('initial_amount', ['rework'], ['forward']), checked: lvl('0', ['forward'], ['accept', 'rework']), accepted: lvl('0', ['accept'], []) },
      rates: { forward: rate('work / forward_delay'), accept: rate('checked / review_delay * (1 - rework_fraction)'), rework: rate('checked / review_delay * rework_fraction') },
      invariants: [inv('conserved', '해야 할 일 + 검토 중 + 통과 = 처음 양', ['work', 'checked', 'accepted'], ['initial_amount'])]
    },
    ports: [{ name: 'rework_fraction', role: 'input', hint: '검토 후 되돌아가는 비율' }, { name: 'accepted', role: 'output', hint: '통과한 양' }]
  }),
  tpl({
    id: 's-growth', group: 'infra', title: 'S자 성장(S-shaped Growth)', source: '책 3.4.2', prefix: 'sg_',
    description: '복리 성장에 용량 한계를 더한 구조. inflow = level · growth fraction · (1 − level ÷ capacity). 처음엔 지수 성장하다가 용량에 가까워지며 완만해집니다.',
    elements: { constants: { initial_amount: { value: 10, unit: U }, growth_fraction: { value: 0.1, unit: '1/일' }, capacity: { value: 1000, unit: U } }, levels: { stock: lvl('initial_amount', ['growth'], []) }, rates: { growth: rate('stock * growth_fraction * (1 - stock / capacity)') } },
    ports: [{ name: 'capacity', role: 'input', hint: '용량 한계' }, { name: 'stock', role: 'output', hint: '성장하는 양' }]
  }),
  ...(['DELAY1', 'DELAY3', 'SMOOTH'] as const).map((fn) =>
    tpl({
      id: fn === 'DELAY1' ? 'delay-1' : fn === 'DELAY3' ? 'delay-3' : 'smooth', group: 'infra',
      title: fn === 'DELAY1' ? '1차 지연(First-order Delay)' : fn === 'DELAY3' ? '3차 지연(Third-order Delay)' : '평활(Smoothing)',
      source: fn === 'SMOOTH' ? '책 3.4.3' : '책 3.4.3.3', prefix: fn === 'DELAY1' ? 'd1_' : fn === 'DELAY3' ? 'd3_' : 'sm_',
      description: `${fn}으로 입력 신호를 지연·평활해 보는 구조. 입력은 STEP(높이, 시작시각)이고 결과는 입력을 따라가되 ${fn === 'DELAY3' ? '3차(S자에 가까운)' : '지수'} 곡선으로 늦게 반응합니다. 입력 신호를 기존 변수로 바꿔 쓸 수 있습니다.`,
      elements: {
        constants: { step_height: { value: 10, unit: U }, step_time: { value: 10, unit: '일' }, delay_time: { value: 5, unit: '일' } },
        auxiliaries: { signal: { expr: 'STEP(step_height, step_time)', unit: U }, delayed: { expr: `${fn}(signal, delay_time)`, unit: U } },
        outputs: ['delayed']
      },
      ports: [{ name: 'signal', role: 'input', hint: '지연·평활할 입력 신호(기존 변수에 연결)' }, { name: 'delayed', role: 'output', hint: '지연된 값' }]
    })
  )
]

/** 라이브러리 모델 전체를 템플릿으로 본다("라이브러리 전체 가져오기"). 상수의 범위는 그 모델의 입력 화면 범위를 따른다. */
export function libraryTemplates(): Template[] {
  return catalog
    .filter((e) => e.category !== 'user')
    .map((e): Template => {
      const params: Record<string, TemplateParam> = {}
      for (const g of e.groups) for (const p of g.params) params[p.name] = { min: p.min, max: p.max, step: p.step, ...(p.integer ? { integer: true } : {}), group: g.title }
      return {
        id: `library:${e.id}`,
        group: e.category === 'structure' ? 'structure' : 'project',
        title: e.title,
        source: e.category === 'structure' ? '책 3장 기본 구조(라이브러리 모델)' : '라이브러리 모델',
        description: e.description,
        prefix: e.id.split('-').map((s) => s[0]).join('') + '_',
        elements: { constants: e.def.constants, levels: e.def.levels, rates: e.def.rates, auxiliaries: e.def.auxiliaries, tables: e.def.tables, ...(e.def.invariants ? { invariants: e.def.invariants } : {}), outputs: e.def.outputs },
        ports: [],
        params
      }
    })
}

export const allTemplates = (): Template[] => [...GENERIC_TEMPLATES, ...libraryTemplates()]

// ---------- 삽입 ----------

export interface InsertOptions {
  /** 모든 변수·테이블·불변식 이름 앞에 붙인다(비워도 된다, 이름이 겹치면 거절) */
  prefix: string
  /** 입력 포트를 기존 변수에 연결한다: 포트 이름 → 기존 변수. 연결한 포트의 변수는 삽입하지 않고 참조를 기존 변수로 바꾼다 */
  connections?: Record<string, string>
  /** 삽입한 변수를 템플릿 이름의 섹터로 묶는다(기본 true) */
  asSector?: boolean
}

export type InsertResult = { ok: true; doc: ModelDoc; note: string; inserted: string[] } | { ok: false; message: string }

const fail = (message: string): InsertResult => ({ ok: false, message })

/** 한 수식의 변수·테이블 이름을 한 번에 바꾼다(차례로 바꾸면 이미 바꾼 이름을 다시 바꾸는 일이 생긴다). */
function renameAll(source: string, vars: Map<string, string>, tables: Map<string, string>): string {
  let out = source
  const refs = findReferences(source).refs.filter((r) => (r.kind === 'variable' && vars.has(r.name)) || (r.kind === 'table' && tables.has(r.name)))
  for (const r of [...refs].reverse()) out = out.slice(0, r.start) + ((r.kind === 'table' ? tables.get(r.name) : vars.get(r.name)) as string) + out.slice(r.end)
  return out
}

/**
 * 템플릿을 현재 모델에 삽입한다(설계 08의 10.1): ① 접두사 확인 ② 이름 충돌 검사 ③ 요소·불변식·테이블 병합(시간 설정은 현재 것을 유지) ④ **포트 연결**
 * ⑤ 삽입 직후 구조 오류와 단위 검사 결과를 알린다. 새 상수는 파라미터가 되고(범위는 템플릿의 것, 없으면 값에서 제안) 템플릿 이름의 섹터로 묶는다.
 */
export function insertTemplate(doc: ModelDoc, t: Template, options: InsertOptions): InsertResult {
  const prefix = options.prefix
  if (prefix !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) return fail('접두사는 영문자·숫자·_만 쓸 수 있고 숫자로 시작할 수 없습니다.')
  const e = t.elements
  const connections = options.connections ?? {}
  const existing = new Set(variableNames(doc.def))
  const removed = new Set<string>()
  const external = new Map<string, string>() // 포트의 지역 이름 → 연결한 기존 변수
  for (const [port, target] of Object.entries(connections)) {
    const p = t.ports.find((x) => x.name === port)
    if (!p || p.role !== 'input') return fail(`'${port}'은(는) 연결할 수 있는 입력 포트가 아닙니다.`)
    if (!(port in e.constants) && !(port in e.auxiliaries)) return fail(`포트 '${port}'은(는) 상수나 Auxiliary여야 연결할 수 있습니다.`)
    if (!kindOf(doc.def, target)) return fail(`연결할 변수 '${target}'이(가) 모델에 없습니다.`)
    removed.add(port)
    external.set(port, target)
  }
  const locals = [...Object.keys(e.constants), ...Object.keys(e.levels), ...Object.keys(e.rates), ...Object.keys(e.auxiliaries)]
  const vars = new Map<string, string>()
  for (const n of locals) vars.set(n, external.get(n) ?? prefix + n)
  const tableMap = new Map(Object.keys(e.tables).map((n) => [n, prefix + n]))
  const finalNames = locals.filter((n) => !removed.has(n)).map((n) => prefix + n)

  // 이름 충돌
  const clashes: string[] = []
  for (const n of finalNames) if (existing.has(n) || n in doc.def.tables) clashes.push(n)
  for (const n of tableMap.values()) if (n in doc.def.tables || existing.has(n) || finalNames.includes(n)) clashes.push(n)
  const invNames = (e.invariants ?? []).map((i) => prefix + i.name)
  for (const n of invNames) if ((doc.def.invariants ?? []).some((i) => i.name === n)) clashes.push(`불변식 ${n}`)
  const badName = finalNames.find((n) => n.length > 64)
  if (badName) return fail(`이름 '${badName}'이(가) 64자를 넘습니다. 접두사를 줄이세요.`)
  if (clashes.length > 0) return fail(`이름이 겹칩니다: ${[...new Set(clashes)].slice(0, 6).join(', ')}${clashes.length > 6 ? ' …' : ''}. 다른 접두사를 쓰세요.`)
  if (existing.size + finalNames.length > MODEL_LIMITS.variables) return fail(`변수가 ${MODEL_LIMITS.variables}개를 넘습니다(현재 ${existing.size}개 + ${finalNames.length}개).`)
  if (Object.keys(doc.def.tables).length + tableMap.size > MODEL_LIMITS.tables) return fail(`테이블이 ${MODEL_LIMITS.tables}개를 넘습니다.`)

  // 포트를 연결한 변수에 단위가 있으면(`명`처럼 이름 하나) 템플릿의 일반 단위를 그 단위로 맞춘다. 복합 단위(`태스크/일`)는 분모 안에서 뜻이 달라질 수 있어 건드리지 않는다.
  let adoptedUnit: string | null = null
  for (const [port, target] of external) {
    const portUnit = (e.constants[port]?.unit ?? e.auxiliaries[port]?.unit)?.trim()
    const targetUnit = (doc.def.constants[target]?.unit ?? doc.def.levels[target]?.unit ?? doc.def.rates[target]?.unit ?? doc.def.auxiliaries[target]?.unit)?.trim()
    if (portUnit === GENERIC_UNIT && targetUnit && !/[/·*^()\s]/.test(targetUnit) && adoptedUnit === null) adoptedUnit = targetUnit
  }
  const fixUnit = (u: string | undefined): string | undefined => (u === undefined || adoptedUnit === null ? u : u.split(GENERIC_UNIT).join(adoptedUnit))
  const withUnit = <T extends { unit?: string | undefined }>(v: T): T => (v.unit === undefined || adoptedUnit === null ? v : { ...v, unit: fixUnit(v.unit) as string })
  const rx = (s: string) => renameAll(s, vars, tableMap)
  const map = (n: string) => vars.get(n) ?? n
  const d = doc.def
  const def: ModelDef = {
    ...d,
    constants: { ...d.constants, ...Object.fromEntries(Object.entries(e.constants).filter(([n]) => !removed.has(n)).map(([n, c]) => [prefix + n, withUnit({ ...c })])) },
    levels: { ...d.levels, ...Object.fromEntries(Object.entries(e.levels).map(([n, l]) => [prefix + n, withUnit({ ...l, init: rx(l.init), inflows: l.inflows.map(map), outflows: l.outflows.map(map) })])) },
    rates: { ...d.rates, ...Object.fromEntries(Object.entries(e.rates).map(([n, r]) => [prefix + n, withUnit({ ...r, expr: rx(r.expr) })])) },
    auxiliaries: { ...d.auxiliaries, ...Object.fromEntries(Object.entries(e.auxiliaries).filter(([n]) => !removed.has(n)).map(([n, a]) => [prefix + n, withUnit({ ...a, expr: rx(a.expr) })])) },
    tables: { ...d.tables, ...Object.fromEntries(Object.entries(e.tables).map(([n, tb]) => [prefix + n, { ...tb, x: [...tb.x], y: [...tb.y] }])) },
    outputs: [...d.outputs, ...(e.outputs ?? []).filter((n) => !removed.has(n)).map(map)],
    ...(e.invariants || d.invariants
      ? { invariants: [...(d.invariants ?? []), ...(e.invariants ?? []).map((i) => ({ ...i, name: prefix + i.name, lhs: i.lhs.map((x) => ({ ...x, variable: map(x.variable) })), rhs: i.rhs.map((x) => ({ ...x, variable: map(x.variable) })) }))] }
      : {})
  }

  // 새 상수는 파라미터가 된다
  const group = (t.title.length > MODEL_LIMITS.name ? t.title.slice(0, MODEL_LIMITS.name) : t.title)
  const newParams = Object.keys(e.constants)
    .filter((n) => !removed.has(n))
    .map((n) => {
      const p = t.params?.[n]
      const c = e.constants[n] as { value: number }
      const r = p ?? suggestRange(c.value)
      return { name: prefix + n, group: p?.group ?? group, min: r.min, max: r.max, step: r.step, ...(p?.integer ? { integer: true } : {}) }
    })
  const newVars = [...Object.keys(e.levels), ...Object.keys(e.rates), ...Object.keys(e.auxiliaries)].filter((n) => !removed.has(n)).map((n) => ({ name: prefix + n, label: prefix + n, unit: fixUnit(e.levels[n]?.unit ?? e.rates[n]?.unit ?? e.auxiliaries[n]?.unit ?? '') as string }))
  let out: ModelDoc = {
    ...doc,
    def,
    spec: { ...doc.spec, params: [...doc.spec.params, ...newParams], ...(doc.spec.variables ? { variables: [...doc.spec.variables, ...newVars] } : {}) }
  }
  const inserted = finalNames
  if (options.asSector !== false && inserted.length > 0) {
    let name = t.title
    for (let i = 2; out.view.sectors.some((s) => s.name === name); i++) name = `${t.title} ${i}`
    const r = addSector(out, name.slice(0, MODEL_LIMITS.name), inserted)
    if (r.ok) out = r.doc
  }

  const issues = lintModel(out.def)
  const units = checkModelUnits(out.def)
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length
  const unitErrors = units.filter((i) => i.severity === 'error').length
  const note = `'${t.title}'을(를) 삽입했습니다(변수 ${inserted.length}개${tableMap.size > 0 ? `, 테이블 ${tableMap.size}개` : ''}${external.size > 0 ? `, 포트 ${external.size}개 연결` : ''}${adoptedUnit ? `, 단위 '${GENERIC_UNIT}'를 '${adoptedUnit}'(으)로 맞춤` : ''}). 삽입 뒤 구조 오류 ${errors}건·경고 ${warnings}건·단위 오류 ${unitErrors}건입니다.`
  return { ok: true, doc: out, note, inserted }
}
