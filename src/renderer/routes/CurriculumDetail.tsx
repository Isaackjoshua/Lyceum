import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  ArrowLeft,
  ArchiveRestore,
  Check,
  Circle,
  CircleDot,
  FileDown,
  Layers,
  Loader2,
  Play,
  Trash2
} from 'lucide-react'
import type { ModuleStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useCurriculumStore } from '@/stores/curriculumStore'

const STATUS_ICON: Record<ModuleStatus, JSX.Element> = {
  not_started: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  in_progress: <CircleDot className="h-3.5 w-3.5 text-accent" />,
  completed: <Check className="h-3.5 w-3.5 text-success" />
}

export function CurriculumDetailRoute(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    detail,
    open,
    loading,
    error,
    setModuleStatus,
    setObjectiveStatus,
    remove,
    archive
  } = useCurriculumStore()
  const [exporting, setExporting] = useState<number | null>(null)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [makingCards, setMakingCards] = useState<number | null>(null)

  useEffect(() => {
    if (id) void open(Number(id))
  }, [id, open])

  const exportModule = async (moduleId: number): Promise<void> => {
    setExporting(moduleId)
    setExportNote(null)
    const result = await window.api.exports.modulePdf(moduleId)
    setExporting(null)
    if (!result.ok) {
      setExportNote(result.error)
    } else if (result.data.saved) {
      setExportNote(`Saved to ${result.data.path}`)
    }
  }

  const makeCards = async (moduleId: number): Promise<void> => {
    setMakingCards(moduleId)
    setExportNote(null)
    const result = await window.api.cards.generate(moduleId)
    setMakingCards(null)
    setExportNote(
      result.ok
        ? `Made ${result.data.created} card${result.data.created === 1 ? '' : 's'}` +
            (result.data.skipped > 0 ? `, skipped ${result.data.skipped} duplicate` : '')
        : result.error
    )
  }

  if (loading && !detail) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <p className="text-sm text-muted-foreground">
            {error ?? 'That curriculum could not be found.'}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
            Back to curricula
          </Button>
        </div>
      </div>
    )
  }

  const totalObjectives = detail.modules.reduce((n, m) => n + m.objectives.length, 0)
  const metObjectives = detail.modules.reduce(
    (n, m) => n + m.objectives.filter((o) => o.status === 'met').length,
    0
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="mb-6 flex items-start gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/')}
          aria-label="Back to curricula"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">
            {detail.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{detail.goal}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {detail.modules.length} modules · {metObjectives}/{totalObjectives} objectives
            met · {detail.learnerLevel} level
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            detail.status === 'archived' ? 'Unarchive curriculum' : 'Archive curriculum'
          }
          title={
            detail.status === 'archived'
              ? 'Bring this back into the active list'
              : 'Hide this from the active list without deleting it'
          }
          onClick={() => void archive(detail.id, detail.status !== 'archived')}
        >
          {detail.status === 'archived' ? (
            <ArchiveRestore className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete curriculum"
          onClick={() => {
            if (
              window.confirm(
                `Delete "${detail.title}" and everything in it? This cannot be undone.`
              )
            ) {
              void remove(detail.id).then(() => navigate('/'))
            }
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {exportNote && (
        <p className="mb-4 rounded-md border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          {exportNote}
        </p>
      )}

      <div className="space-y-3">
        {detail.modules.map((module, index) => (
          <Card key={module.id} className="p-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                {String(index + 1).padStart(2, '0')}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {STATUS_ICON[module.status]}
                  <h2 className="font-medium">{module.title}</h2>
                  {module.estMinutes ? (
                    <span className="text-xs text-muted-foreground">
                      ~{module.estMinutes} min
                    </span>
                  ) : null}
                  {module.mastery > 0 && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(module.mastery * 100)}% mastery
                    </span>
                  )}
                </div>

                {module.summary && (
                  <p className="mt-1 text-sm text-muted-foreground">{module.summary}</p>
                )}

                <ul className="mt-3 space-y-1.5">
                  {module.objectives.map((objective) => (
                    <li key={objective.id}>
                      <button
                        type="button"
                        onClick={() =>
                          void setObjectiveStatus(
                            objective.id,
                            objective.status === 'met' ? 'open' : 'met'
                          )
                        }
                        className="group flex w-full items-start gap-2.5 text-left"
                        aria-pressed={objective.status === 'met'}
                      >
                        <span
                          className={cn(
                            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                            objective.status === 'met'
                              ? 'border-success bg-success text-success-foreground'
                              : 'border-input group-hover:border-accent'
                          )}
                        >
                          {objective.status === 'met' && <Check className="h-3 w-3" />}
                        </span>
                        <span
                          className={cn(
                            'text-sm leading-snug',
                            objective.status === 'met'
                              ? 'text-muted-foreground line-through decoration-muted-foreground/40'
                              : ''
                          )}
                        >
                          {objective.text}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button size="sm" onClick={() => navigate(`/module/${module.id}`)}>
                    <Play className="h-3.5 w-3.5" />
                    {module.status === 'not_started' ? 'Start' : 'Continue'}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void exportModule(module.id)}
                    disabled={exporting === module.id}
                  >
                    {exporting === module.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileDown className="h-3.5 w-3.5" />
                    )}
                    PDF
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void makeCards(module.id)}
                    disabled={makingCards === module.id}
                  >
                    {makingCards === module.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Layers className="h-3.5 w-3.5" />
                    )}
                    Cards
                  </Button>

                  {module.status !== 'completed' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void setModuleStatus(module.id, 'completed')}
                    >
                      Mark complete
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void setModuleStatus(module.id, 'in_progress')}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      </div>
    </div>
  )
}
