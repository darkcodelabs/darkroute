/**
 * WHERE THE CAMERA IS, FROM WHAT A DRIVER ACTUALLY KNOWS.
 *
 * =============================================================================
 * WHY NOT A MAP
 * =============================================================================
 * The obvious fix for "the report files the driver's position as the camera's"
 * is a map with a draggable pin. `PositionCard` already rules that out, and it
 * is right to: this sheet is opened in a moving car, often seconds after
 * passing the thing being reported. A pin-drag is a two-handed, eyes-down,
 * several-second interaction, and asking for it at speed produces either no
 * report at all or a pin dropped roughly where the car is - which is the bug,
 * with extra steps and a false sense of precision.
 *
 * So this asks for what a driver genuinely observed and can answer at a glance,
 * with a thumb, without reading a map:
 *
 *   WHICH SIDE      left, right, or straight overhead on a gantry
 *   HOW FAR OVER    shoulder, one lane, far side, across a divided road
 *
 * =============================================================================
 * WHY LATERAL OFFSET IS THE WHOLE PROBLEM
 * =============================================================================
 * The error being corrected is almost entirely SIDEWAYS. A driver files the
 * report as they pass, so the along-the-road error is small - a second or two
 * of travel. The across-the-road error is the ten to forty metres between the
 * traffic lane and the pole, and on a divided road it is more. That offset is
 * also the one that is SYSTEMATIC: every report from this app would carry it,
 * in the same direction relative to travel, which is the pattern that gets a
 * source mass-reverted rather than individually corrected.
 *
 * Correcting the lateral component therefore removes most of the positional
 * error and all of the systematic bias, from two taps.
 *
 * =============================================================================
 * OVERHEAD IS NOT A FALLBACK
 * =============================================================================
 * `overhead` returns the observer's own position, and that is a real answer
 * rather than a disguised default. A gantry-mounted ALPR genuinely is above the
 * lane the car is in. It is the one case where the two coordinates coincide,
 * and it is reported as `projected` like the others because the driver asserted
 * it - which is the difference between this and v1, where nobody asserted
 * anything and the code assumed.
 *
 * =============================================================================
 * WHAT THIS IS NOT
 * =============================================================================
 * Not survey-grade. It is an estimate from a stated observation, in the same
 * register as a mapper writing down what they saw from the roadside, and it is
 * labelled `projected` so a reviewer can tell. What it is NOT is the driver's
 * raw GPS fix relabelled as a camera, which is the thing it replaces.
 */

/** Which side of the vehicle the camera was on. */
export type SubjectSide = 'left' | 'right' | 'overhead';

/**
 * How far over, in feet, as the chips offer it.
 *
 * These are road features rather than round numbers. A US lane is 10-12 ft, a
 * shoulder 8-10 ft, and a divided-highway median 36-88 ft, so the buckets are
 * placed where a driver's answer naturally falls: just off the shoulder, one
 * or two lanes over, the far edge of a wide road, the other carriageway.
 */
export const SUBJECT_OFFSETS_FT = [15, 40, 80, 150] as const;
export type SubjectOffsetFt = (typeof SUBJECT_OFFSETS_FT)[number];

/** The label each bucket carries on its chip. */
export const OFFSET_LABEL: Readonly<Record<SubjectOffsetFt, string>> = {
  15: 'SHOULDER',
  40: 'ONE LANE OVER',
  80: 'FAR SIDE',
  150: 'ACROSS A DIVIDED ROAD',
};

export const SIDE_LABEL: Readonly<Record<SubjectSide, string>> = {
  left: 'LEFT',
  right: 'RIGHT',
  overhead: 'OVERHEAD',
};

/** Metres per degree of latitude. Spherical earth is ample at this scale. */
const M_PER_DEG_LAT = 111_320;
const FT_TO_M = 0.3048;

export interface ObserverFix {
  readonly lat: number;
  readonly lon: number;
}

export interface SubjectChoice {
  readonly side: SubjectSide;
  readonly offsetFt: SubjectOffsetFt;
}

/**
 * The camera's position, or null when it cannot be worked out.
 *
 * Returns null rather than guessing when the heading is unknown and the side is
 * not `overhead`: "left" is meaningless without knowing which way the car was
 * pointing, and the tempting fallback - assume north, or reuse the observer
 * fix - reintroduces exactly the defect this module exists to remove. A driver
 * with no heading can still report `overhead`, and can still file a report with
 * no camera position at all.
 */
export function projectSubject(
  observer: ObserverFix | null,
  headingDeg: number | null,
  choice: SubjectChoice | null,
): { readonly lat: number; readonly lon: number } | null {
  if (observer === null || choice === null) return null;
  if (!Number.isFinite(observer.lat) || !Number.isFinite(observer.lon)) return null;
  if (observer.lat < -90 || observer.lat > 90) return null;

  // Directly above the car. The one case with no bearing to resolve.
  if (choice.side === 'overhead') return { lat: observer.lat, lon: observer.lon };

  if (headingDeg === null || !Number.isFinite(headingDeg)) return null;

  // Ninety degrees off the direction of travel, to the named side.
  const bearing = choice.side === 'left' ? headingDeg - 90 : headingDeg + 90;
  const rad = ((((bearing % 360) + 360) % 360) * Math.PI) / 180;
  const metres = choice.offsetFt * FT_TO_M;

  const north = metres * Math.cos(rad);
  const east = metres * Math.sin(rad);

  const latRad = (observer.lat * Math.PI) / 180;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(latRad);
  // At the poles a degree of longitude collapses to nothing and the division
  // blows up. Nothing here is drivable, but a NaN coordinate is worse than a
  // refusal, so it refuses.
  if (Math.abs(mPerDegLon) < 1) return null;

  const lat = observer.lat + north / M_PER_DEG_LAT;
  const lon = observer.lon + east / mPerDegLon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;

  // Longitude wraps rather than clamping, so a report beside the date line
  // lands on the map instead of at its edge.
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat, lon: wrapped };
}

/** `RIGHT · ONE LANE OVER`, for the line under the chips. */
export function subjectSummary(choice: SubjectChoice | null): string | null {
  if (choice === null) return null;
  if (choice.side === 'overhead') return SIDE_LABEL.overhead;
  return `${SIDE_LABEL[choice.side]} · ${OFFSET_LABEL[choice.offsetFt]}`;
}
