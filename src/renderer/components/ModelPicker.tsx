import type { CatalogProvider } from '@shared/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

function priceLabel(input: number, output: number): string {
  if (input === 0 && output === 0) return 'free'
  return `$${input}/$${output} per M`
}

/**
 * Chooses a `provider:model`. Providers with no key are still listed rather
 * than hidden — a learner should be able to see what is available and be told
 * what it needs, not wonder where it went.
 */
export function ModelPicker({
  id,
  label,
  hint,
  value,
  providers,
  keyPresent,
  onChange,
  backgroundOnly = false
}: {
  id: string
  label: string
  hint?: string
  value: string
  providers: CatalogProvider[]
  /** provider id -> whether it is usable (key present, or none needed). */
  keyPresent: Record<string, boolean>
  onChange: (ref: string) => void
  /** Sort cheap models first — used for the background role. */
  backgroundOnly?: boolean
}): JSX.Element {
  const selected = providers
    .flatMap((p) => p.models)
    .find((m) => m.ref === value)

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Choose a model">
            {selected ? selected.label : value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {providers.map((provider) => {
            const models = backgroundOnly
              ? [...provider.models].sort(
                  (a, b) => Number(b.background) - Number(a.background)
                )
              : provider.models
            if (models.length === 0) return null
            const usable = keyPresent[provider.id] ?? false

            return (
              <div key={provider.id}>
                <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {provider.label}
                  {!usable && provider.needsKey && ' · no key yet'}
                </div>
                {models.map((model) => (
                  <SelectItem key={model.ref} value={model.ref}>
                    <span className={cn(!usable && 'opacity-60')}>
                      {model.label}
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {priceLabel(model.inputPer1M, model.outputPer1M)}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </div>
            )
          })}
        </SelectContent>
      </Select>

      {selected ? (
        <p className="text-xs text-muted-foreground">
          {selected.note}
          {!selected.supportsTools && (
            <span className="text-accent">
              {' '}
              No native tool calling — Lyceum falls back to prompted JSON, which
              is less reliable.
            </span>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {hint ?? 'Custom model id. Cost cannot be estimated.'}
        </p>
      )}
    </div>
  )
}
