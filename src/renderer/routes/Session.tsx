import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  Loader2,
  NotebookPen,
  Send,
  Square,
  X
} from 'lucide-react'
import type {
  CreateNoteArgs,
  SpendStatus,
  TurnEvent,
  UsageTotals,
  VisualPayload
} from '@shared/types'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/Markdown'
import { NoteCaptureModal, type NoteDraft } from '@/components/NoteCaptureModal'
import { NotesDrawer } from '@/components/NotesDrawer'
import { SelectionToolbar, useSelectionCapture } from '@/components/SelectionToolbar'
import { VisualRenderer } from '@/components/VisualRenderer'
import { cn, formatUsd } from '@/lib/utils'
import { useNotesStore } from '@/stores/notesStore'
import { useSessionStore } from '@/stores/sessionStore'

type ToolHint = Extract<TurnEvent, { type: 'tool_result' }>['hint']

/** Visuals persisted with an earlier assistant turn. */
function visualsOf(meta: Record<string, unknown> | null): VisualPayload[] {
  if (!meta || !Array.isArray(meta.hints)) return []
  return (meta.hints as ToolHint[])
    .filter((hint) => hint?.kind === 'visual')
    .map((hint) => (hint as Extract<ToolHint, { kind: 'visual' }>).visual)
}

export function SessionRoute(): JSX.Element {
  const { moduleId } = useParams<{ moduleId: string }>()
  const navigate = useNavigate()

  const {
    detail,
    loading,
    error,
    streamingText,
    activeRequestId,
    toasts,
    visuals,
    noteChips,
    quizOffer,
    open,
    send,
    cancel,
    handleEvent,
    dismissToast,
    dismissChip,
    dismissQuizOffer,
    reset
  } = useSessionStore()

  const notesOpen = useNotesStore((s) => s.open)
  const setNotesOpen = useNotesStore((s) => s.setOpen)
  const createNote = useNotesStore((s) => s.create)

  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [usage, setUsage] = useState<UsageTotals | null>(null)
  const [spend, setSpend] = useState<SpendStatus | null>(null)

  const transcriptRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const { selection, clear: clearSelection } = useSelectionCapture(transcriptRef)

  useEffect(() => {
    if (moduleId) void open(Number(moduleId))
    return () => reset()
  }, [moduleId, open, reset])

  useEffect(() => window.api.session.onEvent(handleEvent), [handleEvent])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [detail?.messages.length, streamingText])

  // Refresh cost after each completed turn, not on every streamed delta.
  const sessionId = detail?.session.id
  const turnCount = detail?.messages.length ?? 0
  useEffect(() => {
    if (sessionId === undefined) return
    void window.api.usage.session(sessionId).then((r) => {
      if (r.ok) setUsage(r.data)
    })
    void window.api.usage.spendStatus().then((r) => {
      if (r.ok) setSpend(r.data)
    })
  }, [sessionId, turnCount])

  const busy = activeRequestId !== null

  const submit = (): void => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    void send(text)
  }

  const openDraftFor = (text: string, messageId: number): void => {
    if (!detail) return
    setDraft({
      excerpt: text,
      curriculumId: detail.curriculum.id,
      moduleId: detail.module.id,
      sessionId: detail.session.id,
      messageId: messageId > 0 ? messageId : null
    })
    clearSelection()
    window.getSelection()?.removeAllRanges()
  }

  const saveNote = async (args: CreateNoteArgs): Promise<void> => {
    const note = await createNote(args)
    if (!note) throw new Error('The note could not be saved.')
    if (!notesOpen) setNotesOpen(true)
  }

  if (loading && !detail) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening session…
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <div>
          <p className="text-sm text-muted-foreground">
            {error ?? 'That module could not be opened.'}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/')}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  const openObjectives = detail.module.objectives.filter((o) => o.status === 'open')

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* ------------------------------------------------------- header */}
        <header className="flex items-start gap-3 border-b px-6 py-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back to curriculum"
            onClick={() => navigate(`/curriculum/${detail.curriculum.id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-serif text-base font-semibold leading-tight">
              {detail.module.title}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {detail.curriculum.title} ·{' '}
              {detail.module.objectives.length - openObjectives.length}/
              {detail.module.objectives.length} objectives met
              {usage && usage.estimatedUsd > 0 && (
                <> · {formatUsd(usage.estimatedUsd)} this session</>
              )}
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/module/${detail.module.id}/quiz`)}
          >
            Checkpoint
          </Button>

          <Button
            variant={notesOpen ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setNotesOpen(!notesOpen)}
          >
            <NotebookPen className="h-4 w-4" /> Notes
          </Button>
        </header>

        {/* ------------------------------------------------- objectives bar */}
        {openObjectives.length > 0 && (
          <div className="border-b bg-secondary/30 px-6 py-2">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Working toward
            </p>
            <p className="mt-0.5 text-xs">{openObjectives[0]!.text}</p>
          </div>
        )}

        {spend?.warn && (
          <div
            className={cn(
              'border-b px-6 py-2 text-xs',
              spend.blocked
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'bg-accent/10 text-foreground'
            )}
          >
            {spend.blocked
              ? `Monthly cap of ${formatUsd(spend.capUsd)} reached — generation is blocked. Raise it in Settings to continue.`
              : `${Math.round(spend.fraction * 100)}% of your ${formatUsd(spend.capUsd)} monthly cap used (${formatUsd(spend.spentUsd)}).`}
          </div>
        )}

        {/* -------------------------------------------------- transcript */}
        <div ref={transcriptRef} className="relative flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-2xl space-y-6">
            {detail.messages.length === 0 && !streamingText && (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Say what you already know about this, or just say you are starting
                  from scratch. The tutor will find your level before it teaches.
                </p>
              </div>
            )}

            {detail.messages.map((message) => (
              <div key={message.id} data-message-id={message.id} className="group">
                {message.role === 'user' ? (
                  <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-lg bg-secondary px-4 py-2.5 text-sm">
                    {message.content}
                  </div>
                ) : (
                  <div>
                    <Markdown>{message.content}</Markdown>
                    {visualsOf(message.meta).map((visual, i) => (
                      <VisualRenderer key={i} visual={visual} />
                    ))}
                    <button
                      type="button"
                      onClick={() => openDraftFor(message.content, message.id)}
                      className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                    >
                      <BookmarkPlus className="h-3 w-3" /> Save whole reply
                    </button>
                  </div>
                )}
              </div>
            ))}

            {streamingText && (
              <div data-message-id="0">
                <Markdown>{streamingText}</Markdown>
              </div>
            )}

            {/* Visuals for the turn still streaming; persisted ones render above. */}
            {activeRequestId !== null &&
              visuals.map((visual, i) => <VisualRenderer key={i} visual={visual} />)}

            {noteChips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {noteChips.map((chip) => (
                  <div
                    key={chip.id}
                    className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 py-1 pl-3 pr-1 text-xs"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="max-w-64 truncate">
                      Save &ldquo;{chip.suggestion.title}&rdquo;?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!detail) return
                        setDraft({
                          excerpt: chip.suggestion.sourceExcerpt ?? chip.suggestion.content,
                          curriculumId: detail.curriculum.id,
                          moduleId: detail.module.id,
                          sessionId: detail.session.id,
                          messageId: detail.messages.at(-1)?.id ?? null,
                          type: chip.suggestion.type,
                          title: chip.suggestion.title,
                          content: chip.suggestion.content
                        })
                        dismissChip(chip.id)
                      }}
                      className="rounded-full bg-accent px-2 py-0.5 font-medium text-accent-foreground"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissChip(chip.id)}
                      aria-label="Dismiss"
                      className="rounded-full p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {quizOffer && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Checkpoint reached</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {quizOffer.focus
                      ? `A short check on ${quizOffer.focus}`
                      : 'A short check on what you just covered'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/module/${quizOffer.moduleId}/quiz` +
                          (quizOffer.focus
                            ? `?focus=${encodeURIComponent(quizOffer.focus)}`
                            : '')
                      )
                    }
                  >
                    Take it
                  </Button>
                  <Button size="sm" variant="ghost" onClick={dismissQuizOffer}>
                    Later
                  </Button>
                </div>
              </div>
            )}

            {busy && !streamingText && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </p>
            )}

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <div ref={bottomRef} />
          </div>

          {selection && (
            <SelectionToolbar
              selection={selection}
              onSave={() => openDraftFor(selection.text, selection.messageId)}
            />
          )}
        </div>

        {/* ----------------------------------------------------- toasts */}
        {toasts.length > 0 && (
          <div className="pointer-events-none absolute bottom-24 left-1/2 z-20 -translate-x-1/2 space-y-2">
            {toasts.map((toast) => (
              <button
                key={toast.objectiveId}
                type="button"
                onClick={() => dismissToast(toast.objectiveId)}
                className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-xs shadow-lg"
              >
                <Check className="h-3.5 w-3.5 text-success" />
                <span className="font-medium">Objective met</span>
                <span className="max-w-64 truncate text-muted-foreground">
                  {toast.evidence}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* --------------------------------------------------- composer */}
        <div className="border-t px-6 py-4">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit()
                }
              }}
              rows={1}
              placeholder="Type your answer, or ask about what is confusing you…"
              className={cn(
                'max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border border-input',
                'bg-card px-3 py-2.5 text-sm shadow-sm placeholder:text-muted-foreground'
              )}
              style={{ height: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
              }}
            />
            {busy ? (
              <Button variant="outline" onClick={() => void cancel()} aria-label="Stop">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={!input.trim()} aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mx-auto mt-1.5 max-w-2xl text-[11px] text-muted-foreground">
            Enter to send · Shift+Enter for a new line · select any passage to save it
            as a note
          </p>
        </div>
      </div>

      <NotesDrawer moduleId={detail.module.id} curriculumId={detail.curriculum.id} />

      <NoteCaptureModal
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={saveNote}
      />
    </div>
  )
}
