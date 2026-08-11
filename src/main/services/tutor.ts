import type { SessionDetail, TurnEvent } from '@shared/types.js'
import { lookupModel } from '@config/models.js'
import {
  getModuleWithObjectives,
  markModuleStarted
} from '../db/queries/curriculum.js'
import { noteTitlesForModule } from '../db/queries/notes.js'
import {
  appendMessage,
  countMessages,
  getRecentMessages,
  getSession,
  getUnfoldedMessages,
  logUsage,
  recordFold,
  startSession
} from '../db/queries/session.js'
import { readSettings } from '../db/queries/settings.js'
import { runSimple, runTurn } from '../harness/llm.js'
import { estimateTokens } from '../harness/contextManager.js'
import { MODES, modelForRole } from '../harness/modes.js'
import { assembleTutorRequest } from '../harness/promptAssembler.js'
import { createDeltaBatcher } from '../harness/streamBatcher.js'
import { executeTool, toolDefinitions } from '../harness/toolRegistry.js'
import { assertWithinCap } from './usage.js'

/** Fraction of the model's context we spend on the verbatim transcript tail. */
const TRANSCRIPT_BUDGET_TOKENS = 24_000

/**
 * Turns loaded into the UI on open. The model's context window is governed
 * separately by the token budget above — this is purely about not handing the
 * renderer thousands of rows to mount at once.
 */
export const TRANSCRIPT_PAGE_SIZE = 120

export function loadSessionDetail(sessionId: number): SessionDetail {
  const session = getSession(sessionId)
  const { module, objectives, curriculum } = getModuleWithObjectives(session.moduleId)
  return {
    session,
    module: { ...module, objectives },
    curriculum,
    messages: getRecentMessages(sessionId, TRANSCRIPT_PAGE_SIZE),
    totalMessages: countMessages(sessionId)
  }
}

export function beginSession(moduleId: number): SessionDetail {
  const session = startSession(moduleId)
  markModuleStarted(moduleId)
  return loadSessionDetail(session.id)
}

/**
 * Folds transcript overflow into the running summary so long sessions stay
 * within budget without losing continuity. Uses the cheap model.
 *
 * The watermark is what makes this stable: only turns newer than
 * `folded_through_id` are ever summarised, so a turn is folded exactly once.
 * Folding the whole overflow every time would re-summarise its own output and
 * let the summary drift.
 */
async function foldOverflow(
  sessionId: number,
  existingSummary: string | null,
  overflow: { id: number; role: string; content: string }[]
): Promise<void> {
  if (overflow.length === 0) return

  const mode = MODES.stateSummary
  const modelRef = modelForRole(mode.role, readSettings())
  const transcript = overflow
    .map((m) => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${m.content}`)
    .join('\n\n')

  const result = await runSimple({
    modelRef,
    system: mode.system,
    userContent: `Existing running summary:\n${existingSummary?.trim() || '(none yet)'}\n\nTurns being dropped from context:\n${transcript}`,
    maxTokens: mode.maxTokens
  })

  // Advance the watermark only alongside a summary that actually covers those
  // turns; on a failure they stay unfolded and are retried next turn.
  const highest = overflow[overflow.length - 1]!.id
  if (result.text) recordFold(sessionId, result.text, highest)

  logUsage({
    sessionId,
    mode: 'stateSummary',
    model: modelRef,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedUsd: result.usage.estimatedUsd
  })
}

export interface TutorTurnArgs {
  sessionId: number
  text: string
  requestId: string
  emit: (event: TurnEvent) => void
  signal?: AbortSignal
}

/**
 * Runs one tutor turn end to end: persist the learner's message, assemble
 * context, stream the reply, execute any tool calls, persist the result.
 */
export async function runTutorTurn(args: TutorTurnArgs): Promise<void> {
  const { sessionId, requestId, emit } = args

  assertWithinCap()

  const settings = readSettings()
  const modelRef = settings.tutorModel
  const maxTokens = Math.min(settings.maxTokens, lookupModel(modelRef).maxOutput)

  const session = getSession(sessionId)
  const { module, objectives, curriculum } = getModuleWithObjectives(session.moduleId)

  // Persist the learner's message before calling out, so a crash mid-call
  // does not lose what they typed.
  appendMessage(sessionId, 'user', args.text)
  markModuleStarted(session.moduleId)

  // Only the unfolded tail is a candidate for the context window; everything
  // at or below the watermark is represented by `state_summary`.
  const transcript = getUnfoldedMessages(sessionId, session.foldedThroughId)
  const request = assembleTutorRequest({
    curriculum,
    module,
    objectives,
    noteTitles: noteTitlesForModule(session.moduleId),
    stateSummary: session.stateSummary,
    transcript,
    transcriptBudget: TRANSCRIPT_BUDGET_TOKENS
  })

  // Deltas are coalesced before crossing IPC — see streamBatcher for why.
  const batcher = createDeltaBatcher((delta) =>
    emit({ type: 'text_delta', requestId, delta })
  )

  let result: Awaited<ReturnType<typeof runTurn>>
  try {
    result = await runTurn({
      modelRef,
      system: request.system,
      messages: request.messages,
      tools: toolDefinitions(MODES.tutor.tools),
      maxTokens,
      effort: settings.effort,
      onText: (delta) => batcher.push(delta),
      // Tool events are rare and order-sensitive against the text around them,
      // so they flush the buffer rather than being batched.
      onToolStart: (tool) => {
        batcher.flush()
        emit({ type: 'tool_start', requestId, tool })
      },
      onToolResult: (tool, hint) => {
        batcher.flush()
        if (hint) emit({ type: 'tool_result', requestId, tool, hint })
      },
      executeTool: (name, input) =>
        executeTool(name, input, {
          sessionId,
          moduleId: session.moduleId,
          curriculumId: curriculum.id
        }),
      ...(args.signal ? { signal: args.signal } : {})
    })
  } finally {
    // Flush on the error path too, so partial output is not silently lost.
    batcher.flush()
  }

  const stored = appendMessage(sessionId, 'assistant', result.text, {
    hints: result.hints,
    model: modelRef,
    stopReason: result.stopReason
  })

  logUsage({
    sessionId,
    mode: 'tutor',
    model: modelRef,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedUsd: result.usage.estimatedUsd
  })

  emit({
    type: 'usage',
    requestId,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedUsd: result.usage.estimatedUsd
  })
  emit({ type: 'done', requestId, messageId: stored.id })

  // Summarize overflow after the turn is delivered — the learner should never
  // wait on background bookkeeping.
  if (request.overflow.length > 0) {
    void foldOverflow(sessionId, session.stateSummary, request.overflow).catch(
      (err: unknown) => {
        console.error('[tutor] state summary failed:', (err as Error).message)
      }
    )
  }
}

/** Rough context pressure indicator, for the UI. */
export function transcriptPressure(sessionId: number): number {
  const session = getSession(sessionId)
  const total = getUnfoldedMessages(sessionId, session.foldedThroughId).reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  )
  return Math.min(1, total / TRANSCRIPT_BUDGET_TOKENS)
}
