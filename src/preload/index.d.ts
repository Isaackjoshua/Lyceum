import type { LyceumApi } from '@shared/types.js'

declare global {
  interface Window {
    api: LyceumApi
  }
}

export {}
