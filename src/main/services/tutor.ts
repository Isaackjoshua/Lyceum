import type { SessionDetail, TurnEvent } from '@shared/types.js'
import { MODELS, type ModelId } from '@config/models.js'
import {
  getModuleWithObjectives,
  markModuleStarted
} from '../db/queries/curriculum.js'
import { noteTitlesForModule } from '../db/queries/notes.js'
import {
  appendMessage,
  getMessages,
  getSession,
  logUsage,
  startSession,
  updateStateSummary
} from '../db/queries/session.js'
import { readSettings } from '../db/queries/settings.js'
import { runSimple, runTurn } from '../harness/anthropicClient.js'
import { estimateTokens } from '../harness/contextManager.js'
import { MODES } from '../harness/modes.js'
import { assembleTutorRequest } from '../harness/promptAssembler.js'
import { toolDefinitions } from '../harness/toolRegistry.js'

/** Fraction of the model's context we spend on the verbatim transcript tail. */
const TRANSCRIPT_BUDGET_TOKENS = 24_000

export function loadSessionDetail(sessionId: number): SessionDetail {
  const session = getSession(sessionId)
  const { module, objectives, curriculum } = getModuleWithObjectives(session.moduleId)
  return {
    session,
    module: { ...module, objectives },
    curriculum,
    messages: getMessages(sessionId)
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
 */
async function foldOverflow(
  sessionId: number,
  existingSummary: string | null,
  overflow: { role: string; content: string }[]
): Promise<void> {
  if (overflow.length === 0) return

  const mode = MODES.stateSummary
  const transcript = overflow
    .map((m) => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${m.content}`)
    .join('\n\n')

  const result = await runSimple({
    model: mode.model,
    system: mode.system,
    userContent: `Existing running summary:\n${existingSummary?.trim() || '(none yet)'}\n\nTurns being dropped from context:\n${transcript}`,
    maxTokens: mode.maxTokens
  })

  if (result.text) updateStateSummary(sessionId, result.text)

  logUsage({
    sessionId,
    mode: 'stateSummary',
    model: mode.model,
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

  const settings = readSettings()
  const model = settings.tutorModel
  const maxTokens = Math.min(
    settings.maxTokens,
    MODELS[model as ModelId]?.maxOutput ?? settings.maxTokens
  )

  const session = getSession(sessionId)
  const { module, objectives, curriculum } = getModuleWithObjectives(session.moduleId)

  // Persist the learner's message before calling out, so a crash mid-call
  // does not lose what they typed.
  appendMessage(sessionId, 'user', args.text)
  markModuleStarted(session.moduleId)

  const transcript = getMessages(sessionId)
  const request = assembleTutorRequest({
    curriculum,
    module,
    objectives,
    noteTitles: noteTitlesForModule(session.moduleId),
    stateSummary: session.stateSummary,
    transcript,
    transcriptBudget: TRANSCRIPT_BUDGET_TOKENS
  })

  const result = await runTurn({
    model,
    system: request.system,
    messages: request.messages,
    tools: toolDefinitions(MODES.tutor.tools),
    maxTokens,
    effort: settings.effort,
    onText: (delta) => emit({ type: 'text_delta', requestId, delta }),
    onToolStart: (tool) => emit({ type: 'tool_start', requestId, tool }),
    onToolResult: (tool, hint) => {
      if (hint) emit({ type: 'tool_result', requestId, tool, hint })
    },
    toolContext: {
      sessionId,
      moduleId: session.moduleId,
      curriculumId: curriculum.id
    },
    ...(args.signal ? { signal: args.signal } : {})
  })

  const stored = appendMessage(sessionId, 'assistant', result.text, {
    hints: result.hints,
    model,
    stopReason: result.stopReason
  })

  logUsage({
    sessionId,
    mode: 'tutor',
    model,
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
  const total = getMessages(sessionId).reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  )
  return Math.min(1, total / TRANSCRIPT_BUDGET_TOKENS)
}
