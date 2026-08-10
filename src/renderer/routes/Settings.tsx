import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  DatabaseBackup,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Trash2,
  Upload
} from 'lucide-react'
import type { DbInfo, SpendStatus } from '@shared/types'
import { MODELS, TUTOR_MODEL_CHOICES } from '@config/models'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn, formatUsd } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

type Feedback = { kind: 'ok' | 'error'; text: string } | null

export function SettingsRoute(): JSX.Element {
  const { settings, keyStatus, update, refreshKeyStatus } = useSettingsStore()

  const [keyInput, setKeyInput] = useState('')
  const [revealKey, setRevealKey] = useState(false)
  const [savingKey, setSavingKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyFeedback, setKeyFeedback] = useState<Feedback>(null)
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null)
  const [spend, setSpend] = useState<SpendStatus | null>(null)
  const [dataBusy, setDataBusy] = useState<'backup' | 'restore' | 'delete' | null>(null)
  const [dataNote, setDataNote] = useState<Feedback>(null)

  const refreshData = (): void => {
    void window.api.db.info().then((r) => {
      if (r.ok) setDbInfo(r.data)
    })
    void window.api.usage.spendStatus().then((r) => {
      if (r.ok) setSpend(r.data)
    })
  }

  useEffect(refreshData, [keyStatus])

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading settings…
      </div>
    )
  }

  const saveKey = async (): Promise<void> => {
    setSavingKey(true)
    setKeyFeedback(null)
    const result = await window.api.key.set(keyInput)
    setSavingKey(false)
    if (result.ok) {
      setKeyInput('')
      setRevealKey(false)
      await refreshKeyStatus()
      setKeyFeedback({ kind: 'ok', text: 'Key saved and encrypted.' })
    } else {
      setKeyFeedback({ kind: 'error', text: result.error })
    }
  }

  const clearKey = async (): Promise<void> => {
    const result = await window.api.key.clear()
    if (result.ok) {
      await refreshKeyStatus()
      setKeyFeedback({ kind: 'ok', text: 'Key removed.' })
    } else {
      setKeyFeedback({ kind: 'error', text: result.error })
    }
  }

  const testKey = async (): Promise<void> => {
    setTesting(true)
    setKeyFeedback(null)
    const result = await window.api.key.test()
    setTesting(false)
    setKeyFeedback(
      result.ok
        ? { kind: 'ok', text: result.data.message }
        : { kind: 'error', text: result.error }
    )
  }

  const backup = async (): Promise<void> => {
    setDataBusy('backup')
    setDataNote(null)
    const result = await window.api.data.backup()
    setDataBusy(null)
    if (!result.ok) setDataNote({ kind: 'error', text: result.error })
    else if (result.data.saved) {
      setDataNote({ kind: 'ok', text: `Backed up to ${result.data.path}` })
    }
  }

  const restore = async (): Promise<void> => {
    setDataBusy('restore')
    setDataNote(null)
    const result = await window.api.data.restore()
    setDataBusy(null)
    if (!result.ok) setDataNote({ kind: 'error', text: result.error })
    else {
      setDataNote({
        kind: result.data.restored ? 'ok' : 'error',
        text: result.data.message
      })
    }
  }

  const deleteAll = async (): Promise<void> => {
    setDataBusy('delete')
    setDataNote(null)
    const result = await window.api.data.deleteAll()
    setDataBusy(null)
    if (!result.ok) setDataNote({ kind: 'error', text: result.error })
    else if (result.data) {
      setDataNote({ kind: 'ok', text: 'All learning data deleted.' })
      refreshData()
    }
  }

  const encryptionUnavailable = keyStatus !== null && !keyStatus.encryptionAvailable

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
      <header className="mb-8">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lyceum is bring-your-own-key. Your key is encrypted by your operating system
          and never leaves this machine except in calls to Anthropic.
        </p>
      </header>

      {/* ---------------------------------------------------------- API key */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Anthropic API key
          </CardTitle>
          <CardDescription>
            {keyStatus?.present ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="h-3.5 w-3.5" />
                Stored as ciphertext
                {keyStatus.hint ? ` (ends …${keyStatus.hint})` : ''}
              </span>
            ) : (
              'No key stored yet.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {encryptionUnavailable && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                Your OS reports no encryption backend, so Lyceum will refuse to store a
                key rather than write it in plaintext. On Linux, start a keyring service
                (gnome-keyring or kwallet) and reopen the app.
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="api-key">
              {keyStatus?.present ? 'Replace key' : 'Paste your key'}
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={revealKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-…"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="pr-9 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setRevealKey((v) => !v)}
                  aria-label={revealKey ? 'Hide key' : 'Show key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {revealKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={() => void saveKey()}
                disabled={!keyInput.trim() || savingKey || encryptionUnavailable}
              >
                {savingKey && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Create a key at console.anthropic.com. Lyceum bills your own account and
              ships with no key of its own.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void testKey()}
              disabled={!keyStatus?.present || testing}
            >
              {testing && <Loader2 className="h-4 w-4 animate-spin" />}
              Test connection
            </Button>
            {keyStatus?.present && (
              <Button variant="ghost" onClick={() => void clearKey()}>
                <Trash2 className="h-4 w-4" /> Remove key
              </Button>
            )}
          </div>

          {keyFeedback && (
            <p
              role="status"
              className={
                keyFeedback.kind === 'ok'
                  ? 'text-sm text-success'
                  : 'text-sm text-destructive'
              }
            >
              {keyFeedback.text}
            </p>
          )}
        </CardContent>
      </Card>

      {/* -------------------------------------------------- Model + tuning */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Model &amp; generation</CardTitle>
          <CardDescription>
            Background work (flashcards, summaries) always uses the cheapest model.
            This setting controls the live tutor.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="tutor-model">Tutor model</Label>
            <Select
              value={settings.tutorModel}
              onValueChange={(value) => void update({ tutorModel: value })}
            >
              <SelectTrigger id="tutor-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TUTOR_MODEL_CHOICES.map((id) => (
                  <SelectItem key={id} value={id}>
                    {MODELS[id].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {MODELS[settings.tutorModel as keyof typeof MODELS]?.note} — $
              {MODELS[settings.tutorModel as keyof typeof MODELS]?.inputPer1M}/M in, $
              {MODELS[settings.tutorModel as keyof typeof MODELS]?.outputPer1M}/M out.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="effort">Reasoning effort</Label>
              <Select
                value={settings.effort}
                onValueChange={(value) =>
                  void update({ effort: value as typeof settings.effort })
                }
              >
                <SelectTrigger id="effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low — fastest, cheapest</SelectItem>
                  <SelectItem value="medium">Medium — balanced</SelectItem>
                  <SelectItem value="high">High — hardest material</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-tokens">Max tokens per reply</Label>
              <Input
                id="max-tokens"
                type="number"
                min={256}
                max={32000}
                step={256}
                value={settings.maxTokens}
                onChange={(e) => void update({ maxTokens: Number(e.target.value) })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------ Cost control */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Cost controls</CardTitle>
          <CardDescription>
            Usage is estimated from published per-model rates. Your real bill is on
            your Anthropic console.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {spend && (
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm">This month</span>
                <span className="font-serif text-lg font-semibold tabular-nums">
                  {formatUsd(spend.spentUsd)}
                  {spend.capUsd > 0 && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      of {formatUsd(spend.capUsd)}
                    </span>
                  )}
                </span>
              </div>
              {spend.capUsd > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      spend.fraction >= 1
                        ? 'bg-destructive'
                        : spend.warn
                          ? 'bg-accent'
                          : 'bg-success'
                    )}
                    style={{ width: `${Math.min(100, spend.fraction * 100)}%` }}
                  />
                </div>
              )}
              {spend.warn && (
                <p className="mt-2 text-xs text-accent">
                  {spend.blocked
                    ? 'Cap reached — generation is blocked until you raise it or switch blocking off.'
                    : `${Math.round(spend.fraction * 100)}% of your cap used.`}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cap">Monthly spend cap (USD, 0 = off)</Label>
            <Input
              id="cap"
              type="number"
              min={0}
              step={1}
              value={settings.spendCapUsd}
              onChange={(e) => void update({ spendCapUsd: Number(e.target.value) })}
              className="max-w-40"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="cap-blocks">Block generation at the cap</Label>
              <p className="text-xs text-muted-foreground">
                Off = warn only, and keep teaching.
              </p>
            </div>
            <Switch
              id="cap-blocks"
              checked={settings.spendCapBlocks}
              onCheckedChange={(checked) => void update({ spendCapBlocks: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------- Appearance */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="theme">Theme</Label>
            <Select
              value={settings.theme}
              onValueChange={(value) =>
                void update({ theme: value as typeof settings.theme })
              }
            >
              <SelectTrigger id="theme">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="font-scale">Base font size ({settings.fontScale}px)</Label>
            <input
              id="font-scale"
              type="range"
              min={12}
              max={24}
              step={1}
              value={settings.fontScale}
              onChange={(e) => void update({ fontScale: Number(e.target.value) })}
              className="h-9 w-full accent-[hsl(var(--accent))]"
            />
          </div>
        </CardContent>
      </Card>

      {/* -------------------------------------------------------------- Data */}
      <Card>
        <CardHeader>
          <CardTitle>Data</CardTitle>
          <CardDescription>
            Everything lives in one SQLite file. Back it up by copying it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dbInfo ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Location</dt>
              <dd className="break-all font-mono text-xs">{dbInfo.path}</dd>
              <dt className="text-muted-foreground">Schema</dt>
              <dd>v{dbInfo.schemaVersion}</dd>
              <dt className="text-muted-foreground">Contents</dt>
              <dd>
                {dbInfo.curricula} curricula · {dbInfo.notes} notes ·{' '}
                {dbInfo.flashcards} cards
              </dd>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Reading database…</p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void backup()} disabled={dataBusy !== null}>
              {dataBusy === 'backup' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <DatabaseBackup className="h-4 w-4" />
              )}
              Back up
            </Button>
            <Button variant="outline" onClick={() => void restore()} disabled={dataBusy !== null}>
              {dataBusy === 'restore' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Restore
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10"
              onClick={() => void deleteAll()}
              disabled={dataBusy !== null}
            >
              <Trash2 className="h-4 w-4" /> Delete all data
            </Button>
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            A backup is a single self-contained file. Restoring replaces everything
            and quits the app; your current database is kept alongside it as
            lyceum.replaced.sqlite.
          </p>

          {dataNote && (
            <p
              role="status"
              className={cn(
                'mt-3 break-all text-sm',
                dataNote.kind === 'ok' ? 'text-success' : 'text-destructive'
              )}
            >
              {dataNote.text}
            </p>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
