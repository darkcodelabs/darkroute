import { describe, expect, it } from 'vitest';

import {
  BackoffPolicyError,
  DEFAULT_BACKOFF_POLICY,
  assertBackoffPolicy,
  backoffDelayMs,
  backoffSchedule,
  isExhausted,
  jitterBoundsMs,
  nominalDelayMs,
} from './backoff.ts';
import type { BackoffPolicy } from './backoff.ts';

describe('backoff', () => {
  it('accepts the shipping policy', () => {
    expect(() => {
      assertBackoffPolicy(DEFAULT_BACKOFF_POLICY);
    }).not.toThrow();
  });

  it('grows the nominal schedule monotonically and clamps it at the ceiling', () => {
    const schedule = backoffSchedule(12);
    for (let i = 1; i < schedule.length; i++) {
      const previous = schedule[i - 1] ?? 0;
      const current = schedule[i] ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
    expect(schedule[0]).toBe(DEFAULT_BACKOFF_POLICY.baseDelayMs);
    expect(schedule[schedule.length - 1]).toBe(DEFAULT_BACKOFF_POLICY.maxDelayMs);
  });

  it('bounds jitter inside [(1 - ratio) * nominal, nominal] for every draw', () => {
    // Sweep the whole [0, 1) draw space rather than trusting Math.random to
    // find the edges. 0 and the value just under 1 are the interesting ones.
    const draws = [0, 0.0001, 0.25, 0.5, 0.75, 0.999999];
    for (let attempt = 0; attempt < 10; attempt++) {
      const { min, max } = jitterBoundsMs(attempt);
      expect(min).toBe(nominalDelayMs(attempt) * (1 - DEFAULT_BACKOFF_POLICY.jitterRatio));
      expect(max).toBe(nominalDelayMs(attempt));
      for (const draw of draws) {
        const delay = backoffDelayMs(attempt, DEFAULT_BACKOFF_POLICY, () => draw);
        expect(delay).toBeGreaterThanOrEqual(min);
        expect(delay).toBeLessThanOrEqual(max);
      }
    }
  });

  it('never schedules attempt n + 1 earlier than the latest attempt n, below the ceiling', () => {
    // The property that makes a jittered retry log readable: while the delay
    // is still doubling, the windows touch at their edges and never overlap.
    for (let attempt = 0; attempt < 10; attempt++) {
      const current = jitterBoundsMs(attempt);
      const next = jitterBoundsMs(attempt + 1);
      const stillDoubling = next.max === current.max * DEFAULT_BACKOFF_POLICY.factor;
      if (!stillDoubling) continue; // clamped at the ceiling: see below
      expect(next.min).toBeGreaterThanOrEqual(current.max);
    }
  });

  it('turns into one steady window once the delay clamps at the ceiling', () => {
    // Not a degenerate case: this is the state a queue sits in during a long
    // outage, and the windows being identical rather than adjacent is what
    // spreads a whole fleet across the same hour instead of one instant.
    const { maxDelayMs, jitterRatio } = DEFAULT_BACKOFF_POLICY;
    const atCeiling = jitterBoundsMs(20);
    const afterCeiling = jitterBoundsMs(21);
    expect(atCeiling.max).toBe(maxDelayMs);
    expect(atCeiling).toEqual(afterCeiling);
    expect(atCeiling.min).toBe(maxDelayMs * (1 - jitterRatio));
  });

  it('actually varies the delay, so a fleet does not retry in lockstep', () => {
    const draws = [0.1, 0.9];
    const [low, high] = draws.map((draw) =>
      backoffDelayMs(3, DEFAULT_BACKOFF_POLICY, () => draw),
    );
    expect(low).not.toBe(high);
  });

  it('rejects a jitter ratio that would break monotonicity', () => {
    const broken: BackoffPolicy = { ...DEFAULT_BACKOFF_POLICY, jitterRatio: 0.9 };
    expect(() => {
      assertBackoffPolicy(broken);
    }).toThrow(BackoffPolicyError);
  });

  it('rejects a factor that does not back off', () => {
    expect(() => {
      assertBackoffPolicy({ ...DEFAULT_BACKOFF_POLICY, factor: 1 });
    }).toThrow(BackoffPolicyError);
  });

  it('rejects a random source outside [0, 1)', () => {
    expect(() => backoffDelayMs(0, DEFAULT_BACKOFF_POLICY, () => 1)).toThrow(BackoffPolicyError);
  });

  it('calls the queue exhausted at maxAttempts, not before', () => {
    const { maxAttempts } = DEFAULT_BACKOFF_POLICY;
    expect(isExhausted(maxAttempts - 1)).toBe(false);
    expect(isExhausted(maxAttempts)).toBe(true);
  });
});
