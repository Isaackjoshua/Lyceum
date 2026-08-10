import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs'
import type { ReviewRating } from '@shared/types.js'

/**
 * Spaced-repetition scheduling. Pure functions over FSRS card state — no
 * database access here, so the scheduling logic is directly testable.
 *
 * Card state is persisted as JSON in `flashcards.fsrs_json`, with the `due`
 * timestamp mirrored into an indexed `flashcards.due` column so the due query
 * is a range scan rather than a full table read.
 */

const scheduler = fsrs(
  generatorParameters({
    // Fuzz spreads same-day clusters so reviews do not all land together.
    enable_fuzz: true,
    enable_short_term: true
  })
)

/** JSON-safe mirror of the ts-fsrs Card. */
export interface StoredCard {
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review?: string
}

export function serialiseCard(card: Card): StoredCard {
  const stored: StoredCard = {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state
  }
  if (card.last_review) stored.last_review = card.last_review.toISOString()
  return stored
}

/** Rehydrates stored state, falling back to a fresh card if it is unusable. */
export function deserialiseCard(raw: unknown, now = new Date()): Card {
  if (typeof raw !== 'object' || raw === null) return createEmptyCard(now)
  const stored = raw as Partial<StoredCard>
  const due = stored.due ? new Date(stored.due) : null
  if (!due || Number.isNaN(due.getTime())) return createEmptyCard(now)

  const card: Card = {
    due,
    stability: Number(stored.stability) || 0,
    difficulty: Number(stored.difficulty) || 0,
    elapsed_days: Number(stored.elapsed_days) || 0,
    scheduled_days: Number(stored.scheduled_days) || 0,
    learning_steps: Number(stored.learning_steps) || 0,
    reps: Number(stored.reps) || 0,
    lapses: Number(stored.lapses) || 0,
    state: (Number(stored.state) || 0) as State
  }
  if (stored.last_review) {
    const last = new Date(stored.last_review)
    if (!Number.isNaN(last.getTime())) card.last_review = last
  }
  return card
}

export function newCard(now = new Date()): StoredCard {
  return serialiseCard(createEmptyCard(now))
}

const RATING_MAP = {
  1: Rating.Again,
  2: Rating.Hard,
  3: Rating.Good,
  4: Rating.Easy
} as const

/** Applies a self-grade and returns the next state. */
export function schedule(
  stored: unknown,
  rating: ReviewRating,
  now = new Date()
): StoredCard {
  const card = deserialiseCard(stored, now)
  const result = scheduler.next(card, now, RATING_MAP[rating])
  return serialiseCard(result.card)
}

/** What each rating would schedule, for the interval hints on the buttons. */
export function previewIntervals(
  stored: unknown,
  now = new Date()
): { rating: ReviewRating; interval: string }[] {
  const card = deserialiseCard(stored, now)
  return ([1, 2, 3, 4] as ReviewRating[]).map((rating) => {
    const next = scheduler.next(card, now, RATING_MAP[rating])
    return { rating, interval: formatInterval(next.card.due.getTime() - now.getTime()) }
  })
}

/** Compact human interval: 10m, 2h, 3d, 5mo, 1.5y. */
export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`

  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)}h`

  const days = hours / 24
  if (days < 30) return `${Math.round(days)}d`

  const months = days / 30
  if (months < 12) return `${Math.round(months)}mo`

  const years = days / 365
  return `${years < 10 ? years.toFixed(1) : Math.round(years)}y`
}

/**
 * Retention signal for a set of cards: the share that have reached the Review
 * state and are not lapsing. Feeds the mastery blend.
 */
export function retention(cards: unknown[]): number {
  if (cards.length === 0) return 0
  const mature = cards.filter((raw) => {
    const card = deserialiseCard(raw)
    return card.state === State.Review && card.lapses <= 2
  })
  return mature.length / cards.length
}

export { State }
