import type { ModelId } from '@config/models.js'
import { DEFAULT_MODELS } from '@config/models.js'
import { ARCHITECT_SYSTEM } from './prompts/architect.js'
import { TUTOR_SYSTEM } from './prompts/tutor.js'
import { MODULE_SUMMARY_SYSTEM, STATE_SUMMARY_SYSTEM } from './prompts/summarizer.js'

/**
 * The five operating modes. Each is a system prompt + an allowed tool set +
 * a default model. Keeping them in one table makes the cost profile of the
 * whole app legible at a glance.
 */

export type ModeName =
  | 'architect'
  | 'tutor'
  | 'assessor'
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
    // render_visual, suggest_note and propose_quiz are implemented in the
    // registry but stay switched off until Phase 2 ships the UI that renders
    // them. Offering a tool whose result the app would silently drop would
    // make the tutor look broken.
    tools: ['mark_objective'],
    model: DEFAULT_MODELS.tutor,
    maxTokens: 4096
  },
  assessor: {
    // Phase 2.
    system: '',
    tools: ['generate_quiz'],
    model: DEFAULT_MODELS.assessor,
    maxTokens: 4096
  },
  cardSmith: {
    // Phase 2.
    system: '',
    tools: ['generate_flashcards'],
    model: DEFAULT_MODELS.cardSmith,
    maxTokens: 4096
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
