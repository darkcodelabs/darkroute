/**
 * Clock injection.
 *
 * Every time-dependent decision in this package - notification cooldowns, mute
 * expiry, stationary dwell - reads from a `Clock`. `Date.now()` is never called
 * inside engine logic, so a test can drive an hour of a road trip in a
 * millisecond and get the same answer every run.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/** The real clock. The only place in this package `Date.now` appears. */
export const systemClock: Clock = {
  now(): number {
    return Date.now();
  },
};

/** A clock a test drives by hand. */
export interface TestClock extends Clock {
  /** Move time forward. Rejects negative steps - time does not run backwards. */
  advance(ms: number): void;
  /** Jump to an absolute epoch millisecond. */
  set(ms: number): void;
}

/**
 * Build a controllable clock.
 *
 * @param startMs epoch milliseconds to start at. Defaults to 0 so test
 *                expectations read as elapsed time rather than wall time.
 */
export function createTestClock(startMs = 0): TestClock {
  if (!Number.isFinite(startMs)) {
    throw new RangeError(`createTestClock: startMs must be finite, received ${String(startMs)}`);
  }
  let current = startMs;
  return {
    now(): number {
      return current;
    },
    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(`TestClock.advance: ms must be finite and >= 0, received ${String(ms)}`);
      }
      current += ms;
    },
    set(ms: number): void {
      if (!Number.isFinite(ms)) {
        throw new RangeError(`TestClock.set: ms must be finite, received ${String(ms)}`);
      }
      current = ms;
    },
  };
}
