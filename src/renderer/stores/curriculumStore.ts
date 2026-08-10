import { create } from 'zustand'
import type {
  CurriculumDetail,
  CurriculumSummary,
  ModuleStatus,
  ObjectiveStatus
} from '@shared/types'

interface CurriculumState {
  list: CurriculumSummary[]
  detail: CurriculumDetail | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  open: (curriculumId: number) => Promise<void>
  remove: (curriculumId: number) => Promise<void>
  setModuleStatus: (moduleId: number, status: ModuleStatus) => Promise<void>
  setObjectiveStatus: (objectiveId: number, status: ObjectiveStatus) => Promise<void>
}

export const useCurriculumStore = create<CurriculumState>((set, get) => ({
  list: [],
  detail: null,
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true })
    const result = await window.api.curriculum.list()
    set(
      result.ok
        ? { list: result.data, loading: false, error: null }
        : { loading: false, error: result.error }
    )
  },

  open: async (curriculumId) => {
    set({ loading: true, error: null })
    const result = await window.api.curriculum.get(curriculumId)
    set(
      result.ok
        ? { detail: result.data, loading: false }
        : { loading: false, error: result.error }
    )
  },

  remove: async (curriculumId) => {
    const result = await window.api.curriculum.delete(curriculumId)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    const detail = get().detail
    set({ detail: detail?.id === curriculumId ? null : detail })
    await get().refresh()
  },

  setModuleStatus: async (moduleId, status) => {
    const result = await window.api.module.setStatus(moduleId, status)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    const detail = get().detail
    if (!detail) return
    set({
      detail: {
        ...detail,
        modules: detail.modules.map((m) =>
          m.id === moduleId ? { ...m, ...result.data, objectives: m.objectives } : m
        )
      }
    })
  },

  setObjectiveStatus: async (objectiveId, status) => {
    const result = await window.api.objective.setStatus(objectiveId, status)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    const detail = get().detail
    if (!detail) return
    set({
      detail: {
        ...detail,
        modules: detail.modules.map((m) => ({
          ...m,
          objectives: m.objectives.map((o) => (o.id === objectiveId ? result.data : o))
        }))
      }
    })
  }
}))
