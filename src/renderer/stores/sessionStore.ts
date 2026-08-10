import { create } from 'zustand'
import type { Message, SessionDetail, TurnEvent } from '@shared/types'

/** An objective the tutor ticked off during this turn, for a toast. */
export interface ObjectiveToast {
  objectiveId: number
  evidence: string
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

  open: (moduleId: number) => Promise<void>
  send: (text: string) => Promise<void>
  cancel: () => Promise<void>
  dismissToast: (objectiveId: number) => void
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

  open: async (moduleId) => {
    set({ loading: true, error: null, streamingText: '', activeRequestId: null })
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

  handleEvent: (event) => {
    const state = get()
    // Ignore events from a turn the learner has already abandoned.
    if (state.activeRequestId && event.requestId !== state.activeRequestId) return

    switch (event.type) {
      case 'text_delta':
        set({ streamingText: state.streamingText + event.delta })
        break

      case 'tool_result': {
        if (event.hint.kind !== 'objective_met') break
        const { objectiveId, evidence } = event.hint
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
      toasts: []
    })
}))
