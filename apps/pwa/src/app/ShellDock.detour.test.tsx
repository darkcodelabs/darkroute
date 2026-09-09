/**
 * `Reroute around N` - THE NUMBER ON THE KEY, AND THE PLAN BEHIND IT.
 *
 * =============================================================================
 * THE DEFECT
 * =============================================================================
 * The key read `14`. The route it planned came back "0 readers on route
 * - 0 avoided". Both numbers were true about their own collection and nothing
 * reconciled them: `useDockState` counted every reader inside two miles to put
 * a number on the glass, and `planDriveDetour` then dropped every one of them
 * that was behind the car, wider off the line than the berth, or past the end
 * point it derives. On a stationary phone with readers scattered in every
 * direction that was all fourteen of them.
 *
 * `DriveScreen.detour.test.tsx` covers what the key DOES - that it opens
 * nothing, that it asks first, that the prompt is the only place a route leaves
 * the phone. This file covers what the key SAYS, which is the half that lied.
 *
 * =============================================================================
 * WHY IT DRIVES THE STORES AND NOT A VIEW MODEL
 * =============================================================================
 * The claim under test spans three collections that used to be two and a half:
 * the readers the dock counts, the readers the planner keeps, and the readers
 * the router measures its answer against. A hand-built `DockData` would prove
 * nothing about any of them. So records go into the cameras store, a real fix
 * goes into the position store, `packages/core` does the measuring, and the
 * assertions are made against the glass and against the pending offer.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAlertLoop } from '../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../services/alerts/engineLoop.ts';
import { useAlertStore } from '../stores/alert.ts';
import { useCamerasStore } from '../stores/cameras.ts';
import { positionActions, usePositionStore } from '../stores/position.ts';
import { useSettingsStore } from '../stores/settings.ts';
import type { CameraRecord } from '../services/db/schema.ts';
import { pendingDetour, pendingDetourContext } from '../features/drive/DetourOffer.tsx';
import { initScreenState } from './screenState.ts';
import { ShellDock } from './ShellDock.tsx';

const started: AlertLoop[] = [];
function loopUnderTest(): AlertLoop {
  const loop = createAlertLoop();
  started.push(loop);
  return loop;
}

/** Overland Park. The same corner `DriveScreen.detour.test.tsx` drives. */
const FIX = {
  lat: 38.9181,
  lon: -94.6923,
  accuracyM: 8,
  timestampMs: 1_700_000_000_000,
};

/** Metres per degree, near enough at this latitude for a fixture. */
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((FIX.lat * Math.PI) / 180);

/**
 * A reader `north` metres up the road and `east` metres across it.
 *
 * Signed on both axes, because the whole point of the fixture is the readers
 * that are NOT on the journey: negative north is behind the car, and a large
 * east is off to one side of the line it would take.
 */
function reader(north: number, east: number, id: string): CameraRecord {
  return {
    id,
    lat: FIX.lat + north / M_PER_DEG_LAT,
    lon: FIX.lon + east / M_PER_DEG_LON,
    directionDeg: 180,
    confirmations: 1,
  };
}

/**
 * TWELVE READERS WITHIN TWO MILES, AND FOUR OF THEM ON THE JOURNEY.
 *
 * Four ahead and close to the line - the ones a detour steers around. Four
 * behind, which no route forward passes. Four half a kilometre off to the east,
 * which is outside the 1000 ft berth, so moving the route sideways buys the
 * driver nothing against them.
 *
 * Nothing is inside the 500 ft alert radius: a live camera alert outranks every
 * overlay in the presentation ladder, so a nearer fixture would have these
 * cases asserting about the takeover layer instead of the dock.
 */
const AHEAD: readonly CameraRecord[] = [
  reader(400, 60, 'osm:a0'),
  reader(600, 80, 'osm:a1'),
  reader(800, 70, 'osm:a2'),
  reader(1000, 90, 'osm:a3'),
];
const BEHIND: readonly CameraRecord[] = [
  reader(-400, 60, 'osm:b0'),
  reader(-600, 80, 'osm:b1'),
  reader(-800, 70, 'osm:b2'),
  reader(-1000, 90, 'osm:b3'),
];
const WIDE: readonly CameraRecord[] = [
  reader(400, 500, 'osm:w0'),
  reader(600, 520, 'osm:w1'),
  reader(800, 540, 'osm:w2'),
  reader(1000, 560, 'osm:w3'),
];
const TWELVE: readonly CameraRecord[] = [...AHEAD, ...BEHIND, ...WIDE];

/**
 * Put the readers on the phone, put the car among them, and tick once.
 *
 * `speedMps` is what separates the two cases the whole file turns on: 21 m/s
 * with a course is a car the app has seen moving, and 0 with no course is the
 * parked phone that has no ahead to plan along.
 */
function driveThrough(
  cameras: readonly CameraRecord[],
  speedMps: number | null,
  headingDeg: number | null,
): AlertLoop {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras,
      fetchedAtMs: FIX.timestampMs,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
  positionActions.ingestFix({
    lat: FIX.lat,
    lon: FIX.lon,
    accuracyM: FIX.accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    headingDeg,
    speedMps,
    timestamp: FIX.timestampMs,
  });
  const loop = loopUnderTest();
  loop.tick({
    lat: FIX.lat,
    lon: FIX.lon,
    headingDeg,
    speedMps,
    accuracyM: FIX.accuracyM,
    motionMagnitudeMps2: null,
    timestampMs: FIX.timestampMs,
  });
  return loop;
}

/** The key, by the word on it. Absent is a real answer, so this may return null. */
function detourKey(): HTMLElement | null {
  return screen.queryByRole('button', { name: /^Reroute around \d+ readers?$/ });
}

beforeEach(() => {
  initScreenState({ initialScreen: 'radar' });
});

afterEach(() => {
  while (started.length > 0) started.pop()?.stop();
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  useSettingsStore.getState().reset();
  vi.restoreAllMocks();
});

describe('the number on the detour key', () => {
  it('says how many the detour keeps, not how many are nearby', () => {
    driveThrough(TWELVE, 21, 0);
    render(<ShellDock />);

    // TWELVE within two miles, and the key does NOT say twelve.
    expect(useCamerasStore.getState().cameras).toHaveLength(TWELVE.length);
    const key = detourKey();
    expect(key).toHaveAccessibleName(`Reroute around ${String(AHEAD.length)} readers`);

    fireEvent.click(key as Element);

    /*
     * AND THE SAME NUMBER IS THE PLAN'S OWN. This is the assertion the defect
     * would have failed: the label is read off `consideredCameras`, so there
     * is no second count that can drift away from it.
     */
    const offer = pendingDetour();
    if (offer?.kind !== 'route') throw new Error('expected a planned route');
    expect(offer.plan.consideredCameras).toBe(AHEAD.length);
    expect(key).toHaveAccessibleName(`Reroute around ${String(offer.plan.consideredCameras)} readers`);
  });

  it('hands the router every reader on the phone, which is the wider set on purpose', () => {
    /*
     * THE ONE PLACE TWO COLLECTIONS ARE CORRECT, and it is not the one the
     * defect was about. The planner's set answers "what am I steering around".
     * The context's answers "what do I measure the answer against", and
     * `services/route/darkRoute.ts` re-measures every round's new line against
     * it on the device - because a route bent around the four readers ahead is
     * a different road with its own readers on it. Narrowing this to the four
     * is how a build shipped "2 avoided" over a line that passed nine.
     */
    driveThrough(TWELVE, 21, 0);
    render(<ShellDock />);

    fireEvent.click(detourKey() as Element);

    const offer = pendingDetour();
    const context = pendingDetourContext();
    if (offer?.kind !== 'route') throw new Error('expected a planned route');

    expect(context?.cameras).toHaveLength(TWELVE.length);
    expect(offer.plan.consideredCameras).toBeLessThan(TWELVE.length);
    /*
     * ONE ORIGIN, THOUGH. The end point is derived FROM the origin - a run-out
     * along the heading past the farthest reader - so a plan measured from one
     * fix and sent from another would be aimed from a place the car has left.
     */
    expect(context?.from).toEqual({ lat: FIX.lat, lon: FIX.lon });
  });

  it('aims at the readers when the car has never moved, and counts what it planned', () => {
    /*
     * THE REPORTED SCREENSHOT, and what it turned into.
     *
     * Stationary, twelve readers scattered around the car, and the key said
     * a count while planning a run out and back along a bearing nothing
     * vouched for. There is no ahead on a parked phone, so the corridor is
     * aimed at the densest line through the readers instead of at a stale
     * course, and the key promises what that line actually holds.
     *
     * The number is the PLAN'S, never the two-mile count. Those two disagree
     * here on purpose: a straight corridor cannot hold a ring, and the dock
     * keeps saying twelve because twelve is how many are near you.
     */
    driveThrough(TWELVE, 0, null);
    render(<ShellDock />);

    const key = detourKey();
    expect(key).not.toBeNull();

    fireEvent.click(key as Element);
    const offer = pendingDetour();
    if (offer?.kind !== 'route') throw new Error('expected a planned route');

    expect(key).toHaveAccessibleName(`Reroute around ${String(offer.plan.consideredCameras)} readers`);
    expect(offer.plan.consideredCameras).toBeLessThan(TWELVE.length);
    expect(screen.getByText(String(TWELVE.length))).toBeInTheDocument();

    /* ONE COLLECTION. The router's set is the planner's, not a second read of
       the camera store -- the count and the route used to come from different
       collections, which is how the key promised fourteen and avoided none. */
    expect(pendingDetourContext()?.cameras.map((c) => c.id)).toEqual(
      useCamerasStore.getState().assessments.map((a) => a.id),
    );
  });
});
