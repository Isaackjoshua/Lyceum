import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  DatabaseBackup,
  Loader2,
  Plug,
  Trash2,
  Upload
} from 'lucide-react'
import type { DbInfo, SpendStatus } from '@shared/types'
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
import { ModelPicker } from '@/components/ModelPicker'
import { ProviderCard } from '@/components/ProviderCard'
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
  const { settings, keys, catalog, update, refreshKeys, setProviderConfig } =
    useSettingsStore()

  const [testing, setTesting] = useState(false)
  const [testFeedback, setTestFeedback] = useState<Feedback>(null)
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

  useEffect(refreshData, [keys])

  if (!settings || !catalog) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading settings…
      </div>
    )
  }

  const encryptionAvailable = Object.values(keys).some((k) => k.encryptionAvailable)
  const keyPresent = Object.fromEntries(
    catalog.providers.map((p) => [p.id, keys[p.id]?.present ?? false])
  )

  const saveKey = async (provider: string, key: string): Promise<string | null> => {
    const result = await window.api.key.set(provider, key)
    if (!result.ok) return result.error
    await refreshKeys()
    return null
  }

  const clearKey = async (provider: string): Promise<void> => {
    const result = await window.api.key.clear(provider)
    if (result.ok) await refreshKeys()
  }

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    setTestFeedback(null)
    const result = await window.api.key.test(settings.tutorModel)
    setTesting(false)
    setTestFeedback(
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
    setDataNote(
      result.ok
        ? { kind: result.data.restored ? 'ok' : 'error', text: result.data.message }
        : { kind: 'error', text: result.error }
    )
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-10">
        <header className="mb-8">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lyceum is bring-your-own-key and works with any provider. Keys are
            encrypted by your operating system and never leave this machine except
            in calls to the provider you chose.
          </p>
        </header>

        {/* ------------------------------------------------------- models */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Models</CardTitle>
            <CardDescription>
              The tutor model does the teaching. The background model handles
              summaries, flashcards and grading — pick something cheap for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <ModelPicker
              id="tutor-model"
              label="Tutor"
              value={settings.tutorModel}
              providers={catalog.providers}
              keyPresent={keyPresent}
              onChange={(ref) => void update({ tutorModel: ref })}
            />

            <ModelPicker
              id="background-model"
              label="Background work"
              value={settings.backgroundModel}
              providers={catalog.providers}
              keyPresent={keyPresent}
              backgroundOnly
              onChange={(ref) => void update({ backgroundModel: ref })}
            />

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
                <p className="text-xs text-muted-foreground">
                  Only sent to models that accept it; ignored elsewhere.
                </p>
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

            <div className="flex items-center gap-2 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => void testConnection()}
                disabled={testing}
              >
                {testing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                Test tutor model
              </Button>
              {testFeedback && (
                <p
                  role="status"
                  className={
                    testFeedback.kind === 'ok'
                      ? 'text-sm text-success'
                      : 'text-sm text-destructive'
                  }
                >
                  {testFeedback.text}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ---------------------------------------------------- providers */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              Configure as many as you like — you can teach on one and run
              background work on another.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!encryptionAvailable && (
              <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  Your OS reports no encryption backend, so Lyceum will refuse to
                  store any key rather than write it in plaintext. On Linux, start a
                  keyring service (gnome-keyring or kwallet) and reopen the app.
                  Local providers that need no key still work.
                </div>
              </div>
            )}

            {catalog.providers.map((provider) => (
              <ProviderCard
                key={provider.id}
                provider={provider}
                status={keys[provider.id]}
                encryptionAvailable={encryptionAvailable}
                onSaveKey={saveKey}
                onClearKey={clearKey}
                onSetConfig={setProviderConfig}
              />
            ))}
          </CardContent>
        </Card>

        {/* ------------------------------------------------ cost controls */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Cost controls</CardTitle>
            <CardDescription>
              Estimated from published rates for models we have pricing for. Local
              models cost nothing and custom ids cannot be estimated.
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

        {/* -------------------------------------------------- appearance */}
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
              <Label htmlFor="font-scale">
                Base font size ({settings.fontScale}px)
              </Label>
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

        {/* -------------------------------------------------------- data */}
        <Card>
          <CardHeader>
            <CardTitle>Data</CardTitle>
            <CardDescription>Everything lives in one SQLite file.</CardDescription>
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
              <Button
                variant="outline"
                onClick={() => void backup()}
                disabled={dataBusy !== null}
              >
                {dataBusy === 'backup' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DatabaseBackup className="h-4 w-4" />
                )}
                Back up
              </Button>
              <Button
                variant="outline"
                onClick={() => void restore()}
                disabled={dataBusy !== null}
              >
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
