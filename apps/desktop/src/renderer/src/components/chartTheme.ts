import { useEffect, useState } from 'react'
import { resolveDark } from '../lib/theme'
import { useSettingsStore } from '../stores/settingsStore'

/** 차트를 어둡게 그려야 하는지: 설정의 테마를 따르고, `system`이면 운영체제 설정을 따른다. */
export function useDarkMode(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return resolveDark(theme, systemDark)
}

export function chartPalette(dark: boolean) {
  return {
    text: dark ? '#d8d8d8' : '#333333',
    axis: dark ? '#6b6b6b' : '#999999',
    grid: dark ? '#3a3a3a' : '#e3e3e3',
    // 모델 실행(실선, 색상)과 구분되도록 기준 행동은 점선 + 점 표시, 무채색에 가까운 색을 쓴다.
    refs: dark ? ['#f2f2f2', '#d9b38c', '#b8a9e0'] : ['#1a1a1a', '#8b4513', '#4b0082']
  }
}
