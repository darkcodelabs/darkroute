/**
 * THE PROJECTION PUTS THE CAMERA BESIDE THE CAR, ON THE RIGHT SIDE, OR NOWHERE.
 *
 * The failure this replaces was silent: the report filed the driver's own fix
 * as the camera's position and nothing anywhere disagreed. So these assert the
 * three things that would make the replacement silently wrong too - the offset
 * going the wrong way, the offset being the wrong size, and a refusal quietly
 * becoming a guess.
 */

import { describe, expect, it } from 'vitest';

import { SUBJECT_OFFSETS_FT, projectSubject, subjectSummary } from './subjectPosition.ts';

/** Northbound on Reading Rd, Cincinnati. */
const OBSERVER = { lat: 39.0997, lon: -84.5786 };
const NORTH = 0;

/** Great-circle-free distance in metres, ample under a kilometre. */
function metresBetween(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const latRad = (a.lat * Math.PI) / 180;
  const dy = (b.lat - a.lat) * 111_320;
  const dx = (b.lon - a.lon) * 111_320 * Math.cos(latRad);
  return Math.hypot(dx, dy);
}

describe('projectSubject', () => {
  it('puts a RIGHT camera east of a northbound car, and LEFT west of it', () => {
    // The sign of the offset is the whole thing. Getting it backwards produces
    // coordinates that look completely plausible and are on the wrong side of
    // the road, which no later check could catch.
    const right = projectSubject(OBSERVER, NORTH, { side: 'right', offsetFt: 40 });
    const left = projectSubject(OBSERVER, NORTH, { side: 'left', offsetFt: 40 });
    expect(right).not.toBeNull();
    expect(left).not.toBeNull();
    expect(right?.lon).toBeGreaterThan(OBSERVER.lon);
    expect(left?.lon).toBeLessThan(OBSERVER.lon);
    // Purely lateral: driving north, neither moves north or south.
    expect(right?.lat).toBeCloseTo(OBSERVER.lat, 9);
    expect(left?.lat).toBeCloseTo(OBSERVER.lat, 9);
  });

  it('follows the car rather than the compass rose', () => {
    // Heading east, RIGHT is south. If this ever hard-codes a bearing instead
    // of reading the heading, this is the test that fails.
    const right = projectSubject(OBSERVER, 90, { side: 'right', offsetFt: 40 });
    expect(right?.lat).toBeLessThan(OBSERVER.lat);
    expect(right?.lon).toBeCloseTo(OBSERVER.lon, 9);
  });

  it('moves the stated distance, not a different one', () => {
    for (const offsetFt of SUBJECT_OFFSETS_FT) {
      const at = projectSubject(OBSERVER, NORTH, { side: 'right', offsetFt });
      expect(at).not.toBeNull();
      const expected = offsetFt * 0.3048;
      // Within a centimetre. The point is that the unit conversion is right:
      // treating feet as metres would be a 3.3x error that still produces a
      // believable-looking coordinate.
      expect(metresBetween(OBSERVER, at as { lat: number; lon: number })).toBeCloseTo(expected, 2);
    }
  });

  it('closes the duplicate-radius gap the raw fix opened', () => {
    /*
     * Two drivers, opposite carriageways of a divided road, reporting the SAME
     * camera. With v1 both filed their own lane position, landing them ~90 m
     * apart - so `DUPLICATE_RADIUS_M = 25` saw two different cameras and both
     * were published.
     *
     * Reporting it as across-the-divided-road brings them to the same place.
     */
    /*
     * Right-hand traffic, so on a north-south divided road the northbound
     * carriageway is the EASTERN one. A camera on the east shoulder is
     * therefore a short hop to the RIGHT of a northbound driver and a long hop
     * to the LEFT of a southbound one - different sides AND different buckets,
     * which is exactly the case a single fixed offset would get wrong.
     */
    const camera = -84.5781;
    const mPerDegLon = 111_320 * Math.cos((39.0997 * Math.PI) / 180);
    const northbound = { lat: 39.0997, lon: camera - (15 * 0.3048) / mPerDegLon };
    const southbound = { lat: 39.0997, lon: camera - (150 * 0.3048) / mPerDegLon };
    const fromNorth = projectSubject(northbound, 0, { side: 'right', offsetFt: 15 });
    const fromSouth = projectSubject(southbound, 180, { side: 'left', offsetFt: 150 });
    expect(fromNorth).not.toBeNull();
    expect(fromSouth).not.toBeNull();
    const apart = metresBetween(
      fromNorth as { lat: number; lon: number },
      fromSouth as { lat: number; lon: number },
    );
    const rawApart = metresBetween(northbound, southbound);
    expect(apart).toBeLessThan(rawApart);
    expect(apart).toBeLessThan(25);
  });

  it('treats OVERHEAD as the observer position, deliberately', () => {
    // A gantry camera really is above the lane. This is the one case where the
    // two coordinates coincide, and it needs no heading to work out.
    const at = projectSubject(OBSERVER, null, { side: 'overhead', offsetFt: 15 });
    expect(at).toEqual(OBSERVER);
  });

  it('REFUSES a side when it does not know which way the car points', () => {
    // The dangerous fallbacks are "assume north" and "use the observer fix".
    // Both put a camera somewhere confident and wrong. Null is the answer.
    expect(projectSubject(OBSERVER, null, { side: 'left', offsetFt: 40 })).toBeNull();
    expect(projectSubject(OBSERVER, Number.NaN, { side: 'right', offsetFt: 40 })).toBeNull();
  });

  it('refuses when there is nothing to project from', () => {
    expect(projectSubject(null, NORTH, { side: 'right', offsetFt: 40 })).toBeNull();
    expect(projectSubject(OBSERVER, NORTH, null)).toBeNull();
    expect(projectSubject({ lat: 91, lon: 0 }, NORTH, { side: 'right', offsetFt: 40 })).toBeNull();
    expect(
      projectSubject({ lat: Number.NaN, lon: 0 }, NORTH, { side: 'right', offsetFt: 40 }),
    ).toBeNull();
  });

  it('wraps across the date line instead of landing on its edge', () => {
    const at = projectSubject({ lat: 0, lon: 179.999_99 }, 90, { side: 'left', offsetFt: 150 });
    expect(at).not.toBeNull();
    expect(at?.lon).toBeLessThanOrEqual(180);
    expect(at?.lon).toBeGreaterThanOrEqual(-180);
  });

  it('refuses at the pole rather than returning NaN', () => {
    // A degree of longitude collapses there and the division blows up. Nothing
    // here is drivable, but a NaN coordinate is worse than a refusal.
    expect(projectSubject({ lat: 90, lon: 0 }, NORTH, { side: 'right', offsetFt: 40 })).toBeNull();
  });
});

describe('subjectSummary', () => {
  it('reads back what the driver chose', () => {
    expect(subjectSummary({ side: 'right', offsetFt: 40 })).toBe('RIGHT · ONE LANE OVER');
    expect(subjectSummary({ side: 'left', offsetFt: 150 })).toBe('LEFT · ACROSS A DIVIDED ROAD');
  });

  it('does not offer a distance for OVERHEAD, where there is none', () => {
    expect(subjectSummary({ side: 'overhead', offsetFt: 80 })).toBe('OVERHEAD');
  });

  it('says nothing when nothing was chosen', () => {
    expect(subjectSummary(null)).toBeNull();
  });
});
