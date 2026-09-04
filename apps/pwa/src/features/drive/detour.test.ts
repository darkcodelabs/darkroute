/**
 * THE MISSING DESTINATION, and the four ways there is no route.
 *
 * `packages/core/src/avoidance.test.ts` already proves the geometry: which
 * side the stop goes, that clusters collapse, that the cap reports what it
 * dropped. Nothing here re-tests any of that.
 *
 * What is tested here is the half DRIVE has to supply - an end point nobody
 * typed - and the refusals, because a refusal is a sentence a driver reads and
 * the wrong one is worse than none.
 */

import { describe, expect, it } from 'vitest';

import {
  closestApproachFt,
  destinationPoint,
  distanceFt as feetBetween,
} from '../../stores/fwmCore.ts';

import { DETOUR_RUNOUT_FT, planDriveDetour } from './detour.ts';

/** Overland Park, where the reported cameras actually are. Heading due north. */
const FIX = { lat: 38.9, lon: -94.67 };
const NORTH = 0;

/**
 * A camera `ft` to the given side, `alongM` up the road ahead.
 *
 * `distanceFt` is MEASURED rather than set to the along-track figure, because
 * that is what an assessment carries and the run-out is sized off it.
 */
function beside(alongM: number, sideBearing: number, ft: number) {
  const on = destinationPoint(FIX.lat, FIX.lon, NORTH, alongM);
  const at = destinationPoint(on.lat, on.lon, sideBearing, ft * 0.3048);
  return { ...at, distanceFt: feetBetween(FIX.lat, FIX.lon, at.lat, at.lon) };
}

describe('planning the detour DRIVE would send', () => {
  it('routes around the cameras it was given, with the berth it was asked for', () => {
    // Three readers up the same boulevard, all to the right of the road.
    const cameras = [beside(400, 90, 300), beside(1600, 90, 250), beside(3000, 90, 400)];

    const outcome = planDriveDetour(FIX, NORTH, cameras);

    expect(outcome.kind).toBe('route');
    if (outcome.kind !== 'route') throw new Error('expected a route');
    expect(outcome.plan.waypoints.length).toBeGreaterThan(0);
    // Every stop is west of the road, i.e. the far side from the cameras.
    for (const stop of outcome.plan.waypoints) expect(stop.lon).toBeLessThan(FIX.lon);
    // And the measured clearance is a real one, not a claimed one.
    expect(closestApproachFt(outcome.plan.waypoints, cameras) ?? 0).toBeGreaterThan(900);
    expect(outcome.closestFt).toBe(closestApproachFt(outcome.plan.waypoints, cameras));
  });

  it('ends the route past the last camera, not at it', () => {
    // The end point is derived, and getting it short is the expensive mistake:
    // `planDetour` ignores anything beyond it, so the last reader would be
    // silently dropped from a plan the key had already counted it in.
    const far = beside(3000, 90, 300);
    const outcome = planDriveDetour(FIX, NORTH, [beside(400, 90, 300), far]);

    if (outcome.kind !== 'route') throw new Error('expected a route');
    /*
     * The end sits the run-out beyond the farthest camera's own range. Within
     * a couple of percent rather than to the foot: `destinationPoint` walks a
     * sphere and `distanceFt` measures on the ellipsoid, so the two disagree
     * by about 0.2% over two miles. The claim being made is "past the last
     * one, by roughly a quarter mile", and that is what is checked.
     */
    const endFt = feetBetween(FIX.lat, FIX.lon, outcome.to.lat, outcome.to.lon);
    const wanted = far.distanceFt + DETOUR_RUNOUT_FT;
    expect(endFt).toBeGreaterThan(wanted * 0.98);
    expect(endFt).toBeLessThan(wanted * 1.02);
    // Both cameras made it into the plan rather than one falling off the end.
    expect(outcome.plan.consideredCameras).toBe(2);
  });

  it('refuses without a fix, because there is no line to plan around', () => {
    const outcome = planDriveDetour(null, NORTH, [beside(400, 90, 300)]);

    expect(outcome).toMatchObject({ kind: 'none', reason: 'no-fix' });
  });

  it('refuses without a heading, because a parked car has no ahead', () => {
    // `steady.ts`: the course a stationary phone reports is computed from two
    // points inside its own error cloud. A route built along it points nowhere
    // in particular, which is worse than saying there is no route.
    const outcome = planDriveDetour(FIX, null, [beside(400, 90, 300)]);

    expect(outcome).toMatchObject({ kind: 'none', reason: 'no-heading' });
  });

  it('refuses when there is nothing being tracked', () => {
    expect(planDriveDetour(FIX, NORTH, [])).toMatchObject({
      kind: 'none',
      reason: 'nothing-ahead',
    });
  });

  it('says the cameras are already clear rather than inventing a detour', () => {
    // Half a mile off the road. Moving sideways buys the driver nothing, and a
    // route that pretended otherwise would cost a disclosure for no gain.
    const outcome = planDriveDetour(FIX, NORTH, [beside(2800, 90, 2640)]);

    expect(outcome).toMatchObject({ kind: 'none', reason: 'already-clear' });
  });

  it('says a camera on the road is unavoidable rather than routing around it', () => {
    // The case the driver most needs told: both sides of a camera on the
    // centreline are inside the berth, so no stop clears it. Honesty here is
    // the difference between a detour and a false sense of one.
    const onTheRoad = { ...destinationPoint(FIX.lat, FIX.lon, NORTH, 900), distanceFt: 2953 };

    const outcome = planDriveDetour(FIX, NORTH, [onTheRoad]);

    expect(outcome).toMatchObject({ kind: 'none', reason: 'all-unavoidable', unavoidable: 1 });
  });

  it('carries the berth it used into the refusal, so the sentence cannot drift', () => {
    const outcome = planDriveDetour(FIX, NORTH, [beside(2800, 90, 2640)], 500);

    expect(outcome).toMatchObject({ kind: 'none', clearanceFt: 500 });
  });

  it('drops a camera with no usable position instead of routing off a NaN', () => {
    const broken = { lat: Number.NaN, lon: -94.67, distanceFt: 500 };

    expect(planDriveDetour(FIX, NORTH, [broken])).toMatchObject({
      kind: 'none',
      reason: 'nothing-ahead',
    });
  });
});
