import { BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useSettingsStore } from '@/stores/settingsStore'

/**
 * Placeholder for Phase 1, where this becomes the curriculum list plus the
 * "new curriculum" flow (topic -> diagnostic -> editable tree -> saved).
 */
export function CurriculaRoute(): JSX.Element {
  const keyStatus = useSettingsStore((s) => s.keyStatus)
  const hasKey = keyStatus?.present ?? false

  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="max-w-md text-center">
        <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
        <h1 className="mt-4 font-serif text-xl font-semibold">Nothing to learn yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {hasKey
            ? 'Curriculum building arrives in Phase 1. Tell Lyceum a subject and a goal, answer one calibrating question, and it will draft a syllabus you can edit before saving.'
            : 'Add your Anthropic API key first — Lyceum needs it to reach Claude.'}
        </p>
        {!hasKey && (
          <Button asChild className="mt-5">
            <Link to="/settings">Open Settings</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
