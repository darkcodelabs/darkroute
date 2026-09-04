/**
 * REFERENTIAL STABILITY.
 *
 * A selector that allocates on every read makes every unrelated write a
 * re-render, and in this product an unrelated write is a GPS tick - four a
 * second on the node, one a second on the phone. The RADAR hero numeral
 * re-rendering because a tile arrived is not a performance nitpick; it is the
 * difference between a readable instrument and a flickering one.
 *
 * These tests assert it two ways: the selector returns the same reference, and
 * a component subscribed to it does not commit a second render.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { disposeScreenState, initScreenState } from '../app/screenState.ts';
import { alertActions, useAlertStore, useAlertState, useAlertTakeover } from './alert.ts';
import { camerasActions, useCamerasStore, useNearestCamera } from './cameras.ts';
import { createAlertEngine, createTestClock } from './fwmCore.ts';
import type { AlertTick, CameraLike } from './fwmCore.ts';
import { useGpsStatus, usePositionStore, positionActions } from './position.ts';
import { useSettingsStore } from './settings.ts';
import { syncActions, usePendingSyncCount } from './sync.ts';
import { resetAllStores } from './index.ts';

const CAMERA: CameraLike = { id: 'FWM-0442', lat: 39.11, lon: -84.5786, directionDeg: 180 };

function oneTick(lat: number, atMs: number): AlertTick {
  const clock = createTestClock(atMs);
  const engine = createAlertEngine({ clock });
  return engine.update(
    { lat, lon: -84.5786, headingDeg: 0, speedMps: 21, accuracyM: 4, timestampMs: atMs },
    [CAMERA],
  );
}

/** renderHook plus a commit counter. */
function renderCounted<T>(hook: () => T): { value: () => T; renders: () => number } {
  let renders = 0;
  const rendered = renderHook(() => {
    renders += 1;
    return hook();
  });
  return { value: () => rendered.result.current, renders: () => renders };
}

beforeEach(async () => {
  await useSettingsStore.persist.rehydrate();
  disposeScreenState();
  initScreenState({ initialScreen: 'radar' });
  resetAllStores();
});

afterEach(() => {
  disposeScreenState();
});

describe('useNearestCamera', () => {
  it('returns the same reference when unrelated camera state changes', () => {
    act(() => {
      alertActions.ingest(oneTick(39.1093, 1_000_000));
    });
    const before = useCamerasStore.getState().nearest;
    expect(before).not.toBeNull();

    act(() => {
      camerasActions.putTiles([
        {
          ref: { x: 1, y: 2, z: 14 },
          cameras: [{ id: 'FWM-0118', lat: 39.2, lon: -84.6, directionDeg: null }],
          fetchedAtMs: 1_000_001,
          freshness: 'fresh',
          source: 'network',
        },
      ]);
      camerasActions.setLoading(['14/1/3']);
      camerasActions.selectCamera('FWM-0118');
    });

    expect(useCamerasStore.getState().nearest).toBe(before);
  });

  it('does not re-render a subscriber when a tile arrives', () => {
    act(() => {
      alertActions.ingest(oneTick(39.1093, 1_000_000));
    });
    const hook = renderCounted(useNearestCamera);
    const initialRenders = hook.renders();
    expect(hook.value()).not.toBeNull();

    act(() => {
      camerasActions.putTiles([
        {
          ref: { x: 5, y: 6, z: 14 },
          cameras: [{ id: 'FWM-0873', lat: 39.3, lon: -84.7, directionDeg: null }],
          fetchedAtMs: 1_000_002,
          freshness: 'fresh',
          source: 'network',
        },
      ]);
    });

    expect(hook.renders()).toBe(initialRenders);
  });
});

describe('useAlertState', () => {
  it('does not re-render when a tick changes nothing about the state', () => {
    act(() => {
      alertActions.ingest(oneTick(39.1, 1_000_000));
    });
    const hook = renderCounted(useAlertState);
    const initialRenders = hook.renders();
    expect(hook.value()).toBe('clear');

    // Same state, later clock, more ticks - every field but `state` moves.
    act(() => {
      alertActions.ingest(oneTick(39.1, 1_002_000));
      alertActions.ingest(oneTick(39.1, 1_004_000));
    });

    expect(useAlertStore.getState().ticks).toBe(3);
    expect(hook.renders()).toBe(initialRenders);
  });
});

describe('useAlertTakeover', () => {
  it('returns the shared idle object while no alert is live', () => {
    const hook = renderCounted(useAlertTakeover);
    const initialRenders = hook.renders();
    const idle = hook.value();

    act(() => {
      alertActions.ingest(oneTick(39.1, 1_000_000));
      alertActions.ingest(oneTick(39.105, 1_002_000));
    });

    expect(useAlertStore.getState().takeover).toBe(idle);
    expect(hook.renders()).toBe(initialRenders);
  });
});

describe('usePendingSyncCount', () => {
  it('does not re-render when the queue list changes but the total does not', () => {
    act(() => {
      syncActions.setCounts({ reports: 2, actions: 0, total: 2, deadLettered: 0 });
    });
    const hook = renderCounted(usePendingSyncCount);
    const initialRenders = hook.renders();
    expect(hook.value()).toBe(2);

    act(() => {
      syncActions.setDrops([
        {
          reportId: 'drop-03',
          label: 'Vine St',
          capturedAt: '2026-08-19T14:22:08.412Z',
          syncState: 'pending',
          attempts: 0,
          hasPhoto: true,
          nextAttemptAtMs: null,
        },
      ]);
      syncActions.beginSync();
    });

    expect(hook.renders()).toBe(initialRenders);
  });
});

describe('useGpsStatus', () => {
  it('does not re-render when only the speed moves', () => {
    act(() => {
      positionActions.ingestFix({
        lat: 39.1,
        lon: -84.5786,
        accuracyM: 4,
        altitudeM: null,
        altitudeAccuracyM: null,
        speedMps: 21,
        headingDeg: 0,
        timestamp: 1_000_000,
      });
    });
    const hook = renderCounted(useGpsStatus);
    const initialRenders = hook.renders();
    expect(hook.value()).toBe('lock');

    act(() => {
      positionActions.ingestFix({
        lat: 39.1002,
        lon: -84.5786,
        accuracyM: 4,
        altitudeM: null,
        altitudeAccuracyM: null,
        speedMps: 24,
        headingDeg: 0,
        timestamp: 1_002_000,
      });
    });

    expect(usePositionStore.getState().speedMps).toBe(24);
    expect(hook.renders()).toBe(initialRenders);
  });
});
