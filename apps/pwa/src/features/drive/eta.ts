/**
 * HOW LONG UNTIL THE CAMERA, in seconds.
 *
 * =============================================================================
 * WHY THIS IS NOT JUST DISTANCE OVER SPEED
 * =============================================================================
 * The v1 drive screen reads "0.4 MILES · 38 SEC". The seconds are the part a
 * driver actually acts on: a quarter mile means nothing at 25 mph and means
 * fifteen seconds at 60.
 *
 * But the honest answer is often "no answer", and this returns null far more
 * readily than a naive division would:
 *
 *   STOPPED. At a light, `distance / speed` divides by roughly zero and
 *   produces a number in the thousands. "CAMERA IN 47 MINUTES" is worse than
 *   silence, because it is confidently wrong about something the driver can
 *   see out of the window.
 *
 *   NO SPEED. GPS gives no speed on the first fix and drops it indoors. An
 *   unknown speed is not a slow speed.
 *
 *   NOT APPROACHING. Distance shrinking is what makes a time-to-arrival mean
 *   anything. A camera behind you has no ETA no matter how fast you are going,
 *   and the caller knows which case it is holding.
 *
 * =============================================================================
 * IT IS A CEILING, NOT A PROMISE
 * =============================================================================
 * This is straight-line distance at the current speed. A real route is longer
 * and has junctions in it, so the true time is almost always MORE than this
 * says. That direction is the safe one to be wrong in: a driver who is warned
 * early is fine, and one warned late is not.
 */

/** Feet per second, from miles per hour. */
const FT_PER_SEC_PER_MPH = 5280 / 3600;

/**
 * Below this a vehicle is not usefully moving toward anything.
 *
 * 3 mph rather than 0: GPS speed jitters by a mile or two an hour while
 * stationary, and a threshold at zero would produce an ETA every time the
 * noise happened to point forwards.
 */
export const MIN_MOVING_MPH = 3;

/** Beyond this the answer stops being a number somebody acts on. */
export const MAX_USEFUL_SECONDS = 600;

export interface EtaInput {
  readonly distanceFt: number | null;
  readonly speedMph: number | null;
  /** False when the camera is not getting closer. Null when unknown. */
  readonly closing?: boolean | null;
}

/**
 * Seconds until the camera, or null when there is no honest answer.
 *
 * Null is a first-class result here and callers must render it as an absence
 * rather than a zero.
 */
export function etaSeconds({ distanceFt, speedMph, closing = null }: EtaInput): number | null {
  if (distanceFt === null || !Number.isFinite(distanceFt) || distanceFt < 0) return null;
  if (speedMph === null || !Number.isFinite(speedMph)) return null;
  if (speedMph < MIN_MOVING_MPH) return null;
  // Explicitly not closing. Unknown is allowed through: on the first fixes
  // there is no history to say either way, and a distance that is shrinking is
  // the common case.
  if (closing === false) return null;

  const seconds = distanceFt / (speedMph * FT_PER_SEC_PER_MPH);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds > MAX_USEFUL_SECONDS) return null;
  return Math.round(seconds);
}

/**
 * `38 SEC`, `2 MIN`, or null.
 *
 * Seconds up to two minutes because that is the range a driver is reacting in,
 * then minutes, because "94 SEC" is a number to decode rather than read.
 */
export function describeEta(seconds: number | null): string | null {
  if (seconds === null) return null;
  if (seconds < 120) return `${String(seconds)} SEC`;
  return `${String(Math.round(seconds / 60))} MIN`;
}
