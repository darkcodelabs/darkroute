/**
 * THE SPEED LOOKUP - that it refuses far more than it answers.
 *
 * The plate is drawn as an MUTCD road sign, so whatever reaches it is asserted
 * with a road sign's authority. Every test here is about a reading that must
 * NOT get through: the road 40 m away, the road being crossed rather than
 * driven, and the frontage road beside the freeway with a different number on
 * it. A wrong limit is worse than a dash, because a dash makes a driver look at
 * the actual sign, which is what they would have done anyway.
 */

import { describe, expect, it } from 'vitest';

import { bearingDelta, MAX_BEARING_DELTA_DEG, MAX_SNAP_M, speedAt } from './speedAt.ts';

/** ~1 m in degrees of longitude at 38.9 N, and in latitude anywhere. */
const MLON = 1.285e-5;
const MLAT = 8.99e-6;

const HERE: [number, number] = [-94.692, 38.9183];

/** A road running north-south (bearing 0/180) at a given longitude offset. */
function northSouth(mph: string, metresEast: number) {
  const lon = HERE[0] + metresEast * MLON;
  return {
    maxspeed: mph,
    line: [
      [lon, HERE[1] - 200 * MLAT],
      [lon, HERE[1] + 200 * MLAT],
    ] as [number, number][],
  };
}

/** A road running east-west (bearing 90/270) through the point. */
function eastWest(mph: string, metresNorth: number) {
  const lat = HERE[1] + metresNorth * MLAT;
  return {
    maxspeed: mph,
    line: [
      [HERE[0] - 200 * MLON, lat],
      [HERE[0] + 200 * MLON, lat],
    ] as [number, number][],
  };
}

/** The decoded ways for one tile -- what `speedSource` hands over. */
function mapWith(ways: { maxspeed: string; line: [number, number][] }[]) {
  return ways;
}

describe('it reads the limit of the road being driven', () => {
  it('returns the OSM string VERBATIM, not a parsed number', () => {
    // `speedLimit.ts` owns every decision about what counts as a usable value.
    // Parsing here is how two places start disagreeing about "signals".
    const found = speedAt(mapWith([northSouth('55 mph', 3)]), HERE[0], HERE[1], 0);
    expect(found?.maxspeed).toBe('55 mph');
    expect(found?.distanceM).toBeLessThan(6);
  });

  it('accepts a road drawn in the OPPOSITE direction of travel', () => {
    // A one-way pair is drawn both ways and is still the same road. 180 degrees
    // of disagreement is a match.
    expect(speedAt(mapWith([northSouth('45 mph', 2)]), HERE[0], HERE[1], 180)?.maxspeed).toBe(
      '45 mph',
    );
  });

  it('answers when there is no heading at all', () => {
    // Parked, the orientation gate holds the heading null on purpose. That
    // disables the bearing test rather than blocking the reading.
    expect(speedAt(mapWith([eastWest('30 mph', 2)]), HERE[0], HERE[1], null)?.maxspeed).toBe(
      '30 mph',
    );
  });

  it('takes the nearer road when both agree on the limit', () => {
    // A divided carriageway is two ways and one number. That is not ambiguity.
    const found = speedAt(
      mapWith([northSouth('65 mph', 3), northSouth('65 mph', 12)]),
      HERE[0],
      HERE[1],
      0,
    );
    expect(found?.maxspeed).toBe('65 mph');
  });
});

describe('it refuses rather than guessing', () => {
  it('REFUSES THE FRONTAGE ROAD: two roads close together, different limits', () => {
    // The case this whole file exists for. A 45 sign shown to somebody on a 70
    // freeway is worse than no sign at all.
    const found = speedAt(
      mapWith([northSouth('70 mph', 8), northSouth('45 mph', 11)]),
      HERE[0],
      HERE[1],
      0,
    );
    expect(found).toBeNull();
  });

  it('refuses a road beyond the snap radius', () => {
    expect(
      speedAt(mapWith([northSouth('55 mph', MAX_SNAP_M + 15)]), HERE[0], HERE[1], 0),
    ).toBeNull();
  });

  it('REFUSES A ROAD BEING CROSSED rather than driven', () => {
    // Heading north over an east-west road: that is a junction, and its limit
    // is not the driver's limit.
    expect(speedAt(mapWith([eastWest('30 mph', 1)]), HERE[0], HERE[1], 0)).toBeNull();
    // The same road, driven along, is fine.
    expect(speedAt(mapWith([eastWest('30 mph', 1)]), HERE[0], HERE[1], 90)?.maxspeed).toBe(
      '30 mph',
    );
  });

  it('ignores a way carrying no maxspeed at all', () => {
    const blank = { maxspeed: '', line: northSouth('x', 2).line };
    expect(speedAt(mapWith([blank]), HERE[0], HERE[1], 0)).toBeNull();
  });

  it('returns null for an empty tile, which is the common case', () => {
    // Most residential streets carry no maxspeed in OSM at all, so the archive
    // simply has nothing for that square. A dash is the right answer.
    expect(speedAt([], HERE[0], HERE[1], 0)).toBeNull();
  });

  it('refuses a position it does not have', () => {
    expect(speedAt(mapWith([northSouth('55 mph', 1)]), Number.NaN, HERE[1], 0)).toBeNull();
  });
});

describe('bearingDelta folds a two-way road onto one axis', () => {
  it.each([
    [0, 0, 0],
    [0, 180, 0],
    [0, 90, 90],
    [10, 350, 20],
    [45, 225, 0],
  ])('delta(%i, %i) = %i', (a, b, expected) => {
    expect(bearingDelta(a, b)).toBeCloseTo(expected, 5);
  });

  it('has a threshold that actually discriminates', () => {
    expect(MAX_BEARING_DELTA_DEG).toBeGreaterThan(0);
    expect(MAX_BEARING_DELTA_DEG).toBeLessThan(90);
  });
});
