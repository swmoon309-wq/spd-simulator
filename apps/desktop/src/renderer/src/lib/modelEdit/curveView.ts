import type { TableData } from './tables'

/**
 * 그래프 함수 차트의 좌표 계산(순수). 화면 컴포넌트가 SVG로 그리고 끌어 옮길 때 쓴다: 값 ↔ 화면 좌표, 끌 때 앞뒤 점을 넘지 않게 제한.
 */
export interface Domain {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** 점을 모두 담고 양쪽에 여유를 둔 표시 범위(범위 밖 연장선과 기준선 x=1, y=1도 보이게). 길이가 0이면 ±1을 준다. */
export function curveDomain(t: TableData, pad = 0.12): Domain {
  const span = (lo: number, hi: number): [number, number] => {
    const d = hi - lo
    if (d === 0) return [lo - 1, hi + 1]
    return [lo - d * pad, hi + d * pad]
  }
  const [x0, x1] = span(Math.min(...t.x), Math.max(...t.x))
  const [y0, y1] = span(Math.min(...t.y), Math.max(...t.y))
  return { x0, x1, y0, y1 }
}

export interface Scale {
  sx(x: number): number
  sy(y: number): number
  ix(px: number): number
  iy(py: number): number
}

/** 값 ↔ 화면 좌표(y는 위로 갈수록 큰 값). `margin`은 사방 여백(픽셀). */
export function makeScale(d: Domain, width: number, height: number, margin: number): Scale {
  const w = width - margin * 2
  const h = height - margin * 2
  return {
    sx: (x) => margin + ((x - d.x0) / (d.x1 - d.x0)) * w,
    sy: (y) => margin + (1 - (y - d.y0) / (d.y1 - d.y0)) * h,
    ix: (px) => d.x0 + ((px - margin) / w) * (d.x1 - d.x0),
    iy: (py) => d.y0 + (1 - (py - margin) / h) * (d.y1 - d.y0)
  }
}

const round6 = (v: number): number => Number(v.toPrecision(6))

/**
 * `i`번째 점을 `(x, y)`로 끌 때의 실제 위치. x는 앞뒤 점과 `gap` 이상 떨어지게 제한한다(끝 점은 바깥쪽으로는 제한이 없다). 값은 유효 숫자 6자리로
 * 반올림한다. 점 순서가 바뀌는 일이 없어 테이블의 오름차순 규칙을 지킨다.
 */
export function dragTarget(t: TableData, i: number, x: number, y: number, gap: number): { x: number; y: number } {
  const lo = i > 0 ? (t.x[i - 1] as number) + gap : -Infinity
  const hi = i < t.x.length - 1 ? (t.x[i + 1] as number) - gap : Infinity
  return { x: round6(Math.min(Math.max(x, lo), hi)), y: round6(y) }
}

/** 방향키 한 번의 이동량: 표시 범위의 1%(Shift면 10%). */
export function keyStep(d: Domain, axis: 'x' | 'y', big: boolean): number {
  const span = axis === 'x' ? d.x1 - d.x0 : d.y1 - d.y0
  return span * (big ? 0.1 : 0.01)
}

/** 곡선 위의 점들을 잇는 SVG 경로(M … L …). */
export function polyline(t: TableData, s: Scale): string {
  return t.x.map((x, i) => `${i === 0 ? 'M' : 'L'}${s.sx(x).toFixed(1)} ${s.sy(t.y[i] as number).toFixed(1)}`).join(' ')
}

/** 범위 밖의 연장선(엔진 규칙: 양 끝 값으로 고정). 왼쪽·오른쪽 조각의 경로. */
export function extensions(t: TableData, d: Domain, s: Scale): { left: string; right: string } {
  const n = t.x.length
  return {
    left: `M${s.sx(d.x0).toFixed(1)} ${s.sy(t.y[0] as number).toFixed(1)} L${s.sx(t.x[0] as number).toFixed(1)} ${s.sy(t.y[0] as number).toFixed(1)}`,
    right: `M${s.sx(t.x[n - 1] as number).toFixed(1)} ${s.sy(t.y[n - 1] as number).toFixed(1)} L${s.sx(d.x1).toFixed(1)} ${s.sy(t.y[n - 1] as number).toFixed(1)}`
  }
}
