import type {
  ArchitectMessage,
  ArchitectTurnResult,
  CurriculumProposal,
  LearnerLevel,
  ProposedModule
} from '@shared/types.js'
import { readSettings } from '../db/queries/settings.js'
import { logUsage } from '../db/queries/session.js'
import { runTurn } from '../harness/anthropicClient.js'
import { assertWithinCap } from './usage.js'
import { MODES } from '../harness/modes.js'
import { assembleArchitectRequest } from '../harness/promptAssembler.js'
import { PROPOSE_CURRICULUM_TOOL } from '../harness/toolRegistry.js'

const LEVELS: LearnerLevel[] = ['novice', 'beginner', 'intermediate', 'advanced']

/**
 * Coerces the model's propose_curriculum input into a proposal we can trust.
 * The model is well-behaved but this is still untrusted input feeding a
 * database write, so every field is checked.
 */
function parseProposal(input: Record<string, unknown>): CurriculumProposal | null {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const subject = typeof input.subject === 'string' ? input.subject.trim() : ''
  const goal = typeof input.goal === 'string' ? input.goal.trim() : ''
  const rawLevel = typeof input.learner_level === 'string' ? input.learner_level : ''
  const level: LearnerLevel = LEVELS.includes(rawLevel as LearnerLevel)
    ? (rawLevel as LearnerLevel)
    : 'beginner'

  if (!title || !Array.isArray(input.modules)) return null

  const modules: ProposedModule[] = []
  for (const raw of input.modules) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    const moduleTitle = typeof entry.title === 'string' ? entry.title.trim() : ''
    if (!moduleTitle) continue

    const objectives = Array.isArray(entry.objectives)
      ? entry.objectives
          .filter((o): o is string => typeof o === 'string')
          .map((o) => o.trim())
          .filter(Boolean)
      : []

    const module: ProposedModule = { title: moduleTitle, objectives }
    if (typeof entry.summary === 'string' && entry.summary.trim()) {
      module.summary = entry.summary.trim()
    }
    const minutes = Number(entry.est_minutes)
    if (Number.isFinite(minutes) && minutes > 0) {
      module.estMinutes = Math.round(minutes)
    }
    modules.push(module)
  }

  if (modules.length === 0) return null

  return {
    title,
    subject: subject || title,
    goal: goal || title,
    learnerLevel: level,
    modules
  }
}

/**
 * One turn of the pre-save architect conversation.
 *
 * Nothing is written to the database here — the learner reviews and edits the
 * proposal first, and `curriculum:save` is what persists it.
 */
export async function runArchitectTurn(
  messages: ArchitectMessage[],
  onText: (delta: string) => void,
  signal?: AbortSignal
): Promise<ArchitectTurnResult> {
  assertWithinCap()

  const settings = readSettings()
  const mode = MODES.architect
  const request = assembleArchitectRequest(messages)

  const result = await runTurn({
    model: mode.model,
    system: request.system,
    messages: request.messages,
    tools: [PROPOSE_CURRICULUM_TOOL],
    maxTokens: mode.maxTokens,
    effort: settings.effort,
    onText,
    // No toolContext: propose_curriculum has no side effects, so the loop
    // takes a single pass and hands the input straight back to us.
    ...(signal ? { signal } : {})
  })

  logUsage({
    sessionId: null,
    mode: 'architect',
    model: mode.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedUsd: result.usage.estimatedUsd
  })

  const call = result.toolInputs.find((t) => t.name === 'propose_curriculum')
  const proposal = call ? parseProposal(call.input) : null

  return { text: result.text, proposal }
}

export { parseProposal }
