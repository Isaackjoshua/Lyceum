import { contextBridge, ipcRenderer } from 'electron'
import type { LyceumApi } from '@shared/types.js'
import { IPC } from '@shared/types.js'

/**
 * The preload bridge. contextIsolation is ON, so the renderer only ever sees
 * the frozen object below — no ipcRenderer, no Node, no way to name a channel
 * that is not on this whitelist.
 */

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: LyceumApi = {
  key: {
    getStatus: () => invoke(IPC.keyGetStatus),
    set: (apiKey) => invoke(IPC.keySet, apiKey),
    clear: () => invoke(IPC.keyClear),
    test: () => invoke(IPC.keyTest)
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch)
  },
  db: {
    info: () => invoke(IPC.dbInfo)
  },
  app: {
    versions: () => invoke(IPC.appVersions)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Should never happen — contextIsolation is forced on in the main process.
  throw new Error('Lyceum requires contextIsolation to be enabled.')
}
