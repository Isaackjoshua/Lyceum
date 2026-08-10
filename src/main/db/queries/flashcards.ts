import type { DueCard, Flashcard, ReviewQueue, ReviewRating } from '@shared/types.js'
import { getDatabase } from '../index.js'
import { newCard, schedule, type StoredCard } from '../../services/srs.js'

interface CardRow {
  id: number
  note_id: number | null
  module_id: number | null
  front: string
  back: string
  fsrs_json: string
  due: number
  suspended: number
  created_at: number
}

function parseFsrs(json: string): StoredCard | Record<string, unknown> {
  try {
    return JSON.parse(json) as StoredCard
  } catch {
    return {}
  }
}

const toFlashcard = (r: CardRow): Flashcard => ({
  id: r.id,
  noteId: r.note_id,
  moduleId: r.module_id,
  front: r.front,
  back: r.back,
  fsrs: parseFsrs(r.fsrs_json) as Record<string, unknown>,
  suspended: r.suspended === 1,
  createdAt: r.created_at
})

/**
 * Inserts cards, skipping any whose front already exists for the module.
 * Card generation is re-runnable, so duplicate suppression matters.
 */
export function insertCards(
  moduleId: number,
  cards: { front: string; back: string; noteId: number | null }[]
): { created: number; skipped: number } {
  const db = getDatabase()
  const now = Date.now()

  const existing = new Set(
    db
      .prepare<[number], { front: string }>(
        'SELECT front FROM flashcards WHERE module_id = ?'
      )
      .all(moduleId)
      .map((r) => r.front.trim().toLowerCase())
  )

  const insert = db.prepare(
    `INSERT INTO flashcards (note_id, module_id, front, back, fsrs_json, due, suspended, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
  )

  let created = 0
  let skipped = 0

  const tx = db.transaction(() => {
    for (const card of cards) {
      const front = card.front.trim()
      const back = card.back.trim()
      if (!front || !back) {
        skipped++
        continue
      }
      const key = front.toLowerCase()
      if (existing.has(key)) {
        skipped++
        continue
      }
      existing.add(key)

      const state = newCard(new Date(now))
      insert.run(
        card.noteId,
        moduleId,
        front,
        back,
        JSON.stringify(state),
        new Date(state.due).getTime(),
        now
      )
      created++
    }
  })
  tx()

  return { created, skipped }
}

/** Cards due now, oldest-due first. New cards are interleaved at the end. */
export function dueQueue(moduleId: number | null, limit = 60): ReviewQueue {
  const db = getDatabase()
  const now = Date.now()

  const where = moduleId != null ? 'AND f.module_id = ?' : ''
  const params: number[] = moduleId != null ? [moduleId] : []

  const rows = db
    .prepare<unknown[], CardRow & { module_title: string | null }>(
      `SELECT f.*, m.title AS module_title
       FROM flashcards f
       LEFT JOIN modules m ON m.id = f.module_id
       WHERE f.suspended = 0 AND f.due <= ? ${where}
       ORDER BY f.due ASC
       LIMIT ?`
    )
    .all(now, ...params, limit)

  const cards: DueCard[] = rows.map((r) => {
    const state = parseFsrs(r.fsrs_json) as StoredCard
    return {
      id: r.id,
      front: r.front,
      back: r.back,
      moduleId: r.module_id,
      moduleTitle: r.module_title,
      due: r.due,
      reps: Number(state.reps) || 0,
      lapses: Number(state.lapses) || 0,
      state: Number(state.state) || 0
    }
  })

  const totals = db
    .prepare<unknown[], { total: number; due: number; fresh: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END), 0) AS due,
              COALESCE(SUM(CASE WHEN json_extract(fsrs_json, '$.state') = 0 THEN 1 ELSE 0 END), 0) AS fresh
       FROM flashcards
       WHERE suspended = 0 ${moduleId != null ? 'AND module_id = ?' : ''}`
    )
    .get(now, ...params)

  return {
    cards,
    dueCount: totals?.due ?? 0,
    newCount: totals?.fresh ?? 0,
    totalCards: totals?.total ?? 0
  }
}

export function getCard(cardId: number): Flashcard {
  const row = getDatabase()
    .prepare<[number], CardRow>('SELECT * FROM flashcards WHERE id = ?')
    .get(cardId)
  if (!row) throw new Error(`Card ${cardId} not found.`)
  return toFlashcard(row)
}

/** Applies a self-grade: reschedules the card and logs the review. */
export function reviewCard(cardId: number, rating: ReviewRating): void {
  const db = getDatabase()
  const card = getCard(cardId)
  const now = new Date()
  const next = schedule(card.fsrs, rating, now)

  const tx = db.transaction(() => {
    db.prepare('UPDATE flashcards SET fsrs_json = ?, due = ? WHERE id = ?').run(
      JSON.stringify(next),
      new Date(next.due).getTime(),
      cardId
    )
    db.prepare(
      'INSERT INTO reviews (flashcard_id, reviewed_at, rating) VALUES (?, ?, ?)'
    ).run(cardId, now.getTime(), rating)
    db.prepare('INSERT INTO events (ts, type, payload_json) VALUES (?, ?, ?)').run(
      now.getTime(),
      'review',
      JSON.stringify({ cardId, rating, moduleId: card.moduleId })
    )
  })
  tx()
}

export function setSuspended(cardId: number, suspended: boolean): void {
  getDatabase()
    .prepare('UPDATE flashcards SET suspended = ? WHERE id = ?')
    .run(suspended ? 1 : 0, cardId)
}

export function deleteCard(cardId: number): void {
  getDatabase().prepare('DELETE FROM flashcards WHERE id = ?').run(cardId)
}

/** Raw FSRS states for a module's cards — used by the mastery blend. */
export function cardStatesForModule(moduleId: number): unknown[] {
  return getDatabase()
    .prepare<[number], { fsrs_json: string }>(
      'SELECT fsrs_json FROM flashcards WHERE module_id = ? AND suspended = 0'
    )
    .all(moduleId)
    .map((r) => parseFsrs(r.fsrs_json))
}
