/**
 * ZONE AUDIT, wired to the real stores and to the real engine output shape.
 *
 * Nothing here renders a hand-built view model. The cameras go in through
 * `camerasActions.putTile()`, the fix through `positionActions.ingestFix()` and
 * the drive through `ingestAlertTick()` -- the same paths the driving loop uses
 * -- so a screen that agreed with a mock and disagreed with the engine would
 * fail here.
 *
 * The load-bearing test in this file is `muted cameras count`: the same zone is
 * audited twice, once silenced and once not, and the whole rendered panel is
 * compared. "Muting only removes the alert - never the record."
 *   -- Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockShare } from '../../services/adapters/testing/mocks.ts';
import { no } from '../../services/adapters/types.ts';
import { latLonToTile } from '../../stores/fwmCore.ts';
import {
  alertActions,
  camerasActions,
  historyActions,
  ingestAlertTick,
  positionActions,
  resetAllStores,
} from '../../stores';
import type { AlertTick, CameraAssessment, CameraRecord, TileEntry } from '../../stores';

import { ZoneAuditScreen } from './ZoneAuditScreen.tsx';
import { HEAT_CAPTION, HEAT_CAPTION_RECORDED } from './zone.ts';
import type { ZoneCsvBundle } from './zoneCsv.ts';

/** 19 Aug 2026, 09:30 local -- the date the card's footer prints. */
const NOW = new Date(2026, 7, 19, 9, 30).getTime();
const now = (): number => NOW;

const CENTRE = { lat: 39.1, lon: -84.58 };

/** Four cameras inside a 2 mi disc; one at 3 mi that only a 5 mi zone reaches. */
const CAMERAS: readonly CameraRecord[] = [
  {
    id: 'FWM-0442',
    lat: 39.11448,
    lon: -84.58,
    directionDeg: 180,
    ownerType: 'police',
    confirmations: 4,
  },
  { id: 'FWM-0118', lat: 39.1, lon: -84.56136, directionDeg: null, ownerType: 'inter_agency' },
  { id: 'FWM-0873', lat: 39.09276, lon: -84.58, directionDeg: null, ownerType: 'hoa' },
  { id: 'FWM-0901', lat: 39.1, lon: -84.60796, directionDeg: 0, ownerType: 'private' },
  { id: 'FWM-FAR', lat: 39.14344, lon: -84.58, directionDeg: null, ownerType: 'police' },
];

/**
 * The tile is ADDRESSED, not made up.
 *
 * `useZone` asks whether the cache holds the tile the zone centre falls in, so
 * a fixture with an arbitrary x/y would be a tile belonging to somewhere else
 * and the zone would correctly report that nobody has looked here.
 */
const TILE: TileEntry = {
  ref: latLonToTile(CENTRE.lat, CENTRE.lon, 16),
  cameras: CAMERAS,
  fetchedAtMs: NOW - 60_000,
  freshness: 'fresh',
  source: 'network',
};

/** The same cameras, filed under a tile 2,000 miles away. */
const TILE_ELSEWHERE: TileEntry = {
  ...TILE,
  ref: latLonToTile(37.7749, -122.4194, 16),
};

function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'FWM-0442',
    lat: 39.11448,
    lon: -84.58,
    distanceFt: 420,
    bearingDeg: 0,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 180,
    inRange: true,
    muted: false,
    mergedIds: ['FWM-0442'],
    ...over,
  };
}

function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment() : over.nearest;
  return {
    timestampMs: NOW,
    state: 'in_range',
    previousState: 'clear',
    changed: true,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: nearest === null ? 0 : 1,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: nearest !== null,
    hapticPulses: 2,
    notifyCameraIds: nearest === null ? [] : [nearest.id],
    suppressedBy: [],
    ...over,
  };
}

/** One camera passed: in range, then clear again. */
function drivePast(cameraId: string, atMs: number, distanceMi: number): void {
  ingestAlertTick(tick({ timestampMs: atMs, nearest: assessment({ id: cameraId }) }), {
    speedMph: 47,
    distanceMi,
  });
  ingestAlertTick(
    tick({
      timestampMs: atMs + 1000,
      state: 'clear',
      previousState: 'in_range',
      nearest: null,
      shouldAlertUser: false,
    }),
    { speedMph: 47 },
  );
}

function lock(): void {
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
}

/** A four-mile drive that reads FWM-0442 four times. */
function driveTheZone(): void {
  historyActions.startTrip(NOW - 900_000);
  drivePast('FWM-0442', NOW - 800_000, 1);
  drivePast('FWM-0442', NOW - 600_000, 1);
  drivePast('FWM-0442', NOW - 400_000, 1);
  drivePast('FWM-0442', NOW - 200_000, 1);
}

function seedZone(): void {
  camerasActions.putTile(TILE);
  lock();
  driveTheZone();
}

beforeEach(() => {
  resetAllStores();
});

afterEach(() => {
  // Unmount BEFORE resetting the stores: resetting under a still-mounted tree
  // is a React update outside `act`.
  cleanup();
  resetAllStores();
});

describe('wiring', () => {
  it('counts the cached cameras inside the radius, not a number of its own', () => {
    seedZone();

    const { container } = render(<ZoneAuditScreen now={now} />);

    expect(container.querySelector('[data-fwm-zone-card-hero="true"]')?.textContent).toBe('4');
    expect(screen.getByText('license plate readers within 2 miles.')).toBeInTheDocument();
  });

  it('buckets those cameras by the owner class the records carry', () => {
    seedZone();

    render(<ZoneAuditScreen now={now} />);

    const row = (label: string): string =>
      screen
        .getByText(label)
        .closest('.fwm-zone-card-row')
        ?.querySelector('.fwm-zone-card-row-value')?.textContent ?? '';
    expect(row('POLICE-OWNED')).toBe('1');
    expect(row('HOA / PRIVATE')).toBe('2');
    expect(row('SHARED TO OUTSIDE AGENCIES')).toBe('1');
    expect(row('FACING INBOUND TRAFFIC')).toBe('1');
  });

  it('heats the cell the reads happened in, at the rate the trip odometer divides to', () => {
    seedZone();

    const { container } = render(<ZoneAuditScreen now={now} />);

    const banded = [...container.querySelectorAll<HTMLElement>('.fwm-zone-heat-cell')].filter(
      (cell) => cell.dataset['fwmZoneHeatRank'] !== 'none',
    );
    expect(banded).toHaveLength(1);
    // Four reads over a four-mile drive: one read per mile, which is HEAVY.
    expect(banded[0]?.dataset['fwmZoneHeatReads']).toBe('4');
    expect(banded[0]?.dataset['fwmZoneHeatRank']).toBe('heavy');
  });

  it('widens the zone when the radius readout is pressed', () => {
    seedZone();

    const { container } = render(<ZoneAuditScreen now={now} />);
    fireEvent.click(screen.getByRole('button', { name: /2 MI RADIUS/ }));

    expect(screen.getByText('5 MI RADIUS')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-zone-card-hero="true"]')?.textContent).toBe('5');
    expect(screen.getByText('license plate readers within 5 miles.')).toBeInTheDocument();
  });

  it('turns the trip overlay off and on again', () => {
    seedZone();

    const { container } = render(<ZoneAuditScreen now={now} />);
    expect(
      container.querySelector<HTMLElement>('.fwm-zone-heat')?.dataset['fwmZoneTripOverlay'],
    ).toBe('on');

    fireEvent.click(screen.getByRole('button', { name: 'TRIP OVERLAY ON' }));

    expect(
      container.querySelector<HTMLElement>('.fwm-zone-heat')?.dataset['fwmZoneTripOverlay'],
    ).toBe('off');
  });
});

describe('muted cameras count', () => {
  it('renders an identical panel whether the drive was silenced or not', () => {
    seedZone();
    const loud = render(<ZoneAuditScreen now={now} />).container.innerHTML;
    cleanup();
    resetAllStores();

    camerasActions.putTile(TILE);
    lock();
    // Cover the whole run: the drive is thirteen minutes and the default mute
    // is ten.
    act(() => {
      alertActions.muteAll(NOW - 900_000, 3_600_000);
    });
    driveTheZone();
    const silenced = render(<ZoneAuditScreen now={now} />).container.innerHTML;

    expect(silenced).toBe(loud);
  });
});

describe('the heat layer in a build with no trip owner', () => {
  /* NOTHING IN THE PRODUCT CALLS `startTrip()`
   * (`docs/gaps-inbox/log.md#trip-lifecycle-has-no-owner`), so this is the
   * state every shipped build is in. The layer used to draw NOT ONE CELL in
   * it -- B6's most prominent element, permanently blank. */
  it('bands the reads it has actually recorded, with no trip open at all', () => {
    camerasActions.putTile(TILE);
    lock();
    drivePast('FWM-0442', NOW - 800_000, 1);
    drivePast('FWM-0442', NOW - 600_000, 1);

    const { container } = render(<ZoneAuditScreen now={now} />);

    const banded = [...container.querySelectorAll<HTMLElement>('.fwm-zone-heat-cell')].filter(
      (cell) => cell.dataset['fwmZoneHeatRank'] !== 'none',
    );
    expect(banded).toHaveLength(1);
    expect(banded[0]?.dataset['fwmZoneHeatReads']).toBe('2');
    expect(banded[0]?.dataset['fwmZoneHeatRank']).toBe('medium');
  });

  it('captions the count as a count, because nothing divided it by anything', () => {
    camerasActions.putTile(TILE);
    lock();
    drivePast('FWM-0442', NOW - 800_000, 1);

    render(<ZoneAuditScreen now={now} />);

    expect(screen.getByText(HEAT_CAPTION_RECORDED)).toBeInTheDocument();
    expect(screen.queryByText(HEAT_CAPTION)).not.toBeInTheDocument();
  });

  /* THE RATE IS THE TRIP'S RATE. A retained read count is all-time -- the
   * history slice survives sessions and days -- and one trip's odometer is one
   * drive. Dividing the first by the second overstates every cell by the ratio
   * of the two windows, on the one screen that exists to state surveillance
   * density accurately. */
  it('never divides yesterday reads by today miles', () => {
    camerasActions.putTile(TILE);
    lock();
    /* Twenty passes from before this drive, still in the retained log. */
    for (let pass = 0; pass < 20; pass++) {
      drivePast('FWM-0442', NOW - 86_400_000 - pass * 60_000, 0);
    }
    /* Then a ten mile drive that reads nothing at all. */
    historyActions.startTrip(NOW - 900_000);
    act(() => {
      historyActions.notePass('FWM-NONE', 10);
    });

    const { container } = render(<ZoneAuditScreen now={now} />);

    expect(screen.getByText(HEAT_CAPTION)).toBeInTheDocument();
    const banded = [...container.querySelectorAll<HTMLElement>('.fwm-zone-heat-cell')].filter(
      (cell) => cell.dataset['fwmZoneHeatRank'] !== 'none',
    );
    expect(banded).toHaveLength(0);
    expect(screen.getByText('NO READS RECORDED IN THIS ZONE YET')).toBeInTheDocument();
  });
});

describe('a zone that cannot be located', () => {
  it('says so instead of reporting a reassuring zero', () => {
    camerasActions.putTile(TILE);

    const { container } = render(<ZoneAuditScreen now={now} />);

    expect(container.querySelector('[data-fwm-zone-card-hero="true"]')?.textContent).toBe('—');
    expect(screen.getByText('NO FIX · ZONE NOT LOCATED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SHARE CARD' })).toBeDisabled();
  });

  it('distinguishes an empty cache from an empty zone', () => {
    lock();

    render(<ZoneAuditScreen now={now} />);

    expect(screen.getByText('NO CAMERAS CACHED FOR THIS ZONE')).toBeInTheDocument();
  });

  it('says the reads are missing once the cameras are not', () => {
    camerasActions.putTile(TILE);
    lock();

    render(<ZoneAuditScreen now={now} />);

    expect(screen.getByText('NO READS RECORDED IN THIS ZONE YET')).toBeInTheDocument();
  });

  /* THE REASSURING ZERO, REACHED THE OTHER WAY. A GLOBAL tile count is
   * non-zero for ever after one drive through another city, and a zone gated
   * on it prints a confident `0 license plate readers within 2 miles` about a
   * disc nobody ever fetched -- with SHARE CARD enabled to hand that claim to
   * somebody who does not have the app. */
  it('refuses to state a zone whose own tile was never cached', () => {
    camerasActions.putTile(TILE_ELSEWHERE);
    lock();
    const onExportCsv = vi.fn<(bundle: ZoneCsvBundle) => void>();

    const { container } = render(
      <ZoneAuditScreen now={now} share={createMockShare()} onExportCsv={onExportCsv} />,
    );

    expect(screen.getByText('NO CAMERAS CACHED FOR THIS ZONE')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-zone-card-hero="true"]')?.textContent).toBe('—');
    expect(screen.queryByText('license plate readers within 2 miles.')).toBeInTheDocument();
    /* Both keys are wired in this build and both refuse anyway: a zone the
     * screen will not put a number on is a zone it will not hand over in a
     * file either. */
    expect(screen.getByRole('button', { name: 'SHARE CARD' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EXPORT CSV' })).toBeDisabled();
    expect(onExportCsv).not.toHaveBeenCalled();
  });

  it('states the zone again as soon as this zone tile arrives', () => {
    camerasActions.putTile(TILE_ELSEWHERE);
    lock();
    camerasActions.putTile(TILE);

    const { container } = render(<ZoneAuditScreen now={now} />);

    expect(container.querySelector('[data-fwm-zone-card-hero="true"]')?.textContent).toBe('4');
  });
});

describe('SHARE CARD', () => {
  it('hands the adapter the reserved payload kind and no link at all', async () => {
    seedZone();
    const share = createMockShare();

    render(<ZoneAuditScreen now={now} share={share} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE CARD' }));

    await waitFor(() => {
      expect(share.shared()).toHaveLength(1);
    });
    const payload = share.shared()[0];
    expect(payload?.kind).toBe('zone-audit-card');
    expect(payload?.url).toBeUndefined();
    expect(payload?.files).toBeUndefined();
    expect(payload?.text).toContain('4 license plate readers within 2 miles.');
    await screen.findByText('CARD SHARED');
  });

  it('puts no coordinate and no plate in what it shares', async () => {
    seedZone();
    const share = createMockShare();

    render(<ZoneAuditScreen now={now} share={share} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE CARD' }));

    await waitFor(() => {
      expect(share.shared()).toHaveLength(1);
    });
    const text = share.shared()[0]?.text ?? '';
    expect(text).not.toContain('39.1');
    expect(text).not.toContain('84.58');
    expect(text).not.toMatch(/-?\d{2}\.\d{3,}/);
    expect(text).not.toMatch(/\b[A-Z]{3}[- ]?\d{3,4}\b/);
  });

  it('says sharing is unavailable rather than pretending it worked', async () => {
    seedZone();
    const share = createMockShare();
    share.mock.setCapability(no('the Web Share API is not available in this browser'));

    render(<ZoneAuditScreen now={now} share={share} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE CARD' }));

    await screen.findByText('SHARING IS NOT AVAILABLE ON THIS DEVICE');
  });

  it('says nothing at all when the user dismisses the sheet', async () => {
    seedZone();
    const share = createMockShare();
    share.setNextStatus('cancelled');

    const { container } = render(<ZoneAuditScreen now={now} share={share} />);
    fireEvent.click(screen.getByRole('button', { name: 'SHARE CARD' }));

    await waitFor(() => {
      expect(share.mock.subscribers()).toBeGreaterThanOrEqual(0);
    });
    expect(container.querySelector('.fwm-zone-notice')?.textContent).toBe('');
  });

  it('renders the key disabled when a build has switched sharing off', () => {
    seedZone();

    render(<ZoneAuditScreen now={now} share={null} />);

    expect(screen.getByRole('button', { name: 'SHARE CARD' })).toBeDisabled();
  });
});

describe('EXPORT CSV', () => {
  it('renders disabled when no sink is wired, and builds nothing', () => {
    seedZone();

    render(<ZoneAuditScreen now={now} />);

    expect(screen.getByRole('button', { name: 'EXPORT CSV' })).toBeDisabled();
  });

  it('hands the wired sink a bundle covering every camera in the zone', () => {
    seedZone();
    const onExportCsv = vi.fn<(bundle: ZoneCsvBundle) => void>();

    render(<ZoneAuditScreen now={now} onExportCsv={onExportCsv} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT CSV' }));

    expect(onExportCsv).toHaveBeenCalledTimes(1);
    const bundle = onExportCsv.mock.calls[0]?.[0];
    expect(bundle?.rows).toBe(4);
    expect(bundle?.filename).toBe('fwm-zone-audit-20260819.csv');
    expect(bundle?.text).toContain('"FWM-0442","police","yes","4","4"');
    expect(
      screen.getByText('CSV EXPORTED · CAMERA IDS ONLY, NO PLATE, NO COORDINATES'),
    ).toBeInTheDocument();
  });

  it('writes the rows in id order, not in the order the zone ranked them', () => {
    seedZone();
    const onExportCsv = vi.fn<(bundle: ZoneCsvBundle) => void>();

    render(<ZoneAuditScreen now={now} onExportCsv={onExportCsv} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT CSV' }));

    const text = onExportCsv.mock.calls[0]?.[0].text ?? '';
    const ids = text
      .split('\r\n')
      .slice(1)
      .filter((line) => line !== '')
      .map((line) => line.split(',')[0]?.replaceAll('"', '') ?? '');
    expect(ids).toEqual(['FWM-0118', 'FWM-0442', 'FWM-0873', 'FWM-0901']);
    /* Nearest first would put the half-mile camera on the first data row. */
    expect(ids[0]).not.toBe('FWM-0873');
  });

  it('exports no coordinate, so nothing downstream can recover where the driver is', () => {
    seedZone();
    const onExportCsv = vi.fn<(bundle: ZoneCsvBundle) => void>();

    render(<ZoneAuditScreen now={now} onExportCsv={onExportCsv} />);
    fireEvent.click(screen.getByRole('button', { name: 'EXPORT CSV' }));

    const text = onExportCsv.mock.calls[0]?.[0].text ?? '';
    expect(text).not.toContain('39.1');
    expect(text).not.toContain('84.58');
    expect(text.toLowerCase()).not.toContain('plate');
  });
});
