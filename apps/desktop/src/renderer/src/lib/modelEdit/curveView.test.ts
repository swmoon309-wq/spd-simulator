import { describe, expect, it } from 'vitest'
import { curveDomain, dragTarget, extensions, keyStep, makeScale, polyline } from './curveView'

const t = { x: [0, 1, 2, 4], y: [1, 1, 0.5, 0] }

describe('곡선 차트 좌표', () => {
  it('표시 범위는 점을 모두 담고 여유를 둔다. 길이가 0이면 ±1', () => {
    const d = curveDomain(t)
    expect(d.x0).toBeLessThan(0)
    expect(d.x1).toBeGreaterThan(4)
    expect(d.y0).toBeLessThan(0)
    expect(d.y1).toBeGreaterThan(1)
    expect(curveDomain({ x: [3, 3.0001], y: [2, 2] })).toMatchObject({ y0: 1, y1: 3 })
  })

  it('값 ↔ 화면 좌표는 서로 되돌릴 수 있고 y는 위로 갈수록 크다', () => {
    const d = curveDomain(t)
    const s = makeScale(d, 500, 250, 30)
    for (const [x, y] of [[0, 1], [4, 0], [1.7, 0.33]] as const) {
      expect(s.ix(s.sx(x))).toBeCloseTo(x, 9)
      expect(s.iy(s.sy(y))).toBeCloseTo(y, 9)
    }
    expect(s.sy(1)).toBeLessThan(s.sy(0)) // 큰 y가 화면 위쪽(작은 px)
    expect(s.sx(d.x0)).toBe(30)
    expect(s.sx(d.x1)).toBe(470)
    expect(s.sy(d.y1)).toBe(30)
  })

  it('끌 때 x는 앞뒤 점을 넘지 않고 끝 점은 바깥쪽으로 제한이 없다(오름차순 유지)', () => {
    expect(dragTarget(t, 1, 5, 0.7, 0.01)).toEqual({ x: 1.99, y: 0.7 }) // 뒤 점(2) 바로 앞에서 멈춘다
    expect(dragTarget(t, 1, -3, 0.7, 0.01)).toEqual({ x: 0.01, y: 0.7 })
    expect(dragTarget(t, 0, -10, 2, 0.01)).toEqual({ x: -10, y: 2 })
    expect(dragTarget(t, 0, 9, 2, 0.01)).toEqual({ x: 0.99, y: 2 })
    expect(dragTarget(t, 3, 99, 0, 0.01)).toEqual({ x: 99, y: 0 })
    expect(dragTarget(t, 3, 0, 0, 0.01)).toEqual({ x: 2.01, y: 0 })
    expect(dragTarget(t, 1, 1.23456789, 0.123456789, 0.01)).toEqual({ x: 1.23457, y: 0.123457 }) // 유효 숫자 6자리
  })

  it('방향키 이동량은 표시 범위의 1%, Shift는 10%', () => {
    const d = { x0: 0, x1: 100, y0: 0, y1: 10 }
    expect(keyStep(d, 'x', false)).toBe(1)
    expect(keyStep(d, 'x', true)).toBe(10)
    expect(keyStep(d, 'y', false)).toBeCloseTo(0.1, 12)
  })

  it('경로: 점을 잇는 선과 양 끝의 연장선(양 끝 값으로 고정)', () => {
    const d = curveDomain(t)
    const s = makeScale(d, 400, 200, 20)
    expect(polyline(t, s).split('L')).toHaveLength(4)
    expect(polyline(t, s).startsWith('M')).toBe(true)
    const e = extensions(t, d, s)
    const ys = (p: string) => [...p.matchAll(/ ([\d.]+)/g)].map((m) => Number(m[1]))
    expect(new Set(ys(e.left)).size).toBe(1) // 수평선
    expect(new Set(ys(e.right)).size).toBe(1)
  })
})
