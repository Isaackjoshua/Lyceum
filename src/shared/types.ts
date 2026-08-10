/**
 * Domain + IPC types shared between the main process and the renderer.
 *
 * This file must stay free of Node and DOM imports — both sides compile it.
 */

/* ------------------------------------------------------------------ *
 * Domain model (mirrors the SQLite schema in src/main/db/migrations)  *
 * ------------------------------------------------------------------ */

export type CurriculumStatus = 'active' | 'archived'
export type ModuleStatus = 'not_started' | 'in_progress' | 'completed'
export type ObjectiveStatus = 'open' | 'met'
export type LearnerLevel = 'novice' | 'beginner' | 'intermediate' | 'advanced'
export type MessageRole = 'user' | 'assistant' | 'tool'

export type NoteType =
  | 'concept'
  | 'definition'
  | 'theorem'
  | 'principle'
  | 'insight'
  | 'example'
  | 'question'

export const NOTE_TYPES: NoteType[] = [
  'concept',
  'definition',
  'theorem',
  'principle',
  'insight',
  'example',
  'question'
]

export type QuestionType = 'mcq' | 'short' | 'code'
export type EventType = 'session_start' | 'session_end' | 'review' | 'quiz' | 'note'

export interface Curriculum {
  id: number
  title: string
  subject: string
  goal: string
  learnerLevel: LearnerLevel
  status: CurriculumStatus
  createdAt: number
  updatedAt: number
}

export interface Module {
  id: number
  curriculumId: number
  title: string
  summary: string | null
  estMinutes: number | null
  orderIndex: number
  status: ModuleStatus
  mastery: number
  createdAt: number
  updatedAt: number
}

export interface Objective {
  id: number
  moduleId: number
  text: string
  orderIndex: number
  status: ObjectiveStatus
}

export interface Session {
  id: number
  moduleId: number
  startedAt: number
  endedAt: number | null
  stateSummary: string | null
}

export interface Message {
  id: number
  sessionId: number
  role: MessageRole
  content: string
  meta: Record<string, unknown> | null
  createdAt: number
}

export interface Note {
  id: number
  curriculumId: number | null
  moduleId: number | null
  sessionId: number | null
  messageId: number | null
  type: NoteType
  title: string
  content: string
  annotation: string | null
  sourceExcerpt: string | null
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface Flashcard {
  id: number
  noteId: number | null
  moduleId: number | null
  front: string
  back: string
  fsrs: Record<string, unknown>
  suspended: boolean
  createdAt: number
}

export interface Review {
  id: number
  flashcardId: number
  reviewedAt: number
  rating: 1 | 2 | 3 | 4
}

export interface Quiz {
  id: number
  moduleId: number
  createdAt: number
}

export interface QuizQuestion {
  id: number
  quizId: number
  type: QuestionType
  prompt: string
  options: string[] | null
  answer: string
  explanation: string
  orderIndex: number
}

export interface QuizAttempt {
  id: number
  quizId: number
  takenAt: number
  score: number
  responses: Record<string, string>
}

export interface AppEvent {
  id: number
  ts: number
  type: EventType
  payload: Record<string, unknown> | null
}

/* ------------------------------------------------------------------ *
 * Settings                                                            *
 * ------------------------------------------------------------------ */

export type ThemePreference = 'light' | 'dark' | 'system'

export interface Settings {
  tutorModel: string
  maxTokens: number
  /** Reasoning effort for the tutor. Maps to output_config.effort. */
  effort: 'low' | 'medium' | 'high'
  theme: ThemePreference
  /** Renderer root font size in px. */
  fontScale: number
  /** Optional monthly spend cap in USD. 0 = no cap. */
  spendCapUsd: number
  /** Block generation once the cap is reached (vs. warn only). */
  spendCapBlocks: boolean
  /** True when an API key is present in the vault. Never the key itself. */
  keyPresent: boolean
}

/* ------------------------------------------------------------------ *
 * IPC payloads                                                        *
 * ------------------------------------------------------------------ */

/** Every IPC handler returns this envelope — the renderer never sees a throw. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface KeyStatus {
  present: boolean
  /** OS-level encryption availability. False = we refuse to store the key. */
  encryptionAvailable: boolean
  /** Last four characters, for recognition only. Never the full key. */
  hint: string | null
}

export interface TestConnectionResult {
  ok: boolean
  model: string
  message: string
}

export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  estimatedUsd: number
}

/** Channel names. Anything not listed here is rejected by the preload bridge. */
export const IPC = {
  keyGetStatus: 'key:getStatus',
  keySet: 'key:set',
  keyClear: 'key:clear',
  keyTest: 'key:test',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  dbInfo: 'db:info',

  appVersions: 'app:versions'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface DbInfo {
  path: string
  schemaVersion: number
  curricula: number
  notes: number
  flashcards: number
}

export interface AppVersions {
  app: string
  electron: string
  chrome: string
  node: string
}

/* ------------------------------------------------------------------ *
 * The API surface exposed on window.api by the preload bridge         *
 * ------------------------------------------------------------------ */

export interface LyceumApi {
  key: {
    getStatus: () => Promise<IpcResult<KeyStatus>>
    set: (apiKey: string) => Promise<IpcResult<KeyStatus>>
    clear: () => Promise<IpcResult<KeyStatus>>
    test: () => Promise<IpcResult<TestConnectionResult>>
  }
  settings: {
    get: () => Promise<IpcResult<Settings>>
    update: (patch: Partial<Settings>) => Promise<IpcResult<Settings>>
  }
  db: {
    info: () => Promise<IpcResult<DbInfo>>
  }
  app: {
    versions: () => Promise<IpcResult<AppVersions>>
  }
}
