import type { Settings } from '@shared/types.js'
import { DEFAULT_MAX_TOKENS, DEFAULT_MODELS } from '@config/models.js'
import { getDatabase } from '../index.js'

const DEFAULTS: Omit<Settings, 'keyPresent'> = {
  tutorModel: DEFAULT_MODELS.tutor,
  maxTokens: DEFAULT_MAX_TOKENS,
  effort: 'medium',
  theme: 'system',
  fontScale: 16,
  spendCapUsd: 0,
  spendCapBlocks: false
}

/** Reads all settings, falling back to defaults for anything unset. */
export function readSettings(): Omit<Settings, 'keyPresent'> {
  const rows = getDatabase()
    .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
    .all()

  const stored = new Map(rows.map((r) => [r.key, r.value]))
  const get = <K extends keyof typeof DEFAULTS>(key: K): (typeof DEFAULTS)[K] => {
    const raw = stored.get(key)
    if (raw === undefined) return DEFAULTS[key]
    try {
      return JSON.parse(raw) as (typeof DEFAULTS)[K]
    } catch {
      return DEFAULTS[key]
    }
  }

  return {
    tutorModel: get('tutorModel'),
    maxTokens: get('maxTokens'),
    effort: get('effort'),
    theme: get('theme'),
    fontScale: get('fontScale'),
    spendCapUsd: get('spendCapUsd'),
    spendCapBlocks: get('spendCapBlocks')
  }
}

export function writeSettings(patch: Partial<Omit<Settings, 'keyPresent'>>): void {
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
