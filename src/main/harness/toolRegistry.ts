import type Anthropic from '@anthropic-ai/sdk'
import type { NoteType, TurnEvent, VisualPayload } from '@shared/types.js'
import { NOTE_TYPES } from '@shared/types.js'
import { getDatabase } from '../db/index.js'

/**
 * Tool definitions and their main-process executors.
 *
 * Executors run in main, persist their own effects, and return two things:
 * the `tool_result` content fed back into the model loop, and a renderer hint
 * describing what the UI should draw.
 */

export type ToolHint = Extract<TurnEvent, { type: 'tool_result' }>['hint']

export interface ToolContext {
  sessionId: number
  moduleId: number
  curriculumId: number
}

export interface ToolOutcome {
  /** Text handed back to the model as the tool_result. */
  result: string
  hint: ToolHint | null
  isError?: boolean
}

export type ToolExecutor = (
  input: Record<string, unknown>,
  ctx: ToolContext
) => ToolOutcome

interface ToolEntry {
  definition: Anthropic.Tool
  execute: ToolExecutor
}

/* -------------------------------------------------------------- helpers */

function str(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value : ''
}

function int(input: Record<string, unknown>, key: string): number | null {
  const value = input[key]
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(n) ? n : null
}

/* ---------------------------------------------------------------- tools */

const markObjective: ToolEntry = {
  definition: {
    name: 'mark_objective',
    description:
      'Mark a learning objective as met once the learner has demonstrably shown they understand it. Use only on real evidence from this conversation, not on the learner asserting they understand.',
    input_schema: {
      type: 'object',
      properties: {
        objective_id: {
          type: 'integer',
          description: 'The id of the objective, as given in the context block.'
        },
        evidence: {
          type: 'string',
          description: 'One line on how the learner demonstrated it.'
        }
      },
      required: ['objective_id', 'evidence']
    }
  },
  execute: (input, ctx) => {
    const objectiveId = int(input, 'objective_id')
    const evidence = str(input, 'evidence')
    if (objectiveId === null) {
      return { result: 'Error: objective_id must be an integer.', hint: null, isError: true }
    }

    const db = getDatabase()
    // Scope the update to this module: the model cannot tick an objective
    // belonging to some other curriculum.
    const row = db
      .prepare<[number, number], { id: number }>(
        'SELECT id FROM objectives WHERE id = ? AND module_id = ?'
      )
      .get(objectiveId, ctx.moduleId)

    if (!row) {
      return {
        result: `Error: objective ${objectiveId} is not part of the current module.`,
        hint: null,
        isError: true
      }
    }

    db.prepare("UPDATE objectives SET status = 'met' WHERE id = ?").run(objectiveId)

    return {
      result: `Objective ${objectiveId} marked met.`,
      hint: { kind: 'objective_met', objectiveId, evidence }
    }
  }
}

const suggestNote: ToolEntry = {
  definition: {
    name: 'suggest_note',
    description:
      'Offer to save a genuinely key concept the learner just encountered. Use sparingly — a note that fires every turn is noise. The learner decides whether to keep it.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: NOTE_TYPES },
        title: { type: 'string', description: 'A short, specific title.' },
        content: {
          type: 'string',
          description: 'The idea itself, stated so it stands alone months later.'
        },
        source_excerpt: {
          type: 'string',
          description: 'The passage from your reply this note came from.'
        }
      },
      required: ['type', 'title', 'content']
    }
  },
  execute: (input) => {
    const type = str(input, 'type') as NoteType
    if (!NOTE_TYPES.includes(type)) {
      return { result: `Error: unknown note type "${type}".`, hint: null, isError: true }
    }
    const title = str(input, 'title')
    const content = str(input, 'content')
    if (!title || !content) {
      return { result: 'Error: title and content are required.', hint: null, isError: true }
    }

    // Nothing is persisted here — the learner must accept the chip first.
    return {
      result: 'Note offered to the learner. They will accept or dismiss it.',
      hint: {
        kind: 'note_suggested',
        suggestion: {
          type,
          title,
          content,
          sourceExcerpt: str(input, 'source_excerpt') || undefined
        }
      }
    }
  }
}

const renderVisual: ToolEntry = {
  definition: {
    name: 'render_visual',
    description:
      'Render ONE relationship, step, or comparison inline — never the finished mechanism. Skip it for pure procedure, notation, and quick confirmations.',
    input_schema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['svg', 'mermaid', 'html'],
          description:
            'Use mermaid for graphs and flows, svg for bespoke static figures, and html only when the learner needs to manipulate something to see the point.'
        },
        code: {
          type: 'string',
          description:
            'Valid SVG markup, Mermaid source, or a self-contained HTML fragment. HTML runs sandboxed with no network access: inline <style> and <script> only, no external resources.'
        },
        caption: { type: 'string', description: 'One short line naming what is shown.' }
      },
      required: ['format', 'code']
    }
  },
  execute: (input) => {
    const format = str(input, 'format')
    const code = str(input, 'code')
    if (format !== 'svg' && format !== 'mermaid' && format !== 'html') {
      return {
        result: `Error: format must be "svg", "mermaid" or "html".`,
        hint: null,
        isError: true
      }
    }
    if (!code.trim()) {
      return { result: 'Error: code is empty.', hint: null, isError: true }
    }

    const visual: VisualPayload = { format, code }
    const caption = str(input, 'caption')
    if (caption) visual.caption = caption

    return { result: 'Visual rendered inline for the learner.', hint: { kind: 'visual', visual } }
  }
}

const proposeQuiz: ToolEntry = {
  definition: {
    name: 'propose_quiz',
    description:
      'Signal a natural checkpoint and offer a short mastery check on the current module. Use when a coherent chunk of material is genuinely finished.',
    input_schema: {
      type: 'object',
      properties: {
        module_id: { type: 'integer' },
        focus: {
          type: 'string',
          description: 'What the check should concentrate on.'
        }
      },
      required: ['module_id']
    }
  },
  execute: (input, ctx) => ({
    result: 'Checkpoint offered to the learner.',
    hint: {
      kind: 'quiz_proposed',
      moduleId: int(input, 'module_id') ?? ctx.moduleId,
      focus: str(input, 'focus') || null
    }
  })
}

/* ------------------------------------------------------------- registry */

const REGISTRY: Record<string, ToolEntry> = {
  mark_objective: markObjective,
  suggest_note: suggestNote,
  render_visual: renderVisual,
  propose_quiz: proposeQuiz
}

/** Tool definitions for the named tools, in a stable order (cache friendly). */
export function toolDefinitions(names: readonly string[]): Anthropic.Tool[] {
  return names
    .filter((name) => name in REGISTRY)
    .map((name) => REGISTRY[name]!.definition)
}

/** Runs a tool call. Never throws — a failure becomes an error tool_result. */
export function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): ToolOutcome {
  const entry = REGISTRY[name]
  if (!entry) {
    return { result: `Error: unknown tool "${name}".`, hint: null, isError: true }
  }
  try {
    return entry.execute(input, ctx)
  } catch (err) {
    return {
      result: `Error running ${name}: ${(err as Error).message}`,
      hint: null,
      isError: true
    }
  }
}

/** The propose_curriculum tool — architect mode only, no side effects. */
export const PROPOSE_CURRICULUM_TOOL: Anthropic.Tool = {
  name: 'propose_curriculum',
  description:
    "Return a structured, editable curriculum for the learner's goal and level. Call this only after the learner has answered your calibrating question.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A specific title for this course of study.' },
      subject: { type: 'string' },
      goal: { type: 'string', description: "The learner's goal, in their terms." },
      learner_level: {
        type: 'string',
        enum: ['novice', 'beginner', 'intermediate', 'advanced']
      },
      modules: {
        type: 'array',
        description: 'Between 4 and 9 modules, in dependency order.',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            summary: { type: 'string', description: 'One sentence.' },
            est_minutes: { type: 'integer', description: 'Focused study time.' },
            objectives: {
              type: 'array',
              description: '2 to 5 checkable, action-stated objectives.',
              items: { type: 'string' }
            }
          },
          required: ['title', 'objectives']
        }
      }
    },
    required: ['title', 'subject', 'goal', 'learner_level', 'modules']
  }
}

/** generate_quiz — Assessor mode only. No side effects; the caller persists. */
export const GENERATE_QUIZ_TOOL: Anthropic.Tool = {
  name: 'generate_quiz',
  description:
    "Produce a mixed quiz scoped to the module's objectives and the material the learner has actually covered.",
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        description: '4 to 6 questions, mixing types.',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['mcq', 'short', 'code'] },
            prompt: { type: 'string' },
            options: {
              type: 'array',
              description:
                'Required for mcq: 3 to 5 options, exactly one correct, each distractor a real misconception.',
              items: { type: 'string' }
            },
            answer: {
              type: 'string',
              description:
                'For mcq, the correct option verbatim. Otherwise a model answer of one to three sentences.'
            },
            explanation: {
              type: 'string',
              description:
                'Why the answer is right, and for mcq what each distractor gets wrong.'
            }
          },
          required: ['type', 'prompt', 'answer', 'explanation']
        }
      }
    },
    required: ['questions']
  }
}

/** generate_flashcards — Card smith mode only. */
export const GENERATE_FLASHCARDS_TOOL: Anthropic.Tool = {
  name: 'generate_flashcards',
  description: "Turn a module's notes into active-recall cards (question/answer and cloze).",
  input_schema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            front: {
              type: 'string',
              description: 'A question answerable from memory, or a cloze with _____.'
            },
            back: { type: 'string', description: 'The shortest complete answer.' },
            note_id: {
              type: 'integer',
              description: 'The id of the note this card came from.'
            }
          },
          required: ['front', 'back']
        }
      }
    },
    required: ['cards']
  }
}
