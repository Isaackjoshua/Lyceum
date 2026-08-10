import { app, ipcMain } from 'electron'
import type {
  AppVersions,
  DbInfo,
  IpcResult,
  KeyStatus,
  Settings,
  TestConnectionResult
} from '@shared/types.js'
import { IPC } from '@shared/types.js'
import { getDatabase, getDatabasePath, getSchemaVersion } from '../db/index.js'
import { readSettings, writeSettings } from '../db/queries/settings.js'
import { clearApiKey, getKeyStatus, hasApiKey, setApiKey } from '../security/keyVault.js'
import { describeApiError, testConnection } from '../harness/anthropicClient.js'
import { requireString, sanitiseSettingsPatch } from './validate.js'

/**
 * Every handler is wrapped so the renderer receives a result envelope rather
 * than a rejected promise carrying a main-process stack trace.
 */
function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err) {
      const message = describeApiError(err)
      console.error(`[ipc] ${channel} failed: ${message}`)
      return { ok: false, error: message }
    }
  })
}

function currentSettings(): Settings {
  return { ...readSettings(), keyPresent: hasApiKey() }
}

export function registerIpcHandlers(): void {
  handle<KeyStatus>(IPC.keyGetStatus, () => getKeyStatus())

  handle<KeyStatus>(IPC.keySet, (apiKey) => setApiKey(requireString(apiKey, 'apiKey')))

  handle<KeyStatus>(IPC.keyClear, () => clearApiKey())

  handle<TestConnectionResult>(IPC.keyTest, () => testConnection())

  handle<Settings>(IPC.settingsGet, () => currentSettings())

  handle<Settings>(IPC.settingsUpdate, (patch) => {
    writeSettings(sanitiseSettingsPatch(patch))
    return currentSettings()
  })

  handle<DbInfo>(IPC.dbInfo, () => {
    const db = getDatabase()
    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    return {
      path: getDatabasePath(),
      schemaVersion: getSchemaVersion(),
      curricula: count('curricula'),
      notes: count('notes'),
      flashcards: count('flashcards')
    }
  })

  handle<AppVersions>(IPC.appVersions, () => ({
    app: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  }))
}
