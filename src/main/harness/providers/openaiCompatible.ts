import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { estimateCost, lookupModel, parseModelRef } from '@config/models.js'
import { providerInfo } from '@config/providers.js'
import { getApiKey } from '../../security/keyVault.js'
import { readProviderConfig } from '../../db/queries/settings.js'
import { assertSafeBaseUrl } from '../../security/baseUrl.js'
import type { ToolHint } from '../toolRegistry.js'
import {
  MissingKeyError,
  ProviderConfigError,
  type Provider,
  type RunOptions,
  type RunResult,
  type RunUsage,
  type SimpleOptions,
  type ToolSpec
} from './types.js'
import {
  danglingFencePrefix,
  extractToolCalls,
  startsToolBlock,
  toolProtocolPrompt
} from './toolEmulation.js'

const MAX_TOOL_ITERATIONS = 6

function client(providerId: string): OpenAI {
  const info = providerInfo(providerId)
  if (!info) throw new ProviderConfigError(`Unknown provider: ${providerId}`)

  const config = readProviderConfig(providerId)
  const baseURL = (config.baseUrl || info.defaultBaseUrl || '').trim()
  if (!baseURL) {
    throw new ProviderConfigError(
      `${info.label} needs a base URL. Set one in Settings.`
    )
  }

  // Re-checked at request time, not just on save: a stored value could predate
  // this rule or arrive from a backup written by an older build.
  try {
    assertSafeBaseUrl(baseURL)
  } catch (err) {
    throw new ProviderConfigError((err as Error).message)
  }

  let apiKey: string | null = null
  if (info.auth === 'api-key') {
    apiKey = getApiKey(providerId)
    if (!apiKey) throw new MissingKeyError(info.label)
  }

  return new OpenAI({
    // Local runtimes ignore the key but the SDK requires a non-empty string.
    apiKey: apiKey ?? 'not-needed',
    baseURL,
    maxRetries: 3,
    timeout: 10 * 60 * 1000
  })
}

/**
 * The output-cap parameter differs across OpenAI-compatible servers. Sending
 * the wrong one is not an error on most of them — it is silently ignored,
 * which means generation runs uncapped.
 */
function tokenCap(providerId: string, maxTokens: number): Record<string, number> {
  return providerInfo(providerId)?.usesMaxCompletionTokens
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}

function toOpenAITools(tools: ToolSpec[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }))
}

/** OpenAI takes one system message, so the blocks are joined. */
function systemMessage(system: string[], extra = ''): string {
  return [...system.filter((s) => s.trim()), extra].filter(Boolean).join('\n\n')
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || '{}')
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/* -------------------------------------------------------- native tool path */

async function runNative(
  openai: OpenAI,
  providerId: string,
  model: string,
  options: RunOptions
): Promise<RunResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemMessage(options.system) },
    ...options.messages.map((m) => ({ role: m.role, content: m.content }))
  ]

  const tools = toOpenAITools(options.tools)
  const textParts: string[] = []
  const hints: ToolHint[] = []
  const toolInputs: { name: string; input: Record<string, unknown> }[] = []
  const usage: RunUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
  let stopReason: string | null = null

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

    const stream = await openai.chat.completions.create(
      {
        model,
        ...tokenCap(providerId, options.maxTokens),
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        stream: true,
        stream_options: { include_usage: true }
      },
      options.signal ? { signal: options.signal } : undefined
    )

    let content = ''
    const calls = new Map<number, { id: string; name: string; args: string }>()

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage.inputTokens += chunk.usage.prompt_tokens ?? 0
        usage.outputTokens += chunk.usage.completion_tokens ?? 0
      }

      const choice = chunk.choices[0]
      if (!choice) continue
      if (choice.finish_reason) stopReason = choice.finish_reason

      const delta = choice.delta
      if (delta?.content) {
        content += delta.content
        options.onText?.(delta.content)
      }

      // Tool calls arrive fragmented across chunks, keyed by index.
      for (const part of delta?.tool_calls ?? []) {
        const existing = calls.get(part.index) ?? { id: '', name: '', args: '' }
        if (part.id) existing.id = part.id
        if (part.function?.name) existing.name += part.function.name
        if (part.function?.arguments) existing.args += part.function.arguments
        calls.set(part.index, existing)
      }
    }

    if (content) textParts.push(content)

    const made = [...calls.values()].filter((c) => c.name)
    if (made.length === 0) break

    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: made.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.args }
      }))
    })

    for (const call of made) {
      const input = safeParse(call.args)
      toolInputs.push({ name: call.name, input })
      options.onToolStart?.(call.name)

      if (!options.executeTool) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Received.'
        })
        options.onToolResult?.(call.name, null)
        continue
      }

      const outcome = options.executeTool(call.name, input)
      if (outcome.hint) hints.push(outcome.hint)
      messages.push({ role: 'tool', tool_call_id: call.id, content: outcome.result })
      options.onToolResult?.(call.name, outcome.hint)
    }

    if (!options.executeTool) break
  }

  usage.estimatedUsd = estimateCost(
    options.modelRef,
    usage.inputTokens,
    usage.outputTokens
  )

  return { text: textParts.join('').trim(), usage, hints, toolInputs, stopReason }
}

/* ----------------------------------------------------- emulated tool path */

/**
 * For models without native tool calling. The protocol is described in the
 * system prompt and calls are parsed back out of the reply.
 *
 * Streaming needs care: once a tool fence begins, deltas stop being forwarded,
 * or the learner watches raw JSON scroll past.
 */
async function runEmulated(
  openai: OpenAI,
  providerId: string,
  model: string,
  options: RunOptions
): Promise<RunResult> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemMessage(options.system, toolProtocolPrompt(options.tools))
    },
    ...options.messages.map((m) => ({ role: m.role, content: m.content }))
  ]

  const hints: ToolHint[] = []
  const toolInputs: { name: string; input: Record<string, unknown> }[] = []
  const usage: RunUsage = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 }
  let stopReason: string | null = null
  const textParts: string[] = []

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

    const stream = await openai.chat.completions.create(
      {
        model,
        ...tokenCap(providerId, options.maxTokens),
        messages,
        stream: true,
        stream_options: { include_usage: true }
      },
      options.signal ? { signal: options.signal } : undefined
    )

    let raw = ''
    let emitted = 0
    let suppressed = false

    for await (const chunk of stream) {
      if (chunk.usage) {
        usage.inputTokens += chunk.usage.prompt_tokens ?? 0
        usage.outputTokens += chunk.usage.completion_tokens ?? 0
      }
      const choice = chunk.choices[0]
      if (!choice) continue
      if (choice.finish_reason) stopReason = choice.finish_reason

      const piece = choice.delta?.content
      if (!piece) continue
      raw += piece

      if (suppressed) continue
      if (startsToolBlock(raw)) {
        // Roll back to just before the fence and stop streaming.
        const start = raw.indexOf('```lyceum-tool')
        if (start > emitted) options.onText?.(raw.slice(emitted, start))
        emitted = raw.length
        suppressed = true
        continue
      }

      // Hold back anything that might be the start of a fence.
      const safeUpTo = raw.length - danglingFencePrefix(raw)
      if (safeUpTo > emitted) {
        options.onText?.(raw.slice(emitted, safeUpTo))
        emitted = safeUpTo
      }
    }

    const { text, calls } = extractToolCalls(raw, options.tools)
    if (text) textParts.push(text)

    if (calls.length === 0) break

    messages.push({ role: 'assistant', content: raw })

    const results: string[] = []
    for (const call of calls) {
      toolInputs.push({ name: call.name, input: call.input })
      options.onToolStart?.(call.name)

      if (!options.executeTool) {
        options.onToolResult?.(call.name, null)
        continue
      }

      const outcome = options.executeTool(call.name, call.input)
      if (outcome.hint) hints.push(outcome.hint)
      results.push(`${call.name}: ${outcome.result}`)
      options.onToolResult?.(call.name, outcome.hint)
    }

    if (!options.executeTool) break

    // No tool role exists in this protocol, so results come back as a user turn.
    messages.push({
      role: 'user',
      content: `[tool results]\n${results.join('\n')}\n\nContinue teaching. Do not mention these results directly.`
    })
  }

  usage.estimatedUsd = estimateCost(
    options.modelRef,
    usage.inputTokens,
    usage.outputTokens
  )

  return { text: textParts.join('\n\n').trim(), usage, hints, toolInputs, stopReason }
}

/* ---------------------------------------------------------------- provider */

async function runTurn(options: RunOptions): Promise<RunResult> {
  const { provider, id: model } = parseModelRef(options.modelRef)
  const openai = client(provider)
  const info = lookupModel(options.modelRef)

  const native = info.capabilities.tools || options.tools.length === 0
  return native
    ? runNative(openai, provider, model, options)
    : runEmulated(openai, provider, model, options)
}

async function runSimple(
  options: SimpleOptions
): Promise<{ text: string; usage: RunUsage }> {
  const { provider, id: model } = parseModelRef(options.modelRef)
  const openai = client(provider)

  const response = await openai.chat.completions.create(
    {
      model,
      ...tokenCap(provider, options.maxTokens),
      messages: [
        { role: 'system', content: options.system },
        { role: 'user', content: options.userContent }
      ]
    },
    options.signal ? { signal: options.signal } : undefined
  )

  const inputTokens = response.usage?.prompt_tokens ?? 0
  const outputTokens = response.usage?.completion_tokens ?? 0

  return {
    text: (response.choices[0]?.message?.content ?? '').trim(),
    usage: {
      inputTokens,
      outputTokens,
      estimatedUsd: estimateCost(options.modelRef, inputTokens, outputTokens)
    }
  }
}

export const openAICompatibleProvider: Provider = { runTurn, runSimple }

/** Maps an OpenAI SDK error to something worth showing a learner. */
export function describeOpenAIError(err: unknown): string | null {
  if (err instanceof OpenAI.AuthenticationError) {
    return 'That API key was rejected (401). Check it in Settings.'
  }
  if (err instanceof OpenAI.PermissionDeniedError) {
    return 'That key lacks permission for this model (403).'
  }
  if (err instanceof OpenAI.NotFoundError) {
    return 'That model was not found (404). Check the model id in Settings — ids change often on aggregators and local runtimes.'
  }
  if (err instanceof OpenAI.RateLimitError) {
    return 'Rate limited (429). Wait a moment and try again.'
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return 'Could not reach that endpoint. For a local runtime, check it is running and the base URL is right.'
  }
  if (err instanceof OpenAI.APIError) {
    return `API error ${err.status ?? ''}: ${err.message}`.trim()
  }
  return null
}
