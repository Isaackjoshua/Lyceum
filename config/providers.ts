/**
 * Model providers.
 *
 * Lyceum is not native to any one vendor. Two client implementations cover
 * everything:
 *
 *   - `anthropic`         — the Anthropic SDK, for Claude models.
 *   - `openai-compatible` — the OpenAI SDK pointed at a base URL. This covers
 *                           OpenAI itself, Moonshot (Kimi), OpenRouter, Groq,
 *                           Together, Ollama, LM Studio and anything else
 *                           speaking the same wire format.
 *
 * VERIFY MODEL IDS BEFORE RELYING ON THEM. Anthropic's and OpenAI's ids below
 * were checked against their published catalogs; ids for the open-weight and
 * aggregator providers move quickly, so those are editable in Settings and the
 * presets here are only a starting point.
 */

export type ProviderKind = 'anthropic' | 'openai-compatible'

/** How the provider is authenticated. */
export type AuthMode = 'api-key' | 'none'

export interface ProviderInfo {
  id: string
  label: string
  kind: ProviderKind
  /** Fixed for hosted providers; editable when `baseUrlEditable`. */
  defaultBaseUrl: string | null
  baseUrlEditable: boolean
  auth: AuthMode
  /** Rough shape of a valid key, used for a friendly pre-flight check only. */
  keyPrefix: string | null
  /** Where to get a key. Shown in Settings; never fetched. */
  consoleUrl: string | null
  /** Model ids can be typed freely (aggregators, local runtimes). */
  allowsCustomModels: boolean
  blurb: string
}

export const PROVIDERS: Record<string, ProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    kind: 'anthropic',
    defaultBaseUrl: null,
    baseUrlEditable: false,
    auth: 'api-key',
    keyPrefix: 'sk-ant-',
    consoleUrl: 'https://console.anthropic.com',
    allowsCustomModels: false,
    blurb: 'Claude models. The strongest tutoring quality in Lyceum today.'
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlEditable: false,
    auth: 'api-key',
    keyPrefix: 'sk-',
    consoleUrl: 'https://platform.openai.com/api-keys',
    allowsCustomModels: true,
    blurb: 'GPT models via the OpenAI API.'
  },
  moonshot: {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    // Mainland China uses api.moonshot.cn.
    baseUrlEditable: true,
    auth: 'api-key',
    keyPrefix: 'sk-',
    consoleUrl: 'https://platform.moonshot.ai',
    allowsCustomModels: true,
    blurb:
      'Kimi models, OpenAI-compatible. Model ids change often — check their docs and type the current one.'
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    baseUrlEditable: false,
    auth: 'api-key',
    keyPrefix: 'sk-or-',
    consoleUrl: 'https://openrouter.ai/keys',
    allowsCustomModels: true,
    blurb:
      'One key, hundreds of models including most open-weight ones. Use the full id, e.g. moonshotai/kimi-k2.'
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    baseUrlEditable: false,
    auth: 'api-key',
    keyPrefix: 'gsk_',
    consoleUrl: 'https://console.groq.com/keys',
    allowsCustomModels: true,
    blurb: 'Open-weight models at very high speed.'
  },
  together: {
    id: 'together',
    label: 'Together AI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    baseUrlEditable: false,
    auth: 'api-key',
    keyPrefix: null,
    consoleUrl: 'https://api.together.ai/settings/api-keys',
    allowsCustomModels: true,
    blurb: 'Hosted open-weight models.'
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    baseUrlEditable: true,
    auth: 'none',
    keyPrefix: null,
    consoleUrl: 'https://ollama.com',
    allowsCustomModels: true,
    blurb:
      'Models running on this machine. No key, no cost, works offline — but tool support varies by model.'
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai-compatible',
    defaultBaseUrl: '',
    baseUrlEditable: true,
    auth: 'api-key',
    keyPrefix: null,
    consoleUrl: null,
    allowsCustomModels: true,
    blurb: 'Any other endpoint speaking the OpenAI chat-completions format.'
  }
}

export const PROVIDER_IDS = Object.keys(PROVIDERS)

export function providerInfo(id: string): ProviderInfo | null {
  return PROVIDERS[id] ?? null
}
