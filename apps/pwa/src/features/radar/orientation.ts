/**
 * ORIENTATION - when the scope is allowed to rotate, and how fast.
 *
 * =============================================================================
 * THE PROBLEM THIS EXISTS FOR
 * =============================================================================
 * The scope is heading-up: every camera, every road and every ring label is
 * placed relative to the direction of travel. That is right while driving - the
 * thing ahead of you should be at the top of the screen - and it is actively
 * hostile at every other moment, because the heading it rotates by is garbage
 * whenever the vehicle is not moving.
 *
 * A GPS course is derived from consecutive positions. Standing still, those
 * positions differ only by measurement noise, so the reported course is
 * essentially random: E, then SE, then SW, then W, one per second. Each of
 * those re-rotates the ENTIRE map. Observed on a real phone at 0 - 1 mph, with
 * the heading readout changing on almost every fix and the whole scope spinning
 * with it.
 *
 * A driver parked at a light, or reading the screen before setting off, sees an
 * instrument that cannot hold still. It reads as broken because it is.
 *
 * =============================================================================
 * THE RULE
 * =============================================================================
 *   MOVING       rotate, but ease into the new heading rather than snapping.
 *   SLOW OR STOPPED   hold the last heading the vehicle actually had.
 *   NEVER MOVED  north-up. There is no direction of travel to face, and
 *                inventing one points the map somewhere the driver is not.
 *
 * Holding rather than reverting to north on every stop matters: a car at a red
 * light has not changed direction, and spinning the map to north and back at
 * every junction would be its own kind of unusable.
 *
 * =============================================================================
 * WHY THERE IS HYSTERESIS AND NOT ONE THRESHOLD
 * =============================================================================
 * A single cutoff makes the problem worse anywhere traffic moves at about that
 * speed: the scope would flip between "rotating" and "held" every second or two
 * in stop-start traffic, which is more jarring than either state.
 *
 * So it takes more speed to START rotating than to keep rotating. Crawling
 * traffic settles into one behaviour instead of oscillating between two.
 */

/** Start rotating above this. About 7 mph. */
export const HEADING_MOVING_MPS = 3.1;

/** Keep rotating until below this. About 3 mph. */
export const HEADING_STOPPED_MPS = 1.3;

/**
 * How much of the way to the new heading one update travels, 0..1.
 *
 * A GPS course is noisy even at speed - a degree or two of jitter per fix - and
 * snapping to each one makes the map twitch. At 0.25 a real turn is followed
 * within about a second of fixes while the twitch is averaged away.
 */
export const HEADING_EASE = 0.25;

/**
 * Past this, jump rather than ease.
 *
 * A genuine turn onto a new road can be ninety degrees or more, and easing
 * through it would drag every marker across the screen for several seconds. The
 * jitter this file exists to remove is small; a real turn is not, and the two
 * are distinguishable by size.
 */
export const HEADING_SNAP_DEG = 45;

export interface OrientationState {
  /** What the scope is rotated to, or null for north-up. */
  readonly headingDeg: number | null;
  /** Whether the vehicle was moving at the last sample. Drives the hysteresis. */
  readonly moving: boolean;
}

export const NORTH_UP: OrientationState = Object.freeze({ headingDeg: null, moving: false });

export interface OrientationSample {
  /** The platform's reported course, or null. */
  readonly headingDeg: number | null;
  /** Metres per second, or null when the platform did not say. */
  readonly speedMps: number | null;
}

/** Signed difference between two bearings, in [-180, 180). */
export function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

/**
 * Whether the vehicle counts as moving, given what it was doing before.
 *
 * Unknown speed is treated as NOT moving. A platform that will not say how fast
 * you are going has not given a reason to trust its course either, and holding
 * still is the safe failure: a scope that does not rotate is readable, and one
 * that rotates wrongly is a map pointing somewhere you are not.
 */
export function isMoving(speedMps: number | null, wasMoving: boolean): boolean {
  if (speedMps === null || !Number.isFinite(speedMps)) return false;
  return wasMoving ? speedMps > HEADING_STOPPED_MPS : speedMps > HEADING_MOVING_MPS;
}

/**
 * The orientation after one sample.
 *
 * Pure, so the whole rule is testable without a phone: everything about when
 * the scope may turn lives in this one function.
 */
export function nextOrientation(
  previous: OrientationState,
  sample: OrientationSample,
): OrientationState {
  const moving = isMoving(sample.speedMps, previous.moving);

  // Not moving: hold whatever the vehicle was last actually facing. Reverting
  // to north at every red light would spin the map twice per junction.
  if (!moving) return { headingDeg: previous.headingDeg, moving: false };

  const reported = sample.headingDeg;
  if (reported === null || !Number.isFinite(reported)) {
    return { headingDeg: previous.headingDeg, moving: true };
  }
  const wrapped = ((reported % 360) + 360) % 360;

  // First heading of the drive: take it whole. There is nothing to ease from,
  // and easing from north would swing the map through the long way round.
  if (previous.headingDeg === null) return { headingDeg: wrapped, moving: true };

  const delta = headingDelta(previous.headingDeg, wrapped);
  if (Math.abs(delta) >= HEADING_SNAP_DEG) return { headingDeg: wrapped, moving: true };

  const eased = previous.headingDeg + delta * HEADING_EASE;
  return { headingDeg: ((eased % 360) + 360) % 360, moving: true };
}
