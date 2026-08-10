import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import type { Message } from '../src/shared/types.js'
import { migrations } from '../src/main/db/migrations/index.js'
import { planBudget } from '../src/main/harness/contextManager.js'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => DatabaseSync
}

interface DatabaseSync {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}

function migrate(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    migration.up(db as unknown as Database)
    db.exec(`PRAGMA user_version = ${migration.version}`)
  }
  return db
}

describe('migration 2 — fold watermark', () => {
  it('adds folded_through_id defaulting to zero', () => {
    const db = migrate()
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as {
      name: string
      dflt_value: unknown
    }[]
    const column = columns.find((c) => c.name === 'folded_through_id')
    expect(column).toBeDefined()

    db.prepare(
      `INSERT INTO curricula (title, subject, goal, learner_level, status, created_at, updated_at)
       VALUES ('c','s','g','novice','active',0,0)`
    ).run()
    db.prepare(
      `INSERT INTO modules (curriculum_id, title, order_index, created_at, updated_at)
       VALUES (1,'m',0,0,0)`
    ).run()
    db.prepare('INSERT INTO sessions (module_id, started_at) VALUES (1, 0)').run()

    const row = db
      .prepare('SELECT folded_through_id FROM sessions WHERE id = 1')
      .get() as { folded_through_id: number }
    expect(row.folded_through_id).toBe(0)
  })

  it('leaves existing sessions usable after the upgrade', () => {
    // Apply v1 only, insert a session, then apply v2 — the shape a real
    // upgrade takes on an existing install.
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrations[0]!.up(db as unknown as Database)
    db.prepare(
      `INSERT INTO curricula (title, subject, goal, learner_level, status, created_at, updated_at)
       VALUES ('c','s','g','novice','active',0,0)`
    ).run()
    db.prepare(
      `INSERT INTO modules (curriculum_id, title, order_index, created_at, updated_at)
       VALUES (1,'m',0,0,0)`
    ).run()
    db.prepare(
      "INSERT INTO sessions (module_id, started_at, state_summary) VALUES (1, 0, 'prior work')"
    ).run()

    migrations[1]!.up(db as unknown as Database)

    const row = db
      .prepare('SELECT state_summary, folded_through_id FROM sessions WHERE id = 1')
      .get() as { state_summary: string; folded_through_id: number }
    expect(row.state_summary).toBe('prior work')
    expect(row.folded_through_id).toBe(0)
  })
})

/**
 * The watermark exists so a turn is folded exactly once. This models the loop
 * the tutor service runs: each turn, plan over only the unfolded tail, then
 * advance the watermark past whatever was folded.
 */
describe('fold watermark behaviour', () => {
  const message = (id: number, content: string): Message => ({
    id,
    sessionId: 1,
    role: id % 2 === 1 ? 'user' : 'assistant',
    content,
    meta: null,
    createdAt: id
  })

  it('folds each message exactly once across many turns', () => {
    const all: Message[] = []
    let watermark = 0
    const foldedIds: number[] = []

    for (let turn = 1; turn <= 40; turn++) {
      all.push(message(turn, 'x'.repeat(900)))

      const unfolded = all.filter((m) => m.id > watermark)
      const { fold } = planBudget(unfolded, 1200, 4)

      if (fold.length > 0) {
        foldedIds.push(...fold.map((m) => m.id))
        watermark = fold[fold.length - 1]!.id
      }
    }

    // No message is folded twice.
    expect(new Set(foldedIds).size).toBe(foldedIds.length)
    // Folding happened at all.
    expect(foldedIds.length).toBeGreaterThan(10)
    // Folded ids are contiguous from the start: nothing is skipped, so nothing
    // silently vanishes from both the summary and the window.
    expect(foldedIds).toEqual([...foldedIds].sort((a, b) => a - b))
    expect(foldedIds[0]).toBe(1)
    for (let i = 1; i < foldedIds.length; i++) {
      expect(foldedIds[i]).toBe(foldedIds[i - 1]! + 1)
    }
  })

  it('keeps every message either folded or still in the window', () => {
    const all: Message[] = []
    let watermark = 0

    for (let turn = 1; turn <= 25; turn++) {
      all.push(message(turn, 'y'.repeat(900)))
      const unfolded = all.filter((m) => m.id > watermark)
      const { keep, fold } = planBudget(unfolded, 1200, 4)
      expect(keep.length + fold.length).toBe(unfolded.length)
      if (fold.length > 0) watermark = fold[fold.length - 1]!.id
    }

    const stillInWindow = all.filter((m) => m.id > watermark)
    expect(watermark + stillInWindow.length).toBe(all.length)
  })

  it('stops the context growing without bound', () => {
    const all: Message[] = []
    let watermark = 0
    let lastWindowSize = 0

    for (let turn = 1; turn <= 60; turn++) {
      all.push(message(turn, 'z'.repeat(900)))
      const unfolded = all.filter((m) => m.id > watermark)
      const { keep, fold } = planBudget(unfolded, 1200, 4)
      if (fold.length > 0) watermark = fold[fold.length - 1]!.id
      lastWindowSize = keep.reduce((sum, m) => sum + m.content.length, 0)
    }

    // 60 turns at ~900 chars each is ~54k characters; the window stays small.
    expect(lastWindowSize).toBeLessThan(6000)
  })
})

describe('spend cap arithmetic', () => {
  // Mirrors services/usage.ts. Kept here rather than importing it because that
  // module reads settings from a live database.
  const status = (
    spent: number,
    cap: number,
    blocking: boolean
  ): { warn: boolean; blocked: boolean } => {
    if (cap <= 0) return { warn: false, blocked: false }
    const fraction = spent / cap
    return { warn: fraction >= 0.8, blocked: blocking && fraction >= 1 }
  }

  it('never warns or blocks without a cap', () => {
    expect(status(1000, 0, true)).toEqual({ warn: false, blocked: false })
  })

  it('warns at 80% but keeps teaching', () => {
    expect(status(8, 10, true)).toEqual({ warn: true, blocked: false })
    expect(status(7.99, 10, true)).toEqual({ warn: false, blocked: false })
  })

  it('blocks at the cap only when blocking was asked for', () => {
    expect(status(10, 10, true)).toEqual({ warn: true, blocked: true })
    expect(status(10, 10, false)).toEqual({ warn: true, blocked: false })
    expect(status(50, 10, false)).toEqual({ warn: true, blocked: false })
  })
})
