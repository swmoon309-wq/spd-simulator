import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, loadCachedTheme } from './lib/theme'
import './styles.css'

// 저장된 설정을 읽어 오기 전에도 마지막으로 쓴 테마로 그려 화면이 깜빡이지 않게 한다.
applyTheme(loadCachedTheme() ?? 'system')

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
