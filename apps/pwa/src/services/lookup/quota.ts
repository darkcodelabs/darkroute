/**
 * A self-imposed cap on plate lookups.
 *
 * Two unrelated problems turn out to have the same answer, which is the reason
 * this exists as a first-class module rather than a constant somewhere.
 *
 * 1. BEING A GOOD CLIENT. Whatever eventually answers a plate lookup - a
 *    donation-funded nonprofit's API, or our own backend - a driving app with
 *    an uncapped query loop is a bad neighbour. Capping ourselves before anyone
 *    asks us to is both cheap and the thing that makes a request for permission
 *    credible.
 *
 * 2. NOT BUILDING A STALKING TOOL. A person checks their own plate, and the
 *    plates of the vehicles in their household. That is a handful of distinct
 *    plates and a handful of checks. Someone working through a parking lot,
 *    or checking a plate they photographed, looks completely different: many
 *    distinct plates, repeatedly. The design copy already gestures at this
 *    ("Add only plates you're entitled to track"), but copy is not a control.
 *
 * The happy accident is that the cap which makes us a polite client is roughly
 * the same cap that makes bulk lookup useless. Tightening for one tightens the
 * other, so there is no trade-off to manage.
 *
 * WHAT THIS STORES: timestamps and a count of DISTINCT plates, keyed by blind
 * index. Never a plate. The blind index is an HMAC under a non-exportable key
 * (see `services/crypto/plate.ts`), so the quota ledger is useless to anyone
 * who dumps it - it cannot be reversed into the plates that were checked.
 *
 * WHERE IT RUNS: on the device. A server-side quota would require identifying
 * users across requests, which is exactly the tracking this product refuses to
 * do. A local cap is weaker against a determined attacker - they can clear
 * storage - but the determined attacker is not the threat this is for. It is
 * for the ordinary case, and it costs a third party nothing to enforce it here.
 */

export interface LookupQuotaPolicy {
  /** Lookups permitted in a rolling 24 hours. */
  readonly perDay: number
  /** Lookups permitted in a rolling 30 days. */
  readonly perMonth: number
  /**
   * Distinct plates permitted in a rolling 30 days.
   *
   * The sharpest of the three. Checking one plate twenty times is a worried
   * person. Checking twenty plates once each is somebody working through a
   * list, and that is the shape worth refusing.
   */
  readonly distinctPlatesPerMonth: number
}

/**
 * Product safety limits, not a statement about any outside service's limit.
 * No external lookup API is enabled; see
 * `docs/public/AGGREGATION-POLICY.md#external-lookup-boundary`.
 */
export const DEFAULT_LOOKUP_QUOTA: LookupQuotaPolicy = {
  perDay: 3,
  perMonth: 20,
  distinctPlatesPerMonth: 5,
}

const DAY_MS = 24 * 60 * 60 * 1000
const MONTH_MS = 30 * DAY_MS

/** One recorded lookup. Holds no plate - only its blind index. */
export interface LookupRecord {
  readonly blindIndex: string
  readonly at: number
}

export type QuotaDecision =
  | { readonly allowed: true; readonly remainingToday: number; readonly remainingThisMonth: number }
  | {
      readonly allowed: false
      readonly reason: 'daily' | 'monthly' | 'distinct-plates'
      /** When the caller could try again. Absolute epoch ms. */
      readonly retryAt: number
      /** Lowercase, blunt, no scolding - the product voice. */
      readonly message: string
    }

export interface QuotaCheckInput {
  readonly history: readonly LookupRecord[]
  readonly blindIndex: string
  readonly now: number
  readonly policy?: LookupQuotaPolicy
}

/**
 * Decide whether one more lookup is permitted.
 *
 * Pure. The clock is an argument, so this is deterministic under test and
 * cannot drift with a device's wall clock between calls.
 *
 * Rolling windows, not calendar ones. A calendar reset invites someone to sit
 * on the boundary and burst at midnight, and rolling windows are also simply
 * more honest: "three a day" should mean three in any day.
 */
export function checkLookupQuota(input: QuotaCheckInput): QuotaDecision {
  const policy = input.policy ?? DEFAULT_LOOKUP_QUOTA
  const { history, blindIndex, now } = input

  const sinceDay = history.filter((r) => now - r.at < DAY_MS)
  const sinceMonth = history.filter((r) => now - r.at < MONTH_MS)

  if (sinceDay.length >= policy.perDay) {
    const oldest = oldestIn(sinceDay)
    return {
      allowed: false,
      reason: 'daily',
      retryAt: oldest + DAY_MS,
      message: `${String(policy.perDay)} lookups a day. try again ${relative(oldest + DAY_MS - now)}.`,
    }
  }

  if (sinceMonth.length >= policy.perMonth) {
    const oldest = oldestIn(sinceMonth)
    return {
      allowed: false,
      reason: 'monthly',
      retryAt: oldest + MONTH_MS,
      message: `${String(policy.perMonth)} lookups a month. try again ${relative(oldest + MONTH_MS - now)}.`,
    }
  }

  // Distinct-plate ceiling. A plate already inside the window is free to
  // re-check - rechecking your own plate is the legitimate use, and counting it
  // against the distinct ceiling would punish exactly the person this is for.
  const distinct = new Set(sinceMonth.map((r) => r.blindIndex))
  if (!distinct.has(blindIndex) && distinct.size >= policy.distinctPlatesPerMonth) {
    const oldest = oldestIn(sinceMonth)
    return {
      allowed: false,
      reason: 'distinct-plates',
      retryAt: oldest + MONTH_MS,
      message:
        `${String(policy.distinctPlatesPerMonth)} different plates a month. ` +
        'this is for your own vehicles, not for looking up other people.',
    }
  }

  return {
    allowed: true,
    remainingToday: policy.perDay - sinceDay.length,
    remainingThisMonth: policy.perMonth - sinceMonth.length,
  }
}

/**
 * Append a lookup and drop anything outside the widest window.
 *
 * Pruning on write means the ledger stays bounded without a sweep job, and a
 * device that sits unused for a year comes back with an empty ledger rather
 * than a year of timestamps describing when its owner was worried.
 */
export function recordLookup(
  history: readonly LookupRecord[],
  record: LookupRecord,
): readonly LookupRecord[] {
  return [...history, record].filter((r) => record.at - r.at < MONTH_MS)
}

function oldestIn(records: readonly LookupRecord[]): number {
  return records.reduce((min, r) => (r.at < min ? r.at : min), Number.POSITIVE_INFINITY)
}

/** "in 4 hours", "in 12 minutes" - lowercase, no library. */
function relative(ms: number): string {
  if (ms <= 0) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `in ${String(minutes)} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `in ${String(hours)} hour${hours === 1 ? '' : 's'}`
  const days = Math.ceil(hours / 24)
  return `in ${String(days)} day${days === 1 ? '' : 's'}`
}
