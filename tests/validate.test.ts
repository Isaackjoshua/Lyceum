import { describe, expect, it } from 'vitest'
import {
  sanitiseArchitectMessages,
  sanitiseCurriculumProposal,
  sanitiseNoteArgs,
  sanitiseSettingsPatch
} from '../src/main/ipc/validate.js'
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

describe('sanitiseCurriculumProposal', () => {
  const valid = {
    title: 'Backprop',
    subject: 'ML',
    goal: 'Implement it',
    learnerLevel: 'intermediate',
    modules: [{ title: 'Chain rule', objectives: ['State it'], estMinutes: 45 }]
  }

  it('accepts a well-formed proposal', () => {
    const result = sanitiseCurriculumProposal(valid)
    expect(result.title).toBe('Backprop')
    expect(result.modules).toHaveLength(1)
    expect(result.modules[0]!.estMinutes).toBe(45)
  })

  it('requires a title and at least one module', () => {
    expect(() => sanitiseCurriculumProposal({ ...valid, title: '  ' })).toThrow(/title/i)
    expect(() => sanitiseCurriculumProposal({ ...valid, modules: [] })).toThrow(/module/i)
  })

  it('rejects an unknown learner level', () => {
    expect(() => sanitiseCurriculumProposal({ ...valid, learnerLevel: 'guru' })).toThrow(
      /learner level/i
    )
  })

  it('rejects a module with no title', () => {
    expect(() =>
      sanitiseCurriculumProposal({ ...valid, modules: [{ title: '', objectives: [] }] })
    ).toThrow(/needs a title/i)
  })

  it('caps module and objective counts', () => {
    const many = Array.from({ length: 100 }, () => ({ title: 'M', objectives: [] }))
    expect(() => sanitiseCurriculumProposal({ ...valid, modules: many })).toThrow(
      /too many modules/i
    )

    const objectives = Array.from({ length: 50 }, () => 'o')
    expect(() =>
      sanitiseCurriculumProposal({ ...valid, modules: [{ title: 'M', objectives }] })
    ).toThrow(/too many objectives/i)
  })

  it('falls back to the title when subject and goal are missing', () => {
    const result = sanitiseCurriculumProposal({
      title: 'Only a title',
      learnerLevel: 'novice',
      modules: [{ title: 'M', objectives: [] }]
    })
    expect(result.subject).toBe('Only a title')
    expect(result.goal).toBe('Only a title')
  })
})

describe('sanitiseNoteArgs', () => {
  const valid = { type: 'concept', title: 'Chain rule', content: 'd/dx f(g(x))' }

  it('accepts a minimal note', () => {
    const note = sanitiseNoteArgs(valid)
    expect(note.type).toBe('concept')
    expect(note.moduleId).toBeNull()
    expect(note.tags).toEqual([])
  })

  it('rejects an unknown type', () => {
    expect(() => sanitiseNoteArgs({ ...valid, type: 'vibes' })).toThrow(/note type/i)
  })

  it('requires a title and content', () => {
    expect(() => sanitiseNoteArgs({ ...valid, title: '   ' })).toThrow(/title/i)
    expect(() => sanitiseNoteArgs({ ...valid, content: '' })).toThrow(/content/i)
  })

  it('rejects content beyond the cap', () => {
    expect(() => sanitiseNoteArgs({ ...valid, content: 'x'.repeat(60_000) })).toThrow(
      /too long/i
    )
  })

  it('caps the tag count', () => {
    const tags = Array.from({ length: 50 }, (_, i) => `t${i}`)
    expect(() => sanitiseNoteArgs({ ...valid, tags })).toThrow(/too many tags/i)
  })
})

describe('sanitiseArchitectMessages', () => {
  it('accepts a valid exchange', () => {
    const messages = sanitiseArchitectMessages([
      { role: 'user', content: 'teach me' },
      { role: 'assistant', content: 'what do you know?' }
    ])
    expect(messages).toHaveLength(2)
  })

  it('rejects an empty list and an unknown role', () => {
    expect(() => sanitiseArchitectMessages([])).toThrow(/empty/i)
    expect(() => sanitiseArchitectMessages([{ role: 'system', content: 'x' }])).toThrow(
      /role/i
    )
  })

  it('rejects a runaway conversation', () => {
    const many = Array.from({ length: 200 }, () => ({ role: 'user', content: 'x' }))
    expect(() => sanitiseArchitectMessages(many)).toThrow(/too long/i)
  })
})
