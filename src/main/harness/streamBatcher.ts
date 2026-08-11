/**
 * Coalesces streamed text deltas.
 *
 * Providers emit a delta per token. Forwarding each one straight across IPC
 * means thousands of messages for a single reply, and — worse — a React state
 * update and a full markdown re-parse per token in the renderer, which is
 * quadratic in reply length. A long explanation visibly stutters.
 *
 * Batching on a short interval collapses that by one to two orders of
 * magnitude while staying well under the threshold where streaming stops
 * feeling live. Nothing is ever dropped: `flush()` is called before the turn
 * completes.
 */

const FLUSH_INTERVAL_MS = 50
/** Flush early on a big burst so a fast provider does not build a backlog. */
const MAX_PENDING_CHARS = 2_000

export interface DeltaBatcher {
  push: (delta: string) => void
  /** Emits anything buffered. Safe to call repeatedly. */
  flush: () => void
}

export function createDeltaBatcher(
  emit: (text: string) => void,
  intervalMs = FLUSH_INTERVAL_MS
): DeltaBatcher {
  let pending = ''
  let timer: NodeJS.Timeout | null = null

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) return
    const text = pending
    pending = ''
    emit(text)
  }

  return {
    push: (delta) => {
      if (!delta) return
      pending += delta
      if (pending.length >= MAX_PENDING_CHARS) {
        flush()
        return
      }
      // Leading edge is deliberately not emitted: the first token would arrive
      // alone and the rest batched, which looks like a stall then a dump.
      if (!timer) timer = setTimeout(flush, intervalMs)
    },
    flush
  }
}
