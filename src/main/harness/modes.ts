import type { ModelId } from '@config/models.js'
import { DEFAULT_MODELS } from '@config/models.js'
import { ARCHITECT_SYSTEM } from './prompts/architect.js'
import { TUTOR_SYSTEM } from './prompts/tutor.js'
import { MODULE_SUMMARY_SYSTEM, STATE_SUMMARY_SYSTEM } from './prompts/summarizer.js'
import { ASSESSOR_SYSTEM, GRADER_SYSTEM } from './prompts/assessor.js'
import { CARD_SMITH_SYSTEM } from './prompts/cardSmith.js'

/**
 * The five operating modes. Each is a system prompt + an allowed tool set +
 * a default model. Keeping them in one table makes the cost profile of the
 * whole app legible at a glance.
 */

export type ModeName =
  | 'architect'
  | 'tutor'
  | 'assessor'
  | 'grader'
  | 'cardSmith'
  | 'stateSummary'
  | 'moduleSummary'

export interface Mode {
  system: string
  tools: readonly string[]
  model: ModelId
  maxTokens: number
}

export const MODES: Record<ModeName, Mode> = {
  architect: {
    system: ARCHITECT_SYSTEM,
    tools: ['propose_curriculum'],
    model: DEFAULT_MODELS.architect,
    maxTokens: 8192
  },
  tutor: {
    system: TUTOR_SYSTEM,
    tools: ['mark_objective', 'suggest_note', 'render_visual', 'propose_quiz'],
    model: DEFAULT_MODELS.tutor,
    maxTokens: 4096
  },
  assessor: {
    system: ASSESSOR_SYSTEM,
    tools: ['generate_quiz'],
    model: DEFAULT_MODELS.assessor,
    maxTokens: 8192
  },
  grader: {
    // Grades one free-text answer. Cheap model, tiny output.
    system: GRADER_SYSTEM,
    tools: [],
    model: DEFAULT_MODELS.cardSmith,
    maxTokens: 512
  },
  cardSmith: {
    system: CARD_SMITH_SYSTEM,
    tools: ['generate_flashcards'],
    model: DEFAULT_MODELS.cardSmith,
    maxTokens: 8192
  },
  stateSummary: {
    system: STATE_SUMMARY_SYSTEM,
    tools: [],
    model: DEFAULT_MODELS.summarizer,
    maxTokens: 1024
  },
  moduleSummary: {
    system: MODULE_SUMMARY_SYSTEM,
    tools: [],
    model: DEFAULT_MODELS.summarizer,
    maxTokens: 1536
  }
}
