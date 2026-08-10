import { copyFileSync, existsSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, BrowserWindow, dialog } from 'electron'
import Database from 'better-sqlite3'
import type { BackupResult, RestoreResult } from '@shared/types.js'
import {
  closeDatabase,
  getDatabase,
  getDatabasePath,
  getSchemaVersion,
  initDatabase
} from '../db/index.js'
import { migrations } from '../db/migrations/index.js'

function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/**
 * Writes a consistent snapshot of the database.
 *
 * `VACUUM INTO` is used rather than copying the file: the database runs in WAL
 * mode, so a plain copy can miss committed pages still sitting in the -wal
 * file. VACUUM INTO produces a single self-contained, already-compacted file.
 */
export async function backupDatabase(parent?: BrowserWindow): Promise<BackupResult> {
  const options = {
    title: 'Back up Lyceum',
    defaultPath: `lyceum-backup-${timestamp()}.sqlite`,
    filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }]
  }

  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)

  if (result.canceled || !result.filePath) return { saved: false, path: null }

  // VACUUM INTO refuses to overwrite, so clear a chosen existing file first.
  if (existsSync(result.filePath)) rmSync(result.filePath)

  getDatabase().prepare('VACUUM INTO ?').run(result.filePath)
  return { saved: true, path: result.filePath }
}

/** The highest version this build knows how to run. */
function latestKnownVersion(): number {
  return Math.max(...migrations.map((m) => m.version))
}

export type BackupInspection =
  | { ok: true; schemaVersion: number }
  | { ok: false; reason: string }

/**
 * Validates a candidate backup before anything is overwritten. Extracted so
 * the checks are testable without going through a file dialog.
 */
export function inspectBackup(path: string): BackupInspection {
  let version: number
  try {
    const candidate = new Database(path, { readonly: true, fileMustExist: true })
    try {
      const tables = candidate
        .prepare<[], { name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='curricula'"
        )
        .all()
      if (tables.length === 0) {
        return { ok: false, reason: 'That file is a database, but not a Lyceum one.' }
      }
      const raw = candidate.pragma('user_version', { simple: true })
      version = typeof raw === 'number' ? raw : 0
    } finally {
      candidate.close()
    }
  } catch (err) {
    return {
      ok: false,
      reason: `That file could not be read as a database (${(err as Error).message}).`
    }
  }

  if (version > latestKnownVersion()) {
    return {
      ok: false,
      reason: `That backup was written by a newer version of Lyceum (schema v${version}). Update the app first.`
    }
  }

  return { ok: true, schemaVersion: version }
}

/**
 * Replaces the live database with a chosen backup.
 *
 * The candidate is validated before anything is touched, and the current
 * database is set aside rather than deleted, so a bad restore is recoverable.
 * The app must restart afterwards: every prepared statement and open handle
 * points at the old file.
 */
export async function restoreDatabase(parent?: BrowserWindow): Promise<RestoreResult> {
  const options = {
    title: 'Restore Lyceum from a backup',
    properties: ['openFile' as const],
    filters: [{ name: 'SQLite database', extensions: ['sqlite', 'db'] }]
  }

  const picked = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)

  const source = picked.filePaths[0]
  if (picked.canceled || !source) return { restored: false, message: 'Cancelled.' }

  // --- validate before touching anything ---------------------------------
  const inspection = inspectBackup(source)
  if (!inspection.ok) return { restored: false, message: inspection.reason }

  const confirmation = await dialog.showMessageBox(parent!, {
    type: 'warning',
    buttons: ['Restore and quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Replace your current data?',
    message: `Restore from ${basename(source)}?`,
    detail:
      'Your current curricula, notes and cards will be replaced. A copy of the ' +
      'current database is kept alongside it as lyceum.replaced.sqlite. ' +
      'Lyceum will quit so the restore can take effect.'
  })
  if (confirmation.response !== 0) return { restored: false, message: 'Cancelled.' }

  const livePath = getDatabasePath()
  const setAside = join(app.getPath('userData'), 'lyceum.replaced.sqlite')

  try {
    closeDatabase()
    if (existsSync(livePath)) copyFileSync(livePath, setAside)

    // WAL sidecars belong to the old database; leaving them would corrupt the
    // restored one.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${livePath}${suffix}`
      if (existsSync(sidecar)) rmSync(sidecar)
    }

    copyFileSync(source, livePath)
  } catch (err) {
    // Reopen so the app is still usable if the copy failed.
    initDatabase()
    return {
      restored: false,
      message: `Restore failed: ${(err as Error).message}`
    }
  }

  return {
    restored: true,
    message: 'Restored. Lyceum will now quit — reopen it to use the restored data.'
  }
}

/** Wipes every row while leaving the schema in place. */
export async function deleteAllData(parent?: BrowserWindow): Promise<boolean> {
  const confirmation = await dialog.showMessageBox(parent!, {
    type: 'warning',
    buttons: ['Delete everything', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Delete all learning data?',
    message: 'This removes every curriculum, session, note, card and quiz.',
    detail:
      'Your API key and settings are kept. This cannot be undone — back up first if you are unsure.'
  })
  if (confirmation.response !== 0) return false

  const db = getDatabase()
  const wipe = db.transaction(() => {
    // Order matters only for clarity; foreign keys cascade from curricula.
    for (const table of [
      'reviews',
      'flashcards',
      'quiz_attempts',
      'quiz_questions',
      'quizzes',
      'notes',
      'messages',
      'sessions',
      'objectives',
      'modules',
      'curricula',
      'events',
      'usage_log'
    ]) {
      db.prepare(`DELETE FROM ${table}`).run()
    }
    db.prepare("DELETE FROM sqlite_sequence WHERE name != 'settings'").run()
  })
  wipe()
  db.exec('VACUUM')

  return true
}

export { getSchemaVersion }
