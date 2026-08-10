import type { Message, MessageRole, Session } from '@shared/types.js'
import { getDatabase } from '../index.js'

interface SessionRow {
  id: number
  module_id: number
  started_at: number
  ended_at: number | null
  state_summary: string | null
  folded_through_id: number
}

interface MessageRow {
  id: number
  session_id: number
  role: MessageRole
  content: string
  meta_json: string | null
  created_at: number
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  moduleId: r.module_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  stateSummary: r.state_summary,
  foldedThroughId: r.folded_through_id ?? 0
})

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  sessionId: r.session_id,
  role: r.role,
  content: r.content,
  meta: r.meta_json ? (JSON.parse(r.meta_json) as Record<string, unknown>) : null,
  createdAt: r.created_at
})

/**
 * Returns the module's open session, creating one if there is none.
 *
 * Continuity across sittings comes from `state_summary`, not from replaying
 * the whole transcript, so reusing the open session is the right default.
 */
export function startSession(moduleId: number): Session {
  const db = getDatabase()
  const existing = db
    .prepare<[number], SessionRow>(
      'SELECT * FROM sessions WHERE module_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1'
    )
    .get(moduleId)

  if (existing) return toSession(existing)

  const now = Date.now()
  const id = db
    .prepare('INSERT INTO sessions (module_id, started_at) VALUES (?, ?)')
    .run(moduleId, now).lastInsertRowid as number

  db.prepare('INSERT INTO events (ts, type, payload_json) VALUES (?, ?, ?)').run(
    now,
    'session_start',
    JSON.stringify({ sessionId: id, moduleId })
  )

  return {
    id,
    moduleId,
    startedAt: now,
    endedAt: null,
    stateSummary: null,
    foldedThroughId: 0
  }
}

export function getSession(sessionId: number): Session {
  const row = getDatabase()
    .prepare<[number], SessionRow>('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId)
  if (!row) throw new Error(`Session ${sessionId} not found.`)
  return toSession(row)
}

export function getMessages(sessionId: number): Message[] {
  return getDatabase()
    .prepare<[number], MessageRow>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY id'
    )
    .all(sessionId)
    .map(toMessage)
}

/** Messages not yet folded into the running summary. */
export function getUnfoldedMessages(sessionId: number, foldedThroughId: number): Message[] {
  return getDatabase()
    .prepare<[number, number], MessageRow>(
      'SELECT * FROM messages WHERE session_id = ? AND id > ? ORDER BY id'
    )
    .all(sessionId, foldedThroughId)
    .map(toMessage)
}

export function appendMessage(
  sessionId: number,
  role: MessageRole,
  content: string,
  meta: Record<string, unknown> | null = null
): Message {
  const db = getDatabase()
  const now = Date.now()
  const id = db
    .prepare(
      'INSERT INTO messages (session_id, role, content, meta_json, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(sessionId, role, content, meta ? JSON.stringify(meta) : null, now)
    .lastInsertRowid as number

  return { id, sessionId, role, content, meta, createdAt: now }
}

/**
 * Records a completed fold: the new summary plus the watermark it covers.
 * Written together so a crash cannot advance the watermark past content that
 * never made it into the summary.
 */
export function recordFold(
  sessionId: number,
  summary: string,
  foldedThroughId: number
): void {
  getDatabase()
    .prepare(
      'UPDATE sessions SET state_summary = ?, folded_through_id = ? WHERE id = ?'
    )
    .run(summary, foldedThroughId, sessionId)
}

export function endSession(sessionId: number): void {
  const db = getDatabase()
  const now = Date.now()
  db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(
    now,
    sessionId
  )
  db.prepare('INSERT INTO events (ts, type, payload_json) VALUES (?, ?, ?)').run(
    now,
    'session_end',
    JSON.stringify({ sessionId })
  )
}

export function logUsage(args: {
  sessionId: number | null
  mode: string
  model: string
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO usage_log (ts, session_id, mode, model, input_tokens, output_tokens, estimated_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      Date.now(),
      args.sessionId,
      args.mode,
      args.model,
      args.inputTokens,
      args.outputTokens,
      args.estimatedUsd
    )
}
