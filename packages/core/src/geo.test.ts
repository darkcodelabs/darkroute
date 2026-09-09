import { describe, expect, it } from 'vitest';

import {
  AHEAD_HALF_ANGLE_DEG,
  DEFAULT_FACING_TOLERANCE_DEG,
  FEET_PER_METRE,
  METRES_PER_FOOT,
  METRES_PER_SECOND_PER_MPH,
  angularDifferenceDeg,
  assertLatLon,
  bearing,
  distanceFt,
  distanceM,
  feetToMetres,
  isFacingVehicle,
  metresPerSecondToMph,
  metresToFeet,
  mphToMetresPerSecond,
  normaliseBearingDeg,
  normaliseLongitudeDeg,
  relativeDirection,
} from './geo.ts';

/**
 * Reference coordinates. The Cincinnati fix is the one the design screens
 * print ("39.0997 N, 84.5786 W", App Screens 01 · RADAR), so the short-range
 * cases are measured where the product is actually drawn.
 */
const CINCY_LAT = 39.0997;
const CINCY_LON = -84.5786;

describe('unit conversions', () => {
  it('uses the exact international foot', () => {
    expect(METRES_PER_FOOT).toBe(0.3048);
    expect(FEET_PER_METRE).toBe(1 / 0.3048);
    expect(metresToFeet(feetToMetres(1234.5))).toBeCloseTo(1234.5, 9);
  });

  it('uses the exact statute mile per hour', () => {
    expect(METRES_PER_SECOND_PER_MPH).toBe(0.44704);
    // The dash-mode rule in the design system is "speed > 5 mph".
    expect(mphToMetresPerSecond(5)).toBeCloseTo(2.2352, 12);
    expect(metresPerSecondToMph(mphToMetresPerSecond(47))).toBeCloseTo(47, 9);
  });
});

describe('distanceM / distanceFt', () => {
  /**
   * Long haul. The published WGS-84 geodesic for JFK -> LAX is 3,983 km
   * (2,475 statute miles); the assertion is against that external number, not
   * against this implementation's own output.
   */
  it('matches the published geodesic for JFK -> LAX within 0.5%', () => {
    const metres = distanceM(40.6413, -73.7781, 33.9416, -118.4085);
    const publishedM = 3_983_000;
    expect(Math.abs(metres - publishedM) / publishedM).toBeLessThan(0.005);
    // Pinned to this implementation so a regression in the Vincenty loop is
    // loud rather than "still within half a percent".
    expect(metres).toBeCloseTo(3_983_079.7485, 3);
    expect(distanceFt(40.6413, -73.7781, 33.9416, -118.4085)).toBeCloseTo(13_067_846.9439, 3);
  });

  it('matches the published geodesic for Cincinnati -> Cleveland within 0.5%', () => {
    const metres = distanceM(39.1031, -84.512, 41.4993, -81.6944);
    const publishedM = 222.4 * 1609.344; // 222.4 statute miles, great circle
    expect(Math.abs(metres - publishedM) / publishedM).toBeLessThan(0.005);
    expect(metres).toBeCloseTo(357_975.7158, 3);
  });

  /**
   * Short haul, and the reason this package does not use haversine. The
   * destination below is exactly 152.4 m (500.000 ft) due north of the RADAR
   * fix, computed with the Vincenty DIRECT solution. A haversine sphere
   * answers 500.80 ft for it -- 0.8 ft of error inside a 100 ft ring.
   */
  it('is accurate to well under a foot at RADAR range', () => {
    const fiveHundredFtNorth = 39.10107275781626;
    const measured = distanceFt(CINCY_LAT, CINCY_LON, fiveHundredFtNorth, CINCY_LON);
    expect(Math.abs(measured - 500)).toBeLessThan(0.01);
  });

  it('is accurate to well under a foot off-axis', () => {
    // 425 ft at bearing 350 -- the "425 FT / AHEAD · SLIGHT LEFT" readout.
    const measured = distanceFt(CINCY_LAT, CINCY_LON, 39.10084911689151, -84.57886004077926);
    expect(Math.abs(measured - 425)).toBeLessThan(0.01);
  });

  it('is symmetric and zero for coincident points', () => {
    const there = distanceFt(CINCY_LAT, CINCY_LON, 41.4993, -81.6944);
    const back = distanceFt(41.4993, -81.6944, CINCY_LAT, CINCY_LON);
    // Relative, not absolute: over 1.19 million feet the last bit of a double
    // is already 2e-10 ft, so an absolute tolerance would be testing IEEE 754.
    expect(Math.abs(there - back) / there).toBeLessThan(1e-12);
    expect(distanceFt(CINCY_LAT, CINCY_LON, CINCY_LAT, CINCY_LON)).toBe(0);
  });

  it('treats the antimeridian as 0.02 degrees, not 359.98', () => {
    // On the equator 0.02 deg of longitude is 0.02 * pi/180 * 6378137 m.
    expect(distanceM(0, 179.99, 0, -179.99)).toBeCloseTo(2226.3898156, 6);
    expect(distanceFt(0, 179.99, 0, -179.99)).toBeCloseTo(7304.4285288, 6);
    // And at a driving latitude.
    expect(distanceFt(39.1, 179.99, 39.1, -179.99)).toBeCloseTo(5676.1374756, 6);
  });

  it('handles the poles without producing NaN', () => {
    expect(Number.isFinite(distanceM(90, 0, -90, 0))).toBe(true);
    // Two longitudes at the same pole are the same place. Vincenty leaves a
    // sub-nanometre residue there rather than a hard zero; that is noise, not
    // a distance.
    expect(distanceM(90, 0, 90, 137)).toBeLessThan(1e-6);
  });
});

describe('coordinate validation', () => {
  const bad: ReadonlyArray<readonly [number, number, string]> = [
    [Number.NaN, 0, 'NaN latitude'],
    [0, Number.NaN, 'NaN longitude'],
    [Number.POSITIVE_INFINITY, 0, 'infinite latitude'],
    [0, Number.NEGATIVE_INFINITY, 'infinite longitude'],
    [90.0001, 0, 'latitude past the north pole'],
    [-91, 0, 'latitude past the south pole'],
    [0, 180.0001, 'longitude past the antimeridian'],
    [0, -181, 'longitude past the antimeridian, west'],
  ];

  for (const [lat, lon, label] of bad) {
    it(`throws RangeError for ${label}`, () => {
      expect(() => assertLatLon(lat, lon)).toThrow(RangeError);
      expect(() => distanceFt(lat, lon, 0, 0)).toThrow(RangeError);
      expect(() => distanceFt(0, 0, lat, lon)).toThrow(RangeError);
      expect(() => bearing(lat, lon, 0, 0)).toThrow(RangeError);
    });
  }

  it('accepts the exact limits', () => {
    expect(() => assertLatLon(90, 180)).not.toThrow();
    expect(() => assertLatLon(-90, -180)).not.toThrow();
  });
});

describe('bearing', () => {
  it('reads the cardinals exactly', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0, 9); // N
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 9); // E
    expect(bearing(0, 0, -1, 0)).toBeCloseTo(180, 9); // S
    expect(bearing(0, 0, 0, -1)).toBeCloseTo(270, 9); // W
  });

  it('reads the diagonals', () => {
    // Over a whole degree the great circle bends away from 45 by 0.0044 deg.
    expect(bearing(0, 0, 1, 1)).toBeCloseTo(44.9956364553, 8); // NE
    expect(bearing(0, 0, -1, 1)).toBeCloseTo(135.0043635447, 8); // SE
    expect(bearing(0, 0, -1, -1)).toBeCloseTo(224.9956364553, 8); // SW
    expect(bearing(0, 0, 1, -1)).toBeCloseTo(315.0043635447, 8); // NW

    // Over a short hop -- the scale this product works at -- it is 45 exactly.
    expect(bearing(0, 0, 0.001, 0.001)).toBeCloseTo(45, 7);
    expect(bearing(0, 0, -0.001, 0.001)).toBeCloseTo(135, 7);
    expect(bearing(0, 0, -0.001, -0.001)).toBeCloseTo(225, 7);
    expect(bearing(0, 0, 0.001, -0.001)).toBeCloseTo(315, 7);
  });

  it('always lands in [0, 360)', () => {
    for (let lat = -80; lat <= 80; lat += 20) {
      for (let lon = -180; lon < 180; lon += 30) {
        const value = bearing(0, 0, lat, lon === 0 && lat === 0 ? 1 : lon);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(360);
      }
    }
  });

  it('crosses the antimeridian without flipping', () => {
    expect(bearing(0, 179.99, 0, -179.99)).toBeCloseTo(90, 9); // still heading east
    expect(bearing(0, -179.99, 0, 179.99)).toBeCloseTo(270, 9); // still heading west
    expect(Math.abs(angularDifferenceDeg(bearing(39.1, 179.99, 39.1, -179.99), 90))).toBeLessThan(0.01);
  });

  it('returns 0 rather than NaN for coincident points', () => {
    expect(bearing(CINCY_LAT, CINCY_LON, CINCY_LAT, CINCY_LON)).toBe(0);
  });
});

describe('angle helpers', () => {
  it('normalises bearings', () => {
    expect(normaliseBearingDeg(0)).toBe(0);
    expect(normaliseBearingDeg(360)).toBe(0);
    expect(normaliseBearingDeg(361)).toBe(1);
    expect(normaliseBearingDeg(-1)).toBe(359);
    expect(normaliseBearingDeg(-721)).toBe(359);
    expect(() => normaliseBearingDeg(Number.NaN)).toThrow(RangeError);
  });

  it('normalises longitudes, folding +180 onto -180', () => {
    expect(normaliseLongitudeDeg(0)).toBe(0);
    expect(normaliseLongitudeDeg(180)).toBe(-180);
    expect(normaliseLongitudeDeg(-180)).toBe(-180);
    expect(normaliseLongitudeDeg(181)).toBe(-179);
    expect(normaliseLongitudeDeg(-181)).toBe(179);
    expect(normaliseLongitudeDeg(359.99)).toBeCloseTo(-0.01, 9);
  });

  it('reports the signed shortest difference in (-180, 180]', () => {
    expect(angularDifferenceDeg(10, 350)).toBe(20);
    expect(angularDifferenceDeg(350, 10)).toBe(-20);
    expect(angularDifferenceDeg(0, 180)).toBe(180);
    expect(angularDifferenceDeg(180, 0)).toBe(180);
    expect(angularDifferenceDeg(0, 0)).toBe(0);
  });
});

describe('relativeDirection', () => {
  it('splits the compass into four 90-degree sectors', () => {
    expect(AHEAD_HALF_ANGLE_DEG).toBe(45);
    expect(relativeDirection(0, 0)).toBe('ahead');
    expect(relativeDirection(0, 90)).toBe('right');
    expect(relativeDirection(0, 180)).toBe('behind');
    expect(relativeDirection(0, 270)).toBe('left');
  });

  it('assigns every cut point to exactly one sector', () => {
    // Half-open, lower bound inclusive, walking clockwise from `ahead`.
    expect(relativeDirection(0, 44.999999)).toBe('ahead');
    expect(relativeDirection(0, 45)).toBe('right');
    expect(relativeDirection(0, 134.999999)).toBe('right');
    expect(relativeDirection(0, 135)).toBe('behind');
    expect(relativeDirection(0, 224.999999)).toBe('behind');
    expect(relativeDirection(0, 225)).toBe('left');
    expect(relativeDirection(0, 314.999999)).toBe('left');
    expect(relativeDirection(0, 315)).toBe('ahead');
    expect(relativeDirection(0, 359.999999)).toBe('ahead');
  });

  it('wraps around 0 and 360 in both arguments', () => {
    expect(relativeDirection(0, 360)).toBe('ahead');
    expect(relativeDirection(360, 0)).toBe('ahead');
    expect(relativeDirection(350, 5)).toBe('ahead'); // 15 deg off the nose
    expect(relativeDirection(10, 355)).toBe('ahead'); // 345 deg == -15
    expect(relativeDirection(350, 35)).toBe('right'); // exactly 45 relative
    expect(relativeDirection(-10, 35)).toBe('right'); // negative heading, same answer
    expect(relativeDirection(720, 45)).toBe('right'); // two full turns
    expect(relativeDirection(90, 0)).toBe('left');
    expect(relativeDirection(270, 0)).toBe('right');
  });

  it('rejects non-finite angles', () => {
    expect(() => relativeDirection(Number.NaN, 0)).toThrow(RangeError);
    expect(() => relativeDirection(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('isFacingVehicle', () => {
  it('returns null for an unknown facing and never false', () => {
    expect(isFacingVehicle(null, 0)).toBeNull();
    expect(isFacingVehicle(null, 123.4, 5)).toBeNull();
  });

  it('matches the REPORT sheet example', () => {
    // "223 deg · covering the northbound lane": a northbound driver sees the
    // camera at bearing 043, and a lens on 223 is looking straight back at it.
    expect(isFacingVehicle(223, 43)).toBe(true);
  });

  it('is true when the lens points back down the bearing', () => {
    expect(isFacingVehicle(180, 0)).toBe(true); // camera due north, looking south
    expect(isFacingVehicle(0, 180)).toBe(true); // camera due south, looking north
    expect(isFacingVehicle(270, 90)).toBe(true);
  });

  it('is false when the lens points away', () => {
    expect(isFacingVehicle(0, 0)).toBe(false); // camera north of you, looking further north
    expect(isFacingVehicle(90, 0)).toBe(false);
  });

  it('honours the 60-degree coverage cone from the design', () => {
    expect(DEFAULT_FACING_TOLERANCE_DEG).toBe(30);
    expect(isFacingVehicle(150, 0)).toBe(true); // exactly 30 off axis
    expect(isFacingVehicle(210, 0)).toBe(true); // exactly 30 the other way
    expect(isFacingVehicle(149.9, 0)).toBe(false);
    expect(isFacingVehicle(210.1, 0)).toBe(false);
  });

  it('accepts a custom tolerance and rejects a nonsensical one', () => {
    expect(isFacingVehicle(120, 0, 60)).toBe(true);
    expect(isFacingVehicle(120, 0, 59)).toBe(false);
    expect(() => isFacingVehicle(0, 0, 0)).toThrow(RangeError);
    expect(() => isFacingVehicle(0, 0, -1)).toThrow(RangeError);
    expect(() => isFacingVehicle(0, 0, 181)).toThrow(RangeError);
    expect(() => isFacingVehicle(Number.NaN, 0)).toThrow(RangeError);
  });

  it('wraps across north', () => {
    expect(isFacingVehicle(355, 180)).toBe(true); // reciprocal is 0, 355 is 5 off
    expect(isFacingVehicle(5, 180)).toBe(true);
  });
});
