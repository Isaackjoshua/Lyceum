import type { SpendStatus, UsageTotals } from '@shared/types.js'
import { getDatabase } from '../db/index.js'
import { readSettings } from '../db/queries/settings.js'

/** Start of the current calendar month, local time. */
export function monthStart(now = Date.now()): number {
  const d = new Date(now)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function totalsSince(since: number): UsageTotals {
  const row = getDatabase()
    .prepare<[number], { input: number | null; output: number | null; usd: number | null }>(
      `SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(estimated_usd) AS usd
       FROM usage_log WHERE ts >= ?`
    )
    .get(since)

  return {
    inputTokens: row?.input ?? 0,
    outputTokens: row?.output ?? 0,
    estimatedUsd: row?.usd ?? 0
  }
}

export function monthToDateUsage(now = Date.now()): UsageTotals {
  return totalsSince(monthStart(now))
}

export function sessionUsage(sessionId: number): UsageTotals {
  const row = getDatabase()
    .prepare<[number], { input: number | null; output: number | null; usd: number | null }>(
      `SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(estimated_usd) AS usd
       FROM usage_log WHERE session_id = ?`
    )
    .get(sessionId)

  return {
    inputTokens: row?.input ?? 0,
    outputTokens: row?.output ?? 0,
    estimatedUsd: row?.usd ?? 0
  }
}

/** Fraction of the cap at which we start warning. */
const WARN_AT = 0.8

/**
 * Where the learner stands against their monthly cap.
 *
 * `blocked` is only ever true when they explicitly asked for blocking — the
 * default is to warn and keep teaching, because silently refusing to answer
 * mid-session is a worse failure than a slightly larger bill.
 */
export function spendStatus(now = Date.now()): SpendStatus {
  const settings = readSettings()
  const spent = monthToDateUsage(now).estimatedUsd
  const cap = settings.spendCapUsd

  if (cap <= 0) {
    return { spentUsd: spent, capUsd: 0, fraction: 0, warn: false, blocked: false }
  }

  const fraction = spent / cap
  return {
    spentUsd: spent,
    capUsd: cap,
    fraction,
    warn: fraction >= WARN_AT,
    blocked: settings.spendCapBlocks && fraction >= 1
  }
}

export class SpendCapReachedError extends Error {
  constructor(spent: number, cap: number) {
    super(
      `Monthly spend cap reached — about $${spent.toFixed(2)} of $${cap.toFixed(2)} estimated. ` +
        'Raise the cap or switch off blocking in Settings to keep going.'
    )
    this.name = 'SpendCapReachedError'
  }
}

/**
 * Called before any billable request. Throws only when the learner asked to be
 * blocked; a warning is surfaced through `spendStatus`, not by refusing.
 */
export function assertWithinCap(now = Date.now()): void {
  const status = spendStatus(now)
  if (status.blocked) throw new SpendCapReachedError(status.spentUsd, status.capUsd)
}
