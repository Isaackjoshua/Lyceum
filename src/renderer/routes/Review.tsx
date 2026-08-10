import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Layers, Loader2, SkipForward } from 'lucide-react'
import type { ReviewRating } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/utils'
import { useReviewStore } from '@/stores/reviewStore'

const RATINGS: { rating: ReviewRating; label: string; key: string; className: string }[] = [
  {
    rating: 1,
    label: 'Again',
    key: '1',
    className: 'border-destructive/50 text-destructive hover:bg-destructive/10'
  },
  { rating: 2, label: 'Hard', key: '2', className: 'hover:bg-secondary' },
  { rating: 3, label: 'Good', key: '3', className: 'hover:bg-secondary' },
  {
    rating: 4,
    label: 'Easy',
    key: '4',
    className: 'border-success/50 text-success hover:bg-success/10'
  }
]

export function ReviewRoute(): JSX.Element {
  const navigate = useNavigate()
  const {
    queue,
    index,
    revealed,
    previews,
    dueCount,
    totalCards,
    reviewedThisSession,
    loading,
    error,
    load,
    reveal,
    grade,
    skip,
    reset
  } = useReviewStore()

  useEffect(() => {
    void load()
    return () => reset()
  }, [load, reset])

  const card = queue[index]

  // Keyboard-first: space reveals, 1-4 grade.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!card) return
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (!revealed) void reveal()
        return
      }
      if (!revealed) return
      const match = RATINGS.find((r) => r.key === event.key)
      if (match) {
        event.preventDefault()
        void grade(match.rating)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, revealed, reveal, grade])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading your cards…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    )
  }

  // Nothing due, or the queue is finished.
  if (!card) {
    const finished = reviewedThisSession > 0
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          {finished ? (
            <Check className="mx-auto h-8 w-8 text-success" />
          ) : (
            <Layers className="mx-auto h-8 w-8 text-muted-foreground" />
          )}
          <h1 className="mt-4 font-serif text-xl font-semibold">
            {finished ? 'Done for now' : totalCards === 0 ? 'No cards yet' : 'Nothing due'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {finished
              ? `You reviewed ${reviewedThisSession} card${
                  reviewedThisSession === 1 ? '' : 's'
                }. Come back when the next batch is due.`
              : totalCards === 0
                ? 'Save notes while you learn, then turn them into flashcards from a module.'
                : `All ${totalCards} of your cards are scheduled for later. That is the system working.`}
          </p>
          <Button variant="outline" className="mt-5" onClick={() => navigate('/')}>
            Back to curricula
          </Button>
        </div>
      </div>
    )
  }

  const remaining = queue.length - index

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div>
          <h1 className="font-serif text-base font-semibold leading-tight">Review</h1>
          <p className="text-xs text-muted-foreground">
            {remaining} in this batch
            {card.moduleTitle ? ` · ${card.moduleTitle}` : ''}
            {reviewedThisSession > 0 ? ` · ${reviewedThisSession} done` : ''}
          </p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {dueCount} due
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
        <div className="w-full max-w-xl">
          <div className="rounded-lg border bg-card p-8 shadow-sm">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {card.state === 0 ? 'New' : card.lapses > 2 ? 'Struggling' : 'Review'}
            </p>
            <Markdown className="text-base">{card.front}</Markdown>

            {revealed && (
              <>
                <hr className="my-5 border-border" />
                <Markdown>{card.back}</Markdown>
              </>
            )}
          </div>

          <div className="mt-6">
            {!revealed ? (
              <div className="flex items-center gap-2">
                <Button onClick={() => void reveal()} className="flex-1">
                  Show answer
                </Button>
                <Button variant="ghost" size="icon" onClick={skip} aria-label="Skip">
                  <SkipForward className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {RATINGS.map((option) => {
                  const preview = previews.find((p) => p.rating === option.rating)
                  return (
                    <button
                      key={option.rating}
                      type="button"
                      onClick={() => void grade(option.rating)}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-sm font-medium transition-colors',
                        option.className
                      )}
                    >
                      <span className="block">{option.label}</span>
                      <span className="mt-0.5 block text-[11px] font-normal opacity-70">
                        {preview?.interval ?? '·'}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {revealed
                ? 'Press 1–4 to grade. Be honest: guessing right is not remembering.'
                : 'Press space to reveal'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
