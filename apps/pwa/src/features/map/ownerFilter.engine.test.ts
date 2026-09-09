/**
 * THE LOAD-BEARING TEST: the drawing filter cannot reach the warning.
 *
 * =============================================================================
 * WHY THIS IS DRIVEN THROUGH THE REAL LOOP AND NOT MOCKED
 * =============================================================================
 * The defect this feature must never ship is not a wrong pixel. It is a driver
 * who narrows the map to "police / agency" to see who owns what, forgets, and
 * drives past an HOA reader the app has stopped warning them about. Nothing in
 * the UI would look broken - the filter would look like it was working.
 *
 * A test with a stubbed engine cannot catch that, because the wiring mistake
 * that causes it is somebody handing the FILTERED array to the thing that
 * assesses. So this drives the shipped chain end to end: records into the
 * cameras store, `createAlertLoop` over a real fix, `packages/core` doing the
 * measuring, the assessment landing back on the cameras store where the drive
 * card reads it.
 *
 * The fixture is chosen to make the failure loud: the NEAREST camera is `hoa`
 * and the filter selects `police`, so if the filter ever reaches the engine the
 * nearest-camera answer changes from the HOA reader 90 m away to a police
 * camera 400 m away, and these assertions go red rather than a driver finding
 * out on the road.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import { createAlertLoop } from '../../services/alerts/engineLoop.ts';
import type { AlertLoop } from '../../services/alerts/engineLoop.ts';
import type { CameraRecord } from '../../services/db/schema.ts';

import { visibleCameras } from './ownerFilter.ts';

/** Every loop a test starts, stopped even when the test fails partway. */
const started: AlertLoop[] = [];
function loopUnderTest(): AlertLoop {
  const loop = createAlertLoop();
  started.push(loop);
  return loop;
}

/** A fix in Kansas City, where the shipped tile set has real cameras. */
const FIX = {
  lat: 38.9181,
  lon: -94.6923,
  headingDeg: 0,
  speedMps: 21,
  accuracyM: 8,
  timestampMs: 1_700_000_000_000,
};

/** Metres north of the fix, as a camera. 1 degree of latitude is ~111,320 m. */
function cameraNorthOf(metres: number, id: string, ownerType: CameraRecord['ownerType']): CameraRecord {
  const record: CameraRecord = {
    id,
    lat: FIX.lat + metres / 111_320,
    lon: FIX.lon,
    // Facing back down the road, so every camera in the fixture is one the
    // driver is closing on. The filter must not change that for any of them.
    directionDeg: 180,
    confirmations: 1,
  };
  return ownerType === undefined ? record : { ...record, ownerType };
}

/**
 * The road ahead. The one that matters is FIRST and is an HOA reader, which is
 * exactly the class a driver filtering for police would have hidden.
 */
const AHEAD: readonly CameraRecord[] = [
  cameraNorthOf(90, 'osm:hoa-nearest', 'hoa'),
  cameraNorthOf(240, 'osm:private', 'private'),
  cameraNorthOf(400, 'osm:police', 'police'),
  cameraNorthOf(560, 'osm:unrecorded', undefined),
];

function putCameras(cameras: readonly CameraRecord[]): void {
  useCamerasStore.getState().putTiles([
    {
      ref: { z: 11, x: 484, y: 783 },
      cameras,
      fetchedAtMs: FIX.timestampMs,
      freshness: 'fresh',
      source: 'network',
    },
  ]);
}

/** What the drive card reads: ids, distances and the count, in order. */
function assessmentSnapshot(): unknown {
  const state = useCamerasStore.getState();
  return {
    nearestId: state.nearest?.id ?? null,
    nearestDistanceFt: state.nearest?.distanceFt ?? null,
    countInRange: state.countInRange,
    queue: state.assessments.map((a) => ({ id: a.id, distanceFt: a.distanceFt, inRange: a.inRange })),
  };
}

afterEach(() => {
  // Loops before stores, or a leaked subscription re-ticks into the next test.
  while (started.length > 0) started.pop()?.stop();
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  useSettingsStore.getState().reset();
});

describe('the map owner filter against the alert engine', () => {
  it('changes what is drawn', () => {
    putCameras(AHEAD);

    const all = useCamerasStore.getState().cameras;
    expect(visibleCameras(all, null)).toHaveLength(4);
    expect(visibleCameras(all, 'police').map((c) => c.id)).toEqual(['osm:police']);
  });

  it('leaves the nearest camera, its distance and the queue byte-identical', () => {
    putCameras(AHEAD);
    const loop = loopUnderTest();
    loop.tick(FIX);

    const unfiltered = assessmentSnapshot();
    // The fixture is only meaningful if the engine actually found the HOA one.
    expect(unfiltered).toMatchObject({ nearestId: 'osm:hoa-nearest' });

    // The driver narrows the map to the class the nearest camera is NOT.
    useSettingsStore.getState().setMapOwnerFilter('police');
    loop.tick({ ...FIX, timestampMs: FIX.timestampMs + 2_000 });

    expect(assessmentSnapshot()).toEqual(unfiltered);
    // And the camera the map has just stopped drawing is still the one the app
    // is warning about. That combination IS the safety property.
    expect(
      visibleCameras(useCamerasStore.getState().cameras, 'police').map((c) => c.id),
    ).not.toContain('osm:hoa-nearest');
  });

  it('does not shrink the store the engine reads', () => {
    putCameras(AHEAD);
    const loop = loopUnderTest();
    loop.tick(FIX);

    useSettingsStore.getState().setMapOwnerFilter('police');

    // `useCachedCameras()` is this array. Filtering it here rather than at the
    // one map call site is precisely how this feature would become the defect:
    // the engine reads the store directly on every tick.
    expect(useCamerasStore.getState().cameras).toHaveLength(4);
  });

  it('leaves the alert state alone when the filter is set mid-drive', () => {
    putCameras(AHEAD);
    const loop = loopUnderTest();
    loop.tick(FIX);
    const before = {
      state: useAlertStore.getState().state,
      nearestCameraId: useAlertStore.getState().nearestCameraId,
      nearestDistanceFt: useAlertStore.getState().nearestDistanceFt,
    };

    // No tick between: setting the filter must not itself move the engine. The
    // settings store IS subscribed by the loop (for the threshold), so this is
    // not a free assertion - a filter read in that subscriber would show here.
    useSettingsStore.getState().setMapOwnerFilter('unverified');

    expect(useAlertStore.getState().state).toBe(before.state);
    expect(useAlertStore.getState().nearestCameraId).toBe(before.nearestCameraId);
    expect(useAlertStore.getState().nearestDistanceFt).toBe(before.nearestDistanceFt);
  });

  it('stays separate from the alerting owner filter, in both directions', () => {
    // The near-miss the design flagged: `ownerTypesEnabled` is a filter over
    // the same five classes and it DOES govern alerting. If a later change
    // merges them, this is the assertion that should stop it.
    const defaults = useSettingsStore.getState().ownerTypesEnabled;
    useSettingsStore.getState().setMapOwnerFilter('police');
    expect(useSettingsStore.getState().ownerTypesEnabled).toEqual(defaults);

    useSettingsStore.getState().setOwnerTypeEnabled('hoa', false);
    expect(useSettingsStore.getState().mapOwnerFilter).toBe('police');
  });
});
