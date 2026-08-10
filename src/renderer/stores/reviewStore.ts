import { create } from 'zustand'
import type { DueCard, ReviewPreview, ReviewRating, ReviewQueue } from '@shared/types'

interface ReviewState {
  queue: DueCard[]
  index: number
  revealed: boolean
  previews: ReviewPreview[]
  dueCount: number
  totalCards: number
  reviewedThisSession: number
  loading: boolean
  error: string | null

  load: (moduleId?: number | null) => Promise<void>
  reveal: () => Promise<void>
  grade: (rating: ReviewRating) => Promise<void>
  skip: () => void
  reset: () => void
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  queue: [],
  index: 0,
  revealed: false,
  previews: [],
  dueCount: 0,
  totalCards: 0,
  reviewedThisSession: 0,
  loading: false,
  error: null,

  load: async (moduleId) => {
    set({ loading: true, error: null })
    const result = await window.api.cards.dueQueue(moduleId ?? null)
    if (!result.ok) {
      set({ loading: false, error: result.error })
      return
    }
    const queue: ReviewQueue = result.data
    set({
      queue: queue.cards,
      index: 0,
      revealed: false,
      previews: [],
      dueCount: queue.dueCount,
      totalCards: queue.totalCards,
      loading: false
    })
  },

  reveal: async () => {
    const card = get().queue[get().index]
    set({ revealed: true })
    if (!card) return
    // Intervals are computed in main by FSRS; the UI never guesses them.
    const result = await window.api.cards.preview(card.id)
    if (result.ok && get().revealed) set({ previews: result.data })
  },

  grade: async (rating) => {
    const state = get()
    const card = state.queue[state.index]
    if (!card) return

    const result = await window.api.cards.review(card.id, rating)
    if (!result.ok) {
      set({ error: result.error })
      return
    }

    set({
      index: state.index + 1,
      revealed: false,
      previews: [],
      reviewedThisSession: state.reviewedThisSession + 1,
      dueCount: Math.max(0, state.dueCount - 1)
    })
  },

  skip: () => set({ index: get().index + 1, revealed: false, previews: [] }),

  reset: () =>
    set({
      queue: [],
      index: 0,
      revealed: false,
      previews: [],
      reviewedThisSession: 0,
      error: null
    })
}))
