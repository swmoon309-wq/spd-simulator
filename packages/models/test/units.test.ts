import { describe, expect, it } from 'vitest'
import { checkModelUnits, compileModel, parseUnit, runModel, type ModelDef } from '@spd/sd-engine'
import * as m from '../src'

const models: [string, ModelDef][] = [
  ['brooks', m.brooksModel],
  ['integrated-project', m.integratedProjectModel],
  ['production-rework', m.productionReworkModel],
  ['learning-curve', m.learningCurveModel],
  ['rayleigh', m.rayleighModel],
  ['personnel-chain', m.personnelChainModel],
  ['defect-chain', m.defectChainModel]
]

describe('내장 7개 모델의 단위 (설계 08의 6.3, M2)', () => {
  it.each(models)('%s: 단위 오류와 경고가 없다', (_id, def) => {
    const bad = checkModelUnits(def).filter((i) => i.severity !== 'info')
    expect(bad.map((i) => `${i.variable}: ${i.message}`)).toEqual([])
  })

  it('모든 단위 문자열이 읽힌다(28종)', () => {
    const units = new Set<string>()
    for (const [, def] of models) {
      for (const sec of [def.constants, def.levels, def.rates, def.auxiliaries]) for (const v of Object.values(sec)) if (v.unit) units.add(v.unit)
      for (const t of Object.values(def.tables)) for (const u of [t.xUnit, t.yUnit]) if (u) units.add(u)
    }
    expect(units.size).toBe(28)
    for (const u of units) expect(parseUnit(u).ok, u).toBe(true)
  })

  it('모든 변수에 단위가 있다(선언이 없다는 정보가 없다)', () => {
    for (const [id, def] of models) expect(checkModelUnits(def).filter((i) => i.code === 'unit-missing').map((i) => i.variable), id).toEqual([])
  })

  it('통합 모델의 인라인 GRAPH 3곳을 단위가 있는 테이블로 옮겼고 결과는 그대로다', () => {
    const def = m.integratedProjectModel
    expect(Object.keys(def.tables).sort()).toEqual(['ctl_discovery_curve', 'err_density_curve', 'exh_flow_curve'])
    // 같은 곡선을 인라인 GRAPH로 쓴 모델과 모든 변수의 시계열이 비트 단위로 같다
    const inline: ModelDef = JSON.parse(JSON.stringify(def)) as ModelDef
    const t = inline.tables
    inline.auxiliaries['exh_flow'] = { ...(inline.auxiliaries['exh_flow'] as { expr: string }), expr: `GRAPH((1 - prod_frac_manday) / MAX(1 - frac_nominal, 0.01), [${t['exh_flow_curve']!.x.join(', ')}], [${t['exh_flow_curve']!.y.join(', ')}])` }
    inline.auxiliaries['ctl_pct_discovered_per_day'] = { ...(inline.auxiliaries['ctl_pct_discovered_per_day'] as { expr: string }), expr: `GRAPH(ctl_pct_worked, [${t['ctl_discovery_curve']!.x.join(', ')}], [${t['ctl_discovery_curve']!.y.join(', ')}])` }
    inline.auxiliaries['err_density_mult'] = { ...(inline.auxiliaries['err_density_mult'] as { expr: string }), expr: `GRAPH(err_avg_per_task, [${t['err_density_curve']!.x.join(', ')}], [${t['err_density_curve']!.y.join(', ')}])` }
    inline.tables = {}
    const a = runModel(compileModel(def))
    const b = runModel(compileModel(inline))
    expect(Object.keys(a.series).length).toBeGreaterThan(50)
    for (const [name, series] of Object.entries(a.series)) expect(Array.from(b.series[name] as Float64Array), name).toEqual(Array.from(series))
  })
})
