import { app, BrowserWindow, ipcMain, webContents } from 'electron'
import type {
  AppVersions,
  ArchitectTurnResult,
  CurriculumDetail,
  CurriculumSummary,
  DbInfo,
  ExportResult,
  IpcResult,
  KeyStatus,
  Module,
  CardGenerationResult,
  DashboardStats,
  Note,
  Objective,
  QuizDetail,
  QuizResult,
  ReviewPreview,
  ReviewQueue,
  SessionDetail,
  Settings,
  TestConnectionResult,
  TurnEvent
} from '@shared/types.js'
import { IPC } from '@shared/types.js'
import { getDatabase, getDatabasePath, getSchemaVersion } from '../db/index.js'
import {
  deleteCurriculum,
  getCurriculumDetail,
  listCurricula,
  saveCurriculum,
  setModuleStatus,
  setObjectiveStatus
} from '../db/queries/curriculum.js'
import { createNote, deleteNote, listNotes, updateNote } from '../db/queries/notes.js'
import { readSettings, writeSettings } from '../db/queries/settings.js'
import { clearApiKey, getKeyStatus, hasApiKey, setApiKey } from '../security/keyVault.js'
import { describeApiError, testConnection } from '../harness/anthropicClient.js'
import { runArchitectTurn } from '../services/architect.js'
import { beginSession, loadSessionDetail, runTutorTurn } from '../services/tutor.js'
import { exportModulePdf } from '../services/exportService.js'
import { generateQuiz, submitQuiz } from '../services/quiz.js'
import { generateCards } from '../services/cards.js'
import { getQuizDetail, latestQuiz } from '../db/queries/quiz.js'
import {
  deleteCard,
  dueQueue,
  getCard,
  reviewCard,
  setSuspended
} from '../db/queries/flashcards.js'
import { dashboardStats } from '../db/queries/stats.js'
import { previewIntervals } from '../services/srs.js'
import {
  requireInt,
  requireOptionalInt,
  requireRating,
  requireString,
  sanitiseArchitectMessages,
  sanitiseCurriculumProposal,
  sanitiseNoteArgs,
  sanitiseNoteFilter,
  sanitiseNotePatch,
  sanitiseQuizResponses,
  sanitiseSettingsPatch
} from './validate.js'

/** In-flight turns, so the renderer can cancel one. */
const inFlight = new Map<string, AbortController>()

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

/** Sends a streamed turn event to a specific renderer. */
function emitTo(senderId: number, event: TurnEvent): void {
  const contents = webContents.fromId(senderId)
  if (contents && !contents.isDestroyed()) {
    contents.send(IPC.streamEvent, event)
  }
}

export function registerIpcHandlers(): void {
  /* ------------------------------------------------------------- key */

  handle<KeyStatus>(IPC.keyGetStatus, () => getKeyStatus())
  handle<KeyStatus>(IPC.keySet, (apiKey) => setApiKey(requireString(apiKey, 'apiKey')))
  handle<KeyStatus>(IPC.keyClear, () => clearApiKey())
  handle<TestConnectionResult>(IPC.keyTest, () => testConnection())

  /* -------------------------------------------------------- settings */

  handle<Settings>(IPC.settingsGet, () => currentSettings())
  handle<Settings>(IPC.settingsUpdate, (patch) => {
    writeSettings(sanitiseSettingsPatch(patch))
    return currentSettings()
  })

  /* -------------------------------------------------------- metadata */

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

  /* ------------------------------------------------------ curriculum */

  ipcMain.handle(
    IPC.curriculumArchitectTurn,
    async (event, rawMessages, rawRequestId): Promise<IpcResult<ArchitectTurnResult>> => {
      const requestId = requireString(rawRequestId, 'requestId')
      const controller = new AbortController()
      inFlight.set(requestId, controller)
      const senderId = event.sender.id

      try {
        const messages = sanitiseArchitectMessages(rawMessages)
        const result = await runArchitectTurn(
          messages,
          (delta) => emitTo(senderId, { type: 'text_delta', requestId, delta }),
          controller.signal
        )
        emitTo(senderId, { type: 'done', requestId, messageId: 0 })
        return { ok: true, data: result }
      } catch (err) {
        const message = describeApiError(err)
        console.error(`[ipc] architectTurn failed: ${message}`)
        emitTo(senderId, { type: 'error', requestId, message })
        return { ok: false, error: message }
      } finally {
        inFlight.delete(requestId)
      }
    }
  )

  handle<CurriculumDetail>(IPC.curriculumSave, (proposal) => {
    const id = saveCurriculum(sanitiseCurriculumProposal(proposal))
    return getCurriculumDetail(id)
  })

  handle<CurriculumSummary[]>(IPC.curriculumList, () => listCurricula())

  handle<CurriculumDetail>(IPC.curriculumGet, (id) =>
    getCurriculumDetail(requireInt(id, 'curriculumId'))
  )

  handle<null>(IPC.curriculumDelete, (id) => {
    deleteCurriculum(requireInt(id, 'curriculumId'))
    return null
  })

  handle<Module>(IPC.moduleSetStatus, (id, status) => {
    const value = requireString(status, 'status')
    if (!['not_started', 'in_progress', 'completed'].includes(value)) {
      throw new Error(`Invalid module status: ${value}`)
    }
    return setModuleStatus(requireInt(id, 'moduleId'), value as Module['status'])
  })

  handle<Objective>(IPC.objectiveSetStatus, (id, status) => {
    const value = requireString(status, 'status')
    if (!['open', 'met'].includes(value)) {
      throw new Error(`Invalid objective status: ${value}`)
    }
    return setObjectiveStatus(
      requireInt(id, 'objectiveId'),
      value as Objective['status']
    )
  })

  /* --------------------------------------------------------- session */

  handle<SessionDetail>(IPC.sessionStart, (moduleId) =>
    beginSession(requireInt(moduleId, 'moduleId'))
  )

  handle<SessionDetail>(IPC.sessionGet, (sessionId) =>
    loadSessionDetail(requireInt(sessionId, 'sessionId'))
  )

  ipcMain.handle(IPC.sessionSend, async (event, rawArgs): Promise<IpcResult<null>> => {
    if (typeof rawArgs !== 'object' || rawArgs === null) {
      return { ok: false, error: 'Invalid arguments.' }
    }
    const args = rawArgs as Record<string, unknown>
    const senderId = event.sender.id
    let requestId = ''

    try {
      const sessionId = requireInt(args.sessionId, 'sessionId')
      const text = requireString(args.text, 'text').trim()
      requestId = requireString(args.requestId, 'requestId')
      if (!text) throw new Error('Message is empty.')

      const controller = new AbortController()
      inFlight.set(requestId, controller)

      await runTutorTurn({
        sessionId,
        text,
        requestId,
        emit: (turnEvent) => emitTo(senderId, turnEvent),
        signal: controller.signal
      })
      return { ok: true, data: null }
    } catch (err) {
      const message = describeApiError(err)
      console.error(`[ipc] sessionSend failed: ${message}`)
      if (requestId) emitTo(senderId, { type: 'error', requestId, message })
      return { ok: false, error: message }
    } finally {
      if (requestId) inFlight.delete(requestId)
    }
  })

  handle<null>(IPC.sessionCancel, (requestId) => {
    const id = requireString(requestId, 'requestId')
    inFlight.get(id)?.abort()
    inFlight.delete(id)
    return null
  })

  /* ----------------------------------------------------------- notes */

  handle<Note>(IPC.notesCreate, (args) => createNote(sanitiseNoteArgs(args)))
  handle<Note[]>(IPC.notesList, (filter) => listNotes(sanitiseNoteFilter(filter)))
  handle<Note>(IPC.notesUpdate, (id, patch) =>
    updateNote(requireInt(id, 'noteId'), sanitiseNotePatch(patch))
  )
  handle<null>(IPC.notesDelete, (id) => {
    deleteNote(requireInt(id, 'noteId'))
    return null
  })

  /* ------------------------------------------------------------ quiz */

  handle<QuizDetail>(IPC.quizGenerate, (moduleId, focus) =>
    generateQuiz(
      requireInt(moduleId, 'moduleId'),
      typeof focus === 'string' ? focus.slice(0, 500) : null
    )
  )

  handle<QuizDetail>(IPC.quizGet, (quizId) => getQuizDetail(requireInt(quizId, 'quizId')))

  handle<QuizDetail | null>(IPC.quizLatest, (moduleId) =>
    latestQuiz(requireInt(moduleId, 'moduleId'))
  )

  handle<QuizResult>(IPC.quizSubmit, (quizId, responses) =>
    submitQuiz(requireInt(quizId, 'quizId'), sanitiseQuizResponses(responses))
  )

  /* ----------------------------------------------------------- cards */

  handle<CardGenerationResult>(IPC.cardsGenerate, (moduleId) =>
    generateCards(requireInt(moduleId, 'moduleId'))
  )

  handle<ReviewQueue>(IPC.cardsDueQueue, (moduleId) =>
    dueQueue(requireOptionalInt(moduleId, 'moduleId'))
  )

  handle<null>(IPC.cardsReview, (cardId, rating) => {
    reviewCard(requireInt(cardId, 'cardId'), requireRating(rating))
    return null
  })

  handle<ReviewPreview[]>(IPC.cardsPreview, (cardId) =>
    previewIntervals(getCard(requireInt(cardId, 'cardId')).fsrs)
  )

  handle<null>(IPC.cardsSuspend, (cardId, suspended) => {
    setSuspended(requireInt(cardId, 'cardId'), Boolean(suspended))
    return null
  })

  handle<null>(IPC.cardsDelete, (cardId) => {
    deleteCard(requireInt(cardId, 'cardId'))
    return null
  })

  /* ------------------------------------------------------- dashboard */

  handle<DashboardStats>(IPC.dashboardStats, () => dashboardStats())

  /* ---------------------------------------------------------- export */

  ipcMain.handle(
    IPC.exportModulePdf,
    async (event, moduleId): Promise<IpcResult<ExportResult>> => {
      try {
        const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
        const data = await exportModulePdf(requireInt(moduleId, 'moduleId'), parent)
        return { ok: true, data }
      } catch (err) {
        const message = describeApiError(err)
        console.error(`[ipc] exportModulePdf failed: ${message}`)
        return { ok: false, error: message }
      }
    }
  )
}
