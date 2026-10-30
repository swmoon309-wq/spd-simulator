import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_EVM_SETTINGS, evAt, pvAt, type ActualRow } from '@spd/analysis'
import { getEntry } from '../catalog'
import { evmOf } from '../catalog/evm'
import { adoptionStatus, createAdoptionFromPlan, PLAN_CSV_SCENARIO_ID } from './adoption'
import { buildControlView } from './control'
import { defaultParams } from './params'
import { parsePlanCurveCsv, PlanCurveCsvError } from './planCurveCsv'
import { defaultRunSettings } from './runSettings'
import { adoptedSchema } from '../../../shared/projectFile'

vi.mock('../engine/engineClient', () => ({ startRun: () => ({ promise: new Promise(() => undefined), cancel() {} }) }))

const entry = getEntry('brooks')
const fails = (text: string, msg: RegExp | string) => expect(() => parsePlanCurveCsv(text)).toThrow(msg)

describe('계획 곡선 CSV 읽기 (CTL-11)', () => {
  it('일·누적 공수만 있으면 진척률은 누적 공수 ÷ 총 예산이다', () => {
    const c = parsePlanCurveCsv('day,effort\n0,0\n10,100\n20,300\n')
    expect(c.bac).toBe(300)
    expect(c.plannedCompletion).toBe(20)
    expect(c.hasProgress).toBe(false)
    expect(c.series.time).toHaveLength(21)
    expect(c.series.effort[5]).toBeCloseTo(50, 6) // 0~10일은 선형
    expect(c.series.effort[15]).toBeCloseTo(200, 6)
    expect(c.series.progress[20]).toBe(1)
    expect(c.series.progress[10]).toBeCloseTo(100 / 300, 6)
  })

  it('진척률 열은 비율이고, 열 이름 끝에 %가 있으면 백분율이다', () => {
    const a = parsePlanCurveCsv('day,effort,progress\n0,0,0\n10,100,0.2\n20,300,1\n')
    expect(a.hasProgress).toBe(true)
    expect(a.series.progress[10]).toBeCloseTo(0.2, 6)
    const b = parsePlanCurveCsv('일,누적 공수,진척률(%)\n0,0,0\n10,100,20\n20,300,100\n')
    expect(b.series.progress[10]).toBeCloseTo(0.2, 6)
    expect(b.series.effort[20]).toBe(300)
  })

  it('첫 일이 0보다 크면 0일을 앞에 붙이고 알린다', () => {
    const c = parsePlanCurveCsv('day,effort\n7,70\n14,140\n')
    expect(c.series.time[0]).toBe(0)
    expect(c.series.effort[0]).toBe(0)
    expect(c.series.effort[7]).toBeCloseTo(70, 6)
    expect(c.warnings.join(' ')).toContain('0일')
  })

  it('누적 공수가 총 예산에 먼저 닿으면 그 시각이 계획 완료일이다', () => {
    const c = parsePlanCurveCsv('day,effort\n0,0\n10,100\n20,100\n')
    expect(c.plannedCompletion).toBe(10)
    expect(c.warnings.join(' ')).toContain('평평')
  })

  it('세미콜론·소수 쉼표, 모르는 열, 빈 줄을 다룬다', () => {
    const c = parsePlanCurveCsv('day;effort;memo\n0;0;시작\n\n10;12,5;끝\n')
    expect(c.bac).toBe(12.5)
    expect(c.ignored).toEqual(['memo'])
  })

  it('잘못된 입력은 행을 알려 거부한다', () => {
    fails('day\n0\n', /값 열/)
    fails('day,cost\n0,0\n1,1\n', /누적 공수 열/)
    fails('day,effort\n', /한 줄 이상/)
    fails('day,effort\n0,0\n', /두 점 이상/)
    fails('day,effort\n0,0\n0,5\n', /3번째|2번째 행: 일/)
    fails('day,effort\n0,0\n5,10\n3,20\n', /3번째 행: 일/)
    fails('day,effort\n0,0\n5,10\n6,8\n', /3번째 행: 누적 공수가 줄었습니다/)
    fails('day,effort\n0,0\n5,abc\n', /2번째 행.*숫자가 아닙니다/)
    fails('day,effort\n0,0\n5,\n', /비어 있습니다/)
    fails('day,effort\n0,0\n5,0\n', /총 예산/)
    fails('day,effort,progress\n0,0,0\n5,10,50\n', /100%를 넘습니다/)
    fails('day,effort\n-1,0\n5,10\n', /0 이상/)
    fails('day,effort,pv\n0,0,0\n5,1,1\n', /둘 이상/)
    fails('day,effort\n0,0\n9000,10\n', /너무 깁니다/)
  })

  it('오류는 PlanCurveCsvError이다', () => {
    expect(() => parsePlanCurveCsv('x\n')).toThrow(PlanCurveCsvError)
  })
})

describe('계획 곡선으로 만든 채택 계획 (CTL-11)', () => {
  const curve = parsePlanCurveCsv('day,effort\n0,0\n50,1000\n100,3000\n')
  const params = defaultParams(entry)
  const settings = defaultRunSettings(entry)
  const made = createAdoptionFromPlan({ entry, params, settings, curve, fileName: '계획서.csv', now: new Date('2026-10-29T00:00:00.000Z') })
  if (!made.ok) throw new Error(made.message)
  const adopted = made.adopted

  it('곡선이 PV이고, 진척 규칙과 총 태스크는 모델의 것이다', () => {
    expect(adopted.scenarioId).toBe(PLAN_CSV_SCENARIO_ID)
    expect(adopted.scenarioName).toBe('계획 곡선: 계획서.csv')
    expect(adopted.bac).toBe(3000)
    expect(adopted.plannedCompletion).toBe(100)
    expect(adopted.totalTasks).toBe(evmOf(entry).totalTasks(params))
    expect(adopted.credits.map((c) => c.variable)).toEqual(evmOf(entry).credits.map((c) => c.variable))
    expect(pvAt(adopted, 25)).toBeCloseTo(500, 6)
    expect(pvAt(adopted, 100)).toBe(3000)
  })

  it('프로젝트 파일 스키마를 통과한다', () => {
    const r = adoptedSchema.safeParse(adopted)
    expect(r.success ? [] : r.error.issues).toEqual([])
  })

  it('보고일의 PV·EV·SPI가 곡선에서 나온다', () => {
    const total = adopted.totalTasks
    const rows: ActualRow[] = [{ day: 50, cum: { [evmOf(entry).credits[0]!.variable]: total * 0.2 }, effort: 900 }]
    const v = buildControlView(adopted, rows, { credits: evmOf(entry).credits, totalTasks: total }, DEFAULT_EVM_SETTINGS)
    const p = v.points[0]!
    expect(p.pv).toBeCloseTo(1000, 6) // 50일의 계획 공수
    expect(p.ev).toBeCloseTo(evAt(adopted, p.progress), 6)
    expect(p.ac).toBe(900)
    expect(p.spi).toBeCloseTo(p.ev / 1000, 6)
  })

  it('입력이 바뀌어도 어긋남으로 보지 않고 모델 버전만 본다', () => {
    const inputs = { modelId: 'brooks', params: { ...params }, settings, scenarios: [] }
    expect(adoptionStatus(adopted, inputs, entry)).toEqual({ linked: true, changes: [] })
    const older = { ...adopted, model: { ...adopted.model, version: adopted.model.version + 1 } }
    expect(adoptionStatus(older, inputs, entry).changes.map((c) => c.key)).toEqual(['model:version'])
  })

  it('진척 정의가 없는 모델은 만들 수 없다', () => {
    const noEvm = { ...entry, evm: undefined } as typeof entry
    expect(createAdoptionFromPlan({ entry: noEvm, params, settings, curve, fileName: 'x.csv' }).ok).toBe(false)
  })
})

describe('계획 곡선 채택 (스토어)', () => {
  it('채택하면 이전 채택의 개정 이력이 지워지고 계획 곡선이 기준선이 된다', async () => {
    const { useAppStore } = await import('../stores/appStore')
    await useAppStore.getState().newProject('brooks')
    useAppStore.setState({ revisions: [{ number: 1 } as never] })
    expect(useAppStore.getState().adoptPlanCurve(parsePlanCurveCsv('day,effort\n0,0\n100,500\n'), '계획.csv')).toBeNull()
    const s = useAppStore.getState()
    expect(s.revisions).toEqual([])
    expect(s.adopted?.scenarioId).toBe(PLAN_CSV_SCENARIO_ID)
    expect(s.adopted?.bac).toBe(500)
  })
})
