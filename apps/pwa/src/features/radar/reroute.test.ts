/**
 * REROUTE - and the one property nobody was testing.
 *
 * =============================================================================
 * WHY THIS FILE EXISTS
 * =============================================================================
 * `reroute.ts` had no tests. That is not unusual for a small pure module, and
 * it mattered here because of what the module's OUTPUT is used for: the
 * waypoint it returns is handed straight to `navigateTo`, and on iOS
 * `navigateTo` puts its argument into an HTTPS request to www.google.com.
 *
 * `navigateTo.ts` promises, in prose, that "The URL carries the CAMERA's
 * coordinates. It never carries the driver's." Its guard test is
 * `expect(url).not.toMatch(/saddr|origin=|from=/)` -- run against a hardcoded
 * camera, checking PARAMETER NAMES. Nothing in the repo asked what is in the
 * VALUE when the caller is REROUTE, and the answer is: a fixed-magnitude
 * translation of the driver's live GPS fix.
 *
 * These tests state that plainly, so it is a known and measured property
 * instead of a sentence in a comment that happens to be false.
 */

import { describe, expect, it } from 'vitest';

import { REROUTE_LEAD_FT, REROUTE_OFFSET_FT, canReroute, rerouteWaypoint } from './reroute.ts';
import { corridorFor } from './corridor.ts';

const ORIGIN = { lat: 38.9183, lon: -94.692 };

/** One camera dead ahead, close enough that there is something to route around. */
const corridor = (headingDeg: number | null = 0) =>
  corridorFor(
    [
      {
        id: 'c1',
        distanceFt: 900,
        bearingDeg: headingDeg ?? 0,
        relativeDirection: 'ahead' as const,
        inRange: true,
      },
    ] as never,
    headingDeg,
    500,
  );

/** Great-circle-free distance in feet, good enough over two miles. */
const feetBetween = (
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number => {
  const perLat = 364_000;
  const perLon = perLat * Math.cos((a.lat * Math.PI) / 180);
  const dLat = (b.lat - a.lat) * perLat;
  const dLon = (b.lon - a.lon) * perLon;
  return Math.hypot(dLat, dLon);
};

describe('canReroute', () => {
  it('refuses a corridor with no heading, because there is no "ahead" to leave', () => {
    expect(canReroute(corridor(null))).toBe(false);
  });

  it('refuses when there is nothing to route around', () => {
    expect(canReroute(null)).toBe(false);
  });

  it('agrees with rerouteWaypoint, so the key and the handler cannot drift', () => {
    const live = corridor(0);
    expect(canReroute(live)).toBe(true);
    expect(rerouteWaypoint(ORIGIN, live)).not.toBeNull();
  });
});

/**
 * =============================================================================
 * THE DISCLOSURE, MEASURED
 * =============================================================================
 * These do not assert that the behaviour is right. They assert what it IS, so
 * that a change to it is a decision somebody made rather than something that
 * drifts.
 */
describe('what the waypoint reveals about the driver', () => {
  it('is a fixed distance from the driver, whatever the heading', () => {
    // The two constants are exported and the repo is public, so this magnitude
    // is known to anybody who receives the point.
    const expected = Math.hypot(REROUTE_LEAD_FT, REROUTE_OFFSET_FT);
    for (const heading of [0, 37, 90, 180, 271, 359]) {
      const waypoint = rerouteWaypoint(ORIGIN, corridor(heading));
      expect(waypoint).not.toBeNull();
      // Within a foot over two miles. The point is that it is CONSTANT: a
      // receiver knows the driver is on a circle of this radius about it.
      expect(feetBetween(ORIGIN, waypoint as { lat: number; lon: number })).toBeCloseTo(
        expected,
        -1,
      );
    }
    // ~2.06 miles. Stated numerically so a change to either constant shows up
    // here as a change to what is disclosed, not just as a different detour.
    expect(expected / 5280).toBeCloseTo(2.06, 2);
  });

  it('moves exactly as far as the driver moves', () => {
    // Along a parallel it is a PURE translation: the waypoint carries the
    // driver's position with a known offset added, so a receiver holding two
    // presses learns the driver's displacement exactly.
    //
    // Longitude only, deliberately. The offset's east component is divided by
    // `FEET_PER_DEGREE_LAT * cos(lat)`, so moving NORTH also changes the
    // conversion and the translation is exact only to about 5e-6 degrees over
    // a 0.01 degree shift. That is a rounding detail of the projection, not a
    // privacy property -- half a metre of slack does not hide anybody.
    const shifted = { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.01 };
    const a = rerouteWaypoint(ORIGIN, corridor(90)) as { lat: number; lon: number };
    const b = rerouteWaypoint(shifted, corridor(90)) as { lat: number; lon: number };
    expect(b.lat - a.lat).toBeCloseTo(0, 12);
    expect(b.lon - a.lon).toBeCloseTo(0.01, 12);
  });

  it('is not the camera position, which is the thing navigateTo says it carries', () => {
    // The camera in this corridor is 900 ft away. The waypoint is two miles
    // away and derived from the ORIGIN, so `navigateTo`'s promise that the URL
    // "carries the CAMERA's coordinates" does not describe this caller.
    const waypoint = rerouteWaypoint(ORIGIN, corridor(0)) as { lat: number; lon: number };
    expect(feetBetween(ORIGIN, waypoint)).toBeGreaterThan(5_000);
  });
});
