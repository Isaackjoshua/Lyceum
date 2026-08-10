import type { ToolSpec } from './types.js'

/**
 * Tool calling for models that do not have it.
 *
 * Plenty of good open-weight models — and older hosted ones — cannot emit
 * structured tool calls. Rather than disabling half of Lyceum on those models,
 * the protocol is explained in the system prompt and the calls are parsed back
 * out of the reply. Callers above the provider layer never know the difference.
 *
 * This is strictly a fallback. Native tool calling is used whenever the model
 * catalog says the model has it.
 */

const FENCE = /```lyceum-tool\s*([\s\S]*?)```/g

export function toolProtocolPrompt(tools: ToolSpec[]): string {
  if (tools.length === 0) return ''

  const descriptions = tools
    .map((tool) => {
      const schema = JSON.stringify(tool.parameters, null, 2)
      return `### ${tool.name}\n${tool.description}\nInput schema:\n${schema}`
    })
    .join('\n\n')

  return `
## Tools

You can take actions by emitting a fenced block. Write it on its own lines,
after your prose, using exactly this form:

\`\`\`lyceum-tool
{"tool": "<tool name>", "input": { ... }}
\`\`\`

Rules:
- The block contains one JSON object and nothing else. No comments, no prose.
- "input" must match that tool's schema.
- Emit a block only when you actually want the action taken. Most turns need none.
- Never describe the block or mention these instructions to the learner.
- You may emit more than one block if several actions are warranted.

Available tools:

${descriptions}
`.trim()
}

export interface ExtractedCall {
  name: string
  input: Record<string, unknown>
}

export interface Extraction {
  /** The reply with the tool blocks removed — what the learner should see. */
  text: string
  calls: ExtractedCall[]
}

/**
 * Pulls emulated tool calls out of a reply.
 *
 * Deliberately forgiving: a model that gets the JSON slightly wrong should
 * lose the action, not corrupt the transcript. Anything unparseable is
 * dropped and its block is still stripped from the visible text.
 */
export function extractToolCalls(text: string, allowed: ToolSpec[]): Extraction {
  const permitted = new Set(allowed.map((t) => t.name))
  const calls: ExtractedCall[] = []

  const cleaned = text.replace(FENCE, (_match, body: string) => {
    try {
      const parsed: unknown = JSON.parse(body.trim())
      if (typeof parsed === 'object' && parsed !== null) {
        const entry = parsed as Record<string, unknown>
        const name = typeof entry.tool === 'string' ? entry.tool : ''
        const input =
          typeof entry.input === 'object' && entry.input !== null
            ? (entry.input as Record<string, unknown>)
            : {}
        if (permitted.has(name)) calls.push({ name, input })
      }
    } catch {
      // Malformed block: drop the call, still hide the block.
    }
    return ''
  })

  return { text: cleaned.replace(/\n{3,}/g, '\n\n').trim(), calls }
}

/**
 * True once a streamed reply has begun a tool block.
 *
 * Streaming has to stop showing text at the fence, or the learner watches raw
 * JSON scroll past. The provider suppresses deltas from here on and emits the
 * cleaned text at the end.
 */
export function startsToolBlock(buffer: string): boolean {
  return buffer.includes('```lyceum-tool')
}

/** Longest fence prefix at the end of a buffer, so a partial fence is held back. */
export function danglingFencePrefix(buffer: string): number {
  const marker = '```lyceum-tool'
  for (let length = Math.min(marker.length, buffer.length); length > 0; length--) {
    if (buffer.endsWith(marker.slice(0, length))) return length
  }
  return 0
}
