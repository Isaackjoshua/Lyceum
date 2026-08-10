import { join } from 'node:path'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  renameSync
} from 'node:fs'
import { app, safeStorage } from 'electron'
import type { KeyStatus } from '@shared/types.js'
import { PROVIDERS, providerInfo } from '@config/providers.js'

/**
 * The API key vault — one encrypted key per provider.
 *
 * Invariants — do not weaken these:
 *   1. Plaintext keys never leave this module except via getApiKey(), which is
 *      only ever called from within the main process.
 *   2. A key is never logged, never sent over IPC, never written in plaintext.
 *   3. If the OS keychain is unavailable, we refuse to store rather than
 *      falling back to plaintext on disk.
 */

const LEGACY_FILE = 'anthropic.key.enc'
const LEGACY_HINT = 'anthropic.key.hint'

function safeProviderId(provider: string): string {
  if (!(provider in PROVIDERS)) throw new Error(`Unknown provider: ${provider}`)
  return provider
}

function vaultPath(provider: string): string {
  return join(app.getPath('userData'), `${safeProviderId(provider)}.key.enc`)
}

function hintPath(provider: string): string {
  return join(app.getPath('userData'), `${safeProviderId(provider)}.key.hint`)
}

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/**
 * Moves a pre-multi-provider Anthropic key to its provider-scoped name.
 * Runs once at startup; a no-op afterwards.
 */
export function migrateLegacyKey(): void {
  const dir = app.getPath('userData')
  const legacy = join(dir, LEGACY_FILE)
  if (!existsSync(legacy)) return

  const target = vaultPath('anthropic')
  if (!existsSync(target)) {
    try {
      renameSync(legacy, target)
      const legacyHint = join(dir, LEGACY_HINT)
      if (existsSync(legacyHint)) renameSync(legacyHint, hintPath('anthropic'))
      console.log('[keyVault] migrated legacy Anthropic key')
    } catch (err) {
      console.error('[keyVault] legacy key migration failed:', (err as Error).message)
    }
  }
}

export function hasApiKey(provider: string): boolean {
  // Providers that need no auth (a local runtime) are always "ready".
  if (providerInfo(provider)?.auth === 'none') return true
  return existsSync(vaultPath(provider))
}

/** Metadata only — safe to send to the renderer. */
export function getKeyStatus(provider: string): KeyStatus {
  const info = providerInfo(provider)
  if (info?.auth === 'none') {
    return {
      provider,
      present: true,
      required: false,
      encryptionAvailable: isEncryptionAvailable(),
      hint: null
    }
  }

  const present = existsSync(vaultPath(provider))
  let hint: string | null = null
  if (present && existsSync(hintPath(provider))) {
    try {
      hint = readFileSync(hintPath(provider), 'utf8').trim() || null
    } catch {
      hint = null
    }
  }
  return {
    provider,
    present,
    required: true,
    encryptionAvailable: isEncryptionAvailable(),
    hint
  }
}

export function allKeyStatuses(): KeyStatus[] {
  return Object.keys(PROVIDERS).map(getKeyStatus)
}

/**
 * Encrypts and stores a key. Throws if the OS provides no encryption backend
 * (Keychain / DPAPI / libsecret) — we will not store it in the clear.
 */
export function setApiKey(provider: string, apiKey: string): KeyStatus {
  const info = providerInfo(safeProviderId(provider))
  if (info?.auth === 'none') {
    throw new Error(`${info.label} needs no API key.`)
  }

  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key is empty.')

  // A prefix check catches the common paste-the-wrong-key mistake early. It is
  // advisory: providers change formats, so a mismatch warns rather than blocks
  // only where we are confident.
  if (info?.keyPrefix && !trimmed.startsWith(info.keyPrefix)) {
    throw new Error(
      `That does not look like a ${info.label} key (expected it to start with ${info.keyPrefix}).`
    )
  }

  if (!isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is unavailable, so the key cannot be stored safely. ' +
        'On Linux this usually means no keyring service (gnome-keyring / kwallet) is running.'
    )
  }

  const ciphertext = safeStorage.encryptString(trimmed)
  writeFileSync(vaultPath(provider), ciphertext, { mode: 0o600 })
  writeFileSync(hintPath(provider), trimmed.slice(-4), {
    mode: 0o600,
    encoding: 'utf8'
  })
  try {
    chmodSync(vaultPath(provider), 0o600)
    chmodSync(hintPath(provider), 0o600)
  } catch {
    // Best effort — Windows has no POSIX modes.
  }

  return getKeyStatus(provider)
}

export function clearApiKey(provider: string): KeyStatus {
  for (const path of [vaultPath(provider), hintPath(provider)]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch (err) {
        throw new Error(`Could not remove the stored key: ${(err as Error).message}`)
      }
    }
  }
  return getKeyStatus(provider)
}

/**
 * Decrypts and returns a key. MAIN PROCESS ONLY — never expose over IPC.
 * Returns null when none is stored, or when the provider needs no key.
 */
export function getApiKey(provider: string): string | null {
  if (providerInfo(provider)?.auth === 'none') return null
  if (!existsSync(vaultPath(provider))) return null
  if (!isEncryptionAvailable()) return null
  try {
    const ciphertext = readFileSync(vaultPath(provider))
    return safeStorage.decryptString(ciphertext).trim() || null
  } catch {
    // Corrupt, or written under a different OS user / keychain.
    return null
  }
}
