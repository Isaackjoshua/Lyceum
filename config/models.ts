/**
 * Model IDs and pricing — the single source of truth for the app.
 *
 * VERIFIED against the Anthropic model catalog (checked 2026-08-10).
 * Prices are USD per 1,000,000 tokens on the first-party Anthropic API.
 * If Anthropic publishes new models or changes prices, edit ONLY this file.
 *
 * Never append date suffixes to these IDs — the aliases below are complete.
 */

export type ModelId =
  | 'claude-opus-5'
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5'
  | 'claude-opus-4-8'

export interface ModelInfo {
  id: ModelId
  label: string
  /** Context window in tokens. */
  contextWindow: number
  /** Max output tokens per request. */
  maxOutput: number
  /** USD per 1M input tokens. */
  inputPer1M: number
  /** USD per 1M output tokens. */
  outputPer1M: number
  /**
   * Whether `output_config.effort` is accepted. Sending it to a model that
   * does not support it is a 400, so this gates the parameter.
   */
  supportsEffort: boolean
  /** Whether `thinking: { type: 'adaptive' }` is accepted. */
  supportsAdaptiveThinking: boolean
  /** Short note shown in Settings. */
  note: string
}

export const MODELS: Record<ModelId, ModelInfo> = {
  'claude-opus-5': {
    id: 'claude-opus-5',
    label: 'Claude Opus 5',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inputPer1M: 5,
    outputPer1M: 25,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    note: 'Most capable. Best for hard subjects — proofs, deep theory, dense math.'
  },
  'claude-opus-4-8': {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    inputPer1M: 5,
    outputPer1M: 25,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    note: 'Previous-generation Opus. Same price as Opus 5.'
  },
  'claude-sonnet-5': {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    // $2/$10 introductory pricing runs through 2026-08-31; standard is $3/$15.
    inputPer1M: 3,
    outputPer1M: 15,
    supportsEffort: true,
    supportsAdaptiveThinking: true,
    note: 'Balanced default. Near-Opus quality on tutoring at lower cost.'
  },
  'claude-haiku-4-5': {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    contextWindow: 200_000,
    maxOutput: 64_000,
    inputPer1M: 1,
    outputPer1M: 5,
    // Haiku 4.5 predates the effort parameter and rejects it.
    supportsEffort: false,
    supportsAdaptiveThinking: false,
    note: 'Fast and cheap. Used for background work: flashcards and summaries.'
  }
}

/** Models the learner may pick for the live tutoring loop. */
export const TUTOR_MODEL_CHOICES: ModelId[] = [
  'claude-sonnet-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-haiku-4-5'
]

/** Default model per harness mode. Overridable in Settings for the tutor. */
export const DEFAULT_MODELS = {
  /** Topic + diagnostic -> structured curriculum. */
  architect: 'claude-sonnet-5' as ModelId,
  /** The main teaching loop. */
  tutor: 'claude-sonnet-5' as ModelId,
  /** Checkpoint quiz generation and short-answer grading. */
  assessor: 'claude-sonnet-5' as ModelId,
  /** Notes -> flashcards. Background, structured, cheap. */
  cardSmith: 'claude-haiku-4-5' as ModelId,
  /** Rolling state summaries and module summaries. Background, cheap. */
  summarizer: 'claude-haiku-4-5' as ModelId
}

/**
 * Max output tokens per tutor reply. This caps thinking AND response text
 * together, so leave headroom above what the prose alone needs.
 */
export const DEFAULT_MAX_TOKENS = 8192

/** Estimated USD cost for a given token usage on a given model. */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const info = MODELS[model as ModelId]
  if (!info) return 0
  return (
    (inputTokens / 1_000_000) * info.inputPer1M +
    (outputTokens / 1_000_000) * info.outputPer1M
  )
}

export function modelLabel(model: string): string {
  return MODELS[model as ModelId]?.label ?? model
}
