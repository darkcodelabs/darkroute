/**
 * THE PRIVACY HOLD SURVIVES THE RETRY PATH.
 *
 * =============================================================================
 * THE BUG THIS PREVENTS, WHICH IS A BUG OF SHARING ONE FIELD
 * =============================================================================
 * A published report says a named account was at a place at a time. One is a
 * data point; a stream uploaded minutes after capture is a route. The hold is
 * what breaks the link between when a camera was seen and when it was
 * published, and everything else in the privacy story leans on it.
 *
 * The obvious place to put it is `nextAttemptAt`, which already exists and
 * already gates `due()`. That is exactly wrong, because `nextAttemptAt` belongs
 * to the TRANSPORT:
 *
 *   `markFailed`  overwrites it with an exponential backoff, unconditionally
 *   `markSyncing` sets it to null
 *   `due()`       treats null as "run now"
 *
 * So a hold stored there is destroyed by the first 429, the first closed
 * changeset, the first dropped connection. A jitter measured in days becomes a
 * backoff measured in seconds, and the upload happens at a time tightly
 * correlated with where its author just was. Silently, in the error path, which
 * is the path nobody exercises by hand.
 *
 * `publishableAt` is therefore a separate field that the transport does not own
 * and cannot write - it is deliberately absent from `ReportSyncPatch`, so an
 * attempt to touch it fails to compile rather than failing in production.
 */

import { describe, expect, it } from 'vitest';

import {
  PUBLISH_HOLD_MAX_MS,
  PUBLISH_HOLD_MIN_MS,
  backoffDelayMs,
  DEFAULT_BACKOFF_POLICY,
  publishHoldMs,
} from './backoff.ts';

describe('publishHoldMs', () => {
  it('never returns less than a day, whatever the roll', () => {
    // The lower bound is what clears same-day correlation. A hold of zero is
    // the absence of the feature.
    for (const roll of [0, 0.0001, 0.5, 0.9999, 1]) {
      expect(publishHoldMs(() => roll)).toBeGreaterThanOrEqual(PUBLISH_HOLD_MIN_MS);
      expect(publishHoldMs(() => roll)).toBeLessThanOrEqual(PUBLISH_HOLD_MAX_MS);
    }
  });

  it('survives a broken random source without collapsing to zero', () => {
    // A `random` that returns NaN or out-of-range must degrade to the minimum
    // hold, not to no hold. Failing open here is failing dangerous.
    expect(publishHoldMs(() => Number.NaN)).toBe(PUBLISH_HOLD_MIN_MS);
    expect(publishHoldMs(() => -5)).toBe(PUBLISH_HOLD_MIN_MS);
    expect(publishHoldMs(() => 42)).toBe(PUBLISH_HOLD_MAX_MS);
  });

  it('spreads one drive across different days, which is the entire mechanism', () => {
    /*
     * A FIXED DELAY IS NOT A DELAY, IT IS AN OFFSET. Subtract the constant and
     * the original timeline returns intact, so the hold has to be drawn per
     * record from a range wide enough that reports captured minutes apart
     * routinely publish on different days.
     */
    const day = 24 * 60 * 60 * 1000;
    const rolls = [0.02, 0.19, 0.37, 0.55, 0.71, 0.88, 0.99];
    const days = new Set(rolls.map((r) => Math.floor(publishHoldMs(() => r) / day)));
    expect(days.size).toBeGreaterThanOrEqual(5);
  });

  it('DWARFS the retry backoff, so the two cannot be confused for each other', () => {
    /*
     * The number that makes the point. If the hold and the backoff were within
     * an order of magnitude, sharing a field would be a style question. They
     * are not: the longest retry delay the policy will ever produce is a tiny
     * fraction of the shortest hold, so collapsing one into the other is a
     * total loss of the protection rather than a partial one.
     */
    let worstBackoff = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      worstBackoff = Math.max(worstBackoff, backoffDelayMs(attempt, DEFAULT_BACKOFF_POLICY, () => 0.999_999));
    }
    expect(worstBackoff).toBeLessThan(PUBLISH_HOLD_MIN_MS / 10);
  });
});
