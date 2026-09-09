/**
 * TRIAGE, wired to the real stores and driven through the real ingest path.
 *
 * Nothing here renders a hand-built view model. Every figure on the screen is
 * asserted after driving `camerasActions.putTiles()` + `ingestAlertTick()` --
 * the same two calls the driving loop makes -- so a screen that agreed with a
 * mock and disagreed with the engine would fail here.
 *
 * The subject of most of it is one sentence this screen prints on itself:
 * "Muting only removes the alert - never the record."
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  camerasActions,
  historyActions,
  ingestAlertTick,
  resetAllStores,
  useSettingsStore,
} from '../../stores';
import type {
  AlertState,
  AlertTick,
  CameraAssessment,
  CameraOwnerType,
  CameraRecord,
} from '../../stores';

import { TriageScreen } from './TriageScreen.tsx';

const NOW = 1_760_000_000_000;

/** The four cameras this drive goes past: two police, two HOA. */
const CAMERAS: readonly CameraRecord[] = [
  { id: 'FWM-0001', lat: 39.1, lon: -84.58, directionDeg: 221, ownerType: 'police' },
  { id: 'FWM-0002', lat: 39.11, lon: -84.58, directionDeg: 221, ownerType: 'police' },
  { id: 'FWM-0003', lat: 39.12, lon: -84.58, directionDeg: null, ownerType: 'hoa' },
  { id: 'FWM-0004', lat: 39.13, lon: -84.58, directionDeg: null, ownerType: 'hoa' },
];

function cacheCameras(cameras: readonly CameraRecord[] = CAMERAS): void {
  camerasActions.putTiles([
    {
      ref: { z: 14, x: 4324, y: 6291 },
      cameras,
      fetchedAtMs: NOW,
      freshness: 'fresh',
      source: 'fixture',
    },
  ]);
}

function assessment(cameraId: string): CameraAssessment {
  return {
    id: cameraId,
    lat: 39.1,
    lon: -84.58,
    distanceFt: 425,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: true,
    muted: false,
    mergedIds: [cameraId],
  };
}

function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment('FWM-0001') : over.nearest;
  const state: AlertState = over.state ?? 'in_range';
  return {
    timestampMs: NOW,
    state,
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: 1,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: true,
    hapticPulses: 1,
    notifyCameraIds: [nearest === null ? '' : nearest.id],
    suppressedBy: [],
    ...over,
  };
}

/**
 * Drive past each camera in turn: one in-range episode each, separated by a
 * drop back to clear so the next one is a NEW episode and therefore a pass.
 */
function drivePast(cameraIds: readonly string[]): void {
  let atMs = NOW;
  for (const cameraId of cameraIds) {
    atMs += 60_000;
    ingestAlertTick(
      tick({ timestampMs: atMs, nearest: assessment(cameraId), previousState: 'clear' }),
    );
    atMs += 60_000;
    ingestAlertTick(
      tick({ timestampMs: atMs, state: 'clear', previousState: 'in_range', nearest: null }),
    );
  }
}

function ownerRow(container: HTMLElement, ownerType: CameraOwnerType): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-fwm-triage-owner="${ownerType}"]`);
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

function projectionValue(container: HTMLElement): string {
  return container.querySelector<HTMLElement>('.fwm-triage-projection-value')?.textContent ?? '';
}

beforeEach(() => {
  resetAllStores();
});

afterEach(() => {
  resetAllStores();
});

describe('the projection comes off the recorded drive', () => {
  it('counts the drive that actually happened, not a sample', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0002', 'FWM-0003', 'FWM-0004']);

    const { container } = render(<TriageScreen />);

    // Four cameras, one drive, every class on: four alerts, filtering nothing.
    expect(projectionValue(container)).toBe('4');
    expect(screen.getByText('nothing filtered out')).toBeInTheDocument();
  });

  it('drops the switched-off class out of the projection and says what it was', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0002', 'FWM-0003', 'FWM-0004']);
    useSettingsStore.getState().setOwnerTypeEnabled('hoa', false);

    const { container } = render(<TriageScreen />);

    expect(projectionValue(container)).toBe('2');
    expect(screen.getByText('down from 4')).toBeInTheDocument();
    // The trip is still open, so both figures are counts of a drive that is
    // still happening. The caption says which, rather than letting the
    // PROJECTED eyebrow imply a rate over drives nothing has measured.
    expect(screen.getByText('this drive so far')).toBeInTheDocument();
    expect(screen.queryByText('with current filters')).not.toBeInTheDocument();
  });

  it('prints the design"s qualifier once the drive it counted has ended', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0002', 'FWM-0003', 'FWM-0004']);
    useSettingsStore.getState().setOwnerTypeEnabled('hoa', false);
    historyActions.endTrip(NOW + 3_600_000);

    const { container } = render(<TriageScreen />);

    expect(projectionValue(container)).toBe('2');
    expect(screen.getByText('down from 4')).toBeInTheDocument();
    expect(screen.getByText('with current filters')).toBeInTheDocument();
    expect(screen.queryByText('this drive so far')).not.toBeInTheDocument();
  });

  it('reads zero at the kerb and says the drive has had no cameras YET', () => {
    cacheCameras();
    historyActions.startTrip(NOW);

    const { container } = render(<TriageScreen />);

    // A drive that has just started is not a projection of nothing: it is a
    // count that has not counted anything yet, and it says so.
    expect(projectionValue(container)).toBe('0');
    expect(screen.getByText('no cameras yet this drive')).toBeInTheDocument();
  });

  it('counts distinct cameras of a class out of the log for the routes caption', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    // The same HOA camera twice, plus a second one: two cameras, three passes.
    drivePast(['FWM-0003', 'FWM-0003', 'FWM-0004']);

    const { container } = render(<TriageScreen />);

    expect(
      within(ownerRow(container, 'hoa')).getByText('2 on your usual routes'),
    ).toBeInTheDocument();
  });

  it('says there is no drive rather than printing a projection it cannot make', () => {
    cacheCameras();
    // Cameras were passed, but no trip was ever started, so there is no drive
    // to divide by. The hero says so instead of inventing a denominator.
    drivePast(['FWM-0001', 'FWM-0002']);

    const { container } = render(<TriageScreen />);

    expect(projectionValue(container)).toBe('—');
    expect(screen.getByText('no drives on record')).toBeInTheDocument();
  });

  it('em-dashes a class whose zero would be a statement about the tile cache', () => {
    // The device still holds the two POLICE records and has lost the two HOA
    // ones -- ordinary partial eviction. Something resolves, so a whole-log
    // guard would happily print `0 on your usual routes` for HOA.
    cacheCameras(CAMERAS.filter((camera) => camera.ownerType === 'police'));
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0003', 'FWM-0004']);

    const { container } = render(<TriageScreen />);

    expect(
      within(ownerRow(container, 'hoa')).getByText('— on your usual routes'),
    ).toBeInTheDocument();
    // ...and the passes it could not attribute still count in the projection.
    expect(projectionValue(container)).toBe('3');
  });

  it('keeps alerting on a camera whose record this device no longer holds', () => {
    // No tiles cached at all: the owner class of every pass is unresolvable.
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0002']);
    useSettingsStore.getState().setOwnerTypeEnabled('police', false);

    const { container } = render(<TriageScreen />);

    // An unknown class is not a silenced class.
    expect(projectionValue(container)).toBe('2');
    // ...and the count that cannot be resolved says so rather than reading 0.
    expect(
      within(ownerRow(container, 'hoa')).getByText('— on your usual routes'),
    ).toBeInTheDocument();
  });
});

describe('a switch removes the alert and nothing else', () => {
  it('leaves the baseline and every row in place with all five switched off', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0002', 'FWM-0003', 'FWM-0004']);
    for (const owner of ['police', 'inter_agency', 'hoa', 'private', 'unverified'] as const) {
      useSettingsStore.getState().setOwnerTypeEnabled(owner, false);
    }

    const { container } = render(<TriageScreen />);

    expect(projectionValue(container)).toBe('0');
    // The record is untouched: still four alerts on that drive.
    expect(screen.getByText('down from 4')).toBeInTheDocument();
    expect(container.querySelectorAll('.fwm-triage-owner')).toHaveLength(5);
    expect(
      within(ownerRow(container, 'hoa')).getByText('2 on your usual routes'),
    ).toBeInTheDocument();
  });

  it('writes one boolean into settings on a press, and touches nothing else', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001']);

    render(<TriageScreen />);
    expect(useSettingsStore.getState().ownerTypesEnabled.police).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'POLICE / AGENCY' }));

    const settings = useSettingsStore.getState();
    expect(settings.ownerTypesEnabled.police).toBe(false);
    // Every other switch, the mute timers and the threshold are where they were.
    expect(settings.ownerTypesEnabled.hoa).toBe(true);
    expect(settings.mutedUntilMs).toBeNull();
    expect(settings.reAlertWhenCloserThanFt).toBe(150);
  });
});

describe('a muted drive is recorded and counted exactly like an audible one', () => {
  it('produces the same figures as the identical unmuted drive', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0002', 'FWM-0003']);

    const audible = render(<TriageScreen />);
    const audibleProjection = projectionValue(audible.container);
    const audibleRoutes =
      within(ownerRow(audible.container, 'hoa')).getByText(/on your usual routes/).textContent;
    audible.unmount();

    resetAllStores();
    cacheCameras();
    historyActions.startTrip(NOW);
    useSettingsStore.getState().muteAll(NOW);
    drivePast(['FWM-0001', 'FWM-0002', 'FWM-0003']);

    const muted = render(<TriageScreen />);

    expect(projectionValue(muted.container)).toBe(audibleProjection);
    expect(
      within(ownerRow(muted.container, 'hoa')).getByText(/on your usual routes/).textContent,
    ).toBe(audibleRoutes);
  });
});

describe('RE-ALERT ON MUTED IF', () => {
  it('renders the stored distance', () => {
    render(<TriageScreen />);

    expect(screen.getByRole('switch', { name: 'RE-ALERT ON MUTED IF' })).toBeChecked();
    expect(screen.getByText('closer than 150 ft')).toBeInTheDocument();
  });

  it('switches off to a distance no mute can be pierced by', () => {
    render(<TriageScreen />);

    fireEvent.click(screen.getByRole('switch', { name: 'RE-ALERT ON MUTED IF' }));

    expect(useSettingsStore.getState().reAlertWhenCloserThanFt).toBe(0);
    expect(screen.getByText('muted stays muted')).toBeInTheDocument();
  });

  it('gives back the distance the driver had chosen, not the default', () => {
    useSettingsStore.getState().setReAlertWhenCloserThanFt(300);

    render(<TriageScreen />);
    const control = screen.getByRole('switch', { name: 'RE-ALERT ON MUTED IF' });

    fireEvent.click(control);
    expect(useSettingsStore.getState().reAlertWhenCloserThanFt).toBe(0);

    fireEvent.click(control);
    expect(useSettingsStore.getState().reAlertWhenCloserThanFt).toBe(300);
  });
});

describe('privacy', () => {
  it('names owner classes and counts, never an individual camera', () => {
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001', 'FWM-0003']);

    const { container } = render(<TriageScreen />);

    for (const camera of CAMERAS) {
      expect(container.textContent).not.toContain(camera.id);
    }
  });

  it('writes nothing to the URL', () => {
    const before = window.location.search;
    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001']);

    render(<TriageScreen />);
    fireEvent.click(screen.getByRole('switch', { name: 'POLICE / AGENCY' }));

    expect(window.location.search).toBe(before);
  });
});

describe('this screen asks the platform for nothing', () => {
  it('requests no permission, starts no sensor and buzzes nothing on mount', () => {
    const getCurrentPosition = vi.fn();
    const watchPosition = vi.fn();
    const vibrate = vi.fn();
    const requestPermission = vi.fn();

    vi.stubGlobal('navigator', {
      ...navigator,
      geolocation: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
      vibrate,
      permissions: { query: requestPermission },
    });

    cacheCameras();
    historyActions.startTrip(NOW);
    drivePast(['FWM-0001']);
    render(<TriageScreen />);

    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });
});
