import { useEffect, useState } from 'react'
import { Pencil, Search, Trash2, X } from 'lucide-react'
import type { Note, NoteType } from '@shared/types'
import { NOTE_TYPES } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useNotesStore } from '@/stores/notesStore'

function NoteCard({ note }: { note: Note }): JSX.Element {
  const { update, remove } = useNotesStore()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.content)
  const [annotation, setAnnotation] = useState(note.annotation ?? '')

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider text-accent">
            {note.type}
          </span>
          <h3 className="mt-0.5 text-sm font-medium leading-snug">{note.title}</h3>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Edit note"
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Delete note"
            onClick={() => void remove(note.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-xs"
          />
          <textarea
            value={annotation}
            onChange={(e) => setAnnotation(e.target.value)}
            rows={2}
            placeholder="Your own words"
            className="w-full resize-y rounded border border-input bg-background px-2 py-1.5 text-xs"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                void update(note.id, { content: draft, annotation: annotation || null })
                setEditing(false)
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {note.content}
          </p>
          {note.annotation && (
            <p className="mt-2 border-l-2 border-accent/40 pl-2 text-xs italic text-muted-foreground">
              {note.annotation}
            </p>
          )}
          {note.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function NotesDrawer({
  moduleId,
  curriculumId
}: {
  moduleId: number | null
  curriculumId: number | null
}): JSX.Element | null {
  const { notes, open, setOpen, setFilter, filter, loading } = useNotesStore()
  const [search, setSearch] = useState('')
  const [scope, setScope] = useState<'module' | 'curriculum'>('module')

  useEffect(() => {
    if (!open) return
    void setFilter({
      ...(scope === 'module' && moduleId != null ? { moduleId } : {}),
      ...(scope === 'curriculum' && curriculumId != null ? { curriculumId } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(filter.type ? { type: filter.type } : {})
    })
    // setFilter identity is stable; re-running on filter.type would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, search, moduleId, curriculumId, filter.type])

  if (!open) return null

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-secondary/20">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Notes</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setOpen(false)}
          aria-label="Close notes"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-2 border-b px-3 py-2.5">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes"
            className="h-8 pl-8 text-xs"
          />
        </div>

        <div className="flex gap-1">
          {(['module', 'curriculum'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setScope(value)}
              className={cn(
                'rounded px-2 py-1 text-[11px] capitalize transition-colors',
                scope === value
                  ? 'bg-card font-medium shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              This {value}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => void setFilter({ ...filter, type: null })}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors',
              !filter.type ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'
            )}
          >
            all
          </button>
          {NOTE_TYPES.map((type: NoteType) => (
            <button
              key={type}
              type="button"
              onClick={() => void setFilter({ ...filter, type })}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors',
                filter.type === type
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {loading && notes.length === 0 && (
          <p className="text-xs text-muted-foreground">Loading…</p>
        )}
        {!loading && notes.length === 0 && (
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            No notes yet. Select any passage in a tutor reply to capture one.
          </p>
        )}
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} />
        ))}
      </div>
    </aside>
  )
}
