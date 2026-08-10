import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { CreateNoteArgs, NoteType } from '@shared/types'
import { NOTE_TYPES } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

export interface NoteDraft {
  excerpt: string
  curriculumId: number | null
  moduleId: number | null
  sessionId: number | null
  messageId: number | null
  /** Pre-filled when the tutor proposed the note itself. */
  type?: NoteType
  title?: string
  content?: string
}

/** Guesses a title from the excerpt so the field is never empty on open. */
function suggestTitle(excerpt: string): string {
  const firstSentence = excerpt.split(/(?<=[.!?])\s/)[0] ?? excerpt
  const trimmed = firstSentence.trim().replace(/\s+/g, ' ')
  return trimmed.length > 70 ? `${trimmed.slice(0, 67).trimEnd()}…` : trimmed
}

/** Definitions and theorems usually announce themselves; use that. */
function suggestType(excerpt: string): NoteType {
  const text = excerpt.toLowerCase()
  if (/\btheorem\b|\blemma\b|\bcorollary\b/.test(text)) return 'theorem'
  if (/\bis defined as\b|\bdefinition\b|\brefers to\b|\bmeans that\b/.test(text)) {
    return 'definition'
  }
  if (/\bfor example\b|\be\.g\.\b|\bconsider\b/.test(text)) return 'example'
  if (/\?\s*$/.test(excerpt.trim())) return 'question'
  if (/\balways\b|\bnever\b|\brule\b|\bprinciple\b/.test(text)) return 'principle'
  return 'concept'
}

export function NoteCaptureModal({
  draft,
  onClose,
  onSaved
}: {
  draft: NoteDraft | null
  onClose: () => void
  onSaved: (args: CreateNoteArgs) => Promise<unknown>
}): JSX.Element {
  const [type, setType] = useState<NoteType>('concept')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [annotation, setAnnotation] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft) return
    setType(draft.type ?? suggestType(draft.excerpt))
    setTitle(draft.title ?? suggestTitle(draft.excerpt))
    setContent(draft.content ?? draft.excerpt)
    setAnnotation('')
    setTags('')
    setError(null)
  }, [draft])

  const save = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    setError(null)

    const args: CreateNoteArgs = {
      curriculumId: draft.curriculumId,
      moduleId: draft.moduleId,
      sessionId: draft.sessionId,
      messageId: draft.messageId,
      type,
      title: title.trim(),
      content: content.trim(),
      annotation: annotation.trim() || null,
      sourceExcerpt: draft.excerpt,
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    }

    try {
      await onSaved(args)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Save note</DialogTitle>
        <DialogDescription className="mb-4">
          Notes are yours. The tutor sees only their titles, as a reminder of what
          you have already captured.
        </DialogDescription>

        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-40 space-y-1.5">
              <Label htmlFor="note-type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as NoteType)}>
                <SelectTrigger id="note-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NOTE_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="note-title">Title</Label>
              <Input
                id="note-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {draft && draft.content === undefined && (
            <div className="space-y-1.5">
              <Label>Captured excerpt</Label>
              <div
                className={cn(
                  'max-h-32 overflow-y-auto rounded-md border bg-secondary/40 p-3',
                  'text-sm leading-relaxed text-muted-foreground'
                )}
              >
                {draft.excerpt}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note-content">Note</Label>
            <textarea
              id="note-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note-annotation">Your own words (optional)</Label>
            <textarea
              id="note-annotation"
              value={annotation}
              onChange={(e) => setAnnotation(e.target.value)}
              rows={2}
              placeholder="Why this mattered, or where you got stuck"
              className="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note-tags">Tags (comma separated)</Label>
            <Input
              id="note-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="gradients, chain-rule"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !title.trim() || !content.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save note
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
