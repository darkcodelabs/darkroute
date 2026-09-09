/**
 * THE ARENA, DRIVEN FROM THE STORES.
 *
 * `ShellDock.detour.test.tsx`'s idiom: records into the cameras store, a fix
 * into the position store, the screen state initialised, and the assertions
 * made against the glass and the stores -- never against a hand-built view
 * model. What is pinned:
 *
 *   A TAP IS ONE SHOT, AND NOTHING ELSE. The record, the selection, the alert
 *   store, the vibration adapter: none of them hears about it.
 *   AN ALERT EMPTIES THE STACK. One delivering `ingest` tick and the canvas is
 *   gone in the same act, before anything painted.
 *   A FALSE GATE AT MOUNT CLOSES AT ONCE AND STARTS NO FRAME.
 *   MOTION CLOSES IT. Three miles an hour on the fix, mid-round.
 *   ESCAPE CLOSES IT.
 */

import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { disposeScreenState, initScreenState, topOverlay } from '../../app/screenState.ts';
import { alertActions, useAlertStore } from '../../stores/alert.ts';
import type { AlertTick } from '../../stores/alert.ts';
import { camerasActions, useCamerasStore } from '../../stores/cameras.ts';
import type { CameraAssessment, CameraRecord } from '../../stores/cameras.ts';
import { historyActions } from '../../stores/history.ts';
import { useNavigationStore } from '../../stores/navigation.ts';
import { positionActions, usePositionStore } from '../../stores/position.ts';
import {
  ARCADE_OVERLAY,
  ArcadeOverlay,
  closeArcade,
  liveArcadeRound,
  openArcade,
} from './ArcadeOverlay.tsx';

const FIX = { lat: 38.9181, lon: -94.6923, accuracyM: 8, timestampMs: 1_700_000_000_000 };

const RECORDS: readonly CameraRecord[] = [
  { id: 'osm:p0', lat: 38.9192, lon: -94.6923, directionDeg: 180, confirmations: 2, ownerType: 'police' },
  { id: 'osm:h1', lat: 38.921, lon: -94.688, directionDeg: 90, confirmations: 1, ownerType: 'hoa' },
  { id: 'osm:f2', lat: 38.93, lon: -94.7, directionDeg: 0, confirmations: 1, tags: { manufacturer: 'Flock Safety' } },
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

const ASSESSMENTS: readonly CameraAssessment[] = [
  assess('osm:p0', 400, 0, true),
  assess('osm:h1', 1500, 60, false),
  assess('osm:f2', 6000, 300, false),
];

/** Parked in range: the whole gate true, by the stores. */
function parkedInRange(): void {
  useCamerasStore.getState().putTiles([
    { ref: { z: 11, x: 484, y: 783 }, cameras: RECORDS, fetchedAtMs: FIX.timestampMs, freshness: 'fresh', source: 'network' },
  ]);
  camerasActions.applyAssessment({
    assessments: ASSESSMENTS,
    nearest: ASSESSMENTS[0] ?? null,
    countInRange: 1,
  });
  positionActions.ingestFix({
    lat: FIX.lat,
    lon: FIX.lon,
    accuracyM: FIX.accuracyM,
    altitudeM: null,
    altitudeAccuracyM: null,
    headingDeg: null,
    speedMps: 0,
    timestamp: FIX.timestampMs,
  });
  useAlertStore.setState({
    state: 'in_range',
    stationary: true,
    engineBlocked: true,
    suppressedBy: ['stationary'],
    nearestCameraId: 'osm:p0',
    nearestDistanceFt: 400,
    shouldAlertUser: false,
  });
}

/** A tick the engine would deliver: moving, in range, nothing suppressing it. */
function deliveringTick(): AlertTick {
  return {
    timestampMs: FIX.timestampMs + 10_000,
    state: 'in_range',
    previousState: 'clear',
    changed: true,
    nearest: ASSESSMENTS[0] ?? null,
    cameras: ASSESSMENTS,
    countInRange: 1,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 12,
    speedSource: 'gps',
    accuracyM: 8,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 2,
    notifyCameraIds: ['osm:p0'],
    suppressedBy: [],
  };
}

/** `App.tsx`'s ladder, in miniature: the overlay draws only while it is on top. */
function Host(): ReactElement | null {
  const top = useNavigationStore((s) => s.topOverlay);
  return top?.id === ARCADE_OVERLAY.id ? <ArcadeOverlay /> : null;
}

beforeEach(() => {
  disposeScreenState();
  initScreenState({ initialScreen: 'radar' });
  useNavigationStore.getState().sync();
  /* jsdom draws nothing; the simulation and the HUD do not need it to. */
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  useAlertStore.getState().reset();
  useCamerasStore.getState().reset();
  usePositionStore.getState().reset();
  disposeScreenState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a tap', () => {
  it('puts one shot in the air and tells no store, no record and no motor', () => {
    parkedInRange();
    const record = vi.spyOn(historyActions, 'record');
    const notePass = vi.spyOn(historyActions, 'notePass');
    const select = vi.spyOn(camerasActions, 'selectCamera');
    const alertSpies = Object.keys(alertActions).map((key) =>
      vi.spyOn(alertActions, key as keyof typeof alertActions),
    );
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...globalThis.navigator, vibrate, onLine: true });

    openArcade();
    const { container } = render(<Host />);
    const canvas = container.querySelector('canvas.fwm-arcade-canvas');
    expect(canvas).not.toBeNull();
    expect(liveArcadeRound()?.rocks.length).toBe(ASSESSMENTS.length);

    fireEvent.pointerDown(canvas as Element, { clientX: 40, clientY: -40 });
    expect(liveArcadeRound()?.bullets).toHaveLength(1);
    fireEvent.pointerDown(canvas as Element, { clientX: 40, clientY: -40 });
    /* The cadence: a second tap inside 160ms turns the nose and fires nothing. */
    expect(liveArcadeRound()?.bullets).toHaveLength(1);

    expect(record).not.toHaveBeenCalled();
    expect(notePass).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    for (const spy of alertSpies) expect(spy).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(useCamerasStore.getState().selectedCameraId).toBeNull();
  });

  it('lays the field from the two-mile set with the in-range nearest as the big rock', () => {
    parkedInRange();
    openArcade();
    render(<Host />);
    const round = liveArcadeRound();
    expect(round?.rocks.find((rock) => rock.size === 3)?.owner).toBe('police');
    expect(round?.rocks.map((rock) => rock.owner).sort()).toEqual(['flock', 'hoa', 'police']);
  });
});

describe('standing down', () => {
  it('is gone in the same act as a delivering alert tick', () => {
    parkedInRange();
    openArcade();
    const { container } = render(<Host />);
    expect(container.querySelector('canvas')).not.toBeNull();

    act(() => {
      alertActions.ingest(deliveringTick());
    });

    expect(topOverlay()).toBeNull();
    expect(useAlertStore.getState().takeover.active).toBe(true);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('.fwm-arcade')).toBeNull();
    expect(liveArcadeRound()).toBeNull();
  });

  it('closes at once on a false gate at mount and starts no frame', () => {
    parkedInRange();
    useAlertStore.setState({ stationary: false, suppressedBy: [] });
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    openArcade();
    expect(topOverlay()?.id).toBe('arcade');

    const { container } = render(<Host />);

    expect(topOverlay()).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it('closes when the fix reaches three miles an hour mid-round', () => {
    parkedInRange();
    openArcade();
    const { container } = render(<Host />);
    expect(container.querySelector('canvas')).not.toBeNull();

    act(() => {
      positionActions.ingestFix({
        lat: FIX.lat,
        lon: FIX.lon,
        accuracyM: FIX.accuracyM,
        altitudeM: null,
        altitudeAccuracyM: null,
        headingDeg: 10,
        speedMps: 1.35,
        timestamp: FIX.timestampMs + 1000,
      });
    });

    expect(usePositionStore.getState().speedMph).toBeGreaterThanOrEqual(3);
    expect(topOverlay()).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('closes on Escape', () => {
    parkedInRange();
    openArcade();
    const { container } = render(<Host />);
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(topOverlay()).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('closes on the close key, which carries the accessible name', () => {
    parkedInRange();
    openArcade();
    const { getByRole } = render(<Host />);
    fireEvent.click(getByRole('button', { name: 'Close pew' }));
    expect(topOverlay()).toBeNull();
  });

  it('opens once however many times it is asked, and closes cleanly when absent', () => {
    parkedInRange();
    openArcade();
    openArcade();
    expect(useNavigationStore.getState().overlays).toHaveLength(1);
    closeArcade();
    expect(useNavigationStore.getState().overlays).toHaveLength(0);
    closeArcade();
    expect(useNavigationStore.getState().overlays).toHaveLength(0);
  });
});
