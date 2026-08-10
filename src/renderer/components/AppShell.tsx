import { useEffect, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  GraduationCap,
  LayoutDashboard,
  Layers,
  Plus,
  Settings2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCurriculumStore } from '@/stores/curriculumStore'
import { useSettingsStore } from '@/stores/settingsStore'

const SECONDARY_NAV = [
  { to: '/review', label: 'Review', icon: <Layers className="h-4 w-4" /> },
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings2 className="h-4 w-4" /> }
]

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-card font-medium text-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'
  )

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  // Readiness now means: the provider behind the chosen tutor model is usable.
  const settings = useSettingsStore((s) => s.settings)
  const { list, refresh } = useCurriculumStore()
  const location = useLocation()

  const needsKey = settings !== null && !settings.keyPresent
  const onSettings = location.pathname === '/settings'

  useEffect(() => {
    void refresh()
  }, [refresh, location.pathname])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-secondary/40">
        <div className="flex items-center gap-2 px-4 py-4">
          <GraduationCap className="h-5 w-5 text-accent" />
          <span className="font-serif text-lg font-semibold tracking-tight">Lyceum</span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2">
          <div className="mb-1 flex items-center justify-between px-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Curricula
            </span>
            <NavLink
              to="/new"
              aria-label="New curriculum"
              className="rounded p-0.5 text-muted-foreground hover:bg-card hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </NavLink>
          </div>

          <nav className="flex flex-col gap-0.5" aria-label="Curricula">
            {list.length === 0 && (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">None yet</p>
            )}
            {list.map((curriculum) => {
              const pct =
                curriculum.moduleCount > 0
                  ? Math.round(
                      (curriculum.completedModules / curriculum.moduleCount) * 100
                    )
                  : 0
              return (
                <NavLink
                  key={curriculum.id}
                  to={`/curriculum/${curriculum.id}`}
                  className={({ isActive }) =>
                    cn(
                      'rounded-md px-3 py-2 transition-colors',
                      isActive
                        ? 'bg-card shadow-sm'
                        : 'hover:bg-card/60'
                    )
                  }
                >
                  <span className="line-clamp-2 text-xs font-medium leading-snug">
                    {curriculum.title}
                  </span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <span className="h-1 flex-1 overflow-hidden rounded-full bg-border">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {curriculum.completedModules}/{curriculum.moduleCount}
                    </span>
                  </span>
                </NavLink>
              )
            })}
          </nav>

          <nav className="mt-4 flex flex-col gap-0.5 border-t pt-3" aria-label="Main">
            {SECONDARY_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass}>
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="p-3">
          {needsKey && !onSettings && (
            <NavLink
              to="/settings"
              className="block rounded-md border border-accent/40 bg-accent/10 p-3 text-xs leading-relaxed text-foreground hover:bg-accent/15"
            >
              <span className="font-medium">No model configured.</span> Pick a
              provider and add its key in Settings to start learning.
            </NavLink>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  )
}
