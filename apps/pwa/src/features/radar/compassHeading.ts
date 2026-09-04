/**
 * HEADING FROM THE COMPASS, when the GPS has none to give.
 *
 * =============================================================================
 * WHY THIS EXISTS
 * =============================================================================
 * `orientation.ts` holds the heading null whenever the vehicle is stationary,
 * and it is right to: a GPS COURSE is derived from consecutive positions, so
 * standing still it is derived from measurement noise and reports a different
 * direction every second.
 *
 * What that reasoning missed is that a phone is not only a GPS receiver. It has
 * a MAGNETOMETER, and a magnetometer does not care whether you are moving. A
 * parked car pointing north is pointing north, and the device can say so.
 *
 * The consequence of missing it was visible: a stationary car showed NO BEARING
 * and an empty compass, beside an accuracy chip reading ±8 M. The instrument
 * looked broken while every sensor it needed was working.
 *
 * =============================================================================
 * THE TWO PLATFORMS DISAGREE ABOUT ALMOST EVERYTHING
 * =============================================================================
 *   iOS      `webkitCompassHeading` on `deviceorientation`. TRUE north, and it
 *            increases CLOCKWISE -- already a compass bearing. Requires an
 *            explicit permission grant from a user gesture since iOS 13.
 *
 *   ANDROID  `alpha` on `deviceorientationabsolute`. MAGNETIC north, and it
 *            increases COUNTER-CLOCKWISE, so the bearing is `360 - alpha`.
 *            Getting this backwards points the needle the wrong way round the
 *            dial and is not obvious from a desk.
 *
 * The difference between true and magnetic north is up to about 15 degrees in
 * the continental US. Not corrected here: the correction needs a magnetic model
 * and a date, and 15 degrees does not change which way a road runs. It is worth
 * knowing rather than silently assuming they are the same thing.
 *
 * =============================================================================
 * WHY THE GPS COURSE STILL WINS WHEN THERE IS ONE
 * =============================================================================
 * A car is a steel box. The magnetometer inside one is reading the car as much
 * as the earth, and a phone on a vent mount beside a speaker is worse again. So
 * the compass is a FALLBACK, not a replacement: once the vehicle is moving fast
 * enough for the GPS course to be real, that is the better number and it takes
 * over.
 */

/** What a heading came from. Rendered nowhere; it decides precedence. */
export type HeadingSource = 'gps' | 'compass' | 'none';

export interface HeadingReading {
  readonly headingDeg: number | null;
  readonly source: HeadingSource;
}

export const NO_HEADING: HeadingReading = Object.freeze({ headingDeg: null, source: 'none' });

/** Wrap into [0, 360). */
export function normalise(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The bearing from one orientation event, or null.
 *
 * Takes the event shape rather than the event, so the platform differences are
 * testable without a phone -- which is the only way anybody was ever going to
 * catch the Android sign being wrong.
 */
export function headingFromOrientation(event: {
  readonly webkitCompassHeading?: unknown;
  readonly alpha?: unknown;
  readonly absolute?: unknown;
}): number | null {
  // iOS first: it is already a true-north clockwise bearing, which is exactly
  // what the rest of the app means by a heading.
  const ios = event.webkitCompassHeading;
  if (typeof ios === 'number' && Number.isFinite(ios)) return normalise(ios);

  const alpha = event.alpha;
  if (typeof alpha !== 'number' || !Number.isFinite(alpha)) return null;

  // A RELATIVE reading is not a compass. Chrome fires `deviceorientation` with
  // `absolute: false` from a game-rotation sensor that has no idea where north
  // is -- its zero is wherever the phone happened to be looking when the page
  // loaded. Using it would point the needle confidently at nothing.
  if (event.absolute !== true) return null;

  // Android counts anticlockwise from north; a compass counts clockwise.
  return normalise(360 - alpha);
}

/**
 * Which heading to believe.
 *
 * GPS whenever there is one, compass otherwise. Not blended: two sensors
 * disagreeing by a few degrees would make the needle jitter between them, and
 * the whole reason the orientation gate exists is that a twitching instrument
 * reads as a broken one.
 */
export function preferHeading(
  gpsHeadingDeg: number | null,
  compassHeadingDeg: number | null,
): HeadingReading {
  if (gpsHeadingDeg !== null && Number.isFinite(gpsHeadingDeg)) {
    return { headingDeg: normalise(gpsHeadingDeg), source: 'gps' };
  }
  if (compassHeadingDeg !== null && Number.isFinite(compassHeadingDeg)) {
    return { headingDeg: normalise(compassHeadingDeg), source: 'compass' };
  }
  return NO_HEADING;
}

/**
 * How much the compass must move before the reading is republished.
 *
 * A magnetometer in a car twitches by a degree or two continuously. Publishing
 * every sample would re-render the scope tens of times a second to move a
 * needle by less than a pixel, and -- worse -- would re-run the corridor, which
 * is keyed off the heading.
 */
export const COMPASS_STEP_DEG = 3;

/** Whether a new compass sample is worth publishing over the last one. */
export function worthPublishing(previous: number | null, next: number): boolean {
  if (previous === null) return true;
  const delta = Math.abs(((next - previous + 540) % 360) - 180);
  return delta >= COMPASS_STEP_DEG;
}
