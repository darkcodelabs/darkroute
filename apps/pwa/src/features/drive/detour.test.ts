/**
 * THE MISSING DESTINATION, THE BEARING THAT REPLACED THE GUESS, AND THE
 * REFUSALS.
 *
 * `packages/core/src/avoidance.test.ts` already proves the geometry: which
 * side the stop goes, that clusters collapse, that the cap reports what it
 * dropped. Nothing here re-tests any of that, and nothing here touches it.
 *
 * What is tested here is the half DRIVE has to supply - an end point nobody
 * typed, and the bearing to put it on - and the refusals, because a refusal is
 * a sentence a driver reads and the wrong one is worse than none.
 */

import { describe, expect, it } from 'vitest';

import {
  closestApproachFt,
  destinationPoint,
  distanceFt as feetBetween,
} from '../../stores/fwmCore.ts';

import {
  DETOUR_RUNOUT_FT,
  detourAimBearing,
  detourKeyCount,
  detourRouteCameras,
  planDriveDetour,
  usableDetourCameras,
} from './detour.ts';
import type { DetourCamera, DetourOutcome } from './detour.ts';

/** Overland Park, where the reported cameras actually are. Heading due north. */
const FIX = { lat: 38.9, lon: -94.67 };
const NORTH = 0;

/** Ids are only for the router's benefit; the geometry never reads one. */
let nextId = 0;

/**
 * A camera `ft` to the given side, `alongM` up the road ahead.
 *
 * `distanceFt` is MEASURED rather than set to the along-track figure, because
 * that is what an assessment carries and the run-out is sized off it.
 */
function beside(alongM: number, sideBearing: number, ft: number): DetourCamera {
  const on = destinationPoint(FIX.lat, FIX.lon, NORTH, alongM);
  const at = destinationPoint(on.lat, on.lon, sideBearing, ft * 0.3048);
  nextId += 1;
  return {
    ...at,
    id: `osm:${String(nextId)}`,
    directionDeg: null,
    distanceFt: feetBetween(FIX.lat, FIX.lon, at.lat, at.lon),
  };
}

/** A camera on a named bearing at a named range. The browse fixture's unit. */
function outward(bearingDeg: number, metres: number): DetourCamera {
  const at = destinationPoint(FIX.lat, FIX.lon, bearingDeg, metres);
  nextId += 1;
  return {
    ...at,
    id: `osm:${String(nextId)}`,
    directionDeg: null,
    distanceFt: feetBetween(FIX.lat, FIX.lon, at.lat, at.lon),
  };
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
    const onTheRoad = { ...beside(900, 90, 0), distanceFt: 2953 };

    const outcome = planDriveDetour(FIX, NORTH, [onTheRoad]);

    expect(outcome).toMatchObject({ kind: 'none', reason: 'all-unavoidable', unavoidable: 1 });
  });

  it('carries the berth it used into the refusal, so the sentence cannot drift', () => {
    const outcome = planDriveDetour(FIX, NORTH, [beside(2800, 90, 2640)], 500);

    expect(outcome).toMatchObject({ kind: 'none', clearanceFt: 500 });
  });

  it('drops a camera with no usable position instead of routing off a NaN', () => {
    const broken = { ...beside(400, 90, 300), lat: Number.NaN };

    expect(planDriveDetour(FIX, NORTH, [broken])).toMatchObject({
      kind: 'none',
      reason: 'nothing-ahead',
    });
  });
});

/**
 * THE BEARING, WHEN THE PHONE HAS NEVER SEEN THE CAR MOVE.
 *
 * =============================================================================
 * THE DEFECT THIS BLOCK IS FOR
 * =============================================================================
 * "Route around them does the right thing but only goes one hop." The key sat
 * on 4 DENSE AREA - a BROWSE state, so a parked phone with readers scattered
 * in every direction - and the route was run out along whatever bearing was
 * lying around. `planDetour` keeps the cameras inside one clearance either
 * side of that line, so out of fourteen readers exactly one landed in the
 * 2000 ft strip. One camera, one cluster, one waypoint.
 *
 * The planner was right the whole way through. The corridor it was handed was
 * aimed at nothing.
 *
 * =============================================================================
 * WHAT IS PINNED
 * =============================================================================
 * That the aim is chosen from the readers, that the reader it is anchored on
 * survives into the plan rather than being written off as ON the line, and
 * that a heading still wins whenever there is one - which is the whole of
 * `AlertV1` staying as it was.
 */
describe('the bearing a stationary phone plans along', () => {
  it('picks the line the most readers sit beside, not the first one', () => {
    /*
     * A boulevard's worth of readers running north-east, and three singletons
     * scattered elsewhere. Any bearing at all catches one of the singletons;
     * only an aimed one catches the row.
     *
     * SPACED 900 m APART, which is past `CLUSTER_SPAN_MULTIPLE` x the berth, so
     * they are four clusters rather than one. That distinction is the reported
     * sentence: a tight row of readers correctly collapsing into a single stop
     * is not the bug, and a corridor that only ever contained one reader was.
     */
    const row = [outward(45, 500), outward(45, 1400), outward(45, 2300), outward(45, 3200)];
    const scattered = [outward(150, 900), outward(230, 1400), outward(320, 2000)];

    const outcome = planDriveDetour(FIX, null, [...scattered, ...row]);

    if (outcome.kind !== 'route') throw new Error('expected a route');
    expect(outcome.plan.consideredCameras).toBe(row.length);
    // AND IT IS MORE THAN ONE HOP, which is the sentence in the bug report.
    expect(outcome.plan.waypoints.length).toBeGreaterThan(1);
  });

  it('does not aim straight at a reader, because a reader on the line cannot be pushed off it', () => {
    /*
     * The obvious implementation - point at the nearest camera - produces the
     * one plan that cannot help: `planDetour` counts a camera on the centreline
     * `unavoidable` and refuses to put a waypoint beside it. So the aim is the
     * EDGE of a reader's arc, which leaves it a berth off the line: still
     * counted, and pushable.
     */
    const outcome = planDriveDetour(FIX, null, [outward(70, 1200)]);

    if (outcome.kind !== 'route') throw new Error('expected a route');
    expect(outcome.plan.unavoidable).toBe(0);
    expect(outcome.plan.consideredCameras).toBe(1);
    expect(outcome.plan.waypoints).toHaveLength(1);
  });

  it('counts fourteen scattered readers as the most one line can hold, and says so', () => {
    /*
     * THE REPORTED SCREENSHOT. Fourteen readers spread over a two-mile circle
     * with nothing to say which way the car is pointing.
     *
     * A straight corridor cannot hold a ring - that is geometry, not a defect -
     * so what is pinned is the honest version of the promise: the key's number
     * is the plan's own, it is more than the one hop the old aim produced, and
     * it is less than fourteen. DENSE AREA's own numeral still says fourteen,
     * which is a fact about the road rather than an offer about a route.
     */
    const scattered = Array.from({ length: 14 }, (_unused, index) =>
      outward((index * 360) / 14, 600 + index * 180),
    );

    const outcome = planDriveDetour(FIX, null, scattered);

    if (outcome.kind !== 'route') throw new Error('expected a route');
    expect(detourKeyCount(outcome)).toBe(outcome.plan.consideredCameras);
    expect(outcome.plan.consideredCameras).toBeGreaterThan(1);
    expect(outcome.plan.consideredCameras).toBeLessThan(scattered.length);
  });

  it('leaves a moving car alone: a heading beats anything derived', () => {
    /*
     * `AlertV1` fires this mid-alert, where the course is measured and the
     * readers really are through the windscreen. The derived aim must never
     * reach that case, so the same set is planned twice and only the null
     * heading moves.
     */
    const cameras = [outward(45, 900), outward(45, 1500), beside(700, 90, 300)];

    const driving = planDriveDetour(FIX, NORTH, cameras);
    const parked = planDriveDetour(FIX, null, cameras);

    if (driving.kind !== 'route') throw new Error('expected a route while moving');
    if (parked.kind !== 'route') throw new Error('expected a route while parked');
    // Due north caught the one reader beside the northbound line, and nothing
    // about the other two changed it.
    expect(driving.plan.consideredCameras).toBe(1);
    expect(parked.plan.consideredCameras).toBe(2);
    expect(driving.to).not.toEqual(parked.to);
  });

  it('cannot help when every reader is already within a berth of the car', () => {
    /*
     * A parked car with one reader 200 m away, inside the 1000 ft berth. There
     * is no edge to aim at - the reader is in the corridor whichever way you
     * point - so the aim is the reader itself and the answer is the true one:
     * moving the route sideways from where you are standing does not clear a
     * camera that is already this close.
     */
    const outcome = planDriveDetour(FIX, null, [outward(70, 200)]);

    expect(outcome).toMatchObject({ kind: 'none', reason: 'all-unavoidable' });
  });

  it('names no bearing at all when every reader sits on the fix', () => {
    /*
     * The one case left for `no-heading`. There is no course and no reader off
     * the car to aim at, so there is no line - and `DetourOffer` says exactly
     * that rather than routing along a number nothing vouched for.
     */
    const onTop: DetourCamera = {
      ...FIX,
      id: 'osm:on-top',
      directionDeg: null,
      distanceFt: 0,
    };

    expect(detourAimBearing(FIX, [onTop])).toBeNull();
    expect(planDriveDetour(FIX, null, [onTop])).toMatchObject({
      kind: 'none',
      reason: 'no-heading',
    });
  });
});

/**
 * WHAT THE KEY IS ALLOWED TO SAY.
 *
 * The reported defect: the key read `Around 14` and the route it planned came
 * back "0 readers on route - 0 avoided". Both numbers were right about their
 * own collection. The dock counted every reader inside two miles; the plan
 * counted the ones it actually put a stop beside. Nothing reconciled them.
 *
 * So these are about the SUBTRACTION - that the number on the glass is the
 * plan's and never the input's, and that it is not drawn at all when the plan
 * is nothing.
 */
describe('the number on the Around key', () => {
  it('counts the readers the plan kept, not the readers it was handed', () => {
    /*
     * Four inside the two-mile horizon the dock counts, and two of them on the
     * journey: one is BEHIND the car and one sits half a mile off the line, so
     * neither is something a detour steers around. That is an ordinary spread
     * rather than a corner case - it is what a phone in a city holds.
     */
    const ahead = [beside(400, 90, 300), beside(1200, 90, 250)];
    const behind = beside(-800, 90, 200);
    const wideOfTheLine = beside(900, 90, 2640);
    const cameras = [...ahead, behind, wideOfTheLine];

    const outcome = planDriveDetour(FIX, NORTH, cameras);

    if (outcome.kind !== 'route') throw new Error('expected a route');
    expect(detourKeyCount(outcome)).toBe(outcome.plan.consideredCameras);
    expect(detourKeyCount(outcome)).toBe(ahead.length);
    // And the point of the case: it is NOT the size of the set handed over.
    expect(detourKeyCount(outcome)).toBeLessThan(cameras.length);
  });

  it.each<readonly [string, () => DetourOutcome]>([
    ['no-fix', () => planDriveDetour(null, NORTH, [beside(400, 90, 300)])],
    ['nothing-ahead', () => planDriveDetour(FIX, NORTH, [])],
    ['already-clear', () => planDriveDetour(FIX, NORTH, [beside(2800, 90, 2640)])],
    [
      'all-unavoidable',
      () => planDriveDetour(FIX, NORTH, [{ ...beside(900, 90, 0), distanceFt: 2953 }]),
    ],
    [
      'no-heading',
      () =>
        planDriveDetour(FIX, null, [
          { ...FIX, id: 'osm:on-top', directionDeg: null, distanceFt: 0 },
        ]),
    ],
  ])('draws no key on %s, because the detour would clear nothing', (_reason, plan) => {
    const outcome = plan();

    expect(outcome.kind).toBe('none');
    expect(detourKeyCount(outcome)).toBeNull();
  });
});

/**
 * ONE COLLECTION.
 *
 * The label counts a set, the planner steers around a set, and
 * `services/route/darkRoute.ts` measures every round's new line against a set.
 * They were not the same three sets: the shell handed the planner the readers
 * within two miles and handed the router `useCamerasStore.getState().cameras`,
 * which is every cached camera in the country.
 *
 * The router's set has to be WIDER THAN THE PLAN'S COUNT - a route bent around
 * the readers beside your line is a different road with its own readers on it,
 * and a build that handed over only the ones it had already avoided reported
 * "2 avoided" over a line that passed nine. It does not have to be a different
 * reading of the store, and that is the difference these pin.
 */
describe('the set the router measures against', () => {
  it('is the planner s own array, member for member', () => {
    const cameras = [beside(400, 90, 300), beside(-800, 90, 200), beside(900, 90, 2640)];

    const routed = detourRouteCameras(cameras);

    expect(routed.map((camera) => camera.id)).toEqual(cameras.map((camera) => camera.id));
    expect(routed.map((camera) => [camera.lat, camera.lon])).toEqual(
      cameras.map((camera) => [camera.lat, camera.lon]),
    );
  });

  it('is wider than the count on the key, which is the half that must not shrink', () => {
    const cameras = [beside(400, 90, 300), beside(-800, 90, 200), beside(900, 90, 2640)];

    const outcome = planDriveDetour(FIX, NORTH, cameras);

    if (outcome.kind !== 'route') throw new Error('expected a route');
    expect(outcome.plan.consideredCameras).toBeLessThan(detourRouteCameras(cameras).length);
  });

  it('drops exactly what the planner drops, so neither half sees a camera the other cannot', () => {
    /* A NaN position is unroutable and unplannable, and it has to disappear
       from both halves at once or the router is excluding a reader the plan
       never looked at. */
    const good = beside(400, 90, 300);
    const broken = { ...beside(1200, 90, 250), lon: Number.NaN };

    expect(detourRouteCameras([good, broken]).map((camera) => camera.id)).toEqual(
      usableDetourCameras([good, broken]).map((camera) => camera.id),
    );
    expect(detourRouteCameras([good, broken])).toHaveLength(1);
  });
});
