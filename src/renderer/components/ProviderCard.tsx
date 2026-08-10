import { useState } from 'react'
import { Check, ExternalLink, Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react'
import type { CatalogProvider, KeyStatus } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * One provider's configuration: its key, its endpoint, and any model ids the
 * learner typed themselves.
 */
export function ProviderCard({
  provider,
  status,
  encryptionAvailable,
  onSaveKey,
  onClearKey,
  onSetConfig
}: {
  provider: CatalogProvider
  status: KeyStatus | undefined
  encryptionAvailable: boolean
  onSaveKey: (provider: string, key: string) => Promise<string | null>
  onClearKey: (provider: string) => Promise<void>
  onSetConfig: (
    provider: string,
    patch: { baseUrl?: string; customModels?: string[] }
  ) => Promise<void>
}): JSX.Element {
  const [keyInput, setKeyInput] = useState('')
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baseUrl, setBaseUrl] = useState(provider.config.baseUrl)
  const [newModel, setNewModel] = useState('')

  const ready = status?.present ?? false

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const message = await onSaveKey(provider.id, keyInput)
    setSaving(false)
    if (message) setError(message)
    else {
      setKeyInput('')
      setReveal(false)
    }
  }

  const addModel = async (): Promise<void> => {
    const id = newModel.trim()
    if (!id) return
    await onSetConfig(provider.id, {
      customModels: [...provider.config.customModels, id]
    })
    setNewModel('')
  }

  return (
    <div className="rounded-md border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{provider.label}</h3>
            {ready ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-success">
                <Check className="h-3 w-3" />
                {provider.needsKey
                  ? `ready${status?.hint ? ` · …${status.hint}` : ''}`
                  : 'no key needed'}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">not configured</span>
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {provider.blurb}
          </p>
        </div>
        {provider.consoleUrl && (
          <a
            href={provider.consoleUrl}
            onClick={(e) => e.preventDefault()}
            title={provider.consoleUrl}
            className="shrink-0 text-muted-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {provider.needsKey && (
          <div className="space-y-1.5">
            <Label htmlFor={`key-${provider.id}`} className="text-xs">
              {ready ? 'Replace key' : 'API key'}
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id={`key-${provider.id}`}
                  type={reveal ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : 'key'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="h-8 pr-8 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? 'Hide key' : 'Show key'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={!keyInput.trim() || saving || !encryptionAvailable}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
              {ready && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${provider.label} key`}
                  onClick={() => void onClearKey(provider.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {provider.baseUrlEditable && (
          <div className="space-y-1.5">
            <Label htmlFor={`url-${provider.id}`} className="text-xs">
              Base URL
            </Label>
            <div className="flex gap-2">
              <Input
                id={`url-${provider.id}`}
                value={baseUrl}
                placeholder={provider.defaultBaseUrl || 'https://…/v1'}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="h-8 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void onSetConfig(provider.id, { baseUrl })}
                disabled={baseUrl === provider.config.baseUrl}
              >
                Set
              </Button>
            </div>
          </div>
        )}

        {provider.allowsCustomModels && (
          <div className="space-y-1.5">
            <Label htmlFor={`model-${provider.id}`} className="text-xs">
              Add a model id
            </Label>
            <div className="flex gap-2">
              <Input
                id={`model-${provider.id}`}
                value={newModel}
                placeholder="exact id from the provider's docs"
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addModel()
                }}
                className="h-8 font-mono text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void addModel()}
                disabled={!newModel.trim()}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>

            {provider.config.customModels.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {provider.config.customModels.map((id) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {id}
                    <button
                      type="button"
                      aria-label={`Remove ${id}`}
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        void onSetConfig(provider.id, {
                          customModels: provider.config.customModels.filter(
                            (m) => m !== id
                          )
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className={cn('text-xs text-destructive')}>{error}</p>}
      </div>
    </div>
  )
}
