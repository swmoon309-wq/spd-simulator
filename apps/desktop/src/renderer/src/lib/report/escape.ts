const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** 보고서에 들어가는 모든 문자열은 이 함수를 지난다(프로젝트·모델 파일에서 온 이름·메모가 문서를 깨뜨리거나 스크립트가 되지 않게). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] as string)
}

/**
 * 차트 렌더러가 만든 SVG를 문서에 넣어도 되는지 확인한다. 보고서에 들어가는 HTML 조각은 이것뿐이므로 `<svg`로 시작하고
 * 스크립트·이벤트 속성·외부 참조·`<foreignObject>`가 없어야 한다. 아니면 null.
 */
export function safeSvg(svg: string): string | null {
  const s = svg.trim()
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return null
  if (/<\s*script/i.test(s) || /<\s*foreignObject/i.test(s) || /<\s*iframe/i.test(s) || /<\s*object/i.test(s) || /<\s*embed/i.test(s)) return null
  if (/\son[a-z]+\s*=/i.test(s) || /javascript\s*:/i.test(s)) return null
  if (/(href|src)\s*=\s*["']?\s*(https?:|\/\/|file:|data:text)/i.test(s) || /url\(\s*["']?\s*(https?:|\/\/)/i.test(s) || /@import/i.test(s)) return null
  return s
}
