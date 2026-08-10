import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, Sparkles, X } from 'lucide-react'
import type { QuizDetail, QuizResult } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Markdown } from '@/components/Markdown'
import { cn } from '@/lib/utils'

type Stage = 'idle' | 'generating' | 'taking' | 'grading' | 'results'

export function QuizRoute(): JSX.Element {
  const { moduleId } = useParams<{ moduleId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const [stage, setStage] = useState<Stage>('idle')
  const [detail, setDetail] = useState<QuizDetail | null>(null)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [result, setResult] = useState<QuizResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const focus = params.get('focus')
  const id = Number(moduleId)

  const generate = useCallback(async (): Promise<void> => {
    setStage('generating')
    setError(null)
    setResult(null)
    setResponses({})
    const response = await window.api.quiz.generate(id, focus)
    if (!response.ok) {
      setError(response.error)
      setStage('idle')
      return
    }
    setDetail(response.data)
    setStage('taking')
  }, [id, focus])

  // Offer the module's last quiz rather than silently spending money on a new one.
  useEffect(() => {
    let active = true
    void window.api.quiz.latest(id).then((response) => {
      if (!active) return
      if (response.ok && response.data) {
        setDetail(response.data)
        setStage('idle')
      }
    })
    return () => {
      active = false
    }
  }, [id])

  const submit = async (): Promise<void> => {
    if (!detail) return
    setStage('grading')
    setError(null)
    const response = await window.api.quiz.submit(detail.quiz.id, responses)
    if (!response.ok) {
      setError(response.error)
      setStage('taking')
      return
    }
    setResult(response.data)
    setStage('results')
  }

  const answered = detail
    ? detail.questions.filter((q) => (responses[String(q.id)] ?? '').trim()).length
    : 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={() => navigate(`/module/${id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="font-serif text-xl font-semibold tracking-tight">
              Checkpoint
            </h1>
            <p className="text-sm text-muted-foreground">
              {detail?.module.title ?? 'Mastery check'}
            </p>
          </div>
        </div>

        {error && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {/* ------------------------------------------------------- idle */}
        {stage === 'idle' && (
          <Card className="p-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {detail
                ? 'This module already has a checkpoint. Retake it, or write a fresh one that reflects everything you have covered since.'
                : 'A checkpoint tests whether you can apply what you covered — not whether you can restate it. It is scoped to material the tutor actually taught you.'}
            </p>
            <div className="mt-5 flex gap-2">
              {detail && (
                <Button onClick={() => setStage('taking')}>Take existing quiz</Button>
              )}
              <Button
                variant={detail ? 'outline' : 'default'}
                onClick={() => void generate()}
              >
                <Sparkles className="h-4 w-4" />
                {detail ? 'Write a new one' : 'Generate checkpoint'}
              </Button>
            </div>
          </Card>
        )}

        {stage === 'generating' && (
          <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Writing questions from what you have covered…
          </Card>
        )}

        {/* ------------------------------------------------------ taking */}
        {(stage === 'taking' || stage === 'grading') && detail && (
          <>
            <div className="space-y-4">
              {detail.questions.map((question, index) => (
                <Card key={question.id} className="p-5">
                  <div className="mb-3 flex items-baseline gap-2">
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {question.type}
                    </span>
                  </div>

                  <Markdown>{question.prompt}</Markdown>

                  {question.type === 'mcq' && question.options ? (
                    <div className="mt-4 space-y-2">
                      {question.options.map((option) => {
                        const selected = responses[String(question.id)] === option
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() =>
                              setResponses({ ...responses, [question.id]: option })
                            }
                            className={cn(
                              'flex w-full items-start gap-2.5 rounded-md border p-3 text-left text-sm transition-colors',
                              selected
                                ? 'border-accent bg-accent/10'
                                : 'hover:border-accent/40 hover:bg-secondary/50'
                            )}
                          >
                            <span
                              className={cn(
                                'mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2',
                                selected ? 'border-accent bg-accent' : 'border-input'
                              )}
                            />
                            <span>{option}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <textarea
                      value={responses[String(question.id)] ?? ''}
                      onChange={(e) =>
                        setResponses({ ...responses, [question.id]: e.target.value })
                      }
                      rows={question.type === 'code' ? 8 : 4}
                      placeholder={
                        question.type === 'code'
                          ? 'Write your code here…'
                          : 'Your answer…'
                      }
                      className={cn(
                        'mt-4 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
                        question.type === 'code' && 'font-mono text-[0.85rem]'
                      )}
                    />
                  )}
                </Card>
              ))}
            </div>

            <div className="sticky bottom-0 mt-5 flex items-center gap-3 border-t bg-background/95 py-4 backdrop-blur">
              <Button onClick={() => void submit()} disabled={stage === 'grading'}>
                {stage === 'grading' && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit
              </Button>
              <span className="text-xs text-muted-foreground">
                {answered}/{detail.questions.length} answered
                {answered < detail.questions.length &&
                  ' — blanks are marked wrong, which is fine if you genuinely do not know'}
              </span>
            </div>
          </>
        )}

        {/* ----------------------------------------------------- results */}
        {stage === 'results' && detail && result && (
          <>
            <Card className="mb-5 p-6">
              <div className="flex items-baseline gap-3">
                <span className="font-serif text-4xl font-semibold tabular-nums">
                  {Math.round(result.score * 100)}%
                </span>
                <span className="text-sm text-muted-foreground">
                  module mastery now {Math.round(result.mastery * 100)}%
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {result.score >= 0.85
                  ? 'Solid. Read the explanations for anything you guessed, then move on.'
                  : result.score >= 0.6
                    ? 'A real grasp with gaps. The explanations below name them — that is where to spend your next session.'
                    : 'Worth another pass with the tutor before moving on. Nothing here is a verdict on you; it is a map of what to do next.'}
              </p>
            </Card>

            <div className="space-y-4">
              {detail.questions.map((question, index) => {
                const graded = result.answers.find((a) => a.questionId === question.id)
                const given = responses[String(question.id)] ?? ''
                const partial = graded ? graded.score > 0 && graded.score < 1 : false

                return (
                  <Card key={question.id} className="p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      {graded?.correct ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-success">
                          <Check className="h-3.5 w-3.5" /> Correct
                        </span>
                      ) : partial ? (
                        <span className="text-xs font-medium text-accent">
                          Partly right
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs font-medium text-destructive">
                          <X className="h-3.5 w-3.5" /> Not yet
                        </span>
                      )}
                    </div>

                    <Markdown>{question.prompt}</Markdown>

                    <div className="mt-3 space-y-2 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground">You said</span>
                        <p className="mt-0.5 whitespace-pre-wrap rounded bg-secondary/50 p-2 font-mono text-xs">
                          {given.trim() || '(blank)'}
                        </p>
                      </div>
                      {!graded?.correct && (
                        <div>
                          <span className="text-xs text-muted-foreground">
                            Model answer
                          </span>
                          <div className="mt-0.5">
                            <Markdown className="text-sm">{question.answer}</Markdown>
                          </div>
                        </div>
                      )}
                      {graded?.feedback && (
                        <p className="border-l-2 border-accent/40 pl-2.5 text-sm text-muted-foreground">
                          {graded.feedback}
                        </p>
                      )}
                    </div>

                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                        Why
                      </summary>
                      <div className="mt-2">
                        <Markdown className="text-sm">{question.explanation}</Markdown>
                      </div>
                    </details>
                  </Card>
                )
              })}
            </div>

            <div className="mt-6 flex gap-2">
              <Button onClick={() => navigate(`/module/${id}`)}>
                Back to the tutor
              </Button>
              <Button variant="outline" onClick={() => setStage('taking')}>
                Retake
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
