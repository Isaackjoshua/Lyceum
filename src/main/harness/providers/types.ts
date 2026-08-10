import type { ToolHint, ToolOutcome } from '../toolRegistry.js'

/**
 * The provider-neutral contract. Everything above this line — modes, prompts,
 * context assembly, tool execution, services — is vendor-agnostic.
 *
 * Two implementations satisfy it: the Anthropic SDK, and the OpenAI SDK
 * pointed at a base URL (which covers OpenAI, Moonshot, OpenRouter, Groq,
 * Together, Ollama, LM Studio and anything else speaking that format).
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** A tool the model may call. JSON Schema, as both vendors accept. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
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
  toolInputs: { name: string; input: Record<string, unknown> }[]
  stopReason: string | null
}

export interface RunOptions {
  /** `provider:model`. */
  modelRef: string
  /**
   * System prompt in blocks. Providers that support prompt caching mark the
   * first (stable) block; the rest join them with blank lines.
   */
  system: string[]
  messages: ChatMessage[]
  tools: ToolSpec[]
  maxTokens: number
  effort: 'low' | 'medium' | 'high'
  onText?: (delta: string) => void
  onToolStart?: (tool: string) => void
  onToolResult?: (tool: string, hint: ToolHint | null) => void
  /**
   * Executes a tool call in main. Omit for modes whose tools have no side
   * effects — the loop then takes a single pass and hands the inputs back.
   */
  executeTool?: (name: string, input: Record<string, unknown>) => ToolOutcome
  signal?: AbortSignal
}

export interface SimpleOptions {
  modelRef: string
  system: string
  userContent: string
  maxTokens: number
  signal?: AbortSignal
}

export interface Provider {
  /** Streams a turn and drives the tool-use loop to completion. */
  runTurn: (options: RunOptions) => Promise<RunResult>
  /** One non-streaming call. Used for background summarisation and grading. */
  runSimple: (options: SimpleOptions) => Promise<{ text: string; usage: RunUsage }>
}

export class MissingKeyError extends Error {
  constructor(providerLabel: string) {
    super(`No API key is configured for ${providerLabel}. Add one in Settings.`)
    this.name = 'MissingKeyError'
  }
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}
