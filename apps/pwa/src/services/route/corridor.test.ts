/**
 * WHICH READERS COUNT AS "ON THIS ROUTE".
 *
 * This function decides the number on the destination card and the list handed
 * to the router as exclusions, so it is wrong in two expensive directions:
 *
 *   TOO WIDE and the app avoids readers on the parallel street, adding miles
 *   for cameras the driver was never going to pass.
 *   TOO NARROW and it reports a clear road that has a camera on it, which is
 *   the failure that costs a driver their trust in the whole product.
 *
 * The tests are written in metres against a known line rather than against
 * fixtures, so they say what the corridor actually is.
 */

import { describe, expect, it } from 'vitest';

import type { CameraRecord } from '../../stores/cameras.ts';

import { CORRIDOR_M, camerasOnRoute, metresToSegmentSq } from './corridor.ts';

/** A due-east line at 39.05 N, one kilometre long. */
const A = { lat: 39.05, lon: -94.6 };
const B = { lat: 39.05, lon: -94.6 + 1000 / (111_320 * Math.cos((39.05 * Math.PI) / 180)) };

/** Degrees of latitude for a given number of metres. Due north, so no cosine. */
function northOf(metres: number): number {
  return metres / 111_320;
}

function camera(id: string, lat: number, lon: number): CameraRecord {
  return { id, lat, lon, directionDeg: 0, confirmations: 1 };
}

describe('distance to a segment', () => {
  it('is zero on the line', () => {
    expect(Math.sqrt(metresToSegmentSq({ lat: A.lat, lon: (A.lon + B.lon) / 2 }, A, B))).toBeLessThan(1);
  });

  it('measures perpendicular distance off the line', () => {
    const point = { lat: A.lat + northOf(40), lon: (A.lon + B.lon) / 2 };
    expect(Math.sqrt(metresToSegmentSq(point, A, B))).toBeCloseTo(40, 0);
  });

  it('measures to the END of the segment, not to the infinite line through it', () => {
    // 500 m PAST B, on the same bearing. An unclamped projection would report
    // this as being on the line - which is how a route claims a camera a mile
    // beyond the destination is on the way.
    const past = { lat: B.lat, lon: B.lon + 500 / (111_320 * Math.cos((B.lat * Math.PI) / 180)) };
    expect(Math.sqrt(metresToSegmentSq(past, A, B))).toBeCloseTo(500, -1);
  });

  it('does not divide by zero on a repeated shape point', () => {
    // Routers emit these. The answer is the distance to the point itself.
    const point = { lat: A.lat + northOf(30), lon: A.lon };
    expect(Math.sqrt(metresToSegmentSq(point, A, A))).toBeCloseTo(30, 0);
  });
});

describe('cameras on a route', () => {
  const shape = [A, B];

  it('keeps a reader on the road', () => {
    const on = camera('on', A.lat + northOf(10), (A.lon + B.lon) / 2);
    expect(camerasOnRoute(shape, [on]).map((c) => c.id)).toEqual(['on']);
  });

  it('keeps a reader at a wide junction, which is genuinely tens of metres off', () => {
    const junction = camera('junction', A.lat + northOf(45), (A.lon + B.lon) / 2);
    expect(camerasOnRoute(shape, [junction])).toHaveLength(1);
  });

  it('drops a reader on the parallel street', () => {
    // 150 m off is a different road. Counting it would make "avoid all 9"
    // route around cameras the driver was never going to pass.
    const parallel = camera('parallel', A.lat + northOf(150), (A.lon + B.lon) / 2);
    expect(camerasOnRoute(shape, [parallel])).toHaveLength(0);
  });

  it('holds the corridor at the documented width', () => {
    const inside = camera('inside', A.lat + northOf(CORRIDOR_M - 5), (A.lon + B.lon) / 2);
    const outside = camera('outside', A.lat + northOf(CORRIDOR_M + 15), (A.lon + B.lon) / 2);
    expect(camerasOnRoute(shape, [inside, outside]).map((c) => c.id)).toEqual(['inside']);
  });

  it('returns them in the order they are passed, not the order they were stored', () => {
    // The card says "the next one is in 1.5 miles", which a set cannot answer.
    const near = camera('near', A.lat, A.lon + (B.lon - A.lon) * 0.1);
    const far = camera('far', A.lat, A.lon + (B.lon - A.lon) * 0.9);
    // Deliberately handed to it backwards.
    expect(camerasOnRoute(shape, [far, near]).map((c) => c.id)).toEqual(['near', 'far']);
  });

  it('finds nothing when there is no route to be on', () => {
    expect(camerasOnRoute([], [camera('any', A.lat, A.lon)])).toHaveLength(0);
    expect(camerasOnRoute([A], [camera('any', A.lat, A.lon)])).toHaveLength(0);
  });

  it('discards the rest of the country without measuring it', () => {
    // The bounding-box pre-filter. A camera in another state must never reach
    // the segment arithmetic - on a real phone that is tens of thousands of
    // cameras against thousands of shape points.
    const faraway = camera('denver', 39.74, -104.99);
    expect(camerasOnRoute(shape, [faraway])).toHaveLength(0);
  });
});
