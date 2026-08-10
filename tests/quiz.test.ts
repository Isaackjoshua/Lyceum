import { describe, expect, it } from 'vitest'
import { parseGraderVerdict, parseQuizQuestions } from '../src/main/services/quiz.js'
import { parseCards } from '../src/main/services/cards.js'

describe('parseQuizQuestions', () => {
  const mcq = {
    type: 'mcq',
    prompt: 'What does the chain rule compose?',
    options: ['Derivatives', 'Integrals', 'Matrices'],
    answer: 'Derivatives',
    explanation: 'It composes derivatives of nested functions.'
  }

  it('accepts a well-formed mixed quiz', () => {
    const questions = parseQuizQuestions({
      questions: [
        mcq,
        { type: 'short', prompt: 'Explain why.', answer: 'Because…', explanation: 'x' }
      ]
    })
    expect(questions).toHaveLength(2)
    expect(questions[0]!.options).toEqual(['Derivatives', 'Integrals', 'Matrices'])
    expect(questions[1]!.options).toBeNull()
  })

  it('drops an mcq with no options — it would be unanswerable', () => {
    expect(parseQuizQuestions({ questions: [{ ...mcq, options: undefined }] })).toHaveLength(0)
  })

  it('drops an mcq whose answer is not one of its options', () => {
    const broken = { ...mcq, answer: 'Something else entirely' }
    expect(parseQuizQuestions({ questions: [broken] })).toHaveLength(0)
  })

  it('matches the answer to an option despite case and trailing punctuation', () => {
    const q = { ...mcq, answer: 'derivatives.' }
    expect(parseQuizQuestions({ questions: [q] })).toHaveLength(1)
  })

  it('drops questions missing a prompt or answer', () => {
    expect(
      parseQuizQuestions({
        questions: [
          { type: 'short', prompt: '', answer: 'a', explanation: 'e' },
          { type: 'short', prompt: 'p', answer: '  ', explanation: 'e' }
        ]
      })
    ).toHaveLength(0)
  })

  it('rejects unknown question types', () => {
    expect(
      parseQuizQuestions({
        questions: [{ type: 'essay', prompt: 'p', answer: 'a', explanation: 'e' }]
      })
    ).toHaveLength(0)
  })

  it('supplies a placeholder when no explanation is given', () => {
    const questions = parseQuizQuestions({
      questions: [{ type: 'short', prompt: 'p', answer: 'a' }]
    })
    expect(questions[0]!.explanation).toBeTruthy()
  })

  it('returns nothing for malformed input rather than throwing', () => {
    expect(parseQuizQuestions({})).toEqual([])
    expect(parseQuizQuestions({ questions: 'nope' })).toEqual([])
    expect(parseQuizQuestions({ questions: [null, 3, 'x'] })).toEqual([])
  })
})

describe('parseGraderVerdict', () => {
  it('reads a clean JSON verdict', () => {
    const verdict = parseGraderVerdict('{"score": 1, "feedback": "Correct."}')
    expect(verdict).toEqual({ score: 1, feedback: 'Correct.' })
  })

  it('tolerates fenced or padded output', () => {
    const verdict = parseGraderVerdict(
      'Here is my grade:\n```json\n{"score": 0.5, "feedback": "Half."}\n```'
    )
    expect(verdict?.score).toBe(0.5)
  })

  it('snaps out-of-band scores to the nearest band', () => {
    expect(parseGraderVerdict('{"score": 0.9, "feedback": ""}')?.score).toBe(1)
    expect(parseGraderVerdict('{"score": 0.4, "feedback": ""}')?.score).toBe(0.5)
    expect(parseGraderVerdict('{"score": 0.1, "feedback": ""}')?.score).toBe(0)
  })

  it('returns null on unreadable output', () => {
    expect(parseGraderVerdict('I think it was pretty good!')).toBeNull()
    expect(parseGraderVerdict('{"score": "great"}')).toBeNull()
    expect(parseGraderVerdict('')).toBeNull()
  })
})

describe('parseCards', () => {
  const valid = new Set([1, 2])

  it('accepts well-formed cards and keeps a valid note id', () => {
    const cards = parseCards(
      { cards: [{ front: 'What is X?', back: 'Y', note_id: 1 }] },
      valid
    )
    expect(cards).toEqual([{ front: 'What is X?', back: 'Y', noteId: 1 }])
  })

  it('nulls a note id that does not belong to this module', () => {
    const cards = parseCards(
      { cards: [{ front: 'Q', back: 'A', note_id: 999 }] },
      valid
    )
    expect(cards[0]!.noteId).toBeNull()
  })

  it('drops cards where front and back are the same', () => {
    expect(parseCards({ cards: [{ front: 'Same', back: 'same' }] }, valid)).toHaveLength(0)
  })

  it('drops incomplete cards', () => {
    expect(
      parseCards({ cards: [{ front: '', back: 'A' }, { front: 'Q', back: '' }] }, valid)
    ).toHaveLength(0)
  })

  it('returns nothing for malformed input', () => {
    expect(parseCards({}, valid)).toEqual([])
    expect(parseCards({ cards: null }, valid)).toEqual([])
  })
})
