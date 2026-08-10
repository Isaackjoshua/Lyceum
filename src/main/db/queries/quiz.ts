import type {
  QuestionType,
  Quiz,
  QuizDetail,
  QuizQuestion
} from '@shared/types.js'
import { getDatabase } from '../index.js'
import { cardStatesForModule } from './flashcards.js'
import { retention } from '../../services/srs.js'

interface QuizRow {
  id: number
  module_id: number
  created_at: number
}

interface QuestionRow {
  id: number
  quiz_id: number
  type: QuestionType
  prompt: string
  options_json: string | null
  answer: string
  explanation: string
  order_index: number
}

interface ModuleRow {
  id: number
  curriculum_id: number
  title: string
  summary: string | null
  est_minutes: number | null
  order_index: number
  status: 'not_started' | 'in_progress' | 'completed'
  mastery: number
  created_at: number
  updated_at: number
}

const toQuiz = (r: QuizRow): Quiz => ({
  id: r.id,
  moduleId: r.module_id,
  createdAt: r.created_at
})

function toQuestion(r: QuestionRow): QuizQuestion {
  let options: string[] | null = null
  if (r.options_json) {
    try {
      const parsed: unknown = JSON.parse(r.options_json)
      if (Array.isArray(parsed)) {
        options = parsed.filter((o): o is string => typeof o === 'string')
      }
    } catch {
      options = null
    }
  }
  return {
    id: r.id,
    quizId: r.quiz_id,
    type: r.type,
    prompt: r.prompt,
    options,
    answer: r.answer,
    explanation: r.explanation,
    orderIndex: r.order_index
  }
}

export interface NewQuestion {
  type: QuestionType
  prompt: string
  options: string[] | null
  answer: string
  explanation: string
}

export function insertQuiz(moduleId: number, questions: NewQuestion[]): number {
  const db = getDatabase()
  const now = Date.now()

  const tx = db.transaction(() => {
    const quizId = db
      .prepare('INSERT INTO quizzes (module_id, created_at) VALUES (?, ?)')
      .run(moduleId, now).lastInsertRowid as number

    const stmt = db.prepare(
      `INSERT INTO quiz_questions (quiz_id, type, prompt, options_json, answer, explanation, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    questions.forEach((q, index) => {
      stmt.run(
        quizId,
        q.type,
        q.prompt,
        q.options ? JSON.stringify(q.options) : null,
        q.answer,
        q.explanation,
        index
      )
    })
    return quizId
  })

  return tx()
}

function moduleOf(moduleId: number): ModuleRow {
  const row = getDatabase()
    .prepare<[number], ModuleRow>('SELECT * FROM modules WHERE id = ?')
    .get(moduleId)
  if (!row) throw new Error(`Module ${moduleId} not found.`)
  return row
}

export function getQuizDetail(quizId: number): QuizDetail {
  const db = getDatabase()
  const quizRow = db
    .prepare<[number], QuizRow>('SELECT * FROM quizzes WHERE id = ?')
    .get(quizId)
  if (!quizRow) throw new Error(`Quiz ${quizId} not found.`)

  const questions = db
    .prepare<[number], QuestionRow>(
      'SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY order_index, id'
    )
    .all(quizId)
    .map(toQuestion)

  const m = moduleOf(quizRow.module_id)

  return {
    quiz: toQuiz(quizRow),
    questions,
    module: {
      id: m.id,
      curriculumId: m.curriculum_id,
      title: m.title,
      summary: m.summary,
      estMinutes: m.est_minutes,
      orderIndex: m.order_index,
      status: m.status,
      mastery: m.mastery,
      createdAt: m.created_at,
      updatedAt: m.updated_at
    }
  }
}

/** The module's most recent quiz, or null if it has never had one. */
export function latestQuiz(moduleId: number): QuizDetail | null {
  const row = getDatabase()
    .prepare<[number], QuizRow>(
      'SELECT * FROM quizzes WHERE module_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(moduleId)
  return row ? getQuizDetail(row.id) : null
}

export function recordAttempt(
  quizId: number,
  score: number,
  responses: Record<string, string>
): number {
  const db = getDatabase()
  const now = Date.now()

  const tx = db.transaction(() => {
    const attemptId = db
      .prepare(
        'INSERT INTO quiz_attempts (quiz_id, taken_at, score, responses_json) VALUES (?, ?, ?, ?)'
      )
      .run(quizId, now, score, JSON.stringify(responses)).lastInsertRowid as number

    db.prepare('INSERT INTO events (ts, type, payload_json) VALUES (?, ?, ?)').run(
      now,
      'quiz',
      JSON.stringify({ quizId, score })
    )
    return attemptId
  })

  return tx()
}

/** Best score across all attempts of any quiz on the module, or null. */
export function bestQuizScore(moduleId: number): number | null {
  const row = getDatabase()
    .prepare<[number], { best: number | null }>(
      `SELECT MAX(a.score) AS best
       FROM quiz_attempts a
       JOIN quizzes q ON q.id = a.quiz_id
       WHERE q.module_id = ?`
    )
    .get(moduleId)
  return row?.best ?? null
}

/**
 * Mastery = weighted blend of the best quiz score and flashcard retention.
 *
 * Quiz score dominates because it is a direct measurement; retention is a
 * slower, noisier signal. When one signal is missing the other carries full
 * weight, so a learner who has taken a quiz but made no cards is not capped.
 */
export function recomputeMastery(moduleId: number): number {
  const quiz = bestQuizScore(moduleId)
  const cards = cardStatesForModule(moduleId)
  const cardRetention = cards.length > 0 ? retention(cards) : null

  let mastery: number
  if (quiz === null && cardRetention === null) {
    mastery = 0
  } else if (quiz === null) {
    mastery = cardRetention!
  } else if (cardRetention === null) {
    mastery = quiz
  } else {
    mastery = 0.7 * quiz + 0.3 * cardRetention
  }

  mastery = Math.max(0, Math.min(1, mastery))
  getDatabase()
    .prepare('UPDATE modules SET mastery = ?, updated_at = ? WHERE id = ?')
    .run(mastery, Date.now(), moduleId)

  return mastery
}
