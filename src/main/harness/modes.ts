import { ARCHITECT_SYSTEM } from './prompts/architect.js'
import { TUTOR_SYSTEM } from './prompts/tutor.js'
import { MODULE_SUMMARY_SYSTEM, STATE_SUMMARY_SYSTEM } from './prompts/summarizer.js'
import { ASSESSOR_SYSTEM, GRADER_SYSTEM } from './prompts/assessor.js'
import { CARD_SMITH_SYSTEM } from './prompts/cardSmith.js'

/**
 * The operating modes. Each is a system prompt + an allowed tool set + which
 * of the learner's two configured models it runs on.
 *
 * `role` keeps the cost profile of the whole app legible: only the tutor and
 * the assessor use the model the learner chose for teaching; everything else
 * runs on the cheap background model, whatever provider that happens to be.
 */

/** Which configured model a mode runs on. */
export type ModelRole = 'tutor' | 'background'

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
  role: ModelRole
  maxTokens: number
}

export const MODES: Record<ModeName, Mode> = {
  architect: {
    system: ARCHITECT_SYSTEM,
    tools: ['propose_curriculum'],
    role: 'tutor',
    maxTokens: 8192
  },
  tutor: {
    system: TUTOR_SYSTEM,
    tools: ['mark_objective', 'suggest_note', 'render_visual', 'propose_quiz'],
    role: 'tutor',
    maxTokens: 4096
  },
  assessor: {
    system: ASSESSOR_SYSTEM,
    tools: ['generate_quiz'],
    role: 'tutor',
    maxTokens: 8192
  },
  grader: {
    // Grades one free-text answer. Cheap model, tiny output.
    system: GRADER_SYSTEM,
    tools: [],
    role: 'background',
    maxTokens: 512
  },
  cardSmith: {
    system: CARD_SMITH_SYSTEM,
    tools: ['generate_flashcards'],
    role: 'background',
    maxTokens: 8192
  },
  stateSummary: {
    system: STATE_SUMMARY_SYSTEM,
    tools: [],
    role: 'background',
    maxTokens: 1024
  },
  moduleSummary: {
    system: MODULE_SUMMARY_SYSTEM,
    tools: [],
    role: 'background',
    maxTokens: 1536
  }
}

/** Resolves a mode's role to the `provider:model` the learner configured. */
export function modelForRole(
  role: ModelRole,
  settings: { tutorModel: string; backgroundModel: string }
): string {
  return role === 'tutor' ? settings.tutorModel : settings.backgroundModel
}
