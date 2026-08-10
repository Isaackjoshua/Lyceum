import { create } from 'zustand'
import type { CreateNoteArgs, Note, NoteFilter } from '@shared/types'

interface NotesState {
  notes: Note[]
  filter: NoteFilter
  open: boolean
  loading: boolean
  error: string | null

  setOpen: (open: boolean) => void
  setFilter: (filter: NoteFilter) => Promise<void>
  refresh: () => Promise<void>
  create: (args: CreateNoteArgs) => Promise<Note | null>
  update: (noteId: number, patch: Partial<CreateNoteArgs>) => Promise<void>
  remove: (noteId: number) => Promise<void>
}

export const useNotesStore = create<NotesState>((set, get) => ({
  notes: [],
  filter: {},
  open: false,
  loading: false,
  error: null,

  setOpen: (open) => {
    set({ open })
    if (open) void get().refresh()
  },

  setFilter: async (filter) => {
    set({ filter })
    await get().refresh()
  },

  refresh: async () => {
    set({ loading: true })
    const result = await window.api.notes.list(get().filter)
    set(
      result.ok
        ? { notes: result.data, loading: false, error: null }
        : { loading: false, error: result.error }
    )
  },

  create: async (args) => {
    const result = await window.api.notes.create(args)
    if (!result.ok) {
      set({ error: result.error })
      return null
    }
    await get().refresh()
    return result.data
  },

  update: async (noteId, patch) => {
    const result = await window.api.notes.update(noteId, patch)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set({ notes: get().notes.map((n) => (n.id === noteId ? result.data : n)) })
  },

  remove: async (noteId) => {
    const result = await window.api.notes.delete(noteId)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set({ notes: get().notes.filter((n) => n.id !== noteId) })
  }
}))
