import { describe, expect, it } from 'vitest'
import {
  deserialiseCard,
  formatInterval,
  newCard,
  previewIntervals,
  retention,
  schedule,
  State
} from '../src/main/services/srs.js'
import { computeStreak } from '../src/main/db/queries/stats.js'

const NOW = new Date('2026-08-10T12:00:00Z')

describe('card serialisation', () => {
  it('round-trips through JSON', () => {
    const stored = newCard(NOW)
    const json: unknown = JSON.parse(JSON.stringify(stored))
    const card = deserialiseCard(json)
    expect(card.due.getTime()).toBe(new Date(stored.due).getTime())
    expect(card.reps).toBe(0)
    expect(card.state).toBe(State.New)
  })

  it('falls back to a fresh card on unusable state', () => {
    for (const bad of [null, undefined, 'nonsense', {}, { due: 'not-a-date' }]) {
      const card = deserialiseCard(bad, NOW)
      expect(card.state).toBe(State.New)
      expect(card.reps).toBe(0)
    }
  })

  it('does not lose review history', () => {
    let state = newCard(NOW)
    state = schedule(state, 3, NOW)
    const card = deserialiseCard(JSON.parse(JSON.stringify(state)))
    expect(card.reps).toBe(1)
    expect(card.last_review).toBeInstanceOf(Date)
  })
})

describe('schedule', () => {
  it('advances a new card out of the New state', () => {
    const next = schedule(newCard(NOW), 3, NOW)
    expect(next.state).not.toBe(State.New)
    expect(next.reps).toBe(1)
    expect(new Date(next.due).getTime()).toBeGreaterThan(NOW.getTime())
  })

  it('orders intervals: Again <= Hard <= Good <= Easy', () => {
    // Mature the card first — new cards sit in short learning steps where
    // the ordering is compressed.
    let state = newCard(NOW)
    let now = NOW
    for (let i = 0; i < 4; i++) {
      state = schedule(state, 3, now)
      now = new Date(state.due)
    }

    const dues = ([1, 2, 3, 4] as const).map((rating) =>
      new Date(schedule(state, rating, now).due).getTime()
    )
    expect(dues[0]).toBeLessThanOrEqual(dues[1]!)
    expect(dues[1]).toBeLessThanOrEqual(dues[2]!)
    expect(dues[2]).toBeLessThanOrEqual(dues[3]!)
  })

  it('counts a lapse when a reviewed card is forgotten', () => {
    let state = newCard(NOW)
    let now = NOW
    for (let i = 0; i < 4; i++) {
      state = schedule(state, 3, now)
      now = new Date(state.due)
    }
    expect(state.state).toBe(State.Review)

    const lapsed = schedule(state, 1, now)
    expect(lapsed.lapses).toBeGreaterThan(state.lapses)
  })

  it('reschedules the same card differently over successive good grades', () => {
    let state = newCard(NOW)
    let now = NOW
    const gaps: number[] = []
    for (let i = 0; i < 5; i++) {
      const next = schedule(state, 3, now)
      gaps.push(new Date(next.due).getTime() - now.getTime())
      state = next
      now = new Date(next.due)
    }
    // Intervals grow: that is the whole point of spaced repetition.
    expect(gaps.at(-1)!).toBeGreaterThan(gaps[0]!)
  })
})

describe('previewIntervals', () => {
  it('returns a label for every rating', () => {
    const previews = previewIntervals(newCard(NOW), NOW)
    expect(previews.map((p) => p.rating)).toEqual([1, 2, 3, 4])
    for (const preview of previews) {
      expect(preview.interval).toMatch(/^\d+(\.\d+)?(m|h|d|mo|y)$/)
    }
  })
})

describe('formatInterval', () => {
  it('picks a sensible unit', () => {
    expect(formatInterval(60_000)).toBe('1m')
    expect(formatInterval(45 * 60_000)).toBe('45m')
    expect(formatInterval(3 * 3_600_000)).toBe('3h')
    expect(formatInterval(5 * 86_400_000)).toBe('5d')
    expect(formatInterval(90 * 86_400_000)).toBe('3mo')
    expect(formatInterval(800 * 86_400_000)).toBe('2.2y')
  })

  it('never shows a zero interval', () => {
    expect(formatInterval(0)).toBe('1m')
    expect(formatInterval(-5000)).toBe('1m')
  })
})

describe('retention', () => {
  it('is zero with no cards', () => {
    expect(retention([])).toBe(0)
  })

  it('ignores cards that have never reached Review', () => {
    expect(retention([newCard(NOW), newCard(NOW)])).toBe(0)
  })

  it('counts matured cards', () => {
    const mature = (): unknown => {
      let state = newCard(NOW)
      let now = NOW
      for (let i = 0; i < 4; i++) {
        state = schedule(state, 3, now)
        now = new Date(state.due)
      }
      return state
    }
    expect(retention([mature(), mature()])).toBe(1)
    expect(retention([mature(), newCard(NOW)])).toBe(0.5)
  })
})

describe('computeStreak', () => {
  const key = (offsetDays: number): string => {
    const d = new Date(NOW.getTime() - offsetDays * 86_400_000)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }

  it('is zero with no activity', () => {
    expect(computeStreak(new Set(), NOW.getTime())).toBe(0)
  })

  it('counts consecutive days ending today', () => {
    const days = new Set([key(0), key(1), key(2)])
    expect(computeStreak(days, NOW.getTime())).toBe(3)
  })

  it('survives not having studied yet today', () => {
    const days = new Set([key(1), key(2), key(3)])
    expect(computeStreak(days, NOW.getTime())).toBe(3)
  })

  it('breaks on a missed day', () => {
    const days = new Set([key(0), key(1), key(3), key(4)])
    expect(computeStreak(days, NOW.getTime())).toBe(2)
  })

  it('is zero when the last activity is too old', () => {
    expect(computeStreak(new Set([key(5), key(6)]), NOW.getTime())).toBe(0)
  })
})
