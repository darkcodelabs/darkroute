/**
 * The scope must hold still when the vehicle does.
 *
 * Everything here is one complaint, reproduced: a phone at 0-1 mph reported a
 * different GPS course on almost every fix, and each one re-rotated the whole
 * map. These are the cases that has to stop happening.
 */

import { describe, expect, it } from 'vitest';

import {
  HEADING_MOVING_MPS,
  HEADING_SNAP_DEG,
  HEADING_STOPPED_MPS,
  NORTH_UP,
  isMoving,
  nextOrientation,
} from './orientation.ts';

/** Feed a series of samples through, as the driving loop would. */
function drive(samples: readonly { headingDeg: number | null; speedMps: number | null }[]) {
  let state = NORTH_UP;
  for (const sample of samples) state = nextOrientation(state, sample);
  return state;
}

describe('a stationary vehicle', () => {
  it('does not rotate the scope, however wildly the course jumps', () => {
    // THE BUG. Observed at 0-1 mph: E, SE, SW, W on consecutive fixes, each one
    // spinning the entire map.
    const state = drive([
      { headingDeg: 90, speedMps: 0.4 },
      { headingDeg: 135, speedMps: 0.2 },
      { headingDeg: 225, speedMps: 0.5 },
      { headingDeg: 270, speedMps: 0.1 },
    ]);
    expect(state.headingDeg).toBeNull();
    expect(state.moving).toBe(false);
  });

  it('is north-up before it has ever moved, rather than facing a guess', () => {
    expect(drive([{ headingDeg: 42, speedMps: 0 }]).headingDeg).toBeNull();
  });

  it('holds the heading it had, rather than snapping back to north at a light', () => {
    // A car at a red light has not changed direction. Reverting to north and
    // back would spin the map twice per junction.
    const moving = drive([
      { headingDeg: 90, speedMps: 12 },
      { headingDeg: 90, speedMps: 12 },
      { headingDeg: 90, speedMps: 12 },
    ]);
    expect(moving.headingDeg).toBeCloseTo(90, 0);

    const stopped = nextOrientation(moving, { headingDeg: 300, speedMps: 0 });
    expect(stopped.headingDeg).toBeCloseTo(90, 0);
    expect(stopped.moving).toBe(false);
  });
});

describe('hysteresis', () => {
  it('takes more speed to start turning than to keep turning', () => {
    // One threshold would flip between rotating and held every second or two in
    // stop-start traffic, which is worse than either state.
    expect(isMoving(HEADING_STOPPED_MPS + 0.1, false)).toBe(false);
    expect(isMoving(HEADING_STOPPED_MPS + 0.1, true)).toBe(true);
    expect(isMoving(HEADING_MOVING_MPS + 0.1, false)).toBe(true);
  });

  it('treats an unknown speed as stopped', () => {
    // A platform that will not say how fast you are going has not earned trust
    // in its course either, and a scope that does not rotate is readable while
    // one that rotates wrongly points somewhere you are not.
    expect(isMoving(null, true)).toBe(false);
  });
});

describe('a moving vehicle', () => {
  it('eases through jitter instead of twitching on every fix', () => {
    const start = drive([{ headingDeg: 90, speedMps: 12 }]);
    const jittered = nextOrientation(start, { headingDeg: 94, speedMps: 12 });
    // Moved toward it, but nowhere near all the way.
    expect(jittered.headingDeg).toBeGreaterThan(90);
    expect(jittered.headingDeg).toBeLessThan(93);
  });

  it('snaps through a real turn rather than dragging the map round slowly', () => {
    // A ninety-degree turn eased at a quarter per fix would take several
    // seconds, with every marker sliding across the screen the whole time.
    const start = drive([{ headingDeg: 0, speedMps: 12 }]);
    const turned = nextOrientation(start, { headingDeg: HEADING_SNAP_DEG + 5, speedMps: 12 });
    expect(turned.headingDeg).toBeCloseTo(HEADING_SNAP_DEG + 5, 0);
  });

  it('takes the first heading of a drive whole', () => {
    // Easing from north would swing the map the long way round on setting off.
    expect(drive([{ headingDeg: 270, speedMps: 12 }]).headingDeg).toBe(270);
  });

  it('keeps the last heading when the platform stops reporting a course', () => {
    const start = drive([{ headingDeg: 180, speedMps: 12 }]);
    expect(nextOrientation(start, { headingDeg: null, speedMps: 12 }).headingDeg).toBe(180);
  });

  it('never leaves 0..360', () => {
    const wrapped = nextOrientation(
      { headingDeg: 350, moving: true },
      { headingDeg: 10, speedMps: 12 },
    );
    expect(wrapped.headingDeg).toBeGreaterThanOrEqual(0);
    expect(wrapped.headingDeg).toBeLessThan(360);
    // And it goes the SHORT way: 350 -> 10 is +20, not -340.
    expect(wrapped.headingDeg).toBeGreaterThan(350);
  });
});
