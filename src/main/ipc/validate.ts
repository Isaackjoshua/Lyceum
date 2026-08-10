import type { Settings } from '@shared/types.js'
import { MODELS } from '@config/models.js'

/**
 * Input validation for values crossing the IPC boundary.
 *
 * The renderer is treated as untrusted: every field is checked for type and
 * range here before it reaches the database. Kept free of Electron imports so
 * it can be unit tested directly.
 */

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}

export type SettingsPatch = Partial<Omit<Settings, 'keyPresent'>>

export function sanitiseSettingsPatch(input: unknown): SettingsPatch {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Settings patch must be an object.')
  }
  const raw = input as Record<string, unknown>
  const patch: SettingsPatch = {}

  if (raw.tutorModel !== undefined) {
    const model = requireString(raw.tutorModel, 'tutorModel')
    if (!(model in MODELS)) throw new Error(`Unknown model: ${model}`)
    patch.tutorModel = model
  }

  if (raw.maxTokens !== undefined) {
    const n = Number(raw.maxTokens)
    if (!Number.isFinite(n) || n < 256 || n > 32_000) {
      throw new Error('maxTokens must be between 256 and 32000.')
    }
    patch.maxTokens = Math.round(n)
  }

  if (raw.effort !== undefined) {
    const effort = requireString(raw.effort, 'effort')
    if (!['low', 'medium', 'high'].includes(effort)) {
      throw new Error('effort must be low, medium or high.')
    }
    patch.effort = effort as Settings['effort']
  }

  if (raw.theme !== undefined) {
    const theme = requireString(raw.theme, 'theme')
    if (!['light', 'dark', 'system'].includes(theme)) {
      throw new Error('theme must be light, dark or system.')
    }
    patch.theme = theme as Settings['theme']
  }

  if (raw.fontScale !== undefined) {
    const n = Number(raw.fontScale)
    if (!Number.isFinite(n) || n < 12 || n > 24) {
      throw new Error('fontScale must be between 12 and 24.')
    }
    patch.fontScale = Math.round(n)
  }

  if (raw.spendCapUsd !== undefined) {
    const n = Number(raw.spendCapUsd)
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      throw new Error('spendCapUsd must be a non-negative number.')
    }
    patch.spendCapUsd = n
  }

  if (raw.spendCapBlocks !== undefined) {
    patch.spendCapBlocks = Boolean(raw.spendCapBlocks)
  }

  return patch
}
