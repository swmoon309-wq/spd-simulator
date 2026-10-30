/** 색각 이상에서도 구분되는 팔레트(Okabe–Ito 기반). */
export const RUN_COLORS = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#7A7A7A', '#B2182B']

export function colorFor(index: number): string {
  return RUN_COLORS[index % RUN_COLORS.length] as string
}

/**
 * 시나리오 색. id가 `sN`이면 N에 따라 정해 시나리오를 지우거나 순서를 바꿔도 색이 바뀌지 않는다.
 * 그 밖의 id는 문자열 해시로 정한다.
 */
export function scenarioColor(id: string): string {
  const m = /^s(\d+)$/.exec(id)
  if (m) return colorFor(Number(m[1]) - 1)
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return colorFor(h)
}
