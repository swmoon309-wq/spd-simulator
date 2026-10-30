import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** 탭이 바뀌면 오류 상태를 버리도록 탭 이름을 key로도 넘긴다. */
  tabLabel: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 한 탭의 그리기 오류가 앱 전체를 비우지 않도록 그 탭만 안내 문구로 바꾼다. */
export class TabErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.tabLabel}] 화면 오류`, error, info.componentStack)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="tabpanel" role="alert">
        <h2>{this.props.tabLabel} 화면을 표시하지 못했습니다</h2>
        <p>이 탭에서 오류가 났습니다. 다른 탭은 그대로 쓸 수 있고, 프로젝트 데이터는 바뀌지 않았습니다.</p>
        <pre>{error.message}</pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          다시 시도
        </button>
      </div>
    )
  }
}
