import { describe, expect, it } from 'vitest'
import {
  danglingFencePrefix,
  extractToolCalls,
  startsToolBlock,
  toolProtocolPrompt
} from '../src/main/harness/providers/toolEmulation.js'
import type { ToolSpec } from '../src/main/harness/providers/types.js'
import { PROVIDERS } from '../config/providers.js'
import { lookupModel, MODELS, modelRef } from '../config/models.js'

const TOOLS: ToolSpec[] = [
  {
    name: 'mark_objective',
    description: 'Mark an objective met.',
    parameters: {
      type: 'object',
      properties: { objective_id: { type: 'integer' }, evidence: { type: 'string' } },
      required: ['objective_id', 'evidence']
    }
  },
  {
    name: 'suggest_note',
    description: 'Offer a note.',
    parameters: { type: 'object', properties: { title: { type: 'string' } } }
  }
]

describe('toolProtocolPrompt', () => {
  it('is empty when there are no tools', () => {
    expect(toolProtocolPrompt([])).toBe('')
  })

  it('names every tool and includes its schema', () => {
    const prompt = toolProtocolPrompt(TOOLS)
    expect(prompt).toContain('mark_objective')
    expect(prompt).toContain('suggest_note')
    expect(prompt).toContain('objective_id')
    expect(prompt).toContain('lyceum-tool')
  })
})

describe('extractToolCalls', () => {
  it('returns prose untouched when there are no calls', () => {
    const result = extractToolCalls('Just teaching, no actions.', TOOLS)
    expect(result.text).toBe('Just teaching, no actions.')
    expect(result.calls).toEqual([])
  })

  it('pulls a call out and hides the block from the learner', () => {
    const reply = `Good, you have it.

\`\`\`lyceum-tool
{"tool": "mark_objective", "input": {"objective_id": 12, "evidence": "Derived it unaided"}}
\`\`\``
    const result = extractToolCalls(reply, TOOLS)
    expect(result.text).toBe('Good, you have it.')
    expect(result.text).not.toContain('lyceum-tool')
    expect(result.calls).toEqual([
      {
        name: 'mark_objective',
        input: { objective_id: 12, evidence: 'Derived it unaided' }
      }
    ])
  })

  it('handles several calls in one reply', () => {
    const reply = `Text.
\`\`\`lyceum-tool
{"tool": "mark_objective", "input": {"objective_id": 1, "evidence": "a"}}
\`\`\`
More text.
\`\`\`lyceum-tool
{"tool": "suggest_note", "input": {"title": "Chain rule"}}
\`\`\``
    const result = extractToolCalls(reply, TOOLS)
    expect(result.calls).toHaveLength(2)
    expect(result.calls[1]!.name).toBe('suggest_note')
    expect(result.text).toContain('More text.')
  })

  it('drops a call to a tool that was not offered', () => {
    const reply = `\`\`\`lyceum-tool
{"tool": "delete_everything", "input": {}}
\`\`\``
    const result = extractToolCalls(reply, TOOLS)
    expect(result.calls).toEqual([])
  })

  it('drops malformed JSON but still hides the block', () => {
    const reply = `Hello.
\`\`\`lyceum-tool
{"tool": "mark_objective", "input": {oops
\`\`\``
    const result = extractToolCalls(reply, TOOLS)
    expect(result.calls).toEqual([])
    expect(result.text).toBe('Hello.')
    expect(result.text).not.toContain('oops')
  })

  it('defaults missing input to an empty object', () => {
    const reply = `\`\`\`lyceum-tool
{"tool": "suggest_note"}
\`\`\``
    expect(extractToolCalls(reply, TOOLS).calls).toEqual([
      { name: 'suggest_note', input: {} }
    ])
  })

  it('never throws on hostile input', () => {
    for (const bad of ['```lyceum-tool```', '```lyceum-tool\nnull\n```', '']) {
      expect(() => extractToolCalls(bad, TOOLS)).not.toThrow()
    }
  })
})

describe('streaming fence detection', () => {
  it('detects a started tool block', () => {
    expect(startsToolBlock('Some text ```lyceum-tool')).toBe(true)
    expect(startsToolBlock('Some ordinary text')).toBe(false)
  })

  it('holds back a partial fence so raw JSON never reaches the learner', () => {
    // A chunk boundary can land mid-marker; those characters must not stream.
    // '```lyce' is a 7-character prefix of the 14-character marker.
    expect(danglingFencePrefix('teaching ```lyce')).toBe(7)
    expect(danglingFencePrefix('teaching `')).toBe(1)
    expect(danglingFencePrefix('teaching')).toBe(0)
    expect(danglingFencePrefix('done ```lyceum-tool')).toBe(14)
  })

  it('does not hold back ordinary backticks mid-sentence', () => {
    expect(danglingFencePrefix('use `grep` here')).toBe(0)
  })
})

describe('provider catalog', () => {
  it('gives every provider a base URL unless it is editable', () => {
    for (const provider of Object.values(PROVIDERS)) {
      if (provider.kind === 'anthropic') continue
      expect(
        provider.defaultBaseUrl !== null || provider.baseUrlEditable,
        `${provider.id} has no way to resolve an endpoint`
      ).toBe(true)
    }
  })

  it('only marks a provider keyless when it is genuinely local', () => {
    for (const provider of Object.values(PROVIDERS)) {
      if (provider.auth === 'none') {
        expect(provider.defaultBaseUrl ?? '').toMatch(/localhost|127\.0\.0\.1/)
      }
    }
  })

  it('points every catalog model at a known provider', () => {
    for (const model of Object.values(MODELS)) {
      expect(PROVIDERS[model.provider], `${model.provider} is not a provider`).toBeDefined()
    }
  })

  it('prices local models at zero', () => {
    for (const model of Object.values(MODELS)) {
      if (model.provider === 'ollama') {
        expect(model.inputPer1M).toBe(0)
        expect(model.outputPer1M).toBe(0)
      }
    }
  })

  it('only claims effort and adaptive thinking for Anthropic models', () => {
    // Both are Anthropic-specific parameters; sending them elsewhere is a 400.
    for (const model of Object.values(MODELS)) {
      if (model.provider !== 'anthropic') {
        expect(model.capabilities.effort).toBe(false)
        expect(model.capabilities.adaptiveThinking).toBe(false)
      }
    }
  })

  it('round-trips a reference through the catalog', () => {
    const ref = modelRef('anthropic', 'claude-sonnet-5')
    expect(lookupModel(ref).label).toBe('Claude Sonnet 5')
  })
})
