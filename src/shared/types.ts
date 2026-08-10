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
  /** Messages with an id at or below this are already in `stateSummary`. */
  foldedThroughId: number
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

/** Where the learner stands against their monthly spend cap. */
export interface SpendStatus {
  spentUsd: number
  /** 0 when no cap is set. */
  capUsd: number
  /** spent / cap, 0 when uncapped. */
  fraction: number
  warn: boolean
  /** True only when the learner asked for blocking AND the cap is reached. */
  blocked: boolean
}

export interface BackupResult {
  saved: boolean
  path: string | null
}

export interface RestoreResult {
  restored: boolean
  message: string
}

/* ------------------------------------------------------------------ *
 * Curriculum architect                                                *
 * ------------------------------------------------------------------ */

/** A curriculum the architect proposed but the learner has not saved yet. */
export interface ProposedModule {
  title: string
  summary?: string
  estMinutes?: number
  objectives: string[]
}

export interface CurriculumProposal {
  title: string
  subject: string
  goal: string
  learnerLevel: LearnerLevel
  modules: ProposedModule[]
}

/** One turn of the pre-save diagnostic conversation. */
export interface ArchitectMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ArchitectTurnResult {
  /** The architect's prose for this turn (its calibrating question, usually). */
  text: string
  /** Present once it has enough to draft a syllabus. */
  proposal: CurriculumProposal | null
}

/** A curriculum with its modules and objectives, for the tree view. */
export interface CurriculumDetail extends Curriculum {
  modules: (Module & { objectives: Objective[] })[]
}

export interface CurriculumSummary extends Curriculum {
  moduleCount: number
  completedModules: number
  noteCount: number
}

/* ------------------------------------------------------------------ *
 * Tutor session streaming                                             *
 * ------------------------------------------------------------------ */

/** A visual the tutor asked to render inline. */
export interface VisualPayload {
  format: 'svg' | 'mermaid' | 'html'
  code: string
  caption?: string
}

/** A note the tutor proactively offered to save. */
export interface NoteSuggestion {
  type: NoteType
  title: string
  content: string
  sourceExcerpt?: string
}

/**
 * Events streamed from main to the renderer during a turn. Every event carries
 * the requestId of the turn that produced it, so a late event from an
 * abandoned turn can be ignored.
 */
export type TurnEvent =
  | { type: 'text_delta'; requestId: string; delta: string }
  | { type: 'tool_start'; requestId: string; tool: string }
  | {
      type: 'tool_result'
      requestId: string
      tool: string
      /** Renderer hint — what to draw as a result of this tool call. */
      hint:
        | { kind: 'objective_met'; objectiveId: number; evidence: string }
        | { kind: 'note_suggested'; suggestion: NoteSuggestion }
        | { kind: 'visual'; visual: VisualPayload }
        | { kind: 'quiz_proposed'; moduleId: number; focus: string | null }
    }
  | { type: 'usage'; requestId: string; inputTokens: number; outputTokens: number; estimatedUsd: number }
  | { type: 'done'; requestId: string; messageId: number }
  | { type: 'error'; requestId: string; message: string }

export interface SessionDetail {
  session: Session
  module: Module & { objectives: Objective[] }
  curriculum: Curriculum
  messages: Message[]
}

export interface SendMessageArgs {
  sessionId: number
  text: string
  requestId: string
}

/* ------------------------------------------------------------------ *
 * Notes                                                               *
 * ------------------------------------------------------------------ */

export interface CreateNoteArgs {
  curriculumId?: number | null
  moduleId?: number | null
  sessionId?: number | null
  messageId?: number | null
  type: NoteType
  title: string
  content: string
  annotation?: string | null
  sourceExcerpt?: string | null
  tags?: string[]
}

export interface NoteFilter {
  curriculumId?: number | null
  moduleId?: number | null
  type?: NoteType | null
  search?: string | null
}

export interface ExportResult {
  /** False when the learner dismissed the save dialog. */
  saved: boolean
  path: string | null
}

/* ------------------------------------------------------------------ *
 * Quizzes                                                             *
 * ------------------------------------------------------------------ */

export interface QuizDetail {
  quiz: Quiz
  questions: QuizQuestion[]
  module: Module
}

/** Per-question outcome after grading. */
export interface GradedAnswer {
  questionId: number
  /** 0, 0.5 or 1. */
  score: number
  correct: boolean
  feedback: string | null
  answer: string
  explanation: string
}

export interface QuizResult {
  attemptId: number
  score: number
  answers: GradedAnswer[]
  /** The module's recomputed mastery, 0..1. */
  mastery: number
}

/* ------------------------------------------------------------------ *
 * Spaced repetition                                                   *
 * ------------------------------------------------------------------ */

/** Anki-style self-grade. 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type ReviewRating = 1 | 2 | 3 | 4

export interface DueCard {
  id: number
  front: string
  back: string
  moduleId: number | null
  moduleTitle: string | null
  due: number
  reps: number
  lapses: number
  /** FSRS state: 0 New, 1 Learning, 2 Review, 3 Relearning. */
  state: number
}

export interface ReviewQueue {
  cards: DueCard[]
  dueCount: number
  newCount: number
  totalCards: number
}

/** What each rating would schedule, so the UI can show the intervals. */
export interface ReviewPreview {
  rating: ReviewRating
  /** Human-readable interval, e.g. "10m", "3d". */
  interval: string
}

export interface CardGenerationResult {
  created: number
  skipped: number
}

/* ------------------------------------------------------------------ *
 * Dashboard                                                           *
 * ------------------------------------------------------------------ */

export interface ModuleMastery {
  moduleId: number
  moduleTitle: string
  curriculumId: number
  curriculumTitle: string
  mastery: number
  status: ModuleStatus
  objectivesMet: number
  objectivesTotal: number
}

export interface WeakArea {
  moduleId: number
  moduleTitle: string
  curriculumTitle: string
  reason: string
  mastery: number
}

export interface DashboardStats {
  /** Share of all modules completed, 0..1. */
  completion: number
  modulesCompleted: number
  modulesTotal: number
  objectivesMet: number
  objectivesTotal: number
  /** Consecutive days with a session, review or quiz. */
  streakDays: number
  /** Days active in the last 30. */
  activeDaysLast30: number
  /** Minutes on task per day for the last 14 days, oldest first. */
  minutesPerDay: { date: string; minutes: number }[]
  dueToday: number
  totalCards: number
  notesTotal: number
  mastery: ModuleMastery[]
  weakAreas: WeakArea[]
  /** Estimated spend this calendar month, USD. */
  spendThisMonthUsd: number
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

  appVersions: 'app:versions',

  curriculumArchitectTurn: 'curriculum:architectTurn',
  curriculumSave: 'curriculum:save',
  curriculumList: 'curriculum:list',
  curriculumGet: 'curriculum:get',
  curriculumDelete: 'curriculum:delete',

  moduleSetStatus: 'module:setStatus',
  objectiveSetStatus: 'objective:setStatus',

  sessionStart: 'session:start',
  sessionGet: 'session:get',
  sessionSend: 'session:send',
  sessionCancel: 'session:cancel',

  notesCreate: 'notes:create',
  notesList: 'notes:list',
  notesUpdate: 'notes:update',
  notesDelete: 'notes:delete',

  exportModulePdf: 'export:modulePdf',

  quizGenerate: 'quiz:generate',
  quizGet: 'quiz:get',
  quizLatest: 'quiz:latest',
  quizSubmit: 'quiz:submit',

  cardsGenerate: 'cards:generate',
  cardsDueQueue: 'cards:dueQueue',
  cardsReview: 'cards:review',
  cardsPreview: 'cards:preview',
  cardsSuspend: 'cards:suspend',
  cardsDelete: 'cards:delete',

  dashboardStats: 'dashboard:stats',

  usageSpendStatus: 'usage:spendStatus',
  usageSession: 'usage:session',

  dataBackup: 'data:backup',
  dataRestore: 'data:restore',
  dataDeleteAll: 'data:deleteAll',

  curriculumArchive: 'curriculum:archive',

  /** main -> renderer, one-way. */
  streamEvent: 'stream:event'
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
  curriculum: {
    architectTurn: (
      messages: ArchitectMessage[],
      requestId: string
    ) => Promise<IpcResult<ArchitectTurnResult>>
    save: (proposal: CurriculumProposal) => Promise<IpcResult<CurriculumDetail>>
    list: (includeArchived?: boolean) => Promise<IpcResult<CurriculumSummary[]>>
    get: (curriculumId: number) => Promise<IpcResult<CurriculumDetail>>
    delete: (curriculumId: number) => Promise<IpcResult<null>>
    archive: (curriculumId: number, archived: boolean) => Promise<IpcResult<null>>
  }
  module: {
    setStatus: (moduleId: number, status: ModuleStatus) => Promise<IpcResult<Module>>
  }
  objective: {
    setStatus: (
      objectiveId: number,
      status: ObjectiveStatus
    ) => Promise<IpcResult<Objective>>
  }
  session: {
    start: (moduleId: number) => Promise<IpcResult<SessionDetail>>
    get: (sessionId: number) => Promise<IpcResult<SessionDetail>>
    send: (args: SendMessageArgs) => Promise<IpcResult<null>>
    cancel: (requestId: string) => Promise<IpcResult<null>>
    /** Subscribes to streamed turn events. Returns an unsubscribe function. */
    onEvent: (listener: (event: TurnEvent) => void) => () => void
  }
  notes: {
    create: (args: CreateNoteArgs) => Promise<IpcResult<Note>>
    list: (filter: NoteFilter) => Promise<IpcResult<Note[]>>
    update: (noteId: number, patch: Partial<CreateNoteArgs>) => Promise<IpcResult<Note>>
    delete: (noteId: number) => Promise<IpcResult<null>>
  }
  exports: {
    modulePdf: (moduleId: number) => Promise<IpcResult<ExportResult>>
  }
  quiz: {
    generate: (moduleId: number, focus?: string | null) => Promise<IpcResult<QuizDetail>>
    get: (quizId: number) => Promise<IpcResult<QuizDetail>>
    latest: (moduleId: number) => Promise<IpcResult<QuizDetail | null>>
    submit: (
      quizId: number,
      responses: Record<string, string>
    ) => Promise<IpcResult<QuizResult>>
  }
  cards: {
    generate: (moduleId: number) => Promise<IpcResult<CardGenerationResult>>
    dueQueue: (moduleId?: number | null) => Promise<IpcResult<ReviewQueue>>
    review: (cardId: number, rating: ReviewRating) => Promise<IpcResult<null>>
    preview: (cardId: number) => Promise<IpcResult<ReviewPreview[]>>
    suspend: (cardId: number, suspended: boolean) => Promise<IpcResult<null>>
    delete: (cardId: number) => Promise<IpcResult<null>>
  }
  dashboard: {
    stats: () => Promise<IpcResult<DashboardStats>>
  }
  usage: {
    spendStatus: () => Promise<IpcResult<SpendStatus>>
    session: (sessionId: number) => Promise<IpcResult<UsageTotals>>
  }
  data: {
    backup: () => Promise<IpcResult<BackupResult>>
    restore: () => Promise<IpcResult<RestoreResult>>
    deleteAll: () => Promise<IpcResult<boolean>>
  }
}
