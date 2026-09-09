/**
 * Retry scheduling for queued writes: exponential backoff with bounded jitter,
 * and a terminal state that is not "deleted".
 *
 * WHY JITTER AT ALL. Every phone in a city loses signal in the same tunnel and
 * regains it at the same portal. Without jitter, every queued report in that
 * tunnel retries at the same millisecond, and the backend sees a thundering
 * herd shaped exactly like the outage that caused it.
 *
 * WHY BOUNDED JITTER RATHER THAN FULL JITTER. Full jitter - a uniform draw
 * over `[0, delay]` - can schedule attempt 4 sooner than attempt 3, which
 * makes a retry log impossible to read and makes "is this queue making
 * progress?" unanswerable. Bounding the draw to `[(1 - r)·delay, delay]` keeps
 * the schedule readable: while the delay is still doubling, the earliest
 * attempt n+1 can fire is exactly the latest attempt n could, so the windows
 * touch and never overlap. That holds for any policy where
 * `jitterRatio <= 1 - 1/factor`, and `assertBackoffPolicy()` enforces it.
 *
 * THE ONE PLACE THE WINDOWS DO OVERLAP is the ceiling, and it is not a bug.
 * From the step that clamps at `maxDelayMs` onward the schedule is a plateau,
 * and every attempt draws from the same `[(1 - r)·max, max]` window - so
 * consecutive windows are identical rather than adjacent, and the clamping
 * step itself overlaps the one before it. A steady-state retry spread across a
 * fixed window is exactly what is wanted there; the alternative is shrinking
 * the jitter to preserve an invariant that stopped meaning anything the moment
 * the delay stopped growing. Nominal delays are still non-decreasing
 * throughout, which is the property the queue actually depends on.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not perform retries, hold timers, or
 * know what a network is. It answers "when next, and is it over?" - the sync
 * service owns the doing, and the repositories own the persistence.
 */

export interface BackoffPolicy {
  /** Delay before the first retry, in ms. */
  readonly baseDelayMs: number;
  /** Multiplier per attempt. Must be > 1 or the backoff is not a backoff. */
  readonly factor: number;
  /** Ceiling for a single delay, in ms. */
  readonly maxDelayMs: number;
  /** Fraction of the delay that may be shaved off by jitter. 0 disables it. */
  readonly jitterRatio: number;
  /** Attempts after which the item is terminal and goes to dead_letter. */
  readonly maxAttempts: number;
}

/**
 * The shipping policy.
 *
 * 30 s first retry: long enough that a red light does not burn an attempt,
 * short enough that a driver who regains signal at the next intersection sees
 * "2 QUEUED" clear before they park. One hour ceiling and eight attempts give
 * a queued report just over four hours of trying before it is called dead -
 * and "dead" here still means the record is on disk and exportable, it means
 * the app stops asking the network about it.
 *
 * GAP: see DESIGN-GAPS.md#queued-write-retry-schedule
 */
export const DEFAULT_BACKOFF_POLICY: BackoffPolicy = {
  baseDelayMs: 30_000,
  factor: 2,
  maxDelayMs: 60 * 60 * 1000,
  jitterRatio: 0.5,
  maxAttempts: 8,
};

export class BackoffPolicyError extends Error {
  override readonly name = 'BackoffPolicyError';
}

/**
 * Reject a policy that cannot keep its promises.
 *
 * The jitter-ratio check is the interesting one: it is the difference between
 * "we jitter" and "we jitter and the schedule is still readable". It bounds
 * the ratio so that, below the ceiling, attempt n+1 can never be scheduled
 * before the latest time attempt n could have fired.
 */
export function assertBackoffPolicy(policy: BackoffPolicy): void {
  const { baseDelayMs, factor, maxDelayMs, jitterRatio, maxAttempts } = policy;
  if (!(baseDelayMs > 0)) {
    throw new BackoffPolicyError('baseDelayMs must be greater than zero');
  }
  if (!(factor > 1)) {
    throw new BackoffPolicyError('factor must be greater than 1');
  }
  if (!(maxDelayMs >= baseDelayMs)) {
    throw new BackoffPolicyError('maxDelayMs must be at least baseDelayMs');
  }
  if (jitterRatio < 0 || jitterRatio >= 1) {
    throw new BackoffPolicyError('jitterRatio must be in [0, 1)');
  }
  if (jitterRatio > 1 - 1 / factor) {
    throw new BackoffPolicyError(
      `jitterRatio ${String(jitterRatio)} breaks monotonicity for factor ` +
        `${String(factor)}; the maximum that keeps attempt n+1 no earlier than ` +
        `attempt n is ${String(1 - 1 / factor)}`,
    );
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new BackoffPolicyError('maxAttempts must be a positive integer');
  }
}

/**
 * The un-jittered delay before retry number `attempt`.
 *
 * `attempt` is how many attempts have already failed: 0 is the delay before
 * the first retry.
 */
export function nominalDelayMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
): number {
  if (attempt < 0) throw new BackoffPolicyError('attempt must be >= 0');
  const raw = policy.baseDelayMs * Math.pow(policy.factor, attempt);
  return Math.min(policy.maxDelayMs, raw);
}

/** The window a jittered delay for `attempt` is guaranteed to fall inside. */
export function jitterBoundsMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
): { readonly min: number; readonly max: number } {
  const nominal = nominalDelayMs(attempt, policy);
  return { min: nominal * (1 - policy.jitterRatio), max: nominal };
}

/**
 * The actual delay to wait before retry number `attempt`.
 *
 * `random` is injected so a test can pin the draw. It must return a value in
 * `[0, 1)`, the same contract as `Math.random`.
 */
export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
  random: () => number = Math.random,
): number {
  const { min, max } = jitterBoundsMs(attempt, policy);
  const draw = random();
  if (!(draw >= 0 && draw < 1)) {
    throw new BackoffPolicyError('random() must return a value in [0, 1)');
  }
  return min + (max - min) * draw;
}

/** Epoch ms the next attempt becomes due. */
export function nextAttemptAt(
  now: number,
  attempt: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
  random: () => number = Math.random,
): number {
  return now + backoffDelayMs(attempt, policy, random);
}

/**
 * Whether `attempts` failures is the end of the road.
 *
 * Exhausted means dead_letter, and dead_letter means the record stays on disk
 * with a written reason. It never means deleted.
 */
export function isExhausted(
  attempts: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
): boolean {
  return attempts >= policy.maxAttempts;
}

/** The whole nominal schedule, for docs, tests and the settings screen. */
export function backoffSchedule(
  count: number,
  policy: BackoffPolicy = DEFAULT_BACKOFF_POLICY,
): readonly number[] {
  return Array.from({ length: Math.max(0, count) }, (_unused, attempt) =>
    nominalDelayMs(attempt, policy),
  );
}

// ---------------------------------------------------------------------------
// The publish hold, which is not a backoff
// ---------------------------------------------------------------------------

/**
 * HOW LONG A REPORT WAITS BEFORE IT MAY LEAVE THE DEVICE.
 *
 * =============================================================================
 * WHAT IT DEFENDS AGAINST
 * =============================================================================
 * A published report is a timestamped public statement that a named account was
 * at a particular place. One is a data point. A stream of them, uploaded
 * minutes after capture, is a route: an adversary reads the upload times, sorts
 * by them, and recovers the order in which somebody drove past each camera.
 *
 * The hold breaks the correlation between WHEN a thing was seen and WHEN it was
 * published. Reports captured on one drive scatter across days, so upload order
 * stops reconstructing travel order and upload time stops dating the drive.
 *
 * =============================================================================
 * WHY THE RANGE IS WIDE AND RANDOM
 * =============================================================================
 * A fixed delay is not a delay, it is an offset: subtract the constant and the
 * original timeline comes back intact. The hold has to be drawn per record, and
 * from a range wide enough that two reports from the same drive routinely land
 * on different days, or the scatter is cosmetic.
 *
 * One to seven days. The lower bound clears same-day correlation; the upper
 * keeps a camera useful to other people within a week of being seen, which is
 * the trade being made and the reason this is not simply longer.
 */
export const PUBLISH_HOLD_MIN_MS = 24 * 60 * 60 * 1000;
export const PUBLISH_HOLD_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A hold, drawn uniformly. `random` is injected so tests are deterministic and
 * so this never reaches for `Math.random` on its own.
 */
export function publishHoldMs(random: () => number = Math.random): number {
  const roll = random();
  const clamped = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0;
  return Math.round(PUBLISH_HOLD_MIN_MS + clamped * (PUBLISH_HOLD_MAX_MS - PUBLISH_HOLD_MIN_MS));
}
