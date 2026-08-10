import type { ProviderConfig, Settings } from '@shared/types.js'
import {
  DEFAULT_BACKGROUND_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TUTOR_MODEL
} from '@config/models.js'
import { PROVIDERS } from '@config/providers.js'
import { getDatabase } from '../index.js'

type StoredSettings = Omit<Settings, 'keyPresent' | 'providers'>

const DEFAULTS: StoredSettings = {
  tutorModel: DEFAULT_TUTOR_MODEL,
  backgroundModel: DEFAULT_BACKGROUND_MODEL,
  maxTokens: DEFAULT_MAX_TOKENS,
  effort: 'medium',
  theme: 'system',
  fontScale: 16,
  spendCapUsd: 0,
  spendCapBlocks: false
}

/** Per-provider settings key, e.g. `provider.ollama`. */
function providerKey(provider: string): string {
  return `provider.${provider}`
}

function readRaw(): Map<string, string> {
  const rows = getDatabase()
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
    .all()
  return new Map(rows.map((r) => [r.key, r.value]))
}

function parse<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Settings written before multi-provider support stored a bare Anthropic model
 * id. Normalising on read means an existing install upgrades silently instead
 * of falling through to the unknown-model path and losing its pricing.
 */
function normaliseModelRef(ref: string): string {
  return ref.includes(':') ? ref : `anthropic:${ref}`
}

/** Reads all settings, falling back to defaults for anything unset. */
export function readSettings(): StoredSettings {
  const stored = readRaw()
  const get = <K extends keyof StoredSettings>(key: K): StoredSettings[K] =>
    parse(stored.get(key), DEFAULTS[key])

  return {
    tutorModel: normaliseModelRef(get('tutorModel')),
    backgroundModel: normaliseModelRef(get('backgroundModel')),
    maxTokens: get('maxTokens'),
    effort: get('effort'),
    theme: get('theme'),
    fontScale: get('fontScale'),
    spendCapUsd: get('spendCapUsd'),
    spendCapBlocks: get('spendCapBlocks')
  }
}

export function writeSettings(patch: Partial<StoredSettings>): void {
  const db = getDatabase()
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const tx = db.transaction((entries: [string, unknown][]) => {
    for (const [key, value] of entries) stmt.run(key, JSON.stringify(value))
  })
  tx(Object.entries(patch).filter(([, v]) => v !== undefined))
}

/* --------------------------------------------------------- provider config */

const EMPTY_CONFIG: ProviderConfig = { baseUrl: '', customModels: [] }

export function readProviderConfig(provider: string): ProviderConfig {
  const stored = readRaw()
  const config = parse<Partial<ProviderConfig>>(stored.get(providerKey(provider)), {})
  return {
    baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
    customModels: Array.isArray(config.customModels)
      ? config.customModels.filter((m): m is string => typeof m === 'string')
      : []
  }
}

export function readAllProviderConfigs(): Record<string, ProviderConfig> {
  const stored = readRaw()
  const out: Record<string, ProviderConfig> = {}
  for (const provider of Object.keys(PROVIDERS)) {
    const config = parse<Partial<ProviderConfig>>(stored.get(providerKey(provider)), {})
    out[provider] = {
      baseUrl: typeof config.baseUrl === 'string' ? config.baseUrl : '',
      customModels: Array.isArray(config.customModels)
        ? config.customModels.filter((m): m is string => typeof m === 'string')
        : []
    }
  }
  return out
}

export function writeProviderConfig(
  provider: string,
  patch: Partial<ProviderConfig>
): ProviderConfig {
  if (!(provider in PROVIDERS)) throw new Error(`Unknown provider: ${provider}`)

  const current = readProviderConfig(provider)
  const next: ProviderConfig = {
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : current.baseUrl,
    customModels:
      patch.customModels !== undefined ? patch.customModels : current.customModels
  }

  getDatabase()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(providerKey(provider), JSON.stringify(next))

  return next
}

export { EMPTY_CONFIG }
