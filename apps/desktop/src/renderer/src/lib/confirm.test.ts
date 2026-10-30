import { afterEach, describe, expect, it, vi } from 'vitest'
import { askConfirm } from './confirm'

afterEach(() => vi.unstubAllGlobals())
const req = { message: '지울까요?', detail: '되돌릴 수 없습니다.', ok: '지우기', cancel: '취소' }

describe('확인 대화상자', () => {
  it('데스크톱 앱에서는 네이티브 대화상자에 버튼 이름과 함께 묻는다', async () => {
    const confirm = vi.fn(async () => true)
    vi.stubGlobal('window', { spd: { dialogs: { confirm } }, confirm: () => false })
    expect(await askConfirm(req)).toBe(true)
    expect(confirm).toHaveBeenCalledWith(req)
    vi.stubGlobal('window', { spd: { dialogs: { confirm: async () => false } } })
    expect(await askConfirm(req)).toBe(false)
  })

  it('대화상자 API가 없으면(브라우저·개발용) window.confirm으로 묻는다(메시지와 설명을 이어서)', async () => {
    const seen: string[] = []
    vi.stubGlobal('window', { confirm: (m: string) => (seen.push(m), true) })
    expect(await askConfirm(req)).toBe(true)
    expect(seen).toEqual(['지울까요?\n되돌릴 수 없습니다.'])
    vi.stubGlobal('window', { spd: {}, confirm: () => false })
    expect(await askConfirm({ message: '확인?', ok: '예', cancel: '아니오' })).toBe(false)
  })
})
