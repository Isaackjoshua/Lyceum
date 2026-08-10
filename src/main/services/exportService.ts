import { BrowserWindow } from 'electron'
import type { ExportResult } from '@shared/types.js'
import { getModuleWithObjectives } from '../db/queries/curriculum.js'
import { listNotes } from '../db/queries/notes.js'
import { logUsage } from '../db/queries/session.js'
import { readSettings } from '../db/queries/settings.js'
import { runSimple } from '../harness/anthropicClient.js'
import { MODES } from '../harness/modes.js'
import { hasApiKey } from '../security/keyVault.js'
import { savePdf, slugify } from '../pdf/export.js'
import type { PdfSection } from '../pdf/render.js'

/** Asks the cheap model for a module summary. Falls back to notes when offline. */
async function generateSummary(
  moduleTitle: string,
  objectives: string[],
  notes: { title: string; content: string }[]
): Promise<string | null> {
  if (!hasApiKey()) return null

  const mode = MODES.moduleSummary
  const noteBlock =
    notes.length > 0
      ? notes.map((n) => `- ${n.title}: ${n.content}`).join('\n')
      : '(the learner saved no notes for this module)'

  try {
    const result = await runSimple({
      model: mode.model,
      system: mode.system,
      userContent: `Module: ${moduleTitle}\n\nObjectives:\n${objectives
        .map((o) => `- ${o}`)
        .join('\n')}\n\nLearner's notes:\n${noteBlock}`,
      maxTokens: mode.maxTokens
    })

    logUsage({
      sessionId: null,
      mode: 'moduleSummary',
      model: mode.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedUsd: result.usage.estimatedUsd
    })

    return result.text || null
  } catch (err) {
    // Export must still work offline — a missing summary is not a failure.
    console.error('[export] summary generation failed:', (err as Error).message)
    return null
  }
}

/**
 * Module summary PDF: Claude-written summary, objectives with their status,
 * and the learner's own notes for the module.
 */
export async function exportModulePdf(
  moduleId: number,
  parent?: BrowserWindow
): Promise<ExportResult> {
  const { module, objectives, curriculum } = getModuleWithObjectives(moduleId)
  const notes = listNotes({ moduleId })
  const settings = readSettings()

  const summary = await generateSummary(
    module.title,
    objectives.map((o) => o.text),
    notes.map((n) => ({ title: n.title, content: n.content }))
  )

  const sections: PdfSection[] = []

  sections.push({
    heading: 'Summary',
    body:
      summary ??
      (module.summary
        ? module.summary
        : '_No summary available. Add an API key to have Lyceum write one, or take notes as you learn._')
  })

  sections.push({
    heading: 'Learning objectives',
    body:
      objectives.length > 0
        ? objectives
            .map(
              (o) =>
                `<div class="objective"><span class="mark">${
                  o.status === 'met' ? '&#10003; met' : '&#9675; open'
                }</span><span>${o.text}</span></div>`
            )
            .join('\n')
        : '_No objectives recorded for this module._'
  })

  sections.push({
    heading: 'Your notes',
    body:
      notes.length > 0
        ? notes
            .map(
              (n) => `<div class="note">
  <div class="note-type">${n.type}</div>
  <div class="note-title">${n.title}</div>
  <div>${n.content}</div>
  ${n.annotation ? `<div class="note-annotation">${n.annotation}</div>` : ''}
</div>`
            )
            .join('\n')
        : '_You have not saved any notes for this module yet. Select text in a tutor reply to capture one._'
  })

  const meta = [
    curriculum.subject,
    `${objectives.filter((o) => o.status === 'met').length} of ${objectives.length} objectives met`,
    `${notes.length} note${notes.length === 1 ? '' : 's'}`,
    new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  ]
  if (!summary && settings.tutorModel) {
    meta.push('Summary unavailable — exported offline')
  }

  return savePdf(
    {
      title: module.title,
      subtitle: curriculum.title,
      meta,
      sections
    },
    `${slugify(curriculum.title)}-${slugify(module.title)}.pdf`,
    parent
  )
}
