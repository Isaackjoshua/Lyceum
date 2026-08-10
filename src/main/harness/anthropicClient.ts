import Anthropic from '@anthropic-ai/sdk'
import type { TestConnectionResult } from '@shared/types.js'
import { MODELS } from '@config/models.js'
import { getApiKey } from '../security/keyVault.js'

/**
 * Thin wrapper over the Anthropic SDK. Lives in the main process only —
 * the API key never crosses the IPC boundary.
 *
 * Phase 0 covers client construction, error mapping and the connection test.
 * Streaming and the tool-use loop land in Phase 1.
 */

const CHEAP_MODEL = MODELS['claude-haiku-4-5'].id

export class MissingKeyError extends Error {
  constructor() {
    super('No API key is configured. Add one in Settings.')
    this.name = 'MissingKeyError'
  }
}

/** Builds a client from the vaulted key. Throws MissingKeyError when unset. */
export function createClient(): Anthropic {
  const apiKey = getApiKey()
  if (!apiKey) throw new MissingKeyError()
  return new Anthropic({
    apiKey,
    // The SDK already retries 429/5xx with exponential backoff.
    maxRetries: 3,
    timeout: 10 * 60 * 1000
  })
}

/** Turns an SDK error into a message safe and useful to show the learner. */
export function describeApiError(err: unknown): string {
  if (err instanceof MissingKeyError) return err.message

  if (err instanceof Anthropic.AuthenticationError) {
    return 'That API key was rejected (401). Check it and re-enter it in Settings.'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'This API key lacks permission for that model (403).'
  }
  if (err instanceof Anthropic.NotFoundError) {
    return 'That model ID was not found (404). Pick a different model in Settings.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the API (429). Wait a moment and try again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your network connection.'
  }
  if (err instanceof Anthropic.APIError) {
    return `API error ${err.status ?? ''}: ${err.message}`.trim()
  }
  if (err instanceof Error) return err.message
  return 'Unknown error.'
}

/**
 * Makes one very small live call to prove the stored key works.
 * Uses the cheapest model with a tiny output cap.
 */
export async function testConnection(): Promise<TestConnectionResult> {
  const client = createClient()
  const response = await client.messages.create({
    model: CHEAP_MODEL,
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Reply with the single word: ready' }]
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  return {
    ok: true,
    model: response.model,
    message: text
      ? `Connected. ${response.model} replied "${text}".`
      : `Connected to ${response.model}.`
  }
}
