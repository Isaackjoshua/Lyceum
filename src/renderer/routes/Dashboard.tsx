import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, LayoutDashboard, Loader2, TrendingDown } from 'lucide-react'
import type { DashboardStats } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn, formatUsd } from '@/lib/utils'

function Stat({
  label,
  value,
  hint
}: {
  label: string
  value: string
  hint?: string
}): JSX.Element {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-serif text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  )
}

/** Mastery colour ramp. Grey means "no evidence yet", not "bad". */
function masteryClass(mastery: number, status: string): string {
  if (status === 'not_started' || mastery === 0) return 'bg-secondary'
  if (mastery < 0.4) return 'bg-destructive/60'
  if (mastery < 0.7) return 'bg-accent/60'
  return 'bg-success/70'
}

export function DashboardRoute(): JSX.Element {
  const navigate = useNavigate()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.dashboard.stats().then((result) => {
      if (result.ok) setStats(result.data)
      else setError(result.error)
    })
  }, [])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (stats.modulesTotal === 0) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <LayoutDashboard className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 font-serif text-xl font-semibold">Nothing to show yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Progress appears here once you have a curriculum and a session or two
            behind you.
          </p>
          <Button className="mt-5" onClick={() => navigate('/new')}>
            Build a curriculum
          </Button>
        </div>
      </div>
    )
  }

  const peakMinutes = Math.max(1, ...stats.minutesPerDay.map((d) => d.minutes))
  const byCurriculum = new Map<string, typeof stats.mastery>()
  for (const m of stats.mastery) {
    const list = byCurriculum.get(m.curriculumTitle) ?? []
    list.push(m)
    byCurriculum.set(m.curriculumTitle, list)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-8 py-10">
        <header className="mb-6">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Progress</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.objectivesMet} of {stats.objectivesTotal} objectives met across{' '}
            {stats.modulesTotal} modules
          </p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Completion"
            value={`${Math.round(stats.completion * 100)}%`}
            hint={`${stats.modulesCompleted}/${stats.modulesTotal} modules`}
          />
          <Stat
            label="Streak"
            value={`${stats.streakDays}d`}
            hint={`${stats.activeDaysLast30} active days in 30`}
          />
          <Stat
            label="Due now"
            value={String(stats.dueToday)}
            hint={`${stats.totalCards} cards total`}
          />
          <Stat
            label="Spend this month"
            value={formatUsd(stats.spendThisMonthUsd)}
            hint="estimated"
          />
        </div>

        {/* ------------------------------------------------- time on task */}
        <Card className="mb-6 p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Time on task</h2>
            <span className="text-xs text-muted-foreground">last 14 days</span>
          </div>
          <div className="flex h-24 items-end gap-1.5">
            {stats.minutesPerDay.map((day) => (
              <div key={day.date} className="group relative flex-1">
                <div
                  className={cn(
                    'w-full rounded-sm transition-colors',
                    day.minutes > 0 ? 'bg-accent/70' : 'bg-secondary'
                  )}
                  style={{
                    height: `${Math.max(3, (day.minutes / peakMinutes) * 96)}px`
                  }}
                />
                <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-card px-1.5 py-0.5 text-[10px] shadow group-hover:block">
                  {day.minutes}m
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
            <span>{stats.minutesPerDay[0]?.date.slice(5)}</span>
            <span>today</span>
          </div>
        </Card>

        {/* ---------------------------------------------- weak areas */}
        {stats.weakAreas.length > 0 && (
          <Card className="mb-6 p-5">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <TrendingDown className="h-4 w-4 text-accent" /> Worth revisiting
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Based on quiz scores and cards you keep forgetting.
            </p>
            <div className="space-y-2">
              {stats.weakAreas.map((area) => (
                <button
                  key={area.moduleId}
                  type="button"
                  onClick={() => navigate(`/module/${area.moduleId}`)}
                  className="flex w-full items-center justify-between rounded-md border p-3 text-left transition-colors hover:border-accent/50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{area.moduleTitle}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {area.curriculumTitle} · {area.reason}
                    </p>
                  </div>
                  <span className="ml-3 shrink-0 text-xs text-accent">Study →</span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* ------------------------------------------------ mastery grid */}
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold">Mastery</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Blended from your best quiz score and how well your cards are sticking.
          </p>

          <div className="space-y-5">
            {[...byCurriculum.entries()].map(([title, modules]) => (
              <div key={title}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
                <div className="space-y-1.5">
                  {modules.map((module) => (
                    <button
                      key={module.moduleId}
                      type="button"
                      onClick={() => navigate(`/module/${module.moduleId}`)}
                      className="flex w-full items-center gap-3 text-left"
                    >
                      <span className="w-48 shrink-0 truncate text-xs">
                        {module.moduleTitle}
                      </span>
                      <span className="h-4 flex-1 overflow-hidden rounded-sm bg-secondary">
                        <span
                          className={cn(
                            'block h-full rounded-sm transition-all',
                            masteryClass(module.mastery, module.status)
                          )}
                          style={{ width: `${Math.max(2, module.mastery * 100)}%` }}
                        />
                      </span>
                      <span className="w-16 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {module.mastery > 0
                          ? `${Math.round(module.mastery * 100)}%`
                          : '—'}
                      </span>
                      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                        {module.objectivesMet}/{module.objectivesTotal}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {stats.mastery.every((m) => m.mastery === 0) && (
            <p className="mt-4 flex items-center gap-2 rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground">
              <Flame className="h-3.5 w-3.5 shrink-0" />
              Mastery stays at zero until you take a checkpoint or review some cards —
              it measures evidence, not time spent.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
