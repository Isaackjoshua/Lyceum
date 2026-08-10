import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BookOpen, GraduationCap, LayoutDashboard, Layers, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

const NAV: NavItem[] = [
  { to: '/', label: 'Curricula', icon: <BookOpen className="h-4 w-4" /> },
  { to: '/review', label: 'Review', icon: <Layers className="h-4 w-4" /> },
  { to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/settings', label: 'Settings', icon: <Settings2 className="h-4 w-4" /> }
]

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const keyStatus = useSettingsStore((s) => s.keyStatus)
  const location = useLocation()
  const needsKey = keyStatus !== null && !keyStatus.present
  const onSettings = location.pathname === '/settings'

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-secondary/40">
        <div className="flex items-center gap-2 px-4 py-4">
          <GraduationCap className="h-5 w-5 text-accent" />
          <span className="font-serif text-lg font-semibold tracking-tight">Lyceum</span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-card font-medium text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto p-3">
          {needsKey && !onSettings && (
            <NavLink
              to="/settings"
              className="block rounded-md border border-accent/40 bg-accent/10 p-3 text-xs leading-relaxed text-foreground hover:bg-accent/15"
            >
              <span className="font-medium">No API key yet.</span>{' '}
              Add your Anthropic key in Settings to start learning.
            </NavLink>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
