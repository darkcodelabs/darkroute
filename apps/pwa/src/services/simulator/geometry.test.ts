/**
 * The solver claims its results are correct BY THE ENGINE'S OWN MEASUREMENT.
 * These tests are that claim, checked with the engine's own functions.
 */

import { describe, expect, it } from 'vitest';

import { bearing, distanceFt, distanceM, feetToMetres } from './fwmCore.ts';
import {
  MAX_SOLVER_LATITUDE_DEG,
  SOLVER_BEARING_TOLERANCE_DEG,
  SOLVER_TOLERANCE_M,
  buildRouteGeometry,
  curvedSegment,
  pointAlongLeg,
  pointAtDistanceFt,
  positionOnRoute,
  routeLengthFt,
  straightSegment,
  type LatLon,
} from './geometry.ts';
import { DESIGN_REPORT_POSITION } from '../../test/fixtures/cameras.ts';

const ORIGIN: LatLon = { lat: DESIGN_REPORT_POSITION.lat, lon: DESIGN_REPORT_POSITION.lon };

describe('pointAtDistanceFt', () => {
  it('lands exactly where it was asked to, by distanceM and bearing', () => {
    // Every ring the SWEEP screen draws, the threshold, and the outer band.
    for (const ft of [1, 18, 60, 100, 150, 300, 500, 550, 1000, 2000, 5280]) {
      for (const brg of [0, 41, 90, 180, 223, 270, 359.5]) {
        const point = pointAtDistanceFt(ORIGIN, brg, ft);
        const achievedM = distanceM(ORIGIN.lat, ORIGIN.lon, point.lat, point.lon);
        const achievedBearing = bearing(ORIGIN.lat, ORIGIN.lon, point.lat, point.lon);
        expect(Math.abs(achievedM - feetToMetres(ft))).toBeLessThanOrEqual(SOLVER_TOLERANCE_M);
        expect(Math.abs(achievedBearing - brg)).toBeLessThanOrEqual(SOLVER_BEARING_TOLERANCE_DEG);
      }
    }
  });

  it('keeps a due-north or due-south offset on the same meridian', () => {
    for (const brg of [0, 180]) {
      const point = pointAtDistanceFt(ORIGIN, brg, 900);
      expect(point.lon).toBeCloseTo(ORIGIN.lon, 10);
    }
  });

  it('makes meridian distances add exactly, which every scenario relies on', () => {
    const south = pointAtDistanceFt(ORIGIN, 180, 900);
    const north = pointAtDistanceFt(ORIGIN, 0, 312);
    expect(distanceFt(south.lat, south.lon, north.lat, north.lon)).toBeCloseTo(1212, 4);
  });

  it('returns the origin for a zero distance', () => {
    expect(pointAtDistanceFt(ORIGIN, 90, 0)).toStrictEqual({ lat: ORIGIN.lat, lon: ORIGIN.lon });
  });

  it('rejects a negative distance and a polar origin', () => {
    expect(() => pointAtDistanceFt(ORIGIN, 0, -1)).toThrow(RangeError);
    expect(() => pointAtDistanceFt({ lat: MAX_SOLVER_LATITUDE_DEG + 1, lon: 0 }, 0, 100)).toThrow(
      RangeError,
    );
  });
});

describe('pointAlongLeg', () => {
  it('is exactly the requested distance from the leg start', () => {
    const a = ORIGIN;
    const b = pointAtDistanceFt(ORIGIN, 41, 2000);
    for (const ft of [0.5, 10, 137, 999, 1999.5]) {
      const point = pointAlongLeg(a, b, feetToMetres(ft));
      expect(Math.abs(distanceM(a.lat, a.lon, point.lat, point.lon) - feetToMetres(ft))).toBeLessThanOrEqual(
        SOLVER_TOLERANCE_M,
      );
    }
  });

  it('clamps to the endpoints', () => {
    const b = pointAtDistanceFt(ORIGIN, 0, 100);
    expect(pointAlongLeg(ORIGIN, b, -5)).toStrictEqual({ lat: ORIGIN.lat, lon: ORIGIN.lon });
    expect(pointAlongLeg(ORIGIN, b, 1e6)).toStrictEqual(b);
  });
});

describe('straightSegment', () => {
  it('subdivides without changing the endpoints or the length', () => {
    const whole = straightSegment(ORIGIN, 41, 1000);
    const stepped = straightSegment(ORIGIN, 41, 1000, 250);
    expect(whole).toHaveLength(2);
    expect(stepped).toHaveLength(5);
    expect(stepped[0]).toStrictEqual(whole[0]);
    expect(routeLengthFt(buildRouteGeometry(stepped))).toBeCloseTo(1000, 4);
    expect(routeLengthFt(buildRouteGeometry(whole))).toBeCloseTo(1000, 4);
  });

  it('rejects a non-positive length or step', () => {
    expect(() => straightSegment(ORIGIN, 0, 0)).toThrow(RangeError);
    expect(() => straightSegment(ORIGIN, 0, 100, 0)).toThrow(RangeError);
  });
});

describe('curvedSegment', () => {
  it('turns by the requested angle and stays near the requested radius', () => {
    const points = curvedSegment(ORIGIN, 0, 90, 300, 16);
    expect(points).toHaveLength(17);
    const first = points[0];
    const last = points[points.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    if (first === undefined || last === undefined) return;
    // A quarter turn of radius 300 ft ends 300*sqrt(2) ft from the start.
    expect(distanceFt(first.lat, first.lon, last.lat, last.lon)).toBeCloseTo(300 * Math.SQRT2, 0);
    // The inscribed polygon is slightly shorter than the true arc.
    const arcFt = (300 * Math.PI) / 2;
    expect(routeLengthFt(buildRouteGeometry(points))).toBeLessThan(arcFt);
    expect(routeLengthFt(buildRouteGeometry(points))).toBeGreaterThan(arcFt * 0.99);
  });

  it('rejects a zero turn, a non-positive radius and a fractional step count', () => {
    expect(() => curvedSegment(ORIGIN, 0, 0, 100)).toThrow(RangeError);
    expect(() => curvedSegment(ORIGIN, 0, 90, 0)).toThrow(RangeError);
    expect(() => curvedSegment(ORIGIN, 0, 90, 100, 1.5)).toThrow(RangeError);
  });
});

describe('buildRouteGeometry / positionOnRoute', () => {
  const route = [
    ORIGIN,
    pointAtDistanceFt(ORIGIN, 0, 500),
    pointAtDistanceFt(pointAtDistanceFt(ORIGIN, 0, 500), 90, 500),
  ];

  it('measures legs and cumulative distance with distanceM', () => {
    const geometry = buildRouteGeometry(route);
    expect(geometry.legLengthsM).toHaveLength(2);
    expect(geometry.cumulativeM[0]).toBe(0);
    expect(routeLengthFt(geometry)).toBeCloseTo(1000, 4);
    expect(geometry.legBearingsDeg[0]).toBeCloseTo(0, 4);
  });

  it('places the vehicle at the exact distance travelled', () => {
    const geometry = buildRouteGeometry(route);
    for (const ft of [0, 100, 499, 500, 501, 750, 1000]) {
      const placed = positionOnRoute(geometry, feetToMetres(ft));
      const start = route[0];
      if (start === undefined) continue;
      if (ft <= 500) {
        expect(distanceFt(start.lat, start.lon, placed.point.lat, placed.point.lon)).toBeCloseTo(ft, 4);
      }
      expect(placed.routeM).toBeCloseTo(feetToMetres(ft), 6);
    }
  });

  it('clamps past the end and reports it', () => {
    const geometry = buildRouteGeometry(route);
    const placed = positionOnRoute(geometry, geometry.totalM * 2);
    expect(placed.atEnd).toBe(true);
    expect(placed.routeM).toBe(geometry.totalM);
    expect(placed.point).toStrictEqual(route[2]);
  });

  it('refuses a one-point route and a zero-length leg', () => {
    expect(() => buildRouteGeometry([ORIGIN])).toThrow(RangeError);
    expect(() => buildRouteGeometry([ORIGIN, ORIGIN])).toThrow(RangeError);
  });
});
