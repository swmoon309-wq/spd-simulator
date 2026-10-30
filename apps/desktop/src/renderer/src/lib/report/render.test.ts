import { describe, expect, it } from 'vitest'
import type { ReportDoc } from '../../../../shared/reportDoc'
import { escapeHtml, safeSvg } from './escape'
import { renderReportHtml } from './render'

const doc = (over: Partial<ReportDoc> = {}): ReportDoc => ({
  title: '시나리오 비교 보고서',
  subtitle: '기준과 두 대안',
  meta: { author: '홍길동', date: '2026-10-22T05:00:00.000Z', app: '소프트웨어 프로젝트 시뮬레이터 0.1.0', model: { id: 'brooks', name: 'Brooks 법칙', version: 1 } },
  sections: [
    {
      id: 'overview',
      title: '개요',
      status: 'fresh',
      blocks: [
        { kind: 'paragraph', text: '첫 문단' },
        { kind: 'paragraph', text: '주의 문단', tone: 'warning' },
        { kind: 'list', items: ['하나', '둘'] },
        { kind: 'list', items: ['가', '나'], ordered: true },
        { kind: 'keyValues', rows: [['완료일', '274.1일']] },
        {
          kind: 'table',
          caption: '지표',
          columns: [{ label: '지표' }, { label: '값', align: 'right' }],
          rows: [['완료일', { text: '274.1', tone: 'better' }], ['공수', '5,482']],
          note: '낮을수록 좋음'
        },
        { kind: 'callout', title: '읽을 때', text: '예측이 아닙니다', tone: 'note' }
      ]
    },
    { id: 'riskResults', title: '위험 분석', status: 'missing', blocks: [{ kind: 'paragraph', text: '위험 분석을 실행하지 않았습니다.' }] }
  ],
  ...over
})

describe('escapeHtml', () => {
  it('다섯 문자를 이스케이프한다', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;')
    expect(escapeHtml('평범한 글')).toBe('평범한 글')
  })
})

describe('safeSvg', () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="5" height="5"/><text>안녕</text></svg>'
  it('깨끗한 SVG는 그대로 통과한다(xmlns 주소는 외부 참조가 아니다)', () => {
    expect(safeSvg(ok)).toBe(ok)
  })
  it.each([
    ['스크립트', '<svg><script>alert(1)</script></svg>'],
    ['이벤트 속성', '<svg><rect onload="x()"/></svg>'],
    ['javascript:', '<svg><a href="javascript:alert(1)"><text>a</text></a></svg>'],
    ['외부 이미지', '<svg><image href="https://evil.example/a.png"/></svg>'],
    ['foreignObject', '<svg><foreignObject><div>x</div></foreignObject></svg>'],
    ['css 외부 참조', '<svg><rect style="fill:url(https://evil.example/x)"/></svg>'],
    ['svg가 아님', '<div>hi</div>'],
    ['닫히지 않음', '<svg><rect/>']
  ])('%s는 거절한다', (_n, svg) => {
    expect(safeSvg(svg)).toBeNull()
  })
})

describe('renderReportHtml', () => {
  it('자체 완결 문서의 뼈대: doctype, 한국어, 제목, 목차, 절', () => {
    const html = renderReportHtml(doc())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="ko">')
    expect(html).toContain('<title>시나리오 비교 보고서</title>')
    expect(html).toContain('<nav class="toc" aria-label="목차">')
    expect(html).toContain('<a href="#sec-1">개요</a>')
    expect(html).toContain('id="sec-2"')
    expect(html).toContain('<span class="badge fresh">최신</span>')
    expect(html).toContain('<span class="badge missing">없음</span>')
    expect(html).toContain('작성자 홍길동')
    expect(html).toContain('작성일 2026-10-22')
    expect(html).toContain('모델 Brooks 법칙 v1')
  })

  it('블록: 문단 톤, 목록, 키-값, 표(머리글 scope, 정렬, 톤, 주석), 콜아웃', () => {
    const html = renderReportHtml(doc())
    expect(html).toContain('<p>첫 문단</p>')
    expect(html).toContain('<p class="warning">주의 문단</p>')
    expect(html).toContain('<ul><li>하나</li><li>둘</li></ul>')
    expect(html).toContain('<ol><li>가</li><li>나</li></ol>')
    expect(html).toContain('<dt>완료일</dt><dd>274.1일</dd>')
    expect(html).toContain('<caption>지표</caption>')
    expect(html).toContain('<th scope="col" class="r">값</th>')
    expect(html).toContain('<td class="r better">274.1</td>')
    expect(html).toContain('<td class="r">5,482</td>')
    expect(html).toContain('<p class="table-note">낮을수록 좋음</p>')
    expect(html).toContain('<aside class="callout note"><strong>읽을 때</strong>예측이 아닙니다</aside>')
  })

  it('사용자 문자열은 모두 이스케이프된다(제목·작성자·절·셀·메모·모델 이름)', () => {
    const evil = `<script>alert(1)</script>"><img src=x onerror=alert(2)>`
    const html = renderReportHtml(
      doc({
        title: evil,
        subtitle: evil,
        meta: { author: evil, date: evil, app: evil, model: { id: 'x', name: evil, version: 1, custom: true } },
        sections: [{ id: 'overview', title: evil, status: 'fresh', blocks: [{ kind: 'paragraph', text: evil }, { kind: 'list', items: [evil] }, { kind: 'keyValues', rows: [[evil, evil]] }, { kind: 'table', caption: evil, columns: [{ label: evil }], rows: [[evil]], note: evil }, { kind: 'callout', title: evil, text: evil, tone: 'warning' }] }]
      })
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    // 속성 값 안의 따옴표도 이스케이프되어 속성이 끊기지 않는다(`content="..."` 한 덩어리).
    expect(html).toMatch(/<meta name="generator" content="[^"]*"><title>/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('(사용자 모델)')
  })

  it('차트: 안전한 SVG는 인라인, alt는 aria-label과 표로, 위험한 SVG는 넣지 않고 표로 대신한다', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
    const table = { kind: 'table' as const, caption: '차트의 값', columns: [{ label: '이름' }], rows: [['기준']] }
    const html = renderReportHtml(doc({ sections: [{ id: 'charts', title: '차트', status: 'fresh', blocks: [{ kind: 'chart', title: '막대', alt: '기준 274일', svg, table }] }] }))
    expect(html).toContain(`<div class="chart" role="img" aria-label="기준 274일">${svg}</div>`)
    expect(html).toContain('<caption>차트의 값</caption>')
    const bad = renderReportHtml(doc({ sections: [{ id: 'charts', title: '차트', status: 'fresh', blocks: [{ kind: 'chart', title: '막대', alt: '대체 문장', svg: '<svg><script>x</script></svg>' }] }] }))
    expect(bad).not.toContain('<script')
    expect(bad).toContain('차트를 그릴 수 없어')
    expect(bad).toContain('대체 문장')
  })

  it('결정적이다: 같은 문서는 같은 문자열', () => {
    expect(renderReportHtml(doc())).toBe(renderReportHtml(doc()))
  })

  it('외부 파일·글꼴·스크립트를 참조하지 않는다', () => {
    const html = renderReportHtml(doc())
    expect(html).not.toMatch(/<script|<link\s|@import|<img|src\s*=|url\(/i)
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('인쇄 규칙: A4, 표 머리글 반복, 쪽 나눔 방지', () => {
    const html = renderReportHtml(doc())
    expect(html).toContain('td, aside.callout { white-space: pre-line; }') // 칸·콜아웃 안의 줄바꿈이 보인다
    expect(html).toContain('@page { size: A4;')
    expect(html).toContain('thead { display: table-header-group; }')
    expect(html).toContain('break-inside: avoid')
  })

  it('절이 하나뿐이면 목차를 넣지 않는다', () => {
    expect(renderReportHtml(doc({ sections: [doc().sections[0]!] }))).not.toContain('class="toc"')
  })
})
