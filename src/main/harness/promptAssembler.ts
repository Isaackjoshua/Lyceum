import type Anthropic from '@anthropic-ai/sdk'
import type { Curriculum, Message, Module, Objective } from '@shared/types.js'
import { buildContextBlock, planBudget, toApiMessages } from './contextManager.js'
import { MODES } from './modes.js'

/**
 * Composes the request for a tutor turn: the system prompt (stable prefix +
 * per-turn context block) and the messages array.
 */

export interface TutorRequestInput {
  curriculum: Curriculum
  module: Module
  objectives: Objective[]
  noteTitles: string[]
  stateSummary: string | null
  transcript: Message[]
  /** Token budget for the verbatim transcript tail. */
  transcriptBudget: number
}

export interface AssembledRequest {
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  /** Messages that fell outside the budget and want summarizing. */
  overflow: Message[]
}

export function assembleTutorRequest(input: TutorRequestInput): AssembledRequest {
  const { keep, fold } = planBudget(input.transcript, input.transcriptBudget)

  return {
    // Two blocks: the frozen pedagogy (cacheable across every turn of every
    // session) followed by the volatile per-turn context.
    system: [
      { type: 'text', text: MODES.tutor.system, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: buildContextBlock({
          curriculum: input.curriculum,
          module: input.module,
          objectives: input.objectives,
          noteTitles: input.noteTitles,
          stateSummary: input.stateSummary
        })
      }
    ],
    messages: toApiMessages(keep),
    overflow: fold
  }
}

/** The architect conversation is short and pre-save; no context block needed. */
export function assembleArchitectRequest(
  messages: { role: 'user' | 'assistant'; content: string }[]
): { system: Anthropic.TextBlockParam[]; messages: Anthropic.MessageParam[] } {
  return {
    system: [
      { type: 'text', text: MODES.architect.system, cache_control: { type: 'ephemeral' } }
    ],
    messages: messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }))
  }
}
