import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { migrations } from '../src/main/db/migrations/index.js'

// Loaded through createRequire so the bundler does not try to resolve the
// built-in module at transform time.
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

/**
 * Migrations only ever call `db.exec(sql)`, so we drive them with Node's
 * built-in SQLite here. That keeps the schema contract testable under plain
 * `node`, while the app itself uses better-sqlite3 compiled for Electron's ABI
 * (the two ABIs cannot be loaded by the same runtime).
 */
function migrate(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    migration.up(db as unknown as Database)
    db.exec(`PRAGMA user_version = ${migration.version}`)
  }
  return db
}

const names = (db: DatabaseSync, type: 'table' | 'index', like = '%'): string[] =>
  (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = ? AND name LIKE ? AND name NOT LIKE 'sqlite_%'`
      )
      .all(type, like) as { name: string }[]
  ).map((r) => r.name)

describe('migrations', () => {
  it('have unique, ascending versions', () => {
    const versions = migrations.map((m) => m.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect([...versions].sort((a, b) => a - b)).toEqual(versions)
  })

  it('create every table in the data model', () => {
    const tables = names(migrate(), 'table')
    for (const table of [
      'curricula',
      'modules',
      'objectives',
      'sessions',
      'messages',
      'notes',
      'flashcards',
      'reviews',
      'quizzes',
      'quiz_questions',
      'quiz_attempts',
      'events',
      'settings',
      'usage_log'
    ]) {
      expect(tables, `missing table: ${table}`).toContain(table)
    }
  })

  it('index the hot paths the spec calls out', () => {
    const indices = names(migrate(), 'index', 'idx_%')
    expect(indices).toContain('idx_flashcards_due')
    expect(indices).toContain('idx_messages_session')
    expect(indices).toContain('idx_modules_curriculum')
    expect(indices).toContain('idx_objectives_module')
    expect(indices).toContain('idx_notes_module')
  })

  it('sets user_version to the highest migration', () => {
    const db = migrate()
    const highest = Math.max(...migrations.map((m) => m.version))
    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(row.user_version).toBe(highest)
  })

  it('enforces referential integrity and cascades deletes', () => {
    const db = migrate()
    const now = Date.now()

    expect(() =>
      db
        .prepare(
          'INSERT INTO modules (curriculum_id, title, order_index, created_at, updated_at) VALUES (?,?,?,?,?)'
        )
        .run(999, 'Orphan', 0, now, now)
    ).toThrow()

    const curriculumId = Number(
      db
        .prepare(
          'INSERT INTO curricula (title, subject, goal, learner_level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run('Backprop', 'ML', 'Implement it', 'beginner', 'active', now, now)
        .lastInsertRowid
    )

    const moduleId = Number(
      db
        .prepare(
          'INSERT INTO modules (curriculum_id, title, order_index, created_at, updated_at) VALUES (?,?,?,?,?)'
        )
        .run(curriculumId, 'Chain rule', 0, now, now).lastInsertRowid
    )

    db.prepare('INSERT INTO objectives (module_id, text, order_index) VALUES (?,?,?)').run(
      moduleId,
      'State the chain rule',
      0
    )

    db.prepare('DELETE FROM curricula WHERE id = ?').run(curriculumId)

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM objectives').get() as {
      n: number
    }
    expect(remaining.n).toBe(0)
  })

  it('rejects out-of-range mastery and bad enum values', () => {
    const db = migrate()
    const now = Date.now()
    const curriculumId = Number(
      db
        .prepare(
          'INSERT INTO curricula (title, subject, goal, learner_level, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run('C', 'S', 'G', 'novice', 'active', now, now).lastInsertRowid
    )

    expect(() =>
      db
        .prepare(
          'INSERT INTO modules (curriculum_id, title, order_index, mastery, created_at, updated_at) VALUES (?,?,?,?,?,?)'
        )
        .run(curriculumId, 'M', 0, 1.5, now, now)
    ).toThrow()

    expect(() =>
      db
        .prepare(
          'INSERT INTO modules (curriculum_id, title, order_index, status, created_at, updated_at) VALUES (?,?,?,?,?,?)'
        )
        .run(curriculumId, 'M', 0, 'halfway', now, now)
    ).toThrow()

    expect(() =>
      db
        .prepare(
          'INSERT INTO notes (type, title, content, created_at, updated_at) VALUES (?,?,?,?,?)'
        )
        .run('vibes', 'T', 'C', now, now)
    ).toThrow()
  })
})
