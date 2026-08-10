import type { CatalogModel, CatalogProvider, ProviderCatalog } from '@shared/types.js'
import { lookupModel, modelRef, modelsForProvider } from '@config/models.js'
import { PROVIDERS } from '@config/providers.js'
import { readAllProviderConfigs } from '../db/queries/settings.js'

/**
 * The model picker's data source: every provider, its configuration, and the
 * models available under it — presets from the catalog plus whatever ids the
 * learner typed themselves.
 */
export function buildProviderCatalog(): ProviderCatalog {
  const configs = readAllProviderConfigs()

  const providers: CatalogProvider[] = Object.values(PROVIDERS).map((info) => {
    const config = configs[info.id] ?? { baseUrl: '', customModels: [] }

    const presets: CatalogModel[] = modelsForProvider(info.id).map((m) => ({
      ref: modelRef(m.provider, m.id),
      provider: m.provider,
      id: m.id,
      label: m.label,
      inputPer1M: m.inputPer1M,
      outputPer1M: m.outputPer1M,
      supportsTools: m.capabilities.tools,
      background: m.background,
      note: m.note,
      custom: false
    }))

    const presetIds = new Set(presets.map((m) => m.id))
    const custom: CatalogModel[] = config.customModels
      .filter((id) => !presetIds.has(id))
      .map((id) => {
        const ref = modelRef(info.id, id)
        const m = lookupModel(ref)
        return {
          ref,
          provider: info.id,
          id,
          label: id,
          inputPer1M: m.inputPer1M,
          outputPer1M: m.outputPer1M,
          supportsTools: m.capabilities.tools,
          background: m.background,
          note: m.note,
          custom: true
        }
      })

    return {
      id: info.id,
      label: info.label,
      kind: info.kind,
      defaultBaseUrl: info.defaultBaseUrl,
      baseUrlEditable: info.baseUrlEditable,
      needsKey: info.auth === 'api-key',
      keyPrefix: info.keyPrefix,
      consoleUrl: info.consoleUrl,
      allowsCustomModels: info.allowsCustomModels,
      blurb: info.blurb,
      config,
      models: [...presets, ...custom]
    }
  })

  return { providers }
}
