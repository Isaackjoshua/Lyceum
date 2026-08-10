import type { Curriculum, Message, Module, Objective } from '@shared/types.js'
import { buildContextBlock, planBudget, toApiMessages } from './contextManager.js'
import { MODES } from './modes.js'
import type { ChatMessage } from './providers/types.js'

/**
 * Composes the request for a tutor turn: the system prompt (stable prefix +
 * per-turn context block) and the messages array.
 *
 * Output is provider-neutral. The system prompt is returned as blocks so a
 * provider that supports prompt caching can put a breakpoint after the stable
 * first block; providers that do not simply join them.
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
  system: string[]
  messages: ChatMessage[]
  /** Messages that fell outside the budget and want summarizing. */
  overflow: Message[]
}

export function assembleTutorRequest(input: TutorRequestInput): AssembledRequest {
  const { keep, fold } = planBudget(input.transcript, input.transcriptBudget)

  return {
    // Block 0 is the frozen pedagogy — identical across every turn of every
    // session, and therefore the natural cache breakpoint. Block 1 is the
    // volatile per-turn context.
    system: [
      MODES.tutor.system,
      buildContextBlock({
        curriculum: input.curriculum,
        module: input.module,
        objectives: input.objectives,
        noteTitles: input.noteTitles,
        stateSummary: input.stateSummary
      })
    ],
    messages: toApiMessages(keep),
    overflow: fold
  }
}

/** The architect conversation is short and pre-save; no context block needed. */
export function assembleArchitectRequest(
  messages: { role: 'user' | 'assistant'; content: string }[]
): { system: string[]; messages: ChatMessage[] } {
  return {
    system: [MODES.architect.system],
    messages: messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }))
  }
}
