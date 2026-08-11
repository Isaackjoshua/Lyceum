import { create } from 'zustand'
import type {
  Message,
  NoteSuggestion,
  SessionDetail,
  TurnEvent,
  VisualPayload
} from '@shared/types'

/** An objective the tutor ticked off during this turn, for a toast. */
export interface ObjectiveToast {
  objectiveId: number
  evidence: string
}

/** A pending offer from the tutor, shown as a chip under the reply. */
export interface NoteChip {
  id: string
  suggestion: NoteSuggestion
}

export interface QuizOffer {
  moduleId: number
  focus: string | null
}

interface SessionState {
  detail: SessionDetail | null
  loading: boolean
  error: string | null
  /** Text accumulating from the current stream, before it is persisted. */
  streamingText: string
  /** The in-flight turn, or null when idle. */
  activeRequestId: string | null
  toasts: ObjectiveToast[]
  /** True while an earlier page of the transcript is being fetched. */
  loadingEarlier: boolean
  /** Visuals produced during the turn that is currently streaming. */
  visuals: VisualPayload[]
  noteChips: NoteChip[]
  quizOffer: QuizOffer | null

  open: (moduleId: number) => Promise<void>
  loadEarlier: () => Promise<void>
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  dismissToast: (objectiveId: number) => void
  dismissChip: (id: string) => void
  dismissQuizOffer: () => void
  handleEvent: (event: TurnEvent) => void
  reset: () => void
}

function newRequestId(): string {
  return crypto.randomUUID()
}

export const useSessionStore = create<SessionState>((set, get) => ({
  detail: null,
  loading: false,
  error: null,
  streamingText: '',
  activeRequestId: null,
  toasts: [],
  loadingEarlier: false,
  visuals: [],
  noteChips: [],
  quizOffer: null,

  loadEarlier: async () => {
    const state = get()
    const detail = state.detail
    const oldest = detail?.messages[0]
    if (!detail || !oldest || state.loadingEarlier) return

    set({ loadingEarlier: true })
    const result = await window.api.session.earlier(detail.session.id, oldest.id)
    if (!result.ok) {
      set({ loadingEarlier: false, error: result.error })
      return
    }

    // Re-read: a turn may have completed while this was in flight.
    const current = get().detail
    set({
      loadingEarlier: false,
      detail: current
        ? { ...current, messages: [...result.data, ...current.messages] }
        : current
    })
  },

  open: async (moduleId) => {
    set({
      loading: true,
      error: null,
      streamingText: '',
      activeRequestId: null,
      visuals: [],
      noteChips: [],
      quizOffer: null
    })
    const result = await window.api.session.start(moduleId)
    set(
      result.ok
        ? { detail: result.data, loading: false }
        : { loading: false, error: result.error }
    )
  },

  send: async (text) => {
    const detail = get().detail
    if (!detail || get().activeRequestId) return

    const requestId = newRequestId()
    // Optimistic echo so the learner's message appears instantly.
    const optimistic: Message = {
      id: -Date.now(),
      sessionId: detail.session.id,
      role: 'user',
      content: text,
      meta: null,
      createdAt: Date.now()
    }

    set({
      activeRequestId: requestId,
      streamingText: '',
      error: null,
      visuals: [],
      noteChips: [],
      quizOffer: null,
      detail: { ...detail, messages: [...detail.messages, optimistic] }
    })

    const result = await window.api.session.send({
      sessionId: detail.session.id,
      text,
      requestId
    })

    if (!result.ok) {
      // The 'error' stream event usually lands first; this is the backstop.
      set({ activeRequestId: null, error: result.error })
    }
  },

  cancel: async () => {
    const requestId = get().activeRequestId
    if (!requestId) return
    await window.api.session.cancel(requestId)
    set({ activeRequestId: null, streamingText: '' })
  },

  dismissToast: (objectiveId) =>
    set({ toasts: get().toasts.filter((t) => t.objectiveId !== objectiveId) }),

  dismissChip: (id) => set({ noteChips: get().noteChips.filter((c) => c.id !== id) }),

  dismissQuizOffer: () => set({ quizOffer: null }),

  handleEvent: (event) => {
    const state = get()
    // Ignore anything that is not from the turn in flight. A null active id
    // means no turn is running, so a late event from a cancelled or finished
    // one must be dropped rather than appended to the next reply.
    if (event.requestId !== state.activeRequestId) return

    switch (event.type) {
      case 'text_delta':
        set({ streamingText: state.streamingText + event.delta })
        break

      case 'tool_result': {
        const hint = event.hint
        if (hint.kind === 'objective_met') {
          const { objectiveId, evidence } = hint
          const detail = state.detail
          set({
            toasts: [...state.toasts, { objectiveId, evidence }],
            detail: detail
              ? {
                  ...detail,
                  module: {
                    ...detail.module,
                    objectives: detail.module.objectives.map((o) =>
                      o.id === objectiveId ? { ...o, status: 'met' as const } : o
                    )
                  }
                }
              : detail
          })
        } else if (hint.kind === 'visual') {
          set({ visuals: [...state.visuals, hint.visual] })
        } else if (hint.kind === 'note_suggested') {
          set({
            noteChips: [
              ...state.noteChips,
              { id: crypto.randomUUID(), suggestion: hint.suggestion }
            ]
          })
        } else if (hint.kind === 'quiz_proposed') {
          set({ quizOffer: { moduleId: hint.moduleId, focus: hint.focus } })
        }
        break
      }

      case 'done': {
        // Reload from the database: it holds the authoritative transcript,
        // including the row ids that note capture needs.
        const detail = state.detail
        set({ activeRequestId: null, streamingText: '' })
        if (detail) {
          void window.api.session.get(detail.session.id).then((result) => {
            if (result.ok) set({ detail: result.data })
          })
        }
        break
      }

      case 'error':
        set({ activeRequestId: null, streamingText: '', error: event.message })
        break

      default:
        break
    }
  },

  reset: () =>
    set({
      detail: null,
      streamingText: '',
      activeRequestId: null,
      error: null,
      toasts: [],
      loadingEarlier: false,
      visuals: [],
      noteChips: [],
      quizOffer: null
    })
}))
