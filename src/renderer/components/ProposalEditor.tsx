import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2
} from 'lucide-react'
import type { CurriculumProposal, ProposedModule } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'

/**
 * The editable curriculum tree. The learner owns this plan — every field the
 * architect produced can be rewritten, reordered or deleted before saving.
 */
export function ProposalEditor({
  proposal,
  saving,
  onSave,
  onCancel
}: {
  proposal: CurriculumProposal
  saving: boolean
  onSave: (edited: CurriculumProposal) => void
  onCancel: () => void
}): JSX.Element {
  const [draft, setDraft] = useState<CurriculumProposal>(proposal)

  const patchModule = (index: number, patch: Partial<ProposedModule>): void => {
    setDraft({
      ...draft,
      modules: draft.modules.map((m, i) => (i === index ? { ...m, ...patch } : m))
    })
  }

  const moveModule = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= draft.modules.length) return
    const modules = [...draft.modules]
    const [moved] = modules.splice(index, 1)
    modules.splice(target, 0, moved!)
    setDraft({ ...draft, modules })
  }

  const removeModule = (index: number): void => {
    setDraft({ ...draft, modules: draft.modules.filter((_, i) => i !== index) })
  }

  const addModule = (): void => {
    setDraft({
      ...draft,
      modules: [...draft.modules, { title: '', objectives: [''] }]
    })
  }

  const totalMinutes = draft.modules.reduce((sum, m) => sum + (m.estMinutes ?? 0), 0)
  const canSave =
    draft.title.trim().length > 0 &&
    draft.modules.length > 0 &&
    draft.modules.every((m) => m.title.trim().length > 0) &&
    !saving

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Curriculum title
        </label>
        <Input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="mb-4 font-serif text-base"
        />
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Your goal
        </label>
        <Input
          value={draft.goal}
          onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {draft.modules.length} module{draft.modules.length === 1 ? '' : 's'} · pitched
          at {draft.learnerLevel} level
          {totalMinutes > 0 && ` · about ${Math.round(totalMinutes / 60)}h of study`}
        </p>
      </Card>

      <div className="space-y-3">
        {draft.modules.map((module, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-start gap-2">
              <div className="flex flex-col items-center pt-1.5">
                <GripVertical className="h-4 w-4 text-muted-foreground/50" />
                <span className="mt-1 text-xs font-medium text-muted-foreground">
                  {index + 1}
                </span>
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <Input
                  value={module.title}
                  placeholder="Module title"
                  onChange={(e) => patchModule(index, { title: e.target.value })}
                  className="font-medium"
                />
                <Input
                  value={module.summary ?? ''}
                  placeholder="One-sentence summary (optional)"
                  onChange={(e) => patchModule(index, { summary: e.target.value })}
                  className="text-sm"
                />

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Objectives
                  </span>
                  {module.objectives.map((objective, objectiveIndex) => (
                    <div key={objectiveIndex} className="flex gap-2">
                      <Input
                        value={objective}
                        placeholder="What the learner will be able to do"
                        className="text-sm"
                        onChange={(e) => {
                          const objectives = [...module.objectives]
                          objectives[objectiveIndex] = e.target.value
                          patchModule(index, { objectives })
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remove objective"
                        onClick={() =>
                          patchModule(index, {
                            objectives: module.objectives.filter(
                              (_, i) => i !== objectiveIndex
                            )
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      patchModule(index, { objectives: [...module.objectives, ''] })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" /> Add objective
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => moveModule(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Move down"
                  disabled={index === draft.modules.length - 1}
                  onClick={() => moveModule(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete module"
                  onClick={() => removeModule(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Button variant="outline" onClick={addModule} className="w-full">
        <Plus className="h-4 w-4" /> Add module
      </Button>

      <div className="sticky bottom-0 flex items-center gap-2 border-t bg-background/95 py-4 backdrop-blur">
        <Button onClick={() => onSave(draft)} disabled={!canSave}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save curriculum
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Ask for changes instead
        </Button>
      </div>
    </div>
  )
}
