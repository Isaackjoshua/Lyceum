import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Archive, BookOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useCurriculumStore } from '@/stores/curriculumStore'
import { useSettingsStore } from '@/stores/settingsStore'

export function CurriculaRoute(): JSX.Element {
  const navigate = useNavigate()
  const { list, refresh, loading, showArchived, setShowArchived } = useCurriculumStore()
  const keyStatus = useSettingsStore((s) => s.keyStatus)
  const hasKey = keyStatus?.present ?? false

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!loading && list.length === 0 && !showArchived) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 font-serif text-xl font-semibold">Nothing to learn yet</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {hasKey
              ? 'Tell Lyceum a subject and a goal. It will ask one calibrating question, then draft a syllabus you can edit before saving.'
              : 'Add your Anthropic API key first — Lyceum needs it to reach Claude.'}
          </p>
          <Button
            className="mt-5"
            onClick={() => navigate(hasKey ? '/new' : '/settings')}
          >
            {hasKey ? (
              <>
                <Plus className="h-4 w-4" /> New curriculum
              </>
            ) : (
              'Open Settings'
            )}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Curricula</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {list.length} active course{list.length === 1 ? '' : 's'} of study
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showArchived ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => void setShowArchived(!showArchived)}
          >
            <Archive className="h-4 w-4" />
            {showArchived ? 'Hiding none' : 'Show archived'}
          </Button>
          <Button onClick={() => navigate('/new')} disabled={!hasKey}>
            <Plus className="h-4 w-4" /> New
          </Button>
        </div>
      </header>

      <div className="space-y-3">
        {list.map((curriculum) => {
          const pct =
            curriculum.moduleCount > 0
              ? Math.round((curriculum.completedModules / curriculum.moduleCount) * 100)
              : 0
          return (
            <Link key={curriculum.id} to={`/curriculum/${curriculum.id}`}>
              <Card className="p-5 transition-colors hover:border-accent/50">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="font-serif text-base font-semibold">
                    {curriculum.title}
                    {curriculum.status === 'archived' && (
                      <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        archived
                      </span>
                    )}
                  </h2>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {curriculum.completedModules}/{curriculum.moduleCount} modules
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {curriculum.goal}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {pct}%
                  </span>
                  {curriculum.noteCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {curriculum.noteCount} notes
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          )
        })}
      </div>
      </div>
    </div>
  )
}
