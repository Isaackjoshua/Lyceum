import type {
  ArchitectMessage,
  CreateNoteArgs,
  CurriculumProposal,
  LearnerLevel,
  NoteFilter,
  NoteType,
  ProposedModule,
  Settings
} from '@shared/types.js'
import { NOTE_TYPES } from '@shared/types.js'
import { MODELS } from '@config/models.js'

/**
 * Input validation for values crossing the IPC boundary.
 *
 * The renderer is treated as untrusted: every field is checked for type and
 * range here before it reaches the database. Kept free of Electron imports so
 * it can be unit tested directly.
 */

/** Caps that stop a runaway renderer from writing unbounded rows. */
const LIMITS = {
  title: 300,
  text: 20_000,
  noteContent: 50_000,
  message: 50_000,
  modules: 40,
  objectivesPerModule: 20,
  architectMessages: 60,
  tags: 20,
  tag: 40
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
  return value
}

export function requireInt(value: unknown, field: string): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n)) throw new Error(`${field} must be an integer.`)
  return n
}

function boundedString(value: unknown, field: string, max: number): string {
  const text = requireString(value, field).trim()
  if (text.length > max) throw new Error(`${field} is too long (max ${max}).`)
  return text
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`)
  }
  return value as Record<string, unknown>
}

function assertNoteType(value: unknown): NoteType {
  const type = requireString(value, 'type')
  if (!NOTE_TYPES.includes(type as NoteType)) throw new Error(`Unknown note type: ${type}`)
  return type as NoteType
}

function optionalId(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null
  return requireInt(value, field)
}

export type SettingsPatch = Partial<Omit<Settings, 'keyPresent'>>

export function sanitiseSettingsPatch(input: unknown): SettingsPatch {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Settings patch must be an object.')
  }
  const raw = input as Record<string, unknown>
  const patch: SettingsPatch = {}

  if (raw.tutorModel !== undefined) {
    const model = requireString(raw.tutorModel, 'tutorModel')
    if (!(model in MODELS)) throw new Error(`Unknown model: ${model}`)
    patch.tutorModel = model
  }

  if (raw.maxTokens !== undefined) {
    const n = Number(raw.maxTokens)
    if (!Number.isFinite(n) || n < 256 || n > 32_000) {
      throw new Error('maxTokens must be between 256 and 32000.')
    }
    patch.maxTokens = Math.round(n)
  }

  if (raw.effort !== undefined) {
    const effort = requireString(raw.effort, 'effort')
    if (!['low', 'medium', 'high'].includes(effort)) {
      throw new Error('effort must be low, medium or high.')
    }
    patch.effort = effort as Settings['effort']
  }

  if (raw.theme !== undefined) {
    const theme = requireString(raw.theme, 'theme')
    if (!['light', 'dark', 'system'].includes(theme)) {
      throw new Error('theme must be light, dark or system.')
    }
    patch.theme = theme as Settings['theme']
  }

  if (raw.fontScale !== undefined) {
    const n = Number(raw.fontScale)
    if (!Number.isFinite(n) || n < 12 || n > 24) {
      throw new Error('fontScale must be between 12 and 24.')
    }
    patch.fontScale = Math.round(n)
  }

  if (raw.spendCapUsd !== undefined) {
    const n = Number(raw.spendCapUsd)
    if (!Number.isFinite(n) || n < 0 || n > 100_000) {
      throw new Error('spendCapUsd must be a non-negative number.')
    }
    patch.spendCapUsd = n
  }

  if (raw.spendCapBlocks !== undefined) {
    patch.spendCapBlocks = Boolean(raw.spendCapBlocks)
  }

  return patch
}

/* ------------------------------------------------------------ architect */

export function sanitiseArchitectMessages(input: unknown): ArchitectMessage[] {
  if (!Array.isArray(input)) throw new Error('messages must be an array.')
  if (input.length === 0) throw new Error('messages cannot be empty.')
  if (input.length > LIMITS.architectMessages) {
    throw new Error('This conversation is too long. Start a new curriculum.')
  }

  return input.map((raw, i) => {
    const entry = requireObject(raw, `messages[${i}]`)
    const role = requireString(entry.role, `messages[${i}].role`)
    if (role !== 'user' && role !== 'assistant') {
      throw new Error(`messages[${i}].role must be "user" or "assistant".`)
    }
    return {
      role,
      content: boundedString(entry.content, `messages[${i}].content`, LIMITS.message)
    }
  })
}

const LEVELS: LearnerLevel[] = ['novice', 'beginner', 'intermediate', 'advanced']

/**
 * Validates a curriculum before it is written. This runs on learner-edited
 * data, so the errors are worded for a person, not a log file.
 */
export function sanitiseCurriculumProposal(input: unknown): CurriculumProposal {
  const raw = requireObject(input, 'proposal')

  const title = boundedString(raw.title, 'title', LIMITS.title)
  if (!title) throw new Error('The curriculum needs a title.')

  const level = requireString(raw.learnerLevel, 'learnerLevel')
  if (!LEVELS.includes(level as LearnerLevel)) {
    throw new Error(`Unknown learner level: ${level}`)
  }

  if (!Array.isArray(raw.modules) || raw.modules.length === 0) {
    throw new Error('A curriculum needs at least one module.')
  }
  if (raw.modules.length > LIMITS.modules) {
    throw new Error(`That is too many modules (max ${LIMITS.modules}).`)
  }

  const modules: ProposedModule[] = raw.modules.map((rawModule, i) => {
    const entry = requireObject(rawModule, `modules[${i}]`)
    const moduleTitle = boundedString(entry.title, `modules[${i}].title`, LIMITS.title)
    if (!moduleTitle) throw new Error(`Module ${i + 1} needs a title.`)

    if (!Array.isArray(entry.objectives)) {
      throw new Error(`Module "${moduleTitle}" needs an objectives list.`)
    }
    if (entry.objectives.length > LIMITS.objectivesPerModule) {
      throw new Error(
        `Module "${moduleTitle}" has too many objectives (max ${LIMITS.objectivesPerModule}).`
      )
    }

    const objectives = entry.objectives
      .map((o, j) => boundedString(o, `modules[${i}].objectives[${j}]`, LIMITS.text))
      .filter(Boolean)

    const module: ProposedModule = { title: moduleTitle, objectives }

    if (entry.summary !== undefined && entry.summary !== null) {
      const summary = boundedString(entry.summary, `modules[${i}].summary`, LIMITS.text)
      if (summary) module.summary = summary
    }
    if (entry.estMinutes !== undefined && entry.estMinutes !== null) {
      const minutes = Number(entry.estMinutes)
      if (Number.isFinite(minutes) && minutes > 0 && minutes <= 100_000) {
        module.estMinutes = Math.round(minutes)
      }
    }
    return module
  })

  return {
    title,
    subject: boundedString(raw.subject ?? title, 'subject', LIMITS.title) || title,
    goal: boundedString(raw.goal ?? title, 'goal', LIMITS.text) || title,
    learnerLevel: level as LearnerLevel,
    modules
  }
}

/* ---------------------------------------------------------------- notes */

function sanitiseTags(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error('tags must be an array.')
  if (value.length > LIMITS.tags) throw new Error(`Too many tags (max ${LIMITS.tags}).`)
  return value
    .map((t, i) => boundedString(t, `tags[${i}]`, LIMITS.tag))
    .filter(Boolean)
}

export function sanitiseNoteArgs(input: unknown): CreateNoteArgs {
  const raw = requireObject(input, 'note')

  const args: CreateNoteArgs = {
    type: assertNoteType(raw.type),
    title: boundedString(raw.title, 'title', LIMITS.title),
    content: boundedString(raw.content, 'content', LIMITS.noteContent),
    curriculumId: optionalId(raw.curriculumId, 'curriculumId'),
    moduleId: optionalId(raw.moduleId, 'moduleId'),
    sessionId: optionalId(raw.sessionId, 'sessionId'),
    messageId: optionalId(raw.messageId, 'messageId'),
    tags: sanitiseTags(raw.tags)
  }

  if (!args.title) throw new Error('A note needs a title.')
  if (!args.content) throw new Error('A note needs content.')

  if (raw.annotation !== undefined && raw.annotation !== null) {
    args.annotation = boundedString(raw.annotation, 'annotation', LIMITS.noteContent)
  }
  if (raw.sourceExcerpt !== undefined && raw.sourceExcerpt !== null) {
    args.sourceExcerpt = boundedString(
      raw.sourceExcerpt,
      'sourceExcerpt',
      LIMITS.noteContent
    )
  }

  return args
}

export function sanitiseNotePatch(input: unknown): Partial<CreateNoteArgs> {
  const raw = requireObject(input, 'patch')
  const patch: Partial<CreateNoteArgs> = {}

  if (raw.type !== undefined) patch.type = assertNoteType(raw.type)
  if (raw.title !== undefined) {
    patch.title = boundedString(raw.title, 'title', LIMITS.title)
    if (!patch.title) throw new Error('A note needs a title.')
  }
  if (raw.content !== undefined) {
    patch.content = boundedString(raw.content, 'content', LIMITS.noteContent)
    if (!patch.content) throw new Error('A note needs content.')
  }
  if (raw.annotation !== undefined) {
    patch.annotation =
      raw.annotation === null
        ? null
        : boundedString(raw.annotation, 'annotation', LIMITS.noteContent)
  }
  if (raw.tags !== undefined) patch.tags = sanitiseTags(raw.tags)

  return patch
}

export function sanitiseNoteFilter(input: unknown): NoteFilter {
  if (input === undefined || input === null) return {}
  const raw = requireObject(input, 'filter')
  const filter: NoteFilter = {}

  if (raw.curriculumId !== undefined && raw.curriculumId !== null) {
    filter.curriculumId = requireInt(raw.curriculumId, 'curriculumId')
  }
  if (raw.moduleId !== undefined && raw.moduleId !== null) {
    filter.moduleId = requireInt(raw.moduleId, 'moduleId')
  }
  if (raw.type !== undefined && raw.type !== null) {
    filter.type = assertNoteType(raw.type)
  }
  if (raw.search !== undefined && raw.search !== null) {
    filter.search = boundedString(raw.search, 'search', LIMITS.title)
  }

  return filter
}
