import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/AppShell'
import { CurriculaRoute } from '@/routes/Curricula'
import { CurriculumDetailRoute } from '@/routes/CurriculumDetail'
import { DashboardRoute } from '@/routes/Dashboard'
import { NewCurriculumRoute } from '@/routes/NewCurriculum'
import { QuizRoute } from '@/routes/Quiz'
import { ReviewRoute } from '@/routes/Review'
import { SessionRoute } from '@/routes/Session'
import { SettingsRoute } from '@/routes/Settings'
import { applyAppearance, useSettingsStore } from '@/stores/settingsStore'

export function App(): JSX.Element {
  const { load, settings, loading, error } = useSettingsStore()

  useEffect(() => {
    void load()
  }, [load])

  // Track the OS theme while "system" is selected.
  useEffect(() => {
    if (!settings || settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => applyAppearance(settings)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [settings])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Starting Lyceum…
      </div>
    )
  }

  if (error && !settings) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-lg font-semibold">Lyceum could not start</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<CurriculaRoute />} />
          <Route path="/new" element={<NewCurriculumRoute />} />
          <Route path="/curriculum/:id" element={<CurriculumDetailRoute />} />
          <Route path="/module/:moduleId" element={<SessionRoute />} />
          <Route path="/module/:moduleId/quiz" element={<QuizRoute />} />
          <Route path="/review" element={<ReviewRoute />} />
          <Route path="/dashboard" element={<DashboardRoute />} />
          <Route path="/settings" element={<SettingsRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </HashRouter>
  )
}
