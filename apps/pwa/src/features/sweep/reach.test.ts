/**
 * THE RANGE CUT - that panning does not draw the world inside a moving circle.
 *
 * =============================================================================
 * WHAT THIS IS ABOUT
 * =============================================================================
 * Reported as "panning feels like a globe, not a flat map". It was not the
 * projection: a due-east twenty-mile road bows 0.1 units on a 343-unit dial,
 * which nobody can see. It was the CUT.
 *
 * Everything drawn was cut at `outerFt` FROM THE VEHICLE, so the data ended on
 * a circle centred on the car. Sitting still that circle is concentric with the
 * viewport and invisible. Drag the map and it slides across the screen as a
 * curved edge with nothing beyond it -- which is exactly what a globe's horizon
 * looks like. Measured, at a 25 mi scope:
 *
 *     pan 0.0 x range   78 % of the frame had data
 *     pan 0.5 x range   63 %
 *     pan 1.0 x range   40 %
 *     pan 2.0 x range    0 %
 *
 * The same cut is why zooming toward a camera made the camera disappear.
 *
 * The fix separates the SCALE (`outerFt`, feet per dial unit -- unchanged) from
 * the CUT (`reachFt`, how far the frame can see -- grows with the pan). These
 * tests hold them apart.
 */

import { describe, expect, it } from 'vitest';

import { OUTER_RADIUS, radiusForDistanceFt, scopeRadiusFt } from './geometry.ts';
import { FRAME_REACH_RADII, clampPan, panForZoom, reachFt } from './pan.ts';
import { sweepDots } from './sweepState.ts';
import type { SweepInput } from './sweepState.ts';
import type { CameraAssessment } from '../../stores';

const MILE = 5280;
const SCOPE = 25 * MILE;
const NO_PAN = { x: 0, y: 0 };

describe('the scale no longer decides what exists', () => {
  it('places a camera past the outer ring instead of refusing it', () => {
    // The old fused function. Still right for the RING scale, which does stop.
    expect(radiusForDistanceFt(SCOPE * 1.5, SCOPE)).toBeNull();
    // The scale on its own. Extrapolates, because the point is really there.
    expect(scopeRadiusFt(SCOPE * 1.5, SCOPE)).toBeCloseTo(OUTER_RADIUS * 1.5, 1);
  });

  it('agrees with the ring scale everywhere the ring scale has an answer', () => {
    for (const ft of [0, 100, 2_640, MILE, 12 * MILE, SCOPE]) {
      expect(scopeRadiusFt(ft, SCOPE)).toBe(radiusForDistanceFt(ft, SCOPE));
    }
  });

  it('still refuses nonsense', () => {
    expect(scopeRadiusFt(Number.NaN, SCOPE)).toBeNull();
    expect(scopeRadiusFt(-1, SCOPE)).toBeNull();
    expect(scopeRadiusFt(MILE, 0)).toBeNull();
  });
});

describe('the cut grows with the pan', () => {
  it('reaches past the frame edge even at rest, so nothing pops in', () => {
    expect(reachFt(SCOPE, NO_PAN, OUTER_RADIUS)).toBeCloseTo(SCOPE * FRAME_REACH_RADII, 5);
    expect(FRAME_REACH_RADII).toBeGreaterThan(Math.SQRT2);
  });

  it('grows by one range for every range panned', () => {
    const one = reachFt(SCOPE, { x: OUTER_RADIUS, y: 0 }, OUTER_RADIUS);
    const two = reachFt(SCOPE, { x: OUTER_RADIUS * 2, y: 0 }, OUTER_RADIUS);
    expect(one - reachFt(SCOPE, NO_PAN, OUTER_RADIUS)).toBeCloseTo(SCOPE, 5);
    expect(two - one).toBeCloseTo(SCOPE, 5);
  });

  it('measures the pan as a distance, so a diagonal drag counts as one', () => {
    const diagonal = { x: OUTER_RADIUS * 0.6, y: OUTER_RADIUS * 0.8 };
    expect(reachFt(SCOPE, diagonal, OUTER_RADIUS)).toBeCloseTo(
      reachFt(SCOPE, { x: OUTER_RADIUS, y: 0 }, OUTER_RADIUS),
      5,
    );
  });

  it('covers the whole frame at every pan the driver can reach', () => {
    // THE ASSERTION THE BUG WOULD HAVE FAILED. At each pan, the far corner of
    // the viewport must still be inside the cut. Under the old cut -- reach ==
    // outerFt, i.e. 1.0 radii -- this fails from the very first drag.
    for (const panUnits of [0, 86, 171, 343, 686, 1_715, 3_430]) {
      const pan = clampPan({ x: panUnits, y: 0 });
      const reach = reachFt(SCOPE, pan, OUTER_RADIUS);
      // Furthest visible point from the vehicle, in dial units: the frame
      // centre plus the frame's own half-diagonal.
      const furthestUnits = Math.hypot(pan.x, pan.y) + OUTER_RADIUS * Math.SQRT2;
      const furthestFt = (furthestUnits / OUTER_RADIUS) * SCOPE;
      expect(reach).toBeGreaterThan(furthestFt);
    }
  });

  it('falls back to the range rather than to zero on a bad frame', () => {
    expect(reachFt(SCOPE, NO_PAN, 0)).toBe(SCOPE);
    expect(reachFt(0, NO_PAN, OUTER_RADIUS)).toBe(0);
  });
});

describe('cameras use the cut, not the scale', () => {
  function assessment(distanceFt: number): CameraAssessment {
    return {
      id: `cam-${String(distanceFt)}`,
      lat: 38.98,
      lon: -94.67,
      distanceFt,
      bearingDeg: 0,
      relativeDirection: 'ahead',
      facingVehicle: true,
      directionDeg: 180,
      inRange: false,
      muted: false,
      mergedIds: [],
    };
  }

  function input(over: Partial<SweepInput>): SweepInput {
    return {
      assessments: [],
      headingDeg: null,
      gps: 'lock',
      locationPermission: 'granted',
      muted: false,
      mutePierced: false,
      peers: [],
      presenceLive: false,
      outerFt: 5 * MILE,
      ...over,
    };
  }

  const tenMiles = assessment(10 * MILE);

  it('drops a camera past the cut', () => {
    const dots = sweepDots(input({ assessments: [tenMiles], reachFt: 5 * MILE }));
    expect(dots).toHaveLength(0);
  });

  it('keeps that camera once the pan has widened the cut -- the poof bug', () => {
    // "I can't zoom into a camera directly, it just poof starts disappearing."
    // Same cut, same cause.
    const dots = sweepDots(input({ assessments: [tenMiles], reachFt: 30 * MILE }));
    expect(dots).toHaveLength(1);
    expect(dots[0]?.radius).toBeCloseTo(OUTER_RADIUS * 2, 1);
  });

  it('defaults the cut to the scale when nothing says otherwise', () => {
    expect(sweepDots(input({ assessments: [tenMiles] }))).toHaveLength(0);
    expect(sweepDots(input({ assessments: [assessment(2 * MILE)] }))).toHaveLength(1);
  });
});

describe('zooming holds the point you zoomed on', () => {
  const C = OUTER_RADIUS;

  /** Where a world point lands on screen, given the pan. */
  const frameOf = (world: number, pan: number): number => world - pan;
  /** Where the zoom sends a world point. */
  const zoomed = (world: number, k: number): number => C + (world - C) * k;

  it('THE BUG: pinching on a cluster used to throw it off screen', () => {
    // A cluster 90 units left of the vehicle, no pan, zooming 2x in.
    const world = C - 90;
    // What the old code did: change the range, leave the pan at zero.
    expect(frameOf(zoomed(world, 2), 0)).toBe(C - 180);
    // 90 units further left than it started -- straight off the edge, which is
    // exactly what the screenshots showed.
  });

  it('keeps the pinched point exactly where the fingers are', () => {
    const pan = NO_PAN;
    const world = C - 90;
    const focus = { x: frameOf(world, pan.x), y: C };
    const next = panForZoom(pan, focus, 2, C);
    expect(frameOf(zoomed(world, 2), next.x)).toBeCloseTo(focus.x, 6);
  });

  it('holds it for zooming out as well as in', () => {
    const pan = { x: 40, y: -25 };
    const world = C + 120;
    const focus = { x: frameOf(world, pan.x), y: C };
    const next = panForZoom(pan, focus, 0.5, C);
    expect(frameOf(zoomed(world, 0.5), next.x)).toBeCloseTo(focus.x, 6);
  });

  it('reduces to scaling the pan when the focus is the frame centre', () => {
    // What the +/- keys need: the middle of the screen stays still.
    const pan = { x: 60, y: -30 };
    const next = panForZoom(pan, { x: C, y: C }, 2, C);
    expect(next.x).toBeCloseTo(120, 6);
    expect(next.y).toBeCloseTo(-60, 6);
  });

  it('leaves an unpanned view unpanned when zooming about the centre', () => {
    expect(panForZoom(NO_PAN, { x: C, y: C }, 3, C)).toEqual(NO_PAN);
  });

  it('refuses a nonsense magnification rather than flinging the map', () => {
    const pan = { x: 10, y: 10 };
    expect(panForZoom(pan, { x: C, y: C }, 0, C)).toBe(pan);
    expect(panForZoom(pan, { x: C, y: C }, Number.NaN, C)).toBe(pan);
    expect(panForZoom(pan, { x: Number.NaN, y: C }, 2, C)).toBe(pan);
  });
});
