import Anthropic from '@anthropic-ai/sdk'
import type { TestConnectionResult } from '@shared/types.js'
import type { ModelId } from '@config/models.js'
import { estimateCost, MODELS } from '@config/models.js'
import { getApiKey } from '../security/keyVault.js'
import { executeTool, type ToolContext, type ToolHint } from './toolRegistry.js'

/**
 * Thin wrapper over the Anthropic SDK. Lives in the main process only —
 * the API key never crosses the IPC boundary.
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
    // The SDK already retries 429/5xx with exponential backoff and jitter.
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
  if (err instanceof Error) {
    if (err.name === 'AbortError') return 'Cancelled.'
    return err.message
  }
  return 'Unknown error.'
}

/**
 * Per-model request tuning. Effort and adaptive thinking are rejected outright
 * by models that predate them, so both are gated on the catalog flags.
 */
function tuningFor(
  model: string,
  effort: 'low' | 'medium' | 'high'
): Record<string, unknown> {
  const info = MODELS[model as ModelId]
  const tuning: Record<string, unknown> = {}
  if (info?.supportsAdaptiveThinking) tuning.thinking = { type: 'adaptive' }
  if (info?.supportsEffort) tuning.output_config = { effort }
  return tuning
}

export interface RunUsage {
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
}

export interface RunResult {
  text: string
  usage: RunUsage
  hints: ToolHint[]
  /** Raw tool inputs keyed by tool name, for callers that need them. */
  toolInputs: { name: string; input: Record<string, unknown> }[]
  stopReason: string | null
}

export interface RunOptions {
  model: string
  system: Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
  /** Called for each streamed text delta. */
  onText?: (delta: string) => void
  onToolStart?: (tool: string) => void
  onToolResult?: (tool: string, hint: ToolHint | null) => void
  /** Executes tool calls. Omit for modes whose tools have no side effects. */
  toolContext?: ToolContext
  signal?: AbortSignal
}

/** Guards against a pathological model looping on tools forever. */
const MAX_TOOL_ITERATIONS = 6

/**
 * Streams a turn and drives the tool-use loop to completion.
 *
 * Assistant content is echoed back verbatim each iteration, which preserves
 * thinking blocks and tool_use blocks exactly as the API requires.
 */
export async function runTurn(options: RunOptions): Promise<RunResult> {
  const client = createClient()
  const messages: Anthropic.MessageParam[] = [...options.messages]
  const tuning = tuningFor(options.model, options.effort)

  const textParts: string[] = []
  const hints: ToolHint[] = []
  const toolInputs: { name: string; input: Record<string, unknown> }[] = []
  const usage: RunUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
  let stopReason: string | null = null

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

    const stream = client.messages.stream(
      {
        model: options.model,
        max_tokens: options.maxTokens,
        system: options.system,
        messages,
        ...(options.tools.length > 0 ? { tools: options.tools } : {}),
        ...tuning
      } as Anthropic.MessageStreamParams,
      options.signal ? { signal: options.signal } : undefined
    )

    if (options.onText) {
      const onText = options.onText
      stream.on('text', (delta) => onText(delta))
    }

    const message = await stream.finalMessage()

    usage.inputTokens += message.usage.input_tokens
    usage.outputTokens += message.usage.output_tokens
    usage.estimatedUsd += estimateCost(
      options.model,
      message.usage.input_tokens,
      message.usage.output_tokens
    )
    stopReason = message.stop_reason

    for (const block of message.content) {
      if (block.type === 'text') textParts.push(block.text)
    }

    const toolUses = message.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    )

    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break

    // Echo the assistant turn back unchanged — thinking blocks included.
    messages.push({ role: 'assistant', content: message.content })

    const results: Anthropic.ToolResultBlockParam[] = []
    for (const toolUse of toolUses) {
      const input = (toolUse.input ?? {}) as Record<string, unknown>
      toolInputs.push({ name: toolUse.name, input })
      options.onToolStart?.(toolUse.name)

      if (!options.toolContext) {
        // Side-effect-free mode (e.g. the architect): acknowledge and stop.
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: 'Received.'
        })
        options.onToolResult?.(toolUse.name, null)
        continue
      }

      const outcome = executeTool(toolUse.name, input, options.toolContext)
      if (outcome.hint) hints.push(outcome.hint)
      results.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: outcome.result,
        ...(outcome.isError ? { is_error: true } : {})
      })
      options.onToolResult?.(toolUse.name, outcome.hint)
    }

    // All results for one assistant turn go back in a single user message.
    messages.push({ role: 'user', content: results })

    // Side-effect-free modes take a single pass: we have what we came for.
    if (!options.toolContext) break
  }

  return {
    text: textParts.join('').trim(),
    usage,
    hints,
    toolInputs,
    stopReason
  }
}

/** A single non-streaming call. Used for background summarization. */
export async function runSimple(options: {
  model: string
  system: string
  userContent: string
  maxTokens: number
}): Promise<{ text: string; usage: RunUsage }> {
  const client = createClient()
  const message = await client.messages.create({
    model: options.model,
    max_tokens: options.maxTokens,
    system: options.system,
    messages: [{ role: 'user', content: options.userContent }]
  })

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()

  return {
    text,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      estimatedUsd: estimateCost(
        options.model,
        message.usage.input_tokens,
        message.usage.output_tokens
      )
    }
  }
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
