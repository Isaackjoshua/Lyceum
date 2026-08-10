import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { app } from 'electron'
import Database from 'better-sqlite3'
import type { Database as Db } from 'better-sqlite3'
import { migrations } from './migrations/index.js'

let db: Db | null = null
let dbPath = ''

/** Opens the database, applies pragmas, and runs pending migrations. */
export function initDatabase(): Db {
  if (db) return db

  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  dbPath = join(dir, 'lyceum.sqlite')

  const handle = new Database(dbPath)
  handle.pragma('journal_mode = WAL')
  handle.pragma('foreign_keys = ON')
  handle.pragma('synchronous = NORMAL')

  runMigrations(handle)

  db = handle
  return db
}

export function getDatabase(): Db {
  if (!db) throw new Error('Database not initialised. Call initDatabase() first.')
  return db
}

export function getDatabasePath(): string {
  return dbPath
}

export function closeDatabase(): void {
  db?.close()
  db = null
}

/** Current applied schema version (0 if fresh). */
export function getSchemaVersion(handle: Db = getDatabase()): number {
  const row = handle.pragma('user_version', { simple: true })
  return typeof row === 'number' ? row : 0
}

function runMigrations(handle: Db): void {
  const current = getSchemaVersion(handle)
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version)

  if (pending.length === 0) return

  for (const migration of pending) {
    const apply = handle.transaction(() => {
      migration.up(handle)
      // pragma cannot be parameterised; version is an integer literal we control.
      handle.pragma(`user_version = ${migration.version}`)
    })
    apply()
    console.log(`[db] migrated to v${migration.version} (${migration.name})`)
  }
}
