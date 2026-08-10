/**
 * Model catalog — the single source of truth for model ids, capabilities and
 * pricing across every provider.
 *
 * A model is addressed as `provider:modelId`, e.g. `anthropic:claude-sonnet-5`
 * or `ollama:llama3.1`. Nothing else in the codebase hardcodes a model id.
 *
 * Prices are USD per 1,000,000 tokens. Local models are free and priced at 0.
 *
 * VERIFIED (2026-08-10): Anthropic and OpenAI ids and prices come from their
 * published catalogs. Ids for aggregators and open-weight hosts move quickly,
 * so those providers accept free-typed ids in Settings; the entries here are
 * convenience presets, not a closed list.
 */

import { PROVIDERS, providerInfo } from './providers.js'

export interface ModelCapabilities {
  /** Native function/tool calling. When false, Lyceum emulates it via JSON. */
  tools: boolean
  /** Accepts `output_config.effort` (Anthropic only, on recent models). */
  effort: boolean
  /** Accepts `thinking: { type: 'adaptive' }` (Anthropic only). */
  adaptiveThinking: boolean
}

export interface ModelInfo {
  /** Provider-local id, as sent on the wire. */
  id: string
  provider: string
  label: string
  contextWindow: number
  maxOutput: number
  inputPer1M: number
  outputPer1M: number
  capabilities: ModelCapabilities
  /** Suitable as a cheap background worker (summaries, cards, grading). */
  background: boolean
  note: string
}

/** `provider:model`. */
export type ModelRef = string

export function modelRef(provider: string, id: string): ModelRef {
  return `${provider}:${id}`
}

export function parseModelRef(ref: string): { provider: string; id: string } {
  const separator = ref.indexOf(':')
  if (separator === -1) {
    // Legacy refs from before multi-provider support were bare Anthropic ids.
    return { provider: 'anthropic', id: ref }
  }
  return { provider: ref.slice(0, separator), id: ref.slice(separator + 1) }
}

const FULL: ModelCapabilities = { tools: true, effort: true, adaptiveThinking: true }
const TOOLS_ONLY: ModelCapabilities = {
  tools: true,
  effort: false,
  adaptiveThinking: false
}
const NO_TOOLS: ModelCapabilities = {
  tools: false,
  effort: false,
  adaptiveThinking: false
}

function model(m: ModelInfo): ModelInfo {
  return m
}

export const MODELS: Record<ModelRef, ModelInfo> = Object.fromEntries(
  [
    /* ------------------------------------------------------------ Anthropic */
    model({
      id: 'claude-opus-5',
      provider: 'anthropic',
      label: 'Claude Opus 5',
      contextWindow: 1_000_000,
      maxOutput: 128_000,
      inputPer1M: 5,
      outputPer1M: 25,
      capabilities: FULL,
      background: false,
      note: 'Most capable. Best for hard subjects — proofs, deep theory, dense maths.'
    }),
    model({
      id: 'claude-opus-4-8',
      provider: 'anthropic',
      label: 'Claude Opus 4.8',
      contextWindow: 1_000_000,
      maxOutput: 128_000,
      inputPer1M: 5,
      outputPer1M: 25,
      capabilities: FULL,
      background: false,
      note: 'Previous-generation Opus. Same price as Opus 5.'
    }),
    model({
      id: 'claude-sonnet-5',
      provider: 'anthropic',
      label: 'Claude Sonnet 5',
      contextWindow: 1_000_000,
      maxOutput: 128_000,
      inputPer1M: 3,
      outputPer1M: 15,
      capabilities: FULL,
      background: false,
      note: 'Balanced default. Near-Opus tutoring quality at lower cost.'
    }),
    model({
      id: 'claude-haiku-4-5',
      provider: 'anthropic',
      label: 'Claude Haiku 4.5',
      contextWindow: 200_000,
      maxOutput: 64_000,
      inputPer1M: 1,
      outputPer1M: 5,
      // Haiku 4.5 predates the effort parameter and rejects it.
      capabilities: TOOLS_ONLY,
      background: true,
      note: 'Fast and cheap. Lyceum uses it for background work.'
    }),

    /* --------------------------------------------------------------- OpenAI */
    model({
      id: 'gpt-5.1',
      provider: 'openai',
      label: 'GPT-5.1',
      contextWindow: 400_000,
      maxOutput: 128_000,
      inputPer1M: 1.25,
      outputPer1M: 10,
      capabilities: TOOLS_ONLY,
      background: false,
      note: 'OpenAI flagship. Strong general reasoning.'
    }),
    model({
      id: 'gpt-5.1-mini',
      provider: 'openai',
      label: 'GPT-5.1 mini',
      contextWindow: 400_000,
      maxOutput: 128_000,
      inputPer1M: 0.25,
      outputPer1M: 2,
      capabilities: TOOLS_ONLY,
      background: true,
      note: 'Cheaper OpenAI tier. Fine for background work.'
    }),
    model({
      id: 'gpt-4.1',
      provider: 'openai',
      label: 'GPT-4.1',
      contextWindow: 1_047_576,
      maxOutput: 32_768,
      inputPer1M: 2,
      outputPer1M: 8,
      capabilities: TOOLS_ONLY,
      background: false,
      note: 'Previous generation. Still capable.'
    }),
    model({
      id: 'gpt-4.1-mini',
      provider: 'openai',
      label: 'GPT-4.1 mini',
      contextWindow: 1_047_576,
      maxOutput: 32_768,
      inputPer1M: 0.4,
      outputPer1M: 1.6,
      capabilities: TOOLS_ONLY,
      background: true,
      note: 'Cheap and quick.'
    }),

    /* ------------------------------------------------------------- Moonshot */
    model({
      id: 'kimi-k2-0905-preview',
      provider: 'moonshot',
      label: 'Kimi K2',
      contextWindow: 256_000,
      maxOutput: 16_384,
      inputPer1M: 0.6,
      outputPer1M: 2.5,
      capabilities: TOOLS_ONLY,
      background: false,
      note: 'Preset only — check Moonshot for the current id (K3 and later) and type it in.'
    }),

    /* ----------------------------------------------------------- OpenRouter */
    model({
      id: 'moonshotai/kimi-k2',
      provider: 'openrouter',
      label: 'Kimi K2 (via OpenRouter)',
      contextWindow: 200_000,
      maxOutput: 16_384,
      inputPer1M: 0.6,
      outputPer1M: 2.5,
      capabilities: TOOLS_ONLY,
      background: false,
      note: 'Type any OpenRouter id here; pricing is theirs, not ours to promise.'
    }),
    model({
      id: 'deepseek/deepseek-chat',
      provider: 'openrouter',
      label: 'DeepSeek Chat (via OpenRouter)',
      contextWindow: 128_000,
      maxOutput: 8_192,
      inputPer1M: 0.3,
      outputPer1M: 1.2,
      capabilities: TOOLS_ONLY,
      background: true,
      note: 'Inexpensive open-weight option.'
    }),

    /* --------------------------------------------------------------- Ollama */
    model({
      id: 'llama3.1',
      provider: 'ollama',
      label: 'Llama 3.1 (local)',
      contextWindow: 128_000,
      maxOutput: 8_192,
      inputPer1M: 0,
      outputPer1M: 0,
      capabilities: TOOLS_ONLY,
      background: true,
      note: 'Runs on this machine. Free, offline, and noticeably weaker at tutoring.'
    }),
    model({
      id: 'qwen2.5',
      provider: 'ollama',
      label: 'Qwen 2.5 (local)',
      contextWindow: 128_000,
      maxOutput: 8_192,
      inputPer1M: 0,
      outputPer1M: 0,
      capabilities: TOOLS_ONLY,
      background: true,
      note: 'Local. Good tool support for its size.'
    }),
    model({
      id: 'gemma3',
      provider: 'ollama',
      label: 'Gemma 3 (local)',
      contextWindow: 128_000,
      maxOutput: 8_192,
      inputPer1M: 0,
      outputPer1M: 0,
      // Gemma has no native tool calling; Lyceum emulates it.
      capabilities: NO_TOOLS,
      background: true,
      note: 'Local, no native tool calling — Lyceum falls back to prompted JSON.'
    })
  ].map((m) => [modelRef(m.provider, m.id), m])
)

/**
 * Capabilities for a model that is not in the catalog — anything the learner
 * typed themselves. Assume native tools, since most current models have them,
 * and let the runtime fall back if a call is rejected.
 */
export function unknownModel(provider: string, id: string): ModelInfo {
  const info = providerInfo(provider)
  const free = provider === 'ollama'
  return {
    id,
    provider,
    label: id,
    contextWindow: 128_000,
    maxOutput: 8_192,
    inputPer1M: 0,
    outputPer1M: 0,
    capabilities: { tools: true, effort: false, adaptiveThinking: false },
    background: true,
    note: free
      ? 'Local model. No cost.'
      : `Custom model on ${info?.label ?? provider}. Cost cannot be estimated.`
  }
}

export function lookupModel(ref: ModelRef): ModelInfo {
  const known = MODELS[ref]
  if (known) return known
  const { provider, id } = parseModelRef(ref)
  return unknownModel(provider, id)
}

export function modelsForProvider(provider: string): ModelInfo[] {
  return Object.values(MODELS).filter((m) => m.provider === provider)
}

/** Defaults used on a fresh install. */
export const DEFAULT_TUTOR_MODEL: ModelRef = 'anthropic:claude-sonnet-5'
export const DEFAULT_BACKGROUND_MODEL: ModelRef = 'anthropic:claude-haiku-4-5'

/**
 * Max output tokens per tutor reply. On Anthropic this caps thinking AND
 * response text together, so leave headroom above what the prose needs.
 */
export const DEFAULT_MAX_TOKENS = 8192

/** Estimated USD cost. Returns 0 for models with no published pricing. */
export function estimateCost(
  ref: ModelRef,
  inputTokens: number,
  outputTokens: number
): number {
  const info = MODELS[ref]
  if (!info) return 0
  return (
    (inputTokens / 1_000_000) * info.inputPer1M +
    (outputTokens / 1_000_000) * info.outputPer1M
  )
}

export function modelLabel(ref: ModelRef): string {
  const known = MODELS[ref]
  if (known) return known.label
  const { provider, id } = parseModelRef(ref)
  const label = PROVIDERS[provider]?.label
  return label ? `${id} (${label})` : id
}
