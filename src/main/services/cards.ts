import type { CardGenerationResult } from '@shared/types.js'
import { getModuleWithObjectives } from '../db/queries/curriculum.js'
import { insertCards } from '../db/queries/flashcards.js'
import { listNotes } from '../db/queries/notes.js'
import { logUsage } from '../db/queries/session.js'
import { readSettings } from '../db/queries/settings.js'
import { recomputeMastery } from '../db/queries/quiz.js'
import { runTurn } from '../harness/llm.js'
import { MODES, modelForRole } from '../harness/modes.js'
import { GENERATE_FLASHCARDS_TOOL } from '../harness/toolRegistry.js'
import { assertWithinCap } from './usage.js'

interface ParsedCard {
  front: string
  back: string
  noteId: number | null
}

/** Coerces generate_flashcards tool input, dropping anything unusable. */
export function parseCards(
  input: Record<string, unknown>,
  validNoteIds: Set<number>
): ParsedCard[] {
  if (!Array.isArray(input.cards)) return []

  const cards: ParsedCard[] = []
  for (const raw of input.cards) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>

    const front = typeof entry.front === 'string' ? entry.front.trim() : ''
    const back = typeof entry.back === 'string' ? entry.back.trim() : ''
    if (!front || !back) continue

    // A card whose front and back are the same teaches nothing.
    if (front.toLowerCase() === back.toLowerCase()) continue

    const rawId = Number(entry.note_id)
    const noteId = Number.isInteger(rawId) && validNoteIds.has(rawId) ? rawId : null

    cards.push({ front, back, noteId })
  }

  return cards
}

/**
 * Turns the module's notes into flashcards.
 *
 * Re-runnable: existing fronts are skipped, so a learner who adds three notes
 * and regenerates gets three new cards rather than a duplicated deck.
 */
export async function generateCards(moduleId: number): Promise<CardGenerationResult> {
  assertWithinCap()

  const { module } = getModuleWithObjectives(moduleId)
  const notes = listNotes({ moduleId })

  if (notes.length === 0) {
    throw new Error(
      'This module has no notes yet. Capture a few while you learn, then turn them into cards.'
    )
  }

  const mode = MODES.cardSmith
  const modelRef = modelForRole(mode.role, readSettings())
  const noteBlock = notes
    .map(
      (n) =>
        `note_id: ${n.id}\ntype: ${n.type}\ntitle: ${n.title}\ncontent: ${n.content}` +
        (n.annotation ? `\nlearner's own words: ${n.annotation}` : '')
    )
    .join('\n\n---\n\n')

  const result = await runTurn({
    modelRef,
    system: [mode.system],
    messages: [
      {
        role: 'user',
        content: `Module: ${module.title}\n\nThe learner's saved notes:\n\n${noteBlock}`
      }
    ],
    tools: [GENERATE_FLASHCARDS_TOOL],
    maxTokens: mode.maxTokens,
    effort: 'low'
  })

  logUsage({
    sessionId: null,
    mode: 'cardSmith',
    model: modelRef,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedUsd: result.usage.estimatedUsd
  })

  const call = result.toolInputs.find((t) => t.name === 'generate_flashcards')
  const validIds = new Set(notes.map((n) => n.id))
  const cards = call ? parseCards(call.input, validIds) : []

  if (cards.length === 0) {
    throw new Error('The card smith did not produce any usable cards from these notes.')
  }

  const outcome = insertCards(moduleId, cards)
  recomputeMastery(moduleId)
  return outcome
}
