import type { CreateNoteArgs, Note, NoteFilter, NoteType } from '@shared/types.js'
import { NOTE_TYPES } from '@shared/types.js'
import { getDatabase } from '../index.js'

interface NoteRow {
  id: number
  curriculum_id: number | null
  module_id: number | null
  session_id: number | null
  message_id: number | null
  type: NoteType
  title: string
  content: string
  annotation: string | null
  source_excerpt: string | null
  tags_json: string
  created_at: number
  updated_at: number
}

function toNote(r: NoteRow): Note {
  let tags: string[] = []
  try {
    const parsed: unknown = JSON.parse(r.tags_json)
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
  } catch {
    tags = []
  }
  return {
    id: r.id,
    curriculumId: r.curriculum_id,
    moduleId: r.module_id,
    sessionId: r.session_id,
    messageId: r.message_id,
    type: r.type,
    title: r.title,
    content: r.content,
    annotation: r.annotation,
    sourceExcerpt: r.source_excerpt,
    tags,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function assertNoteType(type: string): NoteType {
  if (!NOTE_TYPES.includes(type as NoteType)) throw new Error(`Unknown note type: ${type}`)
  return type as NoteType
}

export function createNote(args: CreateNoteArgs): Note {
  const db = getDatabase()
  const now = Date.now()
  const type = assertNoteType(args.type)
  const title = args.title.trim()
  const content = args.content.trim()
  if (!title) throw new Error('A note needs a title.')
  if (!content) throw new Error('A note needs content.')

  const id = db
    .prepare(
      `INSERT INTO notes (curriculum_id, module_id, session_id, message_id, type, title,
                          content, annotation, source_excerpt, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      args.curriculumId ?? null,
      args.moduleId ?? null,
      args.sessionId ?? null,
      args.messageId ?? null,
      type,
      title,
      content,
      args.annotation ?? null,
      args.sourceExcerpt ?? null,
      JSON.stringify(args.tags ?? []),
      now,
      now
    ).lastInsertRowid as number

  db.prepare('INSERT INTO events (ts, type, payload_json) VALUES (?, ?, ?)').run(
    now,
    'note',
    JSON.stringify({ noteId: id, moduleId: args.moduleId ?? null })
  )

  return getNote(id)
}

export function getNote(noteId: number): Note {
  const row = getDatabase()
    .prepare<[number], NoteRow>('SELECT * FROM notes WHERE id = ?')
    .get(noteId)
  if (!row) throw new Error(`Note ${noteId} not found.`)
  return toNote(row)
}

export function listNotes(filter: NoteFilter): Note[] {
  const clauses: string[] = []
  const params: (string | number)[] = []

  if (filter.curriculumId != null) {
    clauses.push('curriculum_id = ?')
    params.push(filter.curriculumId)
  }
  if (filter.moduleId != null) {
    clauses.push('module_id = ?')
    params.push(filter.moduleId)
  }
  if (filter.type != null) {
    clauses.push('type = ?')
    params.push(assertNoteType(filter.type))
  }
  if (filter.search?.trim()) {
    // LIKE with escaped wildcards — parameterised, so no injection surface.
    const term = `%${filter.search.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    clauses.push("(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\' OR annotation LIKE ? ESCAPE '\\')")
    params.push(term, term, term)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  return getDatabase()
    .prepare<typeof params, NoteRow>(
      `SELECT * FROM notes ${where} ORDER BY created_at DESC`
    )
    .all(...params)
    .map(toNote)
}

export function updateNote(noteId: number, patch: Partial<CreateNoteArgs>): Note {
  const db = getDatabase()
  const sets: string[] = []
  const params: (string | number | null)[] = []

  if (patch.type !== undefined) {
    sets.push('type = ?')
    params.push(assertNoteType(patch.type))
  }
  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) throw new Error('A note needs a title.')
    sets.push('title = ?')
    params.push(title)
  }
  if (patch.content !== undefined) {
    const content = patch.content.trim()
    if (!content) throw new Error('A note needs content.')
    sets.push('content = ?')
    params.push(content)
  }
  if (patch.annotation !== undefined) {
    sets.push('annotation = ?')
    params.push(patch.annotation ?? null)
  }
  if (patch.tags !== undefined) {
    sets.push('tags_json = ?')
    params.push(JSON.stringify(patch.tags))
  }

  if (sets.length > 0) {
    sets.push('updated_at = ?')
    params.push(Date.now())
    params.push(noteId)
    db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  return getNote(noteId)
}

export function deleteNote(noteId: number): void {
  getDatabase().prepare('DELETE FROM notes WHERE id = ?').run(noteId)
}

/** Titles only — the tutor's context block never carries full note bodies. */
export function noteTitlesForModule(moduleId: number): string[] {
  return getDatabase()
    .prepare<[number], { title: string }>(
      'SELECT title FROM notes WHERE module_id = ? ORDER BY created_at DESC LIMIT 40'
    )
    .all(moduleId)
    .map((r) => r.title)
}
