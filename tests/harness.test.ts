import { describe, expect, it } from 'vitest'
import type { Curriculum, Message, Module, Objective } from '../src/shared/types.js'
import {
  buildContextBlock,
  estimateTokens,
  planBudget,
  toApiMessages
} from '../src/main/harness/contextManager.js'
import { parseProposal } from '../src/main/services/architect.js'

const message = (id: number, role: Message['role'], content: string): Message => ({
  id,
  sessionId: 1,
  role,
  content,
  meta: null,
  createdAt: id
})

const curriculum: Curriculum = {
  id: 1,
  title: 'Backpropagation from scratch',
  subject: 'Machine learning',
  goal: 'Implement backprop without a framework',
  learnerLevel: 'intermediate',
  status: 'active',
  createdAt: 0,
  updatedAt: 0
}

const module: Module = {
  id: 7,
  curriculumId: 1,
  title: 'The chain rule',
  summary: 'Composing derivatives',
  estMinutes: 45,
  orderIndex: 0,
  status: 'in_progress',
  mastery: 0,
  createdAt: 0,
  updatedAt: 0
}

const objectives: Objective[] = [
  { id: 11, moduleId: 7, text: 'State the chain rule', orderIndex: 0, status: 'met' },
  { id: 12, moduleId: 7, text: 'Apply it to a composition', orderIndex: 1, status: 'open' }
]

describe('planBudget', () => {
  it('keeps everything when the transcript is short', () => {
    const messages = [message(1, 'user', 'hi'), message(2, 'assistant', 'hello')]
    const plan = planBudget(messages, 10_000)
    expect(plan.keep).toHaveLength(2)
    expect(plan.fold).toHaveLength(0)
  })

  it('folds the oldest turns once the budget is exceeded', () => {
    const messages = Array.from({ length: 30 }, (_, i) =>
      message(i + 1, i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(400))
    )
    const plan = planBudget(messages, 500)

    expect(plan.fold.length).toBeGreaterThan(0)
    expect(plan.keep.length + plan.fold.length).toBe(messages.length)
    // The split preserves order: folded turns all precede kept ones.
    expect(plan.fold.at(-1)!.id).toBeLessThan(plan.keep[0]!.id)
  })

  it('never drops the most recent exchange, even on a tiny budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      message(i + 1, 'user', 'y'.repeat(5000))
    )
    const plan = planBudget(messages, 1, 6)
    expect(plan.keep).toHaveLength(6)
    expect(plan.keep.at(-1)!.id).toBe(20)
  })

  it('keeps everything when there are fewer messages than the minimum', () => {
    const messages = [message(1, 'user', 'z'.repeat(100_000))]
    expect(planBudget(messages, 1).fold).toHaveLength(0)
  })
})

describe('buildContextBlock', () => {
  const block = buildContextBlock({
    curriculum,
    module,
    objectives,
    noteTitles: ['Chain rule statement'],
    stateSummary: 'Learner derived d/dx sin(x^2) correctly.'
  })

  it('carries objective ids so mark_objective can reference them', () => {
    expect(block).toContain('id=11')
    expect(block).toContain('id=12')
  })

  it('distinguishes met from open objectives', () => {
    expect(block).toMatch(/\[MET\].*State the chain rule/)
    expect(block).toMatch(/\[OPEN\].*Apply it to a composition/)
  })

  it('includes the goal, module and running summary', () => {
    expect(block).toContain('Implement backprop without a framework')
    expect(block).toContain('The chain rule')
    expect(block).toContain('derived d/dx sin(x^2)')
  })

  it('carries note titles but never note bodies', () => {
    expect(block).toContain('Chain rule statement')
  })

  it('says so plainly when the module has not started', () => {
    const fresh = buildContextBlock({
      curriculum,
      module,
      objectives,
      noteTitles: [],
      stateSummary: null
    })
    expect(fresh).toContain('This is the start of the module')
  })
})

describe('toApiMessages', () => {
  it('drops tool rows and empty content', () => {
    const messages = [
      message(1, 'user', 'question'),
      message(2, 'tool', 'objective marked'),
      message(3, 'assistant', '   '),
      message(4, 'assistant', 'answer')
    ]
    expect(toApiMessages(messages)).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' }
    ])
  })
})

describe('estimateTokens', () => {
  it('grows with length and never returns zero for real text', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('hello')).toBeGreaterThan(0)
    expect(estimateTokens('x'.repeat(3600))).toBeGreaterThan(estimateTokens('x'.repeat(360)))
  })
})

describe('parseProposal', () => {
  const valid = {
    title: 'Backprop from scratch',
    subject: 'ML',
    goal: 'Implement it',
    learner_level: 'intermediate',
    modules: [
      {
        title: 'The chain rule',
        summary: 'Composing derivatives',
        est_minutes: 45,
        objectives: ['State it', 'Apply it']
      }
    ]
  }

  it('maps snake_case tool input to the app shape', () => {
    const proposal = parseProposal(valid)
    expect(proposal).not.toBeNull()
    expect(proposal!.learnerLevel).toBe('intermediate')
    expect(proposal!.modules[0]!.estMinutes).toBe(45)
    expect(proposal!.modules[0]!.objectives).toEqual(['State it', 'Apply it'])
  })

  it('falls back to beginner on an unknown level', () => {
    expect(parseProposal({ ...valid, learner_level: 'wizard' })!.learnerLevel).toBe(
      'beginner'
    )
  })

  it('returns null without a title or modules', () => {
    expect(parseProposal({ ...valid, title: '' })).toBeNull()
    expect(parseProposal({ ...valid, modules: [] })).toBeNull()
    expect(parseProposal({})).toBeNull()
  })

  it('skips malformed modules rather than failing the whole proposal', () => {
    const proposal = parseProposal({
      ...valid,
      modules: [{ title: '' }, null, 'nonsense', valid.modules[0]]
    })
    expect(proposal!.modules).toHaveLength(1)
    expect(proposal!.modules[0]!.title).toBe('The chain rule')
  })

  it('drops non-string objectives and negative time estimates', () => {
    const proposal = parseProposal({
      ...valid,
      modules: [{ title: 'M', objectives: ['ok', 42, null, ''], est_minutes: -10 }]
    })
    expect(proposal!.modules[0]!.objectives).toEqual(['ok'])
    expect(proposal!.modules[0]!.estMinutes).toBeUndefined()
  })
})
