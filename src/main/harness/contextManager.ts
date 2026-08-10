import type Anthropic from '@anthropic-ai/sdk'
import type { Curriculum, Message, Module, Objective } from '@shared/types.js'

/**
 * Assembles the per-turn context and keeps it inside a token budget.
 *
 * Ordering matters for prompt caching: the stable prefix (curriculum goal,
 * module, objectives) comes first, and the volatile tail (running summary,
 * recent transcript) comes last.
 */

/** Rough token estimate. Good enough for budgeting; never used for billing. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6)
}

export interface ContextInput {
  curriculum: Curriculum
  module: Module
  objectives: Objective[]
  noteTitles: string[]
  stateSummary: string | null
}

/**
 * The context block appended to the tutor system prompt. Objective ids are
 * included because mark_objective needs them.
 */
export function buildContextBlock(input: ContextInput): string {
  const { curriculum, module, objectives, noteTitles, stateSummary } = input

  const lines: string[] = []
  lines.push('--- CURRENT CONTEXT ---')
  lines.push(`Curriculum: ${curriculum.title}`)
  lines.push(`Subject: ${curriculum.subject}`)
  lines.push(`Learner's goal: ${curriculum.goal}`)
  lines.push(`Stated level at intake: ${curriculum.learnerLevel}`)
  lines.push('')
  lines.push(`Current module: ${module.title}`)
  if (module.summary) lines.push(`Module summary: ${module.summary}`)
  lines.push('')

  if (objectives.length > 0) {
    lines.push('Objectives (teach toward the open ones):')
    for (const objective of objectives) {
      const mark = objective.status === 'met' ? 'MET' : 'OPEN'
      lines.push(`  [${mark}] id=${objective.id} — ${objective.text}`)
    }
  } else {
    lines.push('Objectives: none recorded for this module.')
  }
  lines.push('')

  if (noteTitles.length > 0) {
    lines.push("Learner's saved notes for this module (titles only):")
    for (const title of noteTitles) lines.push(`  - ${title}`)
    lines.push('')
  }

  if (stateSummary?.trim()) {
    lines.push('What has been covered so far in this module:')
    lines.push(stateSummary.trim())
  } else {
    lines.push('This is the start of the module. Nothing has been covered yet.')
  }

  lines.push('--- END CONTEXT ---')
  return lines.join('\n')
}

/** Transcript rows converted to SDK messages, dropping tool bookkeeping rows. */
export function toApiMessages(messages: Message[]): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: m.content
    }))
}

export interface BudgetPlan {
  /** Messages to send verbatim this turn. */
  keep: Message[]
  /** Older messages that should be folded into the running summary. */
  fold: Message[]
}

/**
 * Splits the transcript into the part that fits the budget and the part that
 * should be summarized away.
 *
 * Always keeps at least `minKeep` of the most recent messages, even if they
 * exceed the budget — dropping the immediate exchange would break the turn.
 */
export function planBudget(
  messages: Message[],
  budgetTokens: number,
  minKeep = 6
): BudgetPlan {
  if (messages.length <= minKeep) return { keep: messages, fold: [] }

  let used = 0
  let firstKeptIndex = messages.length

  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i]!.content)
    const kept = messages.length - i
    // Honour minKeep even when it blows the budget.
    if (used + cost > budgetTokens && kept > minKeep) break
    used += cost
    firstKeptIndex = i
  }

  return {
    keep: messages.slice(firstKeptIndex),
    fold: messages.slice(0, firstKeptIndex)
  }
}
