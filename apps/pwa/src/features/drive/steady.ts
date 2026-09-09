/**
 * HOLDING THE MAP STILL WHILE THE CAR IS.
 *
 * =============================================================================
 * THE TWO THINGS A PARKED PHONE DOES
 * =============================================================================
 * A stationary GPS does not report a stationary position. It reports a cloud a
 * few metres across, several times a minute, and it reports a HEADING computed
 * from consecutive points inside that cloud - which is to say, a random number.
 *
 * On DRIVE both of those were fed straight to the map:
 *
 *   - `bearingDeg` turned the vehicle marker, so the arrow and its heading
 *     wedge swung to a new direction every tick. Parked. Reported as the arrow
 *     "spinning around like a maniac", and it was.
 *   - `lat`/`lon` re-centred the map with a 450ms animation every tick, so the
 *     whole world slid a few metres and back, continuously, forever.
 *
 * Neither is a map bug. `MapCanvas` is doing exactly what it is told; it is
 * being told nonsense. This is where the nonsense stops.
 *
 * =============================================================================
 * WHY A DEADBAND AND NOT A SMOOTHER
 * =============================================================================
 * A moving average would still move - it would drift slowly instead of jumping,
 * which on a map reads as the ground sliding under a parked car and is arguably
 * worse. A deadband holds the last value EXACTLY until the new one is far
 * enough away to be a real movement, so a parked map is motionless and a moving
 * one follows at full fidelity. The threshold is metres, not a time constant,
 * because the question is "did the car move", not "how noisy is the signal".
 */

import { useEffect, useState } from 'react';

import { metresBetween } from '../../services/cameras/sync.ts';

/**
 * How far the vehicle must move before the map follows it.
 *
 * Consumer GPS on a phone reports 3-10 m of accuracy in the open and worse
 * between buildings, so its idle wander is a few metres either way. 12 m is
 * comfortably outside that and comfortably inside anything that counts as
 * driving: at 25 mph it is passed in about a second.
 */
/**
 * 6 m, not 12.
 *
 * 12 was picked to be comfortably outside GPS idle wander and it is - but it is
 * also comfortably outside walking pace and crawling traffic, where the map
 * visibly stopped following and read as a lost lock. 6 m still sits above the
 * 3-5 m a stationary phone drifts by, and is passed in under a second at any
 * speed worth calling driving.
 */
export const STEADY_METRES = 6;

/**
 * Below this the reported heading is not a direction, it is noise.
 *
 * The same floor `eta.ts` uses to decide there is no useful arrival time, and
 * for the same reason: a course computed from two points inside the GPS's own
 * error cloud describes the error, not the car.
 */
export const HEADING_FLOOR_MPH = 3;

export interface SteadyPoint {
  readonly lat: number;
  readonly lon: number;
}

/**
 * The last position far enough from the one before it to be a real movement.
 *
 * Returns null until there is a fix at all - the map handles that itself, and
 * inventing a coordinate to avoid a null would put a parked car in the
 * Atlantic.
 *
 * STATE AND AN EFFECT, not a ref mutated during render. The first version wrote
 * `held.current` inside the render body, which is a side effect in a function
 * React is allowed to call twice and to throw away: under StrictMode it ran
 * twice per commit, and under a discarded concurrent render the map could have
 * been handed a position from a render that never happened.
 */
export function useSteadyFix(
  fix: SteadyPoint | null,
  metres: number = STEADY_METRES,
): SteadyPoint | null {
  const [held, setHeld] = useState<SteadyPoint | null>(null);

  useEffect(() => {
    // A LOST FIX DOES NOT MOVE THE MAP. Keeping the last known position is the
    // honest picture: the app still knows where it last saw the car, and the
    // GPS row on OFFLINE is where "no fix" is reported.
    if (fix === null) return;
    setHeld((previous) =>
      previous === null || metresBetween(previous, fix) >= metres
        ? { lat: fix.lat, lon: fix.lon }
        : previous,
    );
  }, [fix, metres]);

  return held;
}

/**
 * The heading to draw, HELD rather than blanked when the car slows down.
 *
 * The first version returned null below the floor, which is defensible and read
 * badly: every time you stopped at a light the arrow greyed out and lost its
 * cone, which looks exactly like losing the fix. It has not been lost - the
 * position is still good, only the DIRECTION is unmeasurable.
 *
 * A car that has stopped is still pointing the way it was last going. Holding
 * the last confident heading is both true and stable: it does not spin, because
 * it stops being updated the moment the speed drops below the floor.
 *
 * Null is still returned when there has never been a confident heading at all -
 * a phone opened from cold and never moved has no direction to claim, and the
 * marker says so.
 */
export function steadyHeading(
  headingDeg: number | null,
  speedMph: number | null,
  lastConfident: number | null,
  floor: number = HEADING_FLOOR_MPH,
): number | null {
  const moving =
    speedMph !== null && Number.isFinite(speedMph) && speedMph >= floor;
  if (moving && headingDeg !== null && Number.isFinite(headingDeg)) return headingDeg;
  return lastConfident;
}

/** Remembers the last heading taken while actually moving. */
export function useSteadyHeading(
  headingDeg: number | null,
  speedMph: number | null,
  floor: number = HEADING_FLOOR_MPH,
): number | null {
  const [held, setHeld] = useState<number | null>(null);

  useEffect(() => {
    const next = steadyHeading(headingDeg, speedMph, null, floor);
    if (next !== null) setHeld(next);
  }, [headingDeg, speedMph, floor]);

  return steadyHeading(headingDeg, speedMph, held, floor);
}
