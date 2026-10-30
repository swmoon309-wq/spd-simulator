import * as echarts from 'echarts/core'
import { BarChart, LineChart, RadarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, MarkLineComponent, RadarComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

// 화면용 차트는 캔버스 렌더러를 등록한다. 여기서는 서버측 SVG 렌더링에 필요한 것만 더한다(등록은 전역이고 겹쳐도 안전하다).
echarts.use([BarChart, LineChart, RadarChart, GridComponent, LegendComponent, MarkLineComponent, RadarComponent, TooltipComponent, SVGRenderer])

/**
 * ECharts가 SVG에 붙이는 클래스·클립 이름(`zr0-cls-0` 등)은 프로세스 전체의 증가하는 번호를 쓴다. 같은 차트가 매번 다른 문자열이
 * 되지 않도록(보고서는 같은 입력이면 같은 문자열이어야 한다) 차트마다 처음 나온 순서대로 다시 번호를 붙인다.
 */
export function normalizeSvgIds(svg: string): string {
  const seen = new Map<string, string>()
  const counters = new Map<string, number>()
  return svg.replace(/\bzr\d+-([A-Za-z]+)-?(\d+)\b/g, (whole, kind: string) => {
    let next = seen.get(whole)
    if (!next) {
      const n = counters.get(kind) ?? 0
      counters.set(kind, n + 1)
      next = `zr-${kind}-${n}`
      seen.set(whole, next)
    }
    return next
  })
}

/**
 * 차트 옵션을 **SVG 문자열**로 그린다(설계 09의 2장). DOM 없이 ECharts의 서버측 렌더링을 쓰므로 보고서에 인라인으로 들어가고
 * 확대해도 선명하다. 옵션은 화면 차트와 같은 빌더가 만든 것이다.
 */
export function renderChartSvg(option: echarts.EChartsCoreOption, width: number, height: number): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    chart.setOption(option)
    return normalizeSvgIds(chart.renderToSVGString())
  } finally {
    chart.dispose()
  }
}
