import { describe, expect, it, vi } from 'vitest'
import { assertSafeBaseUrl, isLoopback } from '../src/main/security/baseUrl.js'
import { createDeltaBatcher } from '../src/main/harness/streamBatcher.js'
import { sanitiseProviderConfigPatch } from '../src/main/ipc/validate.js'
import { escapeHtml } from '../src/main/pdf/render.js'
import { PROVIDERS } from '../config/providers.js'

describe('base URL policy', () => {
  it('accepts https anywhere', () => {
    expect(assertSafeBaseUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1'
    )
  })

  it('accepts plaintext http only on loopback', () => {
    expect(assertSafeBaseUrl('http://localhost:11434/v1')).toBeTruthy()
    expect(assertSafeBaseUrl('http://127.0.0.1:1234/v1')).toBeTruthy()
    expect(assertSafeBaseUrl('http://[::1]:8080/v1')).toBeTruthy()
  })

  it('refuses plaintext http to a remote host, which would leak the key', () => {
    expect(() => assertSafeBaseUrl('http://evil.example/v1')).toThrow(/unencrypted/)
    expect(() => assertSafeBaseUrl('http://192.168.1.5:8080/v1')).toThrow(/unencrypted/)
  })

  it('refuses non-web schemes outright', () => {
    for (const url of [
      'file:///etc/passwd',
      'data:text/plain,hi',
      'ftp://example.com',
      'javascript:alert(1)'
    ]) {
      expect(() => assertSafeBaseUrl(url), url).toThrow()
    }
  })

  it('refuses malformed input', () => {
    expect(() => assertSafeBaseUrl('not a url')).toThrow(/not a valid URL/)
  })

  it('does not mistake a lookalike host for loopback', () => {
    expect(isLoopback('localhost.evil.com')).toBe(false)
    expect(isLoopback('127.0.0.1.evil.com')).toBe(false)
    expect(isLoopback('notlocalhost')).toBe(false)
    // A genuine subdomain of .localhost resolves to loopback per RFC 6761.
    expect(isLoopback('api.localhost')).toBe(true)
  })

  it('is enforced through the settings path too', () => {
    expect(() =>
      sanitiseProviderConfigPatch({ baseUrl: 'http://evil.example/v1' })
    ).toThrow(/unencrypted/)
    expect(
      sanitiseProviderConfigPatch({ baseUrl: 'https://ok.example/v1' }).baseUrl
    ).toBe('https://ok.example/v1')
    // Clearing it back to the provider default stays allowed.
    expect(sanitiseProviderConfigPatch({ baseUrl: '' }).baseUrl).toBe('')
  })
})

describe('provider token-cap parameter', () => {
  it('uses max_completion_tokens only where the server expects it', () => {
    // Sending the wrong name is silently ignored by most compatible servers,
    // which would let generation run uncapped.
    expect(PROVIDERS.openai!.usesMaxCompletionTokens).toBe(true)
    for (const id of ['ollama', 'groq', 'together', 'moonshot', 'openrouter']) {
      expect(PROVIDERS[id]!.usesMaxCompletionTokens, id).toBe(false)
    }
  })
})

describe('escapeHtml on PDF content', () => {
  it('neutralises markup that would otherwise land in the print document', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).not.toContain('<img')
    expect(escapeHtml('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d')
  })
})

describe('delta batcher', () => {
  it('coalesces many deltas into far fewer emissions', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const batcher = createDeltaBatcher((text) => emitted.push(text), 50)

    for (let i = 0; i < 200; i++) batcher.push('x')
    // Nothing has been emitted yet — the timer has not fired.
    expect(emitted).toHaveLength(0)

    vi.advanceTimersByTime(50)
    expect(emitted).toEqual(['x'.repeat(200)])
    vi.useRealTimers()
  })

  it('loses nothing: flush emits whatever is pending', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const batcher = createDeltaBatcher((text) => emitted.push(text), 50)

    batcher.push('hello ')
    batcher.push('world')
    batcher.flush()

    expect(emitted.join('')).toBe('hello world')
    // A second flush must not double-emit.
    batcher.flush()
    expect(emitted.join('')).toBe('hello world')
    vi.useRealTimers()
  })

  it('flushes early on a large burst rather than building a backlog', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const batcher = createDeltaBatcher((text) => emitted.push(text), 50)

    batcher.push('y'.repeat(2_500))
    expect(emitted).toHaveLength(1)
    vi.useRealTimers()
  })

  it('preserves order and content across a long stream', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const batcher = createDeltaBatcher((text) => emitted.push(text), 50)

    let expected = ''
    for (let i = 0; i < 500; i++) {
      const token = `t${i} `
      expected += token
      batcher.push(token)
      if (i % 37 === 0) vi.advanceTimersByTime(50)
    }
    batcher.flush()

    expect(emitted.join('')).toBe(expected)
    // The whole point: far fewer IPC messages than tokens.
    expect(emitted.length).toBeLessThan(60)
    vi.useRealTimers()
  })

  it('ignores empty deltas', () => {
    vi.useFakeTimers()
    const emitted: string[] = []
    const batcher = createDeltaBatcher((text) => emitted.push(text), 50)
    batcher.push('')
    batcher.flush()
    expect(emitted).toHaveLength(0)
    vi.useRealTimers()
  })
})
