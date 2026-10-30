import { describe, expect, it } from 'vitest'
import { compile, ExprError, StateStore } from '../src'
import { harness, simulate, value } from './helpers'

describe('변수와 예약어', () => {
  it('변수를 읽는다', () => expect(value('a * b + 1', { a: 3, b: 4 })).toBe(13))
  it('TIME과 DT', () => {
    const { compiled, rt } = harness('TIME + DT', { dt: 0.5 })
    rt.time = 10
    expect(compiled.eval(rt)).toBe(10.5)
  })
  it('정의되지 않은 변수는 위치와 함께 오류', () => {
    try {
      value('a + zzz', { a: 1 })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ExprError)
      expect((e as ExprError).detail).toContain('zzz')
      expect((e as ExprError).pos).toBe(4)
    }
  })
  it('변수 이름은 대소문자를 구분한다', () => {
    expect(() => value('A', { a: 1 })).toThrow(ExprError)
  })
})

describe('비교와 논리', () => {
  it.each([
    ['1 < 2', 1], ['2 < 2', 0], ['2 <= 2', 1], ['3 > 2', 1], ['2 >= 3', 0],
    ['2 = 2', 1], ['2 == 2', 1], ['2 <> 2', 0], ['2 != 3', 1],
    ['1 AND 0', 0], ['1 AND 2', 1], ['0 OR 0', 0], ['0 OR 5', 1], ['NOT 0', 1], ['NOT 3', 0]
  ])('%s = %d', (src, expected) => expect(value(src)).toBe(expected))
})

describe('내장 순수 함수', () => {
  it('IF', () => {
    expect(value('IF(1, 10, 20)')).toBe(10)
    expect(value('IF(0, 10, 20)')).toBe(20)
    expect(value('IF(a > 1, a, -a)', { a: 3 })).toBe(3)
  })
  it('IF의 거짓 분기 오류값은 결과에 영향 없다', () => {
    expect(value('IF(a > 0, 1 / a, 0)', { a: 0 })).toBe(0)
  })
  it('MIN/MAX는 가변 인자', () => {
    expect(value('MIN(3, 1, 2)')).toBe(1)
    expect(value('MAX(3, 1, 2, 9)')).toBe(9)
    expect(value('MAX(4)')).toBe(4)
  })
  it('ABS/SQRT/EXP/LN', () => {
    expect(value('ABS(-3)')).toBe(3)
    expect(value('SQRT(16)')).toBe(4)
    expect(value('EXP(0)')).toBe(1)
    expect(value('LN(EXP(2))')).toBeCloseTo(2, 12)
    expect(Number.isNaN(value('SQRT(-1)'))).toBe(true)
  })
  it('ROUND', () => {
    expect(value('ROUND(2.6)')).toBe(3)
    expect(value('ROUND(3.14159, 2)')).toBe(3.14)
  })
  it('CLAMP', () => {
    expect(value('CLAMP(5, 0, 3)')).toBe(3)
    expect(value('CLAMP(-5, 0, 3)')).toBe(0)
    expect(value('CLAMP(2, 0, 3)')).toBe(2)
  })
  it('함수 이름은 대소문자를 구분하지 않는다', () => expect(value('max(1, 2)')).toBe(2))
  it('나누기 0은 Infinity (러너가 감지)', () => expect(value('1 / 0')).toBe(Infinity))
})

describe('시간 함수', () => {
  it('STEP', () => {
    expect(value('STEP(5, 10)', {}, 9.75)).toBe(0)
    expect(value('STEP(5, 10)', {}, 10)).toBe(5)
    expect(value('STEP(5, 10)', {}, 50)).toBe(5)
  })
  it('PULSE는 [시작, 시작+폭)에서만', () => {
    expect(value('PULSE(7, 10, 2)', {}, 9.75)).toBe(0)
    expect(value('PULSE(7, 10, 2)', {}, 10)).toBe(7)
    expect(value('PULSE(7, 10, 2)', {}, 11.75)).toBe(7)
    expect(value('PULSE(7, 10, 2)', {}, 12)).toBe(0)
  })
  it('RAMP', () => {
    expect(value('RAMP(2, 10)', {}, 5)).toBe(0)
    expect(value('RAMP(2, 10)', {}, 14)).toBe(8)
  })
})

describe('GRAPH', () => {
  const f = (x: number, src = 'GRAPH(x, [0, 1, 3], [0, 10, 14])') => value(src, { x })
  it('선형 보간', () => {
    expect(f(0.5)).toBeCloseTo(5, 12)
    expect(f(2)).toBeCloseTo(12, 12)
    expect(f(1)).toBe(10)
  })
  it('범위 밖은 끝값으로 고정', () => {
    expect(f(-5)).toBe(0)
    expect(f(99)).toBe(14)
  })
  it('음수와 수식 좌표를 상수로 접는다', () => {
    expect(f(-0.5, 'GRAPH(x, [-1, 0, 1], [-2, 0, 2])')).toBeCloseTo(-1, 12)
    expect(f(1, 'GRAPH(x, [0, 1 + 1], [0, 10])')).toBeCloseTo(5, 12)
  })
  it('이름 있는 테이블', () => {
    const { compiled, rt } = harness('GRAPH(x, g)', {
      vars: { x: 0.5 },
      tables: { g: { x: [0, 1], y: [0, 4] } }
    })
    expect(compiled.eval(rt)).toBe(2)
  })
  it('NaN 입력은 NaN', () => expect(Number.isNaN(f(NaN))).toBe(true))
  it.each([
    'GRAPH(x, [0, 1], [0])',
    'GRAPH(x, [1, 0], [0, 1])',
    'GRAPH(x, [0, 0], [0, 1])',
    'GRAPH(x, [0], [1])',
    'GRAPH(x, [0, x], [0, 1])',
    'GRAPH(x, nope)',
    'GRAPH(x)',
    'GRAPH(x, 1, 2)'
  ])('잘못된 정의는 오류: %s', (src) => {
    expect(() => value(src, { x: 0 })).toThrow(ExprError)
  })
})

describe('컴파일 오류', () => {
  it.each(['FOO(1)', 'IF(1, 2)', 'ABS()', 'ABS(1, 2)', 'SMOOTH(1)', '[1, 2]', 'CLAMP(1, 2)'])(
    '%s',
    (src) => expect(() => value(src)).toThrow(ExprError)
  )
})

describe('난수', () => {
  it('같은 시드는 같은 수열', () => {
    const run = (seed: number) => {
      const { compiled, rt } = harness('RANDOM_UNIFORM(0, 1)', { seed })
      return [compiled.eval(rt), compiled.eval(rt), compiled.eval(rt)]
    }
    expect(run(7)).toEqual(run(7))
    expect(run(7)).not.toEqual(run(8))
  })
  it('균등·정규·삼각 분포의 범위와 평균', () => {
    const n = 20000
    const mean = (src: string) => {
      const { compiled, rt } = harness(src, { seed: 42 })
      let s = 0
      for (let i = 0; i < n; i++) {
        const v = compiled.eval(rt)
        if (src.startsWith('RANDOM_UNIFORM')) expect(v >= 2 && v < 6).toBe(true)
        if (src.startsWith('RANDOM_TRIANGULAR')) expect(v >= 1 && v <= 9).toBe(true)
        s += v
      }
      return s / n
    }
    expect(mean('RANDOM_UNIFORM(2, 6)')).toBeCloseTo(4, 1)
    expect(mean('RANDOM_NORMAL(10, 2)')).toBeCloseTo(10, 1)
    expect(mean('RANDOM_TRIANGULAR(1, 2, 9)')).toBeCloseTo(4, 1) // (1+2+9)/3
  })
})

describe('의존성', () => {
  const deps = (src: string, names: string[]) => {
    const store = new StateStore()
    const slots = new Map(names.map((n, i) => [n, i]))
    const c = compile(src, { resolve: (n) => slots.get(n), state: store })
    return { alg: c.algebraicDeps.sort(), del: c.delayedDeps.sort() }
  }
  it('직접 참조는 algebraic', () => {
    expect(deps('a + b * a', ['a', 'b'])).toEqual({ alg: ['a', 'b'], del: [] })
  })
  it('SMOOTH/DELAY의 입력은 delayed로 분리되어 순환을 끊는다', () => {
    expect(deps('a + SMOOTH(b, c)', ['a', 'b', 'c'])).toEqual({ alg: ['a'], del: ['b', 'c'] })
    expect(deps('DELAY3(b, 5)', ['b'])).toEqual({ alg: [], del: ['b'] })
  })
  it('TIME/DT는 의존성이 아니다', () => {
    expect(deps('TIME * DT', [])).toEqual({ alg: [], del: [] })
  })
})

describe('지연·평활 (해석해와 비교)', () => {
  const dt = 0.01
  const end = 60

  it('SMOOTH: 계단 응답 1 − e^(−(t−t0)/d)', () => {
    const d = 10
    const { t, y } = simulate(`SMOOTH(STEP(1, 5), ${d})`, dt, end)
    t.forEach((tt, i) => {
      const exact = tt < 5 ? 0 : 1 - Math.exp(-(tt - 5) / d)
      expect(Math.abs((y[i] as number) - exact)).toBeLessThan(0.01)
    })
  })

  it('DELAY1은 SMOOTH와 같다', () => {
    const a = simulate('SMOOTH(STEP(1, 5), 8)', dt, 30).y
    const b = simulate('DELAY1(STEP(1, 5), 8)', dt, 30).y
    expect(b).toEqual(a)
  })

  it('DELAY3: 계단 응답 1 − e^(−u)(1 + u + u²/2), u = 3(t−t0)/d', () => {
    const d = 12
    const { t, y } = simulate(`DELAY3(STEP(1, 5), ${d})`, dt, end)
    t.forEach((tt, i) => {
      const u = (3 * Math.max(0, tt - 5)) / d
      const exact = 1 - Math.exp(-u) * (1 + u + (u * u) / 2)
      expect(Math.abs((y[i] as number) - exact)).toBeLessThan(0.01)
    })
  })

  it('DELAY3는 SMOOTH보다 응답이 늦게 시작한다(S자)', () => {
    const s = simulate('SMOOTH(STEP(1, 0.5), 10)', dt, 3).y
    const d3 = simulate('DELAY3(STEP(1, 0.5), 10)', dt, 3).y
    expect((d3[200] as number) < (s[200] as number)).toBe(true)
  })

  it('정상 상태 초기화: 입력이 상수면 처음부터 그 값', () => {
    const { y } = simulate('SMOOTH(5, 10)', 0.25, 5)
    expect(y.every((v) => v === 5)).toBe(true)
    expect(simulate('DELAY3(7, 20)', 0.25, 5).y.every((v) => v === 7)).toBe(true)
  })

  it('초기화 중에는 입력을 그대로 돌려준다', () => {
    const { compiled, rt } = harness('SMOOTH(4, 10)')
    rt.initializing = true
    expect(compiled.eval(rt)).toBe(4)
  })

  it('지연시간이 dt보다 작으면 dt로 제한되어 발산하지 않는다', () => {
    const { y } = simulate('SMOOTH(STEP(1, 1), 0.001)', 0.25, 5)
    expect(y.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true)
    expect(y[y.length - 1]).toBeCloseTo(1, 6)
  })

  it('중첩: 한 SMOOTH의 출력이 다른 SMOOTH의 입력일 때 갱신 순서와 무관', () => {
    const nested = simulate('SMOOTH(SMOOTH(STEP(1, 2), 5), 5)', 0.01, 40).y
    expect(nested[nested.length - 1]).toBeGreaterThan(0.99)
    // 2차 계단 응답 1 − e^(−u)(1 + u), u = (t − 2)/5
    const t = 20
    const u = (t - 2) / 5
    const exact = 1 - Math.exp(-u) * (1 + u)
    expect(Math.abs((nested[Math.round(t / 0.01)] as number) - exact)).toBeLessThan(0.01)
  })
})
