import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { LyceumApi, TurnEvent } from '@shared/types.js'
import { IPC } from '@shared/types.js'

/**
 * The preload bridge. contextIsolation is ON, so the renderer only ever sees
 * the object below — no ipcRenderer, no Node, and no way to name a channel
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
  },
  curriculum: {
    architectTurn: (messages, requestId) =>
      invoke(IPC.curriculumArchitectTurn, messages, requestId),
    save: (proposal) => invoke(IPC.curriculumSave, proposal),
    list: () => invoke(IPC.curriculumList),
    get: (curriculumId) => invoke(IPC.curriculumGet, curriculumId),
    delete: (curriculumId) => invoke(IPC.curriculumDelete, curriculumId)
  },
  module: {
    setStatus: (moduleId, status) => invoke(IPC.moduleSetStatus, moduleId, status)
  },
  objective: {
    setStatus: (objectiveId, status) =>
      invoke(IPC.objectiveSetStatus, objectiveId, status)
  },
  session: {
    start: (moduleId) => invoke(IPC.sessionStart, moduleId),
    get: (sessionId) => invoke(IPC.sessionGet, sessionId),
    send: (args) => invoke(IPC.sessionSend, args),
    cancel: (requestId) => invoke(IPC.sessionCancel, requestId),
    onEvent: (listener) => {
      // The IpcRendererEvent is deliberately not forwarded: it carries a
      // sender reference the renderer has no business holding.
      const handler = (_event: IpcRendererEvent, payload: TurnEvent): void =>
        listener(payload)
      ipcRenderer.on(IPC.streamEvent, handler)
      return () => {
        ipcRenderer.removeListener(IPC.streamEvent, handler)
      }
    }
  },
  notes: {
    create: (args) => invoke(IPC.notesCreate, args),
    list: (filter) => invoke(IPC.notesList, filter),
    update: (noteId, patch) => invoke(IPC.notesUpdate, noteId, patch),
    delete: (noteId) => invoke(IPC.notesDelete, noteId)
  },
  exports: {
    modulePdf: (moduleId) => invoke(IPC.exportModulePdf, moduleId)
  },
  quiz: {
    generate: (moduleId, focus) => invoke(IPC.quizGenerate, moduleId, focus ?? null),
    get: (quizId) => invoke(IPC.quizGet, quizId),
    latest: (moduleId) => invoke(IPC.quizLatest, moduleId),
    submit: (quizId, responses) => invoke(IPC.quizSubmit, quizId, responses)
  },
  cards: {
    generate: (moduleId) => invoke(IPC.cardsGenerate, moduleId),
    dueQueue: (moduleId) => invoke(IPC.cardsDueQueue, moduleId ?? null),
    review: (cardId, rating) => invoke(IPC.cardsReview, cardId, rating),
    preview: (cardId) => invoke(IPC.cardsPreview, cardId),
    suspend: (cardId, suspended) => invoke(IPC.cardsSuspend, cardId, suspended),
    delete: (cardId) => invoke(IPC.cardsDelete, cardId)
  },
  dashboard: {
    stats: () => invoke(IPC.dashboardStats)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Should never happen — contextIsolation is forced on in the main process.
  throw new Error('Lyceum requires contextIsolation to be enabled.')
}
