import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Send, Sparkles } from 'lucide-react'
import type { ArchitectMessage, CurriculumProposal } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Markdown } from '@/components/Markdown'
import { ProposalEditor } from '@/components/ProposalEditor'
import { useCurriculumStore } from '@/stores/curriculumStore'
import { useSettingsStore } from '@/stores/settingsStore'

type Stage = 'intake' | 'diagnostic' | 'proposal'

/**
 * Topic -> one calibrating question -> editable syllabus -> saved.
 *
 * Nothing is written to the database until the learner presses Save, so
 * abandoning halfway leaves no debris.
 */
export function NewCurriculumRoute(): JSX.Element {
  const navigate = useNavigate()
  const keyStatus = useSettingsStore((s) => s.keyStatus)
  const refreshList = useCurriculumStore((s) => s.refresh)

  const [stage, setStage] = useState<Stage>('intake')
  const [subject, setSubject] = useState('')
  const [goal, setGoal] = useState('')
  const [messages, setMessages] = useState<ArchitectMessage[]>([])
  const [reply, setReply] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposal, setProposal] = useState<CurriculumProposal | null>(null)
  const [saving, setSaving] = useState(false)

  const requestIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stream deltas for the architect turn in progress.
  useEffect(() => {
    return window.api.session.onEvent((event) => {
      if (event.requestId !== requestIdRef.current) return
      if (event.type === 'text_delta') setStreaming((prev) => prev + event.delta)
    })
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, streaming])

  const runTurn = async (next: ArchitectMessage[]): Promise<void> => {
    setBusy(true)
    setError(null)
    setStreaming('')
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId

    const result = await window.api.curriculum.architectTurn(next, requestId)
    requestIdRef.current = null
    setStreaming('')
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setMessages([...next, { role: 'assistant', content: result.data.text }])
    if (result.data.proposal) {
      setProposal(result.data.proposal)
      setStage('proposal')
    } else {
      setStage('diagnostic')
    }
  }

  const beginDiagnostic = (): void => {
    const opening: ArchitectMessage = {
      role: 'user',
      content: `I want to learn: ${subject.trim()}\n\nMy goal: ${goal.trim()}`
    }
    void runTurn([opening])
  }

  const sendReply = (): void => {
    const text = reply.trim()
    if (!text || busy) return
    setReply('')
    void runTurn([...messages, { role: 'user', content: text }])
  }

  const save = async (edited: CurriculumProposal): Promise<void> => {
    setSaving(true)
    setError(null)
    const result = await window.api.curriculum.save(edited)
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    await refreshList()
    navigate(`/curriculum/${result.data.id}`)
  }

  if (keyStatus && !keyStatus.present) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <div className="max-w-md text-center">
          <h1 className="font-serif text-xl font-semibold">An API key is needed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Building a curriculum requires a live call to Claude. Add your Anthropic
            key in Settings first.
          </p>
          <Button className="mt-5" onClick={() => navigate('/settings')}>
            Open Settings
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-6 py-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-serif text-lg font-semibold leading-tight">
            New curriculum
          </h1>
          <p className="text-xs text-muted-foreground">
            {stage === 'intake' && 'What do you want to learn?'}
            {stage === 'diagnostic' && 'Answer so the plan fits where you actually are'}
            {stage === 'proposal' && 'Edit anything before you save it'}
          </p>
        </div>
      </header>

      {stage === 'intake' && (
        <div className="mx-auto w-full max-w-xl px-8 py-12">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                autoFocus
                placeholder="Backpropagation in neural networks"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="goal">What do you want to be able to do?</Label>
              <Input
                id="goal"
                placeholder="Understand it well enough to implement it from scratch"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && subject.trim() && goal.trim()) {
                    beginDiagnostic()
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Be concrete. &ldquo;Implement it from scratch&rdquo; produces a very
                different plan from &ldquo;follow a paper that mentions it&rdquo;.
              </p>
            </div>
            <Button
              onClick={beginDiagnostic}
              disabled={!subject.trim() || !goal.trim() || busy}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Continue
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
      )}

      {stage === 'diagnostic' && (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-6">
            <div className="mx-auto max-w-2xl space-y-5">
              {messages.map((message, i) => (
                <div key={i}>
                  {message.role === 'user' ? (
                    <div className="ml-auto max-w-[85%] rounded-lg bg-secondary px-4 py-2.5 text-sm">
                      {message.content}
                    </div>
                  ) : (
                    <Markdown>{message.content}</Markdown>
                  )}
                </div>
              ))}
              {streaming && <Markdown>{streaming}</Markdown>}
              {busy && !streaming && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>

          <div className="border-t px-8 py-4">
            <div className="mx-auto flex max-w-2xl gap-2">
              <Input
                autoFocus
                placeholder="Your answer…"
                value={reply}
                disabled={busy}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendReply()
                  }
                }}
              />
              <Button onClick={sendReply} disabled={!reply.trim() || busy}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {stage === 'proposal' && proposal && (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-3xl">
            {messages.at(-1)?.role === 'assistant' && (
              <div className="mb-6">
                <Markdown>{messages.at(-1)!.content}</Markdown>
              </div>
            )}
            <ProposalEditor
              proposal={proposal}
              saving={saving}
              onSave={(edited) => void save(edited)}
              onCancel={() => setStage('diagnostic')}
            />
            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          </div>
        </div>
      )}
    </div>
  )
}
