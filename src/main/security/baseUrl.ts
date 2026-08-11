/**
 * Provider endpoint validation.
 *
 * Lives on its own because it is enforced twice: once when the learner saves a
 * base URL, and again at request time. The second check matters — a value
 * could predate this rule, or arrive from a restored backup written by an
 * older build.
 */

/** Hostnames that never leave the machine, so plaintext HTTP is fine. */
export function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[|]$/g, '').toLowerCase()
  return (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

/**
 * Two rules, both load-bearing:
 *   - Only http(s). A `file:` or `data:` base URL would be a way to make the
 *     main process read something it should not.
 *   - Plaintext HTTP is allowed only to the loopback interface. A remote
 *     `http://` endpoint would put the learner's API key on the wire in the
 *     clear, on every single request — exactly the mistake a mistyped or
 *     malicious URL invites.
 */
export function assertSafeBaseUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`That is not a valid URL: ${url}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('A base URL must start with http:// or https://')
  }

  if (parsed.protocol === 'http:' && !isLoopback(parsed.hostname)) {
    throw new Error(
      `Refusing to use plaintext http:// for ${parsed.hostname} — your API key ` +
        'would be sent unencrypted on every request. Use https:// instead. ' +
        '(http:// is allowed for localhost, where nothing leaves the machine.)'
    )
  }

  return url
}
