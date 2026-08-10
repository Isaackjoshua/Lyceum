import { create } from 'zustand'
import type {
  KeyStatus,
  ProviderCatalog,
  ProviderConfig,
  Settings
} from '@shared/types'

interface SettingsState {
  settings: Settings | null
  /** Key status per provider id. */
  keys: Record<string, KeyStatus>
  catalog: ProviderCatalog | null
  loading: boolean
  error: string | null

  load: () => Promise<void>
  update: (patch: Partial<Settings>) => Promise<void>
  refreshKeys: () => Promise<void>
  setProviderConfig: (
    provider: string,
    patch: Partial<ProviderConfig>
  ) => Promise<void>
}

/** Applies theme + font scale to the document root. */
export function applyAppearance(settings: Settings): void {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
  root.classList.toggle('dark', dark)
  root.style.fontSize = `${settings.fontScale}px`
}

const byProvider = (statuses: KeyStatus[]): Record<string, KeyStatus> =>
  Object.fromEntries(statuses.map((s) => [s.provider, s]))

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  keys: {},
  catalog: null,
  loading: true,
  error: null,

  load: async () => {
    set({ loading: true, error: null })
    const [settingsResult, keyResult, catalogResult] = await Promise.all([
      window.api.settings.get(),
      window.api.key.getStatus(),
      window.api.providers.list()
    ])

    if (!settingsResult.ok) {
      set({ loading: false, error: settingsResult.error })
      return
    }
    applyAppearance(settingsResult.data)
    set({
      settings: settingsResult.data,
      keys: keyResult.ok ? byProvider(keyResult.data) : {},
      catalog: catalogResult.ok ? catalogResult.data : null,
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

  refreshKeys: async () => {
    const [keyResult, settingsResult] = await Promise.all([
      window.api.key.getStatus(),
      window.api.settings.get()
    ])
    set({
      ...(keyResult.ok ? { keys: byProvider(keyResult.data) } : {}),
      ...(settingsResult.ok ? { settings: settingsResult.data } : {})
    })
  },

  setProviderConfig: async (provider, patch) => {
    const result = await window.api.providers.setConfig(provider, patch)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    // The catalog derives from provider config, so reload it.
    const catalog = await window.api.providers.list()
    const settings = get().settings
    set({
      catalog: catalog.ok ? catalog.data : get().catalog,
      settings: settings
        ? { ...settings, providers: { ...settings.providers, [provider]: result.data } }
        : settings,
      error: null
    })
  }
}))
