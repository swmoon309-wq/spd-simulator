import type { SpdApi } from '../../shared/ipc'

declare global {
  interface Window {
    /** Electron 앱에서만 있다. 브라우저 미리보기에는 없다. */
    spd?: SpdApi
  }
}

export {}
