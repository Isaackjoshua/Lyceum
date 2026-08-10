import Anthropic from '@anthropic-ai/sdk'
import { estimateCost, lookupModel, parseModelRef } from '@config/models.js'
import { getApiKey } from '../../security/keyVault.js'
import type { ToolHint } from '../toolRegistry.js'
import {
  MissingKeyError,
  type Provider,
  type RunOptions,
  type RunResult,
  type RunUsage,
  type SimpleOptions,
  type ToolSpec
} from './types.js'

/** Guards against a pathological model looping on tools forever. */
const MAX_TOOL_ITERATIONS = 6

function client(): Anthropic {
  const apiKey = getApiKey('anthropic')
  if (!apiKey) throw new MissingKeyError('Anthropic')
  return new Anthropic({
    apiKey,
    // The SDK already retries 429/5xx with exponential backoff and jitter.
    maxRetries: 3,
    timeout: 10 * 60 * 1000
  })
}

function toAnthropicTools(tools: ToolSpec[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema
  }))
}

/**
 * Per-model request tuning. Effort and adaptive thinking are rejected outright
 * by models that predate them, so both are gated on catalog capabilities.
 */
function tuning(ref: string, effort: RunOptions['effort']): Record<string, unknown> {
  const info = lookupModel(ref)
  const out: Record<string, unknown> = {}
  if (info.capabilities.adaptiveThinking) out.thinking = { type: 'adaptive' }
  if (info.capabilities.effort) out.output_config = { effort }
  return out
}

/** First block is the stable pedagogy — worth a cache breakpoint. */
function systemBlocks(system: string[]): Anthropic.TextBlockParam[] {
  return system
    .filter((text) => text.trim().length > 0)
    .map((text, index) =>
      index === 0
        ? { type: 'text', text, cache_control: { type: 'ephemeral' } }
        : { type: 'text', text }
    )
}

async function runTurn(options: RunOptions): Promise<RunResult> {
  const anthropic = client()
  const { id: model } = parseModelRef(options.modelRef)

  const messages: Anthropic.MessageParam[] = options.messages.map((m) => ({
    role: m.role,
    content: m.content
  }))

  const textParts: string[] = []
  const hints: ToolHint[] = []
  const toolInputs: { name: string; input: Record<string, unknown> }[] = []
  const usage: RunUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
  let stopReason: string | null = null

  const tools = toAnthropicTools(options.tools)

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

    const stream = anthropic.messages.stream(
      {
        model,
        max_tokens: options.maxTokens,
        system: systemBlocks(options.system),
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        ...tuning(options.modelRef, options.effort)
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
      options.modelRef,
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

      if (!options.executeTool) {
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: 'Received.'
        })
        options.onToolResult?.(toolUse.name, null)
        continue
      }

      const outcome = options.executeTool(toolUse.name, input)
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

    if (!options.executeTool) break
  }

  return { text: textParts.join('').trim(), usage, hints, toolInputs, stopReason }
}

async function runSimple(
  options: SimpleOptions
): Promise<{ text: string; usage: RunUsage }> {
  const anthropic = client()
  const { id: model } = parseModelRef(options.modelRef)

  const message = await anthropic.messages.create(
    {
      model,
      max_tokens: options.maxTokens,
      system: options.system,
      messages: [{ role: 'user', content: options.userContent }]
    },
    options.signal ? { signal: options.signal } : undefined
  )

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
        options.modelRef,
        message.usage.input_tokens,
        message.usage.output_tokens
      )
    }
  }
}

export const anthropicProvider: Provider = { runTurn, runSimple }

/** Maps an Anthropic SDK error to something worth showing a learner. */
export function describeAnthropicError(err: unknown): string | null {
  if (err instanceof Anthropic.AuthenticationError) {
    return 'That Anthropic key was rejected (401). Check it in Settings.'
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return 'This Anthropic key lacks permission for that model (403).'
  }
  if (err instanceof Anthropic.NotFoundError) {
    return 'That Anthropic model was not found (404). Pick another in Settings.'
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'Rate limited by Anthropic (429). Wait a moment and try again.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your network connection.'
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic API error ${err.status ?? ''}: ${err.message}`.trim()
  }
  return null
}
