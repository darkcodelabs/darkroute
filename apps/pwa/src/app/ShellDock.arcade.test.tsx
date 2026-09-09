/**
 * THE PEW KEY, END TO END: stores in, key on the dock, overlay raised.
 *
 * `useArcadeOffer` reads eight things off four stores and the dock's own
 * derivation; this drives all of them the way the app does and asks whether
 * the key is on the glass, whether pressing it raises exactly one overlay, and
 * whether it leaves again when the car moves.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openArcade } from '../features/arcade/ArcadeOverlay.tsx';
import { useAlertStore } from '../stores/alert.ts';
import { camerasActions, useCamerasStore } from '../stores/cameras.ts';
import type { CameraAssessment, CameraRecord } from '../stores/cameras.ts';
import { useNavigationStore } from '../stores/navigation.ts';
import { positionActions, usePositionStore } from '../stores/position.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { disposeScreenState, initScreenState, topOverlay } from './screenState.ts';
import { ShellDock } from './ShellDock.tsx';

const FIX = { lat: 38.9181, lon: -94.6923, accuracyM: 8, timestampMs: 1_700_000_000_000 };

const RECORDS: readonly CameraRecord[] = [
  { id: 'osm:p0', lat: 38.9192, lon: -94.6923, directionDeg: 180, confirmations: 2, ownerType: 'police' },
  { id: 'osm:h1', lat: 38.921, lon: -94.688, directionDeg: 90, confirmations: 1, ownerType: 'hoa' },
];

function assess(id: string, distanceFt: number, bearingDeg: number, inRange: boolean): CameraAssessment {
  const record = RECORDS.find((r) => r.id === id);
  return {
    id,
    lat: record?.lat ?? FIX.lat,
    lon: record?.lon ?? FIX.lon,
    distanceFt,
    bearingDeg,
    relativeDirection: null,
    facingVehicle: null,
    directionDeg: record?.directionDeg ?? null,
    inRange,
    muted: false,
    mergedIds: [id],
  };
}

const ASSESSMENTS: readonly CameraAssessment[] = [assess('osm:p0', 400, 0, true), assess('osm:h1', 1500, 60, false)];

function park(speedMps: number, stationary: boolean): void {
  useCamerasStore.getState().putTiles([
    { ref: { z: 11, x: 484, y: 783 }, cameras: RECORDS, fetchedAtMs: FIX.timestampMs, freshness: 'fresh', source: 'network' },
  ]);
  camerasActions.applyAssessment({ assessments: ASSESSMENTS, nearest: ASSESSMENTS[0] ?? null, countInRange: 1 });
  positionActions.ingestFix({
    lat: FIX.lat,
    lon: FIX.lon,
    accuracyM: FIX.accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    headingDeg: null,
    speedMps,
    timestamp: FIX.timestampMs,
  });
  useAlertStore.setState({
    state: 'in_range',
    stationary,
    engineBlocked: stationary,
    suppressedBy: stationary ? ['stationary'] : [],
    nearestCameraId: 'osm:p0',
    nearestDistanceFt: 400,
    shouldAlertUser: false,
  });
}

const KEY = /^Play pew at this reader$/;

beforeEach(() => {
  disposeScreenState();
  initScreenState({ initialScreen: 'radar' });
  useNavigationStore.getState().sync();
});

afterEach(() => {
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  useSettingsStore.getState().reset();
  disposeScreenState();
  vi.restoreAllMocks();
});

describe('the PEW key on the shell dock', () => {
  it('appears on dense while parked in range, and raises exactly one overlay', () => {
    park(0, true);
    render(<ShellDock />);

    const dock = document.querySelector('.fwm-dock');
    expect(dock?.getAttribute('data-fwm-state')).toBe('dense');
    const key = screen.getByRole('button', { name: KEY });

    fireEvent.click(key);
    expect(topOverlay()?.id).toBe('arcade');
    expect(useNavigationStore.getState().overlays).toHaveLength(1);

    openArcade();
    openArcade();
    expect(useNavigationStore.getState().overlays).toHaveLength(1);
    expect(useNavigationStore.getState().overlays[0]?.id).toBe('arcade');
  });

  it('is absent when the engine does not call the car parked', () => {
    park(0, false);
    render(<ShellDock />);
    expect(screen.queryByRole('button', { name: KEY })).toBeNull();
  });

  it('is absent when the fix says moving even though the engine still says parked', () => {
    park(1.8, true);
    render(<ShellDock />);
    expect(screen.queryByRole('button', { name: KEY })).toBeNull();
  });

  it('is absent off the map tab', () => {
    disposeScreenState();
    initScreenState({ initialScreen: 'log' });
    useNavigationStore.getState().sync();
    park(0, true);
    render(<ShellDock />);
    expect(screen.queryByRole('button', { name: KEY })).toBeNull();
  });

  it('leaves the dock when the car moves', () => {
    park(0, true);
    render(<ShellDock />);
    expect(screen.getByRole('button', { name: KEY })).toBeInTheDocument();
    act(() => {
      useAlertStore.setState({ stationary: false, suppressedBy: [] });
    });
    expect(screen.queryByRole('button', { name: KEY })).toBeNull();
  });
});
