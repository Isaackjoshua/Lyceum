import type {
  GradedAnswer,
  QuestionType,
  QuizDetail,
  QuizQuestion,
  QuizResult
} from '@shared/types.js'
import { getModuleWithObjectives } from '../db/queries/curriculum.js'
import { getMessages } from '../db/queries/session.js'
import { logUsage } from '../db/queries/session.js'
import {
  getQuizDetail,
  insertQuiz,
  recomputeMastery,
  recordAttempt,
  type NewQuestion
} from '../db/queries/quiz.js'
import { getDatabase } from '../db/index.js'
import { runSimple, runTurn } from '../harness/anthropicClient.js'
import { MODES } from '../harness/modes.js'
import { GENERATE_QUIZ_TOOL } from '../harness/toolRegistry.js'

const QUESTION_TYPES: QuestionType[] = ['mcq', 'short', 'code']

/** Coerces generate_quiz tool input into rows we are willing to store. */
export function parseQuizQuestions(input: Record<string, unknown>): NewQuestion[] {
  if (!Array.isArray(input.questions)) return []

  const questions: NewQuestion[] = []
  for (const raw of input.questions) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>

    const type = typeof entry.type === 'string' ? entry.type : ''
    if (!QUESTION_TYPES.includes(type as QuestionType)) continue

    const prompt = typeof entry.prompt === 'string' ? entry.prompt.trim() : ''
    const answer = typeof entry.answer === 'string' ? entry.answer.trim() : ''
    if (!prompt || !answer) continue

    const explanation =
      typeof entry.explanation === 'string' ? entry.explanation.trim() : ''

    let options: string[] | null = null
    if (Array.isArray(entry.options)) {
      const cleaned = entry.options
        .filter((o): o is string => typeof o === 'string')
        .map((o) => o.trim())
        .filter(Boolean)
      if (cleaned.length >= 2) options = cleaned
    }

    // An mcq without options is unanswerable; drop rather than render it broken.
    if (type === 'mcq' && !options) continue
    // An mcq whose answer is not among its options cannot be graded.
    if (type === 'mcq' && options && !options.some((o) => normalise(o) === normalise(answer))) {
      continue
    }

    questions.push({
      type: type as QuestionType,
      prompt,
      options,
      answer,
      explanation: explanation || 'No explanation was provided.'
    })
  }

  return questions
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '')
}

/** Recent transcript, trimmed, so the assessor only tests what was taught. */
function coveredMaterial(moduleId: number): string {
  const db = getDatabase()
  const session = db
    .prepare<[number], { id: number; state_summary: string | null }>(
      'SELECT id, state_summary FROM sessions WHERE module_id = ? ORDER BY started_at DESC LIMIT 1'
    )
    .get(moduleId)

  if (!session) return '(no tutoring session has happened yet)'

  const parts: string[] = []
  if (session.state_summary?.trim()) parts.push(session.state_summary.trim())

  const recent = getMessages(session.id).slice(-14)
  if (recent.length > 0) {
    parts.push(
      recent
        .filter((m) => m.role !== 'tool')
        .map((m) => `${m.role === 'user' ? 'Learner' : 'Tutor'}: ${m.content}`)
        .join('\n\n')
        .slice(0, 12_000)
    )
  }

  return parts.join('\n\n') || '(no tutoring session has happened yet)'
}

export async function generateQuiz(
  moduleId: number,
  focus?: string | null
): Promise<QuizDetail> {
  const { module, objectives, curriculum } = getModuleWithObjectives(moduleId)
  const mode = MODES.assessor

  const userContent = [
    `Curriculum: ${curriculum.title}`,
    `Module: ${module.title}`,
    module.summary ? `Module summary: ${module.summary}` : '',
    '',
    'Objectives:',
    ...objectives.map((o) => `- [${o.status}] ${o.text}`),
    '',
    focus ? `Focus this check on: ${focus}` : '',
    '',
    'What the learner has actually covered:',
    coveredMaterial(moduleId)
  ]
    .filter(Boolean)
    .join('\n')

  const result = await runTurn({
    model: mode.model,
    system: [{ type: 'text', text: mode.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userContent }],
    tools: [GENERATE_QUIZ_TOOL],
    maxTokens: mode.maxTokens,
    effort: 'medium'
  })

  logUsage({
    sessionId: null,
    mode: 'assessor',
    model: mode.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    estimatedUsd: result.usage.estimatedUsd
  })

  const call = result.toolInputs.find((t) => t.name === 'generate_quiz')
  const questions = call ? parseQuizQuestions(call.input) : []

  if (questions.length === 0) {
    throw new Error(
      'The assessor could not produce a usable quiz for this module. Cover more material in a session first.'
    )
  }

  return getQuizDetail(insertQuiz(moduleId, questions))
}

/* ------------------------------------------------------------- grading */

/** MCQs grade locally — no API call, so quizzes partly work offline. */
function gradeMcq(question: QuizQuestion, response: string): GradedAnswer {
  const correct = normalise(response) === normalise(question.answer)
  return {
    questionId: question.id,
    score: correct ? 1 : 0,
    correct,
    feedback: null,
    answer: question.answer,
    explanation: question.explanation
  }
}

interface GraderVerdict {
  score: number
  feedback: string
}

/** Parses the grader's JSON reply, tolerating fenced or padded output. */
export function parseGraderVerdict(text: string): GraderVerdict | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const raw = Number(parsed.score)
    if (!Number.isFinite(raw)) return null
    // The prompt asks for 0, 0.5 or 1; snap anything else to the nearest.
    const score = raw >= 0.75 ? 1 : raw >= 0.25 ? 0.5 : 0
    const feedback = typeof parsed.feedback === 'string' ? parsed.feedback.trim() : ''
    return { score, feedback }
  } catch {
    return null
  }
}

async function gradeFreeText(
  question: QuizQuestion,
  response: string
): Promise<GradedAnswer> {
  const base = {
    questionId: question.id,
    answer: question.answer,
    explanation: question.explanation
  }

  if (!response.trim()) {
    return { ...base, score: 0, correct: false, feedback: 'No answer given.' }
  }

  const mode = MODES.grader
  try {
    const result = await runSimple({
      model: mode.model,
      system: mode.system,
      userContent: `Question:\n${question.prompt}\n\nModel answer:\n${question.answer}\n\nLearner's answer:\n${response}`,
      maxTokens: mode.maxTokens
    })

    logUsage({
      sessionId: null,
      mode: 'grader',
      model: mode.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      estimatedUsd: result.usage.estimatedUsd
    })

    const verdict = parseGraderVerdict(result.text)
    if (!verdict) {
      return {
        ...base,
        score: 0,
        correct: false,
        feedback: 'The grader returned an unreadable response. Compare with the model answer yourself.'
      }
    }

    return {
      ...base,
      score: verdict.score,
      correct: verdict.score >= 1,
      feedback: verdict.feedback || null
    }
  } catch (err) {
    // Never lose an attempt because grading failed: score it zero, say why.
    return {
      ...base,
      score: 0,
      correct: false,
      feedback: `Could not be graded (${(err as Error).message}). Compare with the model answer yourself.`
    }
  }
}

/**
 * Grades an attempt and updates the module's mastery.
 * Free-text questions grade concurrently — they are independent calls.
 */
export async function submitQuiz(
  quizId: number,
  responses: Record<string, string>
): Promise<QuizResult> {
  const detail = getQuizDetail(quizId)

  const answers = await Promise.all(
    detail.questions.map((question) => {
      const response = responses[String(question.id)] ?? ''
      return question.type === 'mcq'
        ? Promise.resolve(gradeMcq(question, response))
        : gradeFreeText(question, response)
    })
  )

  const score =
    answers.length > 0
      ? answers.reduce((sum, a) => sum + a.score, 0) / answers.length
      : 0

  const attemptId = recordAttempt(quizId, score, responses)
  const mastery = recomputeMastery(detail.module.id)

  return { attemptId, score, answers, mastery }
}
