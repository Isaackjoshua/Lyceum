import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs'
import { app, safeStorage } from 'electron'
import type { KeyStatus } from '@shared/types.js'

/**
 * The Anthropic API key vault.
 *
 * Invariants — do not weaken these:
 *   1. The plaintext key never leaves this module except via getApiKey(),
 *      which is only ever called from within the main process.
 *   2. The key is never logged, never sent over IPC, never written in plaintext.
 *   3. If the OS keychain is unavailable, we refuse to store the key rather
 *      than falling back to plaintext on disk.
 */

const FILE_NAME = 'anthropic.key.enc'
const HINT_FILE = 'anthropic.key.hint'

function vaultPath(): string {
  return join(app.getPath('userData'), FILE_NAME)
}

function hintPath(): string {
  return join(app.getPath('userData'), HINT_FILE)
}

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function hasApiKey(): boolean {
  return existsSync(vaultPath())
}

/** Metadata only — safe to send to the renderer. */
export function getKeyStatus(): KeyStatus {
  const present = hasApiKey()
  let hint: string | null = null
  if (present && existsSync(hintPath())) {
    try {
      hint = readFileSync(hintPath(), 'utf8').trim() || null
    } catch {
      hint = null
    }
  }
  return { present, encryptionAvailable: isEncryptionAvailable(), hint }
}

/**
 * Encrypts and stores the key. Throws if the OS provides no encryption
 * backend (Keychain / DPAPI / libsecret) — we will not store it in the clear.
 */
export function setApiKey(apiKey: string): KeyStatus {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('API key is empty.')
  if (!trimmed.startsWith('sk-ant-')) {
    throw new Error('That does not look like an Anthropic API key (expected sk-ant-…).')
  }
  if (!isEncryptionAvailable()) {
    throw new Error(
      'OS encryption is unavailable, so the key cannot be stored safely. ' +
        'On Linux this usually means no keyring service (gnome-keyring / kwallet) is running.'
    )
  }

  const ciphertext = safeStorage.encryptString(trimmed)
  writeFileSync(vaultPath(), ciphertext, { mode: 0o600 })
  writeFileSync(hintPath(), trimmed.slice(-4), { mode: 0o600, encoding: 'utf8' })
  try {
    chmodSync(vaultPath(), 0o600)
    chmodSync(hintPath(), 0o600)
  } catch {
    // Best effort — Windows has no POSIX modes.
  }

  return getKeyStatus()
}

export function clearApiKey(): KeyStatus {
  for (const path of [vaultPath(), hintPath()]) {
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch (err) {
        throw new Error(`Could not remove the stored key: ${(err as Error).message}`)
      }
    }
  }
  return getKeyStatus()
}

/**
 * Decrypts and returns the key. MAIN PROCESS ONLY — never expose over IPC.
 * Returns null when no key is stored.
 */
export function getApiKey(): string | null {
  if (!hasApiKey()) return null
  if (!isEncryptionAvailable()) return null
  try {
    const ciphertext = readFileSync(vaultPath())
    const plaintext = safeStorage.decryptString(ciphertext)
    return plaintext.trim() || null
  } catch {
    // Corrupt or written under a different OS user / keychain.
    return null
  }
}
