import type { TestConnectionResult } from '@shared/types.js'
import { lookupModel, parseModelRef } from '@config/models.js'
import { providerInfo } from '@config/providers.js'
import { anthropicProvider, describeAnthropicError } from './providers/anthropic.js'
import {
  describeOpenAIError,
  openAICompatibleProvider
} from './providers/openaiCompatible.js'
import {
  MissingKeyError,
  ProviderConfigError,
  type Provider,
  type RunOptions,
  type RunResult,
  type RunUsage,
  type SimpleOptions
} from './providers/types.js'

/**
 * Provider dispatch. Everything above this file works in terms of a
 * `provider:model` reference and never knows which vendor answered.
 */

function providerFor(ref: string): Provider {
  const { provider } = parseModelRef(ref)
  const info = providerInfo(provider)
  if (!info) throw new ProviderConfigError(`Unknown provider: ${provider}`)
  return info.kind === 'anthropic' ? anthropicProvider : openAICompatibleProvider
}

export function runTurn(options: RunOptions): Promise<RunResult> {
  return providerFor(options.modelRef).runTurn(options)
}

export function runSimple(
  options: SimpleOptions
): Promise<{ text: string; usage: RunUsage }> {
  return providerFor(options.modelRef).runSimple(options)
}

/** Turns any provider error into a message worth showing the learner. */
export function describeApiError(err: unknown): string {
  if (err instanceof MissingKeyError || err instanceof ProviderConfigError) {
    return err.message
  }

  const anthropic = describeAnthropicError(err)
  if (anthropic) return anthropic

  const openai = describeOpenAIError(err)
  if (openai) return openai

  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Cancelled.'
    return err.message
  }
  return 'Unknown error.'
}

/**
 * Makes one very small live call to prove a provider is reachable and
 * authenticated. Uses whichever model the learner selected for that provider,
 * with a tiny output cap.
 */
export async function testConnection(ref: string): Promise<TestConnectionResult> {
  const info = lookupModel(ref)
  const result = await runSimple({
    modelRef: ref,
    system: 'Reply with a single word.',
    userContent: 'Reply with the single word: ready',
    maxTokens: 16
  })

  const text = result.text.trim()
  return {
    ok: true,
    model: info.label,
    message: text
      ? `Connected. ${info.label} replied "${text.slice(0, 40)}".`
      : `Connected to ${info.label}.`
  }
}

export { MissingKeyError, ProviderConfigError }
export type { RunOptions, RunResult, RunUsage, SimpleOptions }
