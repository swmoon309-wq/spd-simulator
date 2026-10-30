import { describe, expect, it } from 'vitest'
import { HELP_TOPICS } from '../../../shared/menuCommands'
import { EXAMPLE_GUIDES, GLOSSARY, HELP_TOPIC_LABELS, searchGlossary } from './help'

describe('도움말 내용', () => {
  it('용어는 겹치지 않고 모두 풀이가 있다', () => {
    expect(new Set(GLOSSARY.map((t) => t.term)).size).toBe(GLOSSARY.length)
    for (const t of GLOSSARY) {
      expect(t.meaning.length, t.term).toBeGreaterThan(10)
      expect(t.group, t.term).not.toBe('')
    }
  })

  it('앱의 주요 영역 용어가 들어 있다', () => {
    const groups = new Set(GLOSSARY.map((t) => t.group))
    for (const g of ['모델과 실행', '시나리오', '통제(Earned Value)', '위험 분석', '모델 검증']) expect(groups.has(g), g).toBe(true)
    for (const alias of ['CPI', 'SPI', 'EV', 'PV', 'AC', 'BAC', 'dt', 'seed', 'NRMSE']) expect(GLOSSARY.some((t) => t.alias?.includes(alias)), alias).toBe(true)
  })

  it('예제 안내는 단계가 있고 제목이 겹치지 않는다', () => {
    expect(new Set(EXAMPLE_GUIDES.map((g) => g.title)).size).toBe(EXAMPLE_GUIDES.length)
    for (const g of EXAMPLE_GUIDES) expect(g.steps.length, g.title).toBeGreaterThanOrEqual(3)
  })

  it('모든 도움말 주제에 이름이 있다', () => {
    for (const t of HELP_TOPICS) expect(HELP_TOPIC_LABELS[t], t).toBeTruthy()
  })
})

describe('searchGlossary', () => {
  it('빈 검색어는 전부', () => {
    expect(searchGlossary('')).toHaveLength(GLOSSARY.length)
    expect(searchGlossary('   ')).toHaveLength(GLOSSARY.length)
  })

  it('이름·약어·풀이에서 대소문자 없이 찾는다', () => {
    expect(searchGlossary('cpi').some((t) => t.alias === 'CPI')).toBe(true)
    expect(searchGlossary('시드').some((t) => t.term === '난수 시드')).toBe(true)
    expect(searchGlossary('p80').length).toBeGreaterThan(0)
  })

  it('낱말이 모두 들어 있어야 한다', () => {
    const hits = searchGlossary('보고일 재예측')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((t) => `${t.term}${t.alias ?? ''}${t.meaning}`.includes('재예측') && `${t.term}${t.alias ?? ''}${t.meaning}`.includes('보고일'))).toBe(true)
    expect(searchGlossary('존재하지않는용어xyz')).toEqual([])
  })
})
