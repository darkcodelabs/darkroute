/**
 * HEAT MAP -- B6's heat layer with the screen to itself, wired to the real
 * stores.
 *
 * No design file draws this screen, so the assertions below are as much about
 * what it does NOT draw as what it does: nothing on it may be a control B6 does
 * not draw, and the share card and the export live on ZONE AUDIT.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { latLonToTile } from '../../stores/fwmCore.ts';
import {
  camerasActions,
  historyActions,
  ingestAlertTick,
  positionActions,
  resetAllStores,
} from '../../stores';
import type { AlertTick, CameraAssessment, TileEntry } from '../../stores';

import { HeatMapScreen } from './HeatMapScreen.tsx';
import { HEAT_CAPTION, HEAT_CAPTION_RECORDED, HEAT_GRID_COLS, HEAT_GRID_ROWS } from './zone.ts';

const NOW = new Date(2026, 7, 19, 9, 30).getTime();

const CENTRE = { lat: 39.1, lon: -84.58 };

/* Addressed, not invented: the zone asks whether ITS tile is cached. */
const TILE: TileEntry = {
  ref: latLonToTile(CENTRE.lat, CENTRE.lon, 16),
  cameras: [
    { id: 'FWM-0442', lat: 39.11448, lon: -84.58, directionDeg: 180, ownerType: 'police' },
    { id: 'FWM-0118', lat: 39.1, lon: -84.56136, directionDeg: null, ownerType: 'inter_agency' },
  ],
  fetchedAtMs: NOW - 60_000,
  freshness: 'fresh',
  source: 'network',
};

function assessment(id: string): CameraAssessment {
  return {
    id,
    lat: 39.11448,
    lon: -84.58,
    distanceFt: 420,
    bearingDeg: 0,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 180,
    inRange: true,
    muted: false,
    mergedIds: [id],
  };
}

function tick(over: Partial<AlertTick>): AlertTick {
  return {
    timestampMs: NOW,
    state: 'in_range',
    previousState: 'clear',
    changed: true,
    nearest: assessment('FWM-0442'),
    cameras: [assessment('FWM-0442')],
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
    hapticPulses: 2,
    notifyCameraIds: ['FWM-0442'],
    suppressedBy: [],
    ...over,
  };
}

function seedZone(): void {
  camerasActions.putTile(TILE);
  positionActions.ingestFix({
    lat: CENTRE.lat,
    lon: CENTRE.lon,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: 21,
    headingDeg: 0,
    timestamp: NOW,
  });
  historyActions.startTrip(NOW - 600_000);
  ingestAlertTick(tick({ timestampMs: NOW - 500_000 }), { speedMph: 47, distanceMi: 2 });
  ingestAlertTick(
    tick({
      timestampMs: NOW - 499_000,
      state: 'clear',
      previousState: 'in_range',
      nearest: null,
      cameras: [],
      countInRange: 0,
      shouldAlertUser: false,
      notifyCameraIds: [],
    }),
    { speedMph: 47 },
  );
}

beforeEach(() => {
  resetAllStores();
});

afterEach(() => {
  cleanup();
  resetAllStores();
});

describe('the screen', () => {
  it('names itself after the key that opens it', () => {
    seedZone();

    render(<HeatMapScreen />);

    expect(screen.getByRole('heading', { name: 'HEAT MAP' })).toBeInTheDocument();
  });

  it('gives the layer the whole body and draws the same grid ZONE AUDIT draws', () => {
    seedZone();

    const { container } = render(<HeatMapScreen />);

    expect(container.querySelector<HTMLElement>('.fwm-zone')?.dataset['fwmZoneScreen']).toBe(
      'heat-map',
    );
    expect(container.querySelectorAll('.fwm-zone-heat-cell')).toHaveLength(
      HEAT_GRID_COLS * HEAT_GRID_ROWS,
    );
    expect(screen.getByText(HEAT_CAPTION)).toBeInTheDocument();
  });

  it('keeps B6 legend and B6 radius readout, and no other control', () => {
    seedZone();

    render(<HeatMapScreen />);

    expect(screen.getByText('LOW')).toBeInTheDocument();
    expect(screen.getByText('MEDIUM')).toBeInTheDocument();
    expect(screen.getByText('HEAVY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TRIP OVERLAY ON' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /2 MI RADIUS/ })).toBeEnabled();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('draws no share card and no export, which live on ZONE AUDIT', () => {
    seedZone();

    const { container } = render(<HeatMapScreen />);

    expect(container.querySelector('[data-fwm-zone-card="true"]')).toBeNull();
    expect(screen.queryByText('SHARE CARD')).not.toBeInTheDocument();
    expect(screen.queryByText('EXPORT CSV')).not.toBeInTheDocument();
    expect(screen.queryByText('SHARE CARD - RENDERS AS AN IMAGE')).not.toBeInTheDocument();
  });

  it('changes the radius from its own header', () => {
    seedZone();

    render(<HeatMapScreen />);
    fireEvent.click(screen.getByRole('button', { name: /2 MI RADIUS/ }));

    expect(screen.getByText('5 MI RADIUS')).toBeInTheDocument();
  });

  it('says why it is empty rather than drawing a heat that was never measured', () => {
    camerasActions.putTile(TILE);

    const { container } = render(<HeatMapScreen />);

    expect(screen.getByText('NO FIX · ZONE NOT LOCATED')).toBeInTheDocument();
    expect(container.querySelectorAll('.fwm-zone-heat-cell')).toHaveLength(0);
  });

  /* The whole screen is the layer, so a layer that can never draw is a screen
   * that is a header, an empty box and a legend for ever. No product code
   * opens a trip (`docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner`), which
   * is the state this asserts against. */
  it('draws a banded grid with no trip open, which is every shipped build', () => {
    camerasActions.putTile(TILE);
    positionActions.ingestFix({
      lat: CENTRE.lat,
      lon: CENTRE.lon,
      accuracyM: 4,
      altitudeM: null,
      altitudeAccuracyM: null,
      speedMps: 21,
      headingDeg: 0,
      timestamp: NOW,
    });
    ingestAlertTick(tick({ timestampMs: NOW - 500_000 }), { speedMph: 47 });
    ingestAlertTick(
      tick({
        timestampMs: NOW - 499_000,
        state: 'clear',
        previousState: 'in_range',
        nearest: null,
        cameras: [],
        countInRange: 0,
        shouldAlertUser: false,
        notifyCameraIds: [],
      }),
      { speedMph: 47 },
    );

    const { container } = render(<HeatMapScreen />);

    expect(container.querySelectorAll('.fwm-zone-heat-cell')).toHaveLength(
      HEAT_GRID_COLS * HEAT_GRID_ROWS,
    );
    expect(
      [...container.querySelectorAll<HTMLElement>('.fwm-zone-heat-cell')].filter(
        (cell) => cell.dataset['fwmZoneHeatRank'] !== 'none',
      ),
    ).toHaveLength(1);
    expect(screen.getByText(HEAT_CAPTION_RECORDED)).toBeInTheDocument();
  });

  it('renders not one inline style', () => {
    seedZone();

    const { container } = render(<HeatMapScreen />);

    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });
});
