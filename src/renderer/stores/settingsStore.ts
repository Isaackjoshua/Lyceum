import { create } from 'zustand'
import type { KeyStatus, Settings } from '@shared/types'

interface SettingsState {
  settings: Settings | null
  keyStatus: KeyStatus | null
  loading: boolean
  error: string | null
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
  refreshKeyStatus: () => Promise<void>
}

/** Applies theme + font scale to the document root. */
export function applyAppearance(settings: Settings): void {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  root.classList.toggle('dark', dark)
  root.style.fontSize = `${settings.fontScale}px`
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  keyStatus: null,
  loading: true,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    const [settingsResult, keyResult] = await Promise.all([
      window.api.settings.get(),
      window.api.key.getStatus()
    ])

    if (!settingsResult.ok) {
      set({ loading: false, error: settingsResult.error })
      return
    }
    applyAppearance(settingsResult.data)
    set({
      settings: settingsResult.data,
      keyStatus: keyResult.ok ? keyResult.data : null,
      loading: false,
      error: keyResult.ok ? null : keyResult.error
    })
  },

  update: async (patch) => {
    const result = await window.api.settings.update(patch)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    applyAppearance(result.data)
    set({ settings: result.data, error: null })
  },

  refreshKeyStatus: async () => {
    const result = await window.api.key.getStatus()
    if (result.ok) {
      const settings = get().settings
      set({
        keyStatus: result.data,
        settings: settings ? { ...settings, keyPresent: result.data.present } : settings
      })
    }
  }
}))
