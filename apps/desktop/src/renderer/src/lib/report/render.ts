import { STATUS_LABELS, type Block, type Cell, type ReportDoc, type ReportSection, type TableBlock } from '../../../../shared/reportDoc'
import { escapeHtml as esc, safeSvg } from './escape'

/** 보고서 스타일. 밝은 테마 고정, 시스템 글꼴, A4 인쇄 규칙을 함께 둔다. 외부 파일·글꼴을 참조하지 않는다. */
const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: #f4f5f7; color: #1d1f23; font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.6; }
.report { max-width: 820px; margin: 0 auto; background: #fff; padding: 32px 40px; border: 1px solid #d9dce1; }
header.doc-head { border-bottom: 2px solid #1d1f23; padding-bottom: 12px; margin-bottom: 16px; }
h1 { margin: 0 0 4px; font-size: 22px; }
.subtitle { margin: 0; color: #5d6470; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 20px; margin: 10px 0 0; color: #5d6470; font-size: 12px; }
nav.toc { margin: 0 0 16px; padding: 10px 14px; background: #f4f5f7; border-radius: 6px; }
nav.toc h2 { margin: 0 0 4px; font-size: 13px; }
nav.toc ol { margin: 0; padding-left: 20px; columns: 2; }
section.sec { margin: 0 0 20px; }
section.sec > h2 { margin: 18px 0 8px; font-size: 16px; padding-bottom: 4px; border-bottom: 1px solid #d9dce1; break-after: avoid; }
h3 { margin: 12px 0 6px; font-size: 14px; }
.badge { display: inline-block; margin-left: 8px; padding: 0 8px; border: 1px solid #5d6470; border-radius: 10px; font-size: 11px; font-weight: 400; color: #5d6470; vertical-align: middle; }
.badge.stale, .badge.missing, .badge.na { border-color: #b3261e; color: #b3261e; }
p { margin: 6px 0; }
p.warning { border-left: 4px solid #b3261e; padding-left: 10px; }
p.note { border-left: 4px solid #5d6470; padding-left: 10px; color: #3a3d44; }
ul, ol { margin: 6px 0; padding-left: 22px; }
dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; margin: 6px 0; }
dl.kv dt { color: #5d6470; }
dl.kv dd { margin: 0; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
caption { text-align: left; font-weight: 600; padding: 4px 0; caption-side: top; }
th, td { padding: 4px 8px; border-bottom: 1px solid #d9dce1; text-align: left; vertical-align: top; }
td, aside.callout { white-space: pre-line; }
thead th { background: #f4f5f7; border-bottom: 2px solid #5d6470; font-weight: 600; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.better { color: #0a7d4b; font-weight: 600; }
.worse { color: #b3261e; font-weight: 600; }
.dim { color: #8a8f98; }
.strong { font-weight: 700; }
.table-note { margin: 0 0 8px; color: #5d6470; font-size: 11px; }
figure { margin: 12px 0; break-inside: avoid; }
figure .chart { max-width: 100%; overflow: hidden; }
figure .chart svg { max-width: 100%; height: auto; }
figcaption { font-weight: 600; font-size: 12px; margin-bottom: 4px; }
aside.callout { margin: 10px 0; padding: 8px 12px; border: 1px solid #5d6470; border-radius: 6px; break-inside: avoid; }
aside.callout.warning { border-color: #b3261e; background: #fdf3f2; }
aside.callout.note { background: #f4f5f7; }
aside.callout strong { display: block; }
footer.doc-foot { margin-top: 24px; padding-top: 8px; border-top: 1px solid #d9dce1; color: #5d6470; font-size: 11px; }
@page { size: A4; margin: 18mm 16mm; }
@media print {
  body { background: #fff; padding: 0; }
  .report { border: 0; padding: 0; max-width: none; }
  nav.toc { break-inside: avoid; }
  section.sec > h2 { break-after: avoid; }
}
`

const cellText = (c: Cell): string => (typeof c === 'string' ? c : c.text)
const cellTone = (c: Cell): string => (typeof c === 'string' || !c.tone ? '' : c.tone)

function renderTable(t: TableBlock): string {
  const head = t.columns.map((c) => `<th scope="col"${c.align === 'right' ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')
  const body = t.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => {
            const classes = [t.columns[i]?.align === 'right' ? 'r' : '', cellTone(cell)].filter(Boolean).join(' ')
            return `<td${classes ? ` class="${classes}"` : ''}>${esc(cellText(cell))}</td>`
          })
          .join('')}</tr>`
    )
    .join('')
  return `<table>${t.caption ? `<caption>${esc(t.caption)}</caption>` : ''}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${t.note ? `<p class="table-note">${esc(t.note)}</p>` : ''}`
}

function renderBlock(b: Block): string {
  switch (b.kind) {
    case 'paragraph':
      return `<p${b.tone && b.tone !== 'normal' ? ` class="${b.tone}"` : ''}>${esc(b.text)}</p>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      return `<${tag}>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</${tag}>`
    }
    case 'keyValues':
      return `<dl class="kv">${b.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
    case 'table':
      return renderTable(b)
    case 'chart': {
      const svg = safeSvg(b.svg)
      const chart = svg ? `<div class="chart" role="img" aria-label="${esc(b.alt)}">${svg}</div>` : `<p class="note">(차트를 그릴 수 없어 아래 표로 대신합니다)</p>`
      return `<figure><figcaption>${esc(b.title)}</figcaption>${chart}${b.table ? renderTable(b.table) : `<p class="note">${esc(b.alt)}</p>`}</figure>`
    }
    case 'callout':
      return `<aside class="callout ${b.tone}"><strong>${esc(b.title)}</strong>${esc(b.text)}</aside>`
  }
}

function renderSection(s: ReportSection, index: number): string {
  return `<section class="sec" id="sec-${index + 1}"><h2>${esc(s.title)}<span class="badge ${s.status}">${esc(STATUS_LABELS[s.status])}</span></h2>${s.blocks.map(renderBlock).join('')}</section>`
}

/** 날짜(ISO)에서 `YYYY-MM-DD`만. 읽을 수 없으면 원문(이스케이프됨). */
function dayOf(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso
}

/**
 * 보고서를 자체 완결 HTML 한 문자열로 만든다(설계 09의 6.1). 같은 문서는 같은 문자열이다(결정적). 사용자 문자열은 모두 이스케이프하고
 * 외부 파일·글꼴·스크립트를 쓰지 않는다. 미리보기와 내보낸 파일과 PDF가 같은 문자열을 쓴다.
 */
export function renderReportHtml(doc: ReportDoc): string {
  const model = doc.meta.model
  const metaRows = [
    ...(doc.meta.author ? [`작성자 ${esc(doc.meta.author)}`] : []),
    `작성일 ${esc(dayOf(doc.meta.date))}`,
    `모델 ${esc(model.name)}${model.custom ? ' (사용자 모델)' : ''} v${model.version}`
  ]
  const toc = doc.sections.map((s, i) => `<li><a href="#sec-${i + 1}">${esc(s.title)}</a></li>`).join('')
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${esc(doc.meta.app)}"><title>${esc(doc.title)}</title><style>${STYLE}</style></head>
<body><main class="report">
<header class="doc-head"><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="subtitle">${esc(doc.subtitle)}</p>` : ''}<div class="meta">${metaRows.map((m) => `<span>${m}</span>`).join('')}</div></header>
${doc.sections.length > 1 ? `<nav class="toc" aria-label="목차"><h2>목차</h2><ol>${toc}</ol></nav>` : ''}
${doc.sections.map(renderSection).join('\n')}
<footer class="doc-foot">${esc(doc.meta.app)} · ${esc(dayOf(doc.meta.date))}</footer>
</main></body></html>
`
}
