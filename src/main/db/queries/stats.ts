import type { DashboardStats, ModuleMastery, WeakArea } from '@shared/types.js'
import { getDatabase } from '../index.js'

/** Local-midnight day key, so streaks match the learner's calendar. */
function dayKey(ts: number): string {
  const d = new Date(ts)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

const DAY_MS = 86_400_000

/**
 * Consecutive days ending today (or yesterday) with any learning activity.
 *
 * Counting from yesterday matters: a learner who has not studied *yet today*
 * still has their streak, and telling them it is broken at 9am is wrong.
 */
export function computeStreak(days: Set<string>, now = Date.now()): number {
  if (days.size === 0) return 0

  const today = dayKey(now)
  const yesterday = dayKey(now - DAY_MS)
  if (!days.has(today) && !days.has(yesterday)) return 0

  let streak = 0
  let cursor = days.has(today) ? now : now - DAY_MS
  while (days.has(dayKey(cursor))) {
    streak++
    cursor -= DAY_MS
  }
  return streak
}

/**
 * Minutes on task per day, derived from session start/end events.
 *
 * A session with no end event is credited a nominal 10 minutes rather than
 * nothing — otherwise abandoning the app mid-session silently erases the work.
 */
function minutesPerDay(days: number, now = Date.now()): { date: string; minutes: number }[] {
  const db = getDatabase()
  const since = now - days * DAY_MS

  const sessions = db
    .prepare<[number], { started_at: number; ended_at: number | null }>(
      'SELECT started_at, ended_at FROM sessions WHERE started_at >= ?'
    )
    .all(since)

  const buckets = new Map<string, number>()
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(now - i * DAY_MS), 0)

  for (const session of sessions) {
    const key = dayKey(session.started_at)
    if (!buckets.has(key)) continue
    const raw = session.ended_at
      ? (session.ended_at - session.started_at) / 60_000
      : 10
    // Cap a single session at three hours: a window left open overnight is
    // not three hours of study.
    buckets.set(key, (buckets.get(key) ?? 0) + Math.min(180, Math.max(0, raw)))
  }

  return [...buckets.entries()].map(([date, minutes]) => ({
    date,
    minutes: Math.round(minutes)
  }))
}

export function dashboardStats(now = Date.now()): DashboardStats {
  const db = getDatabase()

  const moduleRows = db
    .prepare<
      [],
      {
        id: number
        title: string
        curriculum_id: number
        curriculum_title: string
        status: ModuleMastery['status']
        mastery: number
        met: number
        total: number
      }
    >(
      `SELECT m.id, m.title, m.curriculum_id, c.title AS curriculum_title,
              m.status, m.mastery,
              COALESCE(SUM(CASE WHEN o.status = 'met' THEN 1 ELSE 0 END), 0) AS met,
              COUNT(o.id) AS total
       FROM modules m
       JOIN curricula c ON c.id = m.curriculum_id AND c.status = 'active'
       LEFT JOIN objectives o ON o.module_id = m.id
       GROUP BY m.id
       ORDER BY c.title, m.order_index`
    )
    .all()

  const mastery: ModuleMastery[] = moduleRows.map((r) => ({
    moduleId: r.id,
    moduleTitle: r.title,
    curriculumId: r.curriculum_id,
    curriculumTitle: r.curriculum_title,
    mastery: r.mastery,
    status: r.status,
    objectivesMet: r.met,
    objectivesTotal: r.total
  }))

  const modulesTotal = mastery.length
  const modulesCompleted = mastery.filter((m) => m.status === 'completed').length
  const objectivesMet = mastery.reduce((n, m) => n + m.objectivesMet, 0)
  const objectivesTotal = mastery.reduce((n, m) => n + m.objectivesTotal, 0)

  // --- activity days ------------------------------------------------------
  // Bounded: `events` grows without limit over a learner's lifetime, and a
  // streak only ever needs a contiguous run ending today. Two years is far
  // more than any streak this will ever display.
  const STREAK_WINDOW_DAYS = 730
  const eventDays = new Set(
    db
      .prepare<[number], { ts: number }>(
        `SELECT ts FROM events
         WHERE type IN ('session_start','review','quiz') AND ts >= ?`
      )
      .all(now - STREAK_WINDOW_DAYS * DAY_MS)
      .map((r) => dayKey(r.ts))
  )

  const thirtyDaysAgo = now - 30 * DAY_MS
  const activeDaysLast30 = [...eventDays].filter(
    (key) => new Date(`${key}T00:00:00`).getTime() >= thirtyDaysAgo
  ).length

  // --- cards --------------------------------------------------------------
  const cardTotals = db
    .prepare<[number], { total: number; due: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN due <= ? THEN 1 ELSE 0 END), 0) AS due
       FROM flashcards WHERE suspended = 0`
    )
    .get(now)

  const notesTotal =
    db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM notes').get()?.n ?? 0

  // --- weak areas ---------------------------------------------------------
  // Three grouped queries rather than three per module. The dashboard reads
  // every module in every active curriculum, so this was the worst N+1 here.
  const attemptCounts = new Map<number, number>(
    db
      .prepare<[], { module_id: number; n: number }>(
        `SELECT q.module_id, COUNT(*) AS n
         FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
         GROUP BY q.module_id`
      )
      .all()
      .map((r) => [r.module_id, r.n])
  )

  const cardCounts = new Map<number, number>(
    db
      .prepare<[], { module_id: number; n: number }>(
        `SELECT module_id, COUNT(*) AS n FROM flashcards
         WHERE suspended = 0 AND module_id IS NOT NULL GROUP BY module_id`
      )
      .all()
      .map((r) => [r.module_id, r.n])
  )

  const lapsingCounts = new Map<number, number>(
    db
      .prepare<[], { module_id: number; n: number }>(
        `SELECT module_id, COUNT(*) AS n FROM flashcards
         WHERE suspended = 0 AND module_id IS NOT NULL
           AND COALESCE(json_extract(fsrs_json, '$.lapses'), 0) >= 3
         GROUP BY module_id`
      )
      .all()
      .map((r) => [r.module_id, r.n])
  )

  const weakAreas: WeakArea[] = []

  for (const m of mastery) {
    const attempted = attemptCounts.get(m.moduleId) ?? 0
    const cards = cardCounts.get(m.moduleId) ?? 0

    // Drive this off evidence, not module status: a module can carry quiz
    // attempts and cards while its status lags behind. Conversely, a module
    // with no evidence at all is not "weak" — it is simply untested, and
    // telling someone to revisit something they never started is noise.
    if (attempted === 0 && cards === 0) continue

    if (attempted > 0 && m.mastery < 0.7) {
      weakAreas.push({
        moduleId: m.moduleId,
        moduleTitle: m.moduleTitle,
        curriculumTitle: m.curriculumTitle,
        reason: `Quiz mastery is ${Math.round(m.mastery * 100)}%`,
        mastery: m.mastery
      })
      continue
    }

    const lapsing = lapsingCounts.get(m.moduleId) ?? 0
    if (lapsing > 0) {
      weakAreas.push({
        moduleId: m.moduleId,
        moduleTitle: m.moduleTitle,
        curriculumTitle: m.curriculumTitle,
        reason: `${lapsing} card${lapsing === 1 ? '' : 's'} you keep forgetting`,
        mastery: m.mastery
      })
    }
  }

  weakAreas.sort((a, b) => a.mastery - b.mastery)

  // --- spend --------------------------------------------------------------
  const monthStart = new Date(now)
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const spend = db
    .prepare<[number], { total: number | null }>(
      'SELECT SUM(estimated_usd) AS total FROM usage_log WHERE ts >= ?'
    )
    .get(monthStart.getTime())

  return {
    completion: modulesTotal > 0 ? modulesCompleted / modulesTotal : 0,
    modulesCompleted,
    modulesTotal,
    objectivesMet,
    objectivesTotal,
    streakDays: computeStreak(eventDays, now),
    activeDaysLast30,
    minutesPerDay: minutesPerDay(14, now),
    dueToday: cardTotals?.due ?? 0,
    totalCards: cardTotals?.total ?? 0,
    notesTotal,
    mastery,
    weakAreas: weakAreas.slice(0, 6),
    spendThisMonthUsd: spend?.total ?? 0
  }
}

export { dayKey }
