import { describe, expect, it } from 'vitest'
import { sanitiseSettingsPatch } from '../src/main/ipc/validate.js'
import { estimateCost, MODELS, TUTOR_MODEL_CHOICES } from '../config/models.js'

describe('sanitiseSettingsPatch', () => {
  it('passes through valid values', () => {
    expect(
      sanitiseSettingsPatch({
        tutorModel: 'claude-opus-5',
        maxTokens: 4096,
        effort: 'high',
        theme: 'dark',
        fontScale: 18,
        spendCapUsd: 25,
        spendCapBlocks: true
      })
    ).toEqual({
      tutorModel: 'claude-opus-5',
      maxTokens: 4096,
      effort: 'high',
      theme: 'dark',
      fontScale: 18,
      spendCapUsd: 25,
      spendCapBlocks: true
    })
  })

  it('drops keys that were not supplied', () => {
    expect(sanitiseSettingsPatch({ theme: 'light' })).toEqual({ theme: 'light' })
  })

  it('ignores unknown keys rather than writing them', () => {
    const patch = sanitiseSettingsPatch({ theme: 'light', apiKey: 'sk-ant-oops' })
    expect(patch).toEqual({ theme: 'light' })
    expect(Object.keys(patch)).not.toContain('apiKey')
  })

  it('rejects non-object payloads', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => sanitiseSettingsPatch(bad)).toThrow(/must be an object/)
    }
  })

  it('rejects an unknown model', () => {
    expect(() => sanitiseSettingsPatch({ tutorModel: 'gpt-4' })).toThrow(/Unknown model/)
  })

  it('rejects out-of-range numbers', () => {
    expect(() => sanitiseSettingsPatch({ maxTokens: 12 })).toThrow(/maxTokens/)
    expect(() => sanitiseSettingsPatch({ maxTokens: 999_999 })).toThrow(/maxTokens/)
    expect(() => sanitiseSettingsPatch({ fontScale: 400 })).toThrow(/fontScale/)
    expect(() => sanitiseSettingsPatch({ spendCapUsd: -5 })).toThrow(/spendCapUsd/)
    expect(() => sanitiseSettingsPatch({ maxTokens: Number.NaN })).toThrow(/maxTokens/)
  })

  it('rejects invalid enum values', () => {
    expect(() => sanitiseSettingsPatch({ effort: 'maximum' })).toThrow(/effort/)
    expect(() => sanitiseSettingsPatch({ theme: 'sepia' })).toThrow(/theme/)
  })

  it('coerces truthiness for the boolean flag', () => {
    expect(sanitiseSettingsPatch({ spendCapBlocks: 1 })).toEqual({ spendCapBlocks: true })
    expect(sanitiseSettingsPatch({ spendCapBlocks: 0 })).toEqual({ spendCapBlocks: false })
  })
})

describe('model catalog', () => {
  it('lists only known models as tutor choices', () => {
    for (const id of TUTOR_MODEL_CHOICES) expect(MODELS[id]).toBeDefined()
  })

  it('uses bare model IDs with no date suffix', () => {
    for (const model of Object.values(MODELS)) {
      expect(model.id).not.toMatch(/-\d{8}$/)
    }
  })

  it('estimates cost from per-million rates', () => {
    // Opus 5: $5/M in, $25/M out.
    expect(estimateCost('claude-opus-5', 1_000_000, 0)).toBeCloseTo(5)
    expect(estimateCost('claude-opus-5', 0, 1_000_000)).toBeCloseTo(25)
    expect(estimateCost('claude-opus-5', 500_000, 100_000)).toBeCloseTo(2.5 + 2.5)
  })

  it('returns zero for an unknown model rather than throwing', () => {
    expect(estimateCost('nonexistent', 1_000_000, 1_000_000)).toBe(0)
  })
})
