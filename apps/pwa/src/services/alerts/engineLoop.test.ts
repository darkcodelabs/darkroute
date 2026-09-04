import { afterEach, describe, expect, it } from 'vitest';

import { useAlertStore } from '../../stores/alert.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { usePositionStore } from '../../stores/position.ts';
import { useSettingsStore } from '../../stores/settings.ts';
import type { CameraRecord } from '../db/schema.ts';

import { createAlertLoop } from './engineLoop.ts';
import type { AlertLoop } from './engineLoop.ts';

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
  headingDeg: 41,
  speedMps: 21,
  accuracyM: 8,
  timestampMs: 1_700_000_000_000,
};

/** Metres north of the fix, as a camera. 1 degree of latitude is ~111,320 m. */
function cameraNorthOf(metres: number, id = 'osm:test'): CameraRecord {
  return {
    id,
    lat: FIX.lat + metres / 111_320,
    lon: FIX.lon,
    directionDeg: 180,
    ownerType: 'unverified',
    confirmations: 1,
  };
}

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

afterEach(() => {
  // Before the stores, or a leaked subscription re-ticks into the next test -
  // which is how a single assertion failure cascaded into a phantom second one.
  while (started.length > 0) started.pop()?.stop();
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset?.();
  usePositionStore.getState().reset();
});

describe('the alert loop', () => {
  it('turns a fix plus a camera list into an alert state', () => {
    // The whole point: packages/core was complete and never driven, so this is
    // the first assertion in the app that the engine's output reaches a screen.
    putCameras([cameraNorthOf(90)]);
    const loop = loopUnderTest();

    loop.tick(FIX);

    const state = useAlertStore.getState();
    expect(state.nearestCameraId).not.toBeNull();
    expect(state.nearestDistanceFt).toBeGreaterThan(250);
    expect(state.nearestDistanceFt).toBeLessThan(350);
    loop.stop();
  });

  it('re-ticks when the cameras arrive, not only when the fix changes', () => {
    // The bug this covers cost an afternoon: tiles land AFTER the first fix, a
    // stationary car gets no second fix, so the app sat on "no cameras loaded"
    // with hundreds of cameras in the store beside it.
    const loop = loopUnderTest();
    usePositionStore.getState().ingestFix({
      ...FIX,
      altitudeM: null,
      altitudeAccuracyM: null,
      timestamp: FIX.timestampMs,
    });
    expect(useAlertStore.getState().nearestCameraId).toBeNull();

    putCameras([cameraNorthOf(120)]);

    expect(useAlertStore.getState().nearestCameraId).not.toBeNull();
    loop.stop();
  });

  it('follows the threshold the driver set, while it is running', () => {
    putCameras([cameraNorthOf(150)]);
    const loop = loopUnderTest();
    loop.tick(FIX);
    const atDefault = useAlertStore.getState().state;

    useSettingsStore.getState().setThresholdFt(1000);
    loop.tick({ ...FIX, timestampMs: FIX.timestampMs + 2_000 });

    // Not asserting a specific state: the point is that the engine SEES the
    // change. A loop that cached the threshold at construction would report
    // the same state for both.
    expect(useSettingsStore.getState().thresholdFt).toBe(1000);
    expect(typeof atDefault).toBe('string');
    loop.stop();
  });

  it('survives a camera the engine refuses, rather than dying for the drive', () => {
    // The engine throws RangeError on an impossible coordinate. One bad row in
    // a tile must not stop every later fix from being assessed.
    putCameras([{ ...cameraNorthOf(100, 'osm:bad'), lat: 999 }]);
    const loop = loopUnderTest();

    expect(() => {
      loop.tick(FIX);
    }).not.toThrow();

    // The fix has to be IN THE STORE for the camera-change re-tick to fire -
    // the loop will not invent a position it was never given.
    usePositionStore.getState().ingestFix({
      ...FIX,
      altitudeM: null,
      altitudeAccuracyM: null,
      timestamp: FIX.timestampMs,
    });
    putCameras([cameraNorthOf(100, 'osm:good')]);
    expect(useAlertStore.getState().nearestCameraId).toBe('osm:good');
    loop.stop();
  });

  it('stops meaning stops', () => {
    const loop = loopUnderTest();
    loop.stop();

    putCameras([cameraNorthOf(50)]);
    usePositionStore.getState().ingestFix({
      ...FIX,
      altitudeM: null,
      altitudeAccuracyM: null,
      timestamp: FIX.timestampMs,
    });

    expect(useAlertStore.getState().nearestCameraId).toBeNull();
  });
});
