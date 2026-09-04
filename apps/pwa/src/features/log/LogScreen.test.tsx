/**
 * LOG, wired to the real stores and to the real engine output shape.
 *
 * Nothing here renders a hand-built view model. Every assertion goes through
 * the same path the driving loop uses -- `ingestAlertTick()` -- so a screen that
 * agreed with a mock and disagreed with the engine would fail here.
 *
 * The load-bearing test in this file is `muted cameras still count`: the same
 * drive is run twice, once silenced and once not, and the whole rendered panel
 * is compared. "Muting only removes the alert - never the record."
 *   -- Flockys Screens II.dc.html, B4 · ALERT TRIAGE
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { disposeScreenState, initScreenState } from '../../app/screenState.ts';
import {
  alertActions,
  historyActions,
  ingestAlertTick,
  resetAllStores,
  useHistoryStore,
  useNavigationStore,
} from '../../stores';
import type { AlertTick, CameraAssessment } from '../../stores';

import type { AllTimeExposurePort } from './allTimeExposure.ts';
import { LogScreen } from './LogScreen.tsx';

/** 4 Mar 2026, 14:22:08 local -- the clock the panel's first row renders. */
const NOW = new Date(2026, 2, 4, 14, 22, 8).getTime();
const now = (): number => NOW;

function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'cam-1',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 380,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: true,
    muted: false,
    mergedIds: ['cam-1'],
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

interface Pass {
  readonly id: string;
  readonly label: string;
  readonly atMs: number;
  readonly distanceFt: number;
  readonly speedMph: number;
}

/**
 * One camera, passed. In range, then clear again -- which is what makes the
 * next camera a new episode rather than a continuation of this one.
 */
function drivePast(pass: Pass): void {
  ingestAlertTick(
    tick({
      timestampMs: pass.atMs,
      state: 'in_range',
      previousState: 'clear',
      nearest: assessment({ id: pass.id, distanceFt: pass.distanceFt }),
    }),
    { labelFor: () => pass.label, speedMph: pass.speedMph, distanceMi: 0.4 },
  );
  ingestAlertTick(
    tick({
      timestampMs: pass.atMs + 1000,
      state: 'clear',
      previousState: 'in_range',
      nearest: null,
      shouldAlertUser: false,
    }),
    { speedMph: pass.speedMph },
  );
}

/**
 * One camera come up on and never entered range of -- the design's middle
 * timeline row, `Reading Rd` at 760 FT against the 500 FT threshold.
 */
function driveNear(pass: Pass): void {
  ingestAlertTick(
    tick({
      timestampMs: pass.atMs,
      state: 'approaching',
      previousState: 'clear',
      nearest: assessment({ id: pass.id, distanceFt: pass.distanceFt, inRange: false }),
      countInRange: 0,
      shouldAlertUser: false,
      hapticPulses: 1,
    }),
    { labelFor: () => pass.label, speedMph: pass.speedMph, distanceMi: 0.4 },
  );
  ingestAlertTick(
    tick({
      timestampMs: pass.atMs + 1000,
      state: 'clear',
      previousState: 'approaching',
      nearest: null,
      shouldAlertUser: false,
    }),
    { speedMph: pass.speedMph },
  );
}

/** A durable ALL TIME read, injected so no test opens a database. */
function allTimePort(read: Awaited<ReturnType<AllTimeExposurePort>>): AllTimeExposurePort {
  return () => Promise.resolve(read);
}

const NO_DURABLE_READ: AllTimeExposurePort = allTimePort({
  status: 'unavailable',
  reason: 'no trip has been recorded on this device yet',
});

/** The three cameras the design's timeline draws, in the order they happened. */
const DRIVE: readonly Pass[] = [
  { id: 'cam-71', label: 'I-71 N Exit 3', atMs: NOW - 1440_000, distanceFt: 210, speedMph: 62 },
  { id: 'cam-reading', label: 'Reading Rd', atMs: NOW - 737_000, distanceFt: 760, speedMph: 38 },
  { id: 'cam-vine', label: 'Vine St & 7th', atMs: NOW, distanceFt: 380, speedMph: 47 },
];

function driveTheDesignsDrive(): void {
  historyActions.startTrip(DRIVE[0]?.atMs ?? NOW);
  for (const pass of DRIVE) drivePast(pass);
}

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.fwm-log-row')];
}

/** The drive is 24 minutes long; the default mute is ten. Cover the whole run. */
const MUTE_MS = 3_600_000;

beforeEach(() => {
  disposeScreenState();
  resetAllStores();
});

afterEach(() => {
  // Unmount BEFORE resetting the stores. Vitest runs this file's hook ahead of
  // the shared `cleanup()` in `src/test/setup.ts`, and resetting a store under a
  // still-mounted tree is a React update outside `act`.
  cleanup();
  disposeScreenState();
  resetAllStores();
});

describe('wiring', () => {
  it('renders the passes the driving loop recorded, newest first', () => {
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);

    const drawn = rows(container);
    expect(drawn).toHaveLength(3);
    expect(within(drawn[0] as HTMLElement).getByText('Vine St & 7th')).toBeInTheDocument();
    expect(
      within(drawn[0] as HTMLElement).getByText('14:22:08 · 47 MPH · 380 FT'),
    ).toBeInTheDocument();
    expect(within(drawn[2] as HTMLElement).getByText('I-71 N Exit 3')).toBeInTheDocument();
  });

  it('renders the exposure counters the alert slice kept, not a count of its own', () => {
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);

    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('3');
    expect(screen.getByText('CAMERAS · 3 UNIQUE')).toBeInTheDocument();
  });

  it('puts the whole drive into today and the peak into the last bar of the week', () => {
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);
    const bars = [...container.querySelectorAll<HTMLElement>('.fwm-log-bar')];

    expect(bars).toHaveLength(7);
    expect(bars[6]?.dataset['fwmLogBarPasses']).toBe('3');
    expect(bars[6]?.dataset['fwmLogBarRank']).toBe('peak');
    expect(bars[0]?.dataset['fwmLogBarLevel']).toBe('0');
  });

  it('names the segment the driver was read on most often', () => {
    historyActions.startTrip(NOW - 3_600_000);
    drivePast({
      id: 'cam-a',
      label: 'Reading Rd',
      atMs: NOW - 60_000,
      distanceFt: 500,
      speedMph: 38,
    });
    drivePast({
      id: 'cam-b',
      label: 'Reading Rd',
      atMs: NOW - 40_000,
      distanceFt: 420,
      speedMph: 38,
    });
    drivePast({
      id: 'cam-c',
      label: 'Vine St & 7th',
      atMs: NOW - 20_000,
      distanceFt: 380,
      speedMph: 47,
    });

    const { container } = render(<LogScreen now={now} />);

    expect(container.querySelector('[data-fwm-log-segment-name="true"]')?.textContent).toBe(
      'Reading Rd',
    );
    expect(screen.getByText('2 CAMS / — MI')).toBeInTheDocument();
  });

  it('takes the all-time total from the durable count rather than from the rows on screen', () => {
    historyActions.hydrate([], 1284, new Date(2026, 2, 1).getTime());
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);

    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe('1,287');
    expect(screen.getByText('SINCE MAR 2026')).toBeInTheDocument();
  });

  it('renders nothing before anything has been recorded', () => {
    const { container } = render(<LogScreen now={now} />);

    expect(rows(container)).toHaveLength(0);
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('0');
    // No trip has been started, so the screen opens on ALL TIME -- which is
    // also empty, and says which window it is talking about.
    expect(screen.getByText('NO CAMERAS RECORDED')).toBeInTheDocument();
  });
});

describe('muted cameras still count', () => {
  function renderTheDrive(silenced: boolean): string {
    resetAllStores();
    if (silenced) alertActions.muteAll(DRIVE[0]?.atMs ?? NOW, MUTE_MS);
    driveTheDesignsDrive();
    const view = render(<LogScreen now={now} />);
    const html = (view.container.querySelector('.fwm-log') as HTMLElement).innerHTML;
    view.unmount();
    return html;
  }

  it('produces a byte-identical panel whether or not the driver heard the alerts', () => {
    const audible = renderTheDrive(false);
    const silenced = renderTheDrive(true);

    expect(silenced.replaceAll('data-fwm-log-muted="true"', 'data-fwm-log-muted="false"')).toBe(
      audible,
    );
  });

  it('records the mute on the row without removing the row', () => {
    alertActions.muteAll(DRIVE[0]?.atMs ?? NOW, MUTE_MS);
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);

    expect(rows(container)).toHaveLength(3);
    expect(rows(container)[0]?.dataset['fwmLogMuted']).toBe('true');
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('3');
  });
});

describe('CONF / DISM', () => {
  it('records the outcome against the row the driver ruled on', () => {
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);
    const first = rows(container)[0] as HTMLElement;
    const id = Number(first.dataset['fwmLogRow']);

    fireEvent.click(within(first).getByText('CONF'));

    expect(useHistoryStore.getState().entries.find((e) => e.id === id)?.outcome).toBe('confirmed');
    expect(within(rows(container)[0] as HTMLElement).getByText('CONF')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('lets a row be re-ruled without touching any other row', () => {
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);
    const first = rows(container)[0] as HTMLElement;

    fireEvent.click(within(first).getByText('CONF'));
    fireEvent.click(within(rows(container)[0] as HTMLElement).getByText('DISM'));

    expect(rows(container)[0]?.dataset['fwmLogOutcome']).toBe('dismissed');
    expect(rows(container)[1]?.dataset['fwmLogOutcome']).toBe('none');
  });
});

describe('TRIP / ALL TIME', () => {
  it('shows only this trip under TRIP and the whole log under ALL TIME', () => {
    // A camera from before the trip started.
    drivePast({
      id: 'cam-old',
      label: 'Old Rd',
      atMs: NOW - 7_200_000,
      distanceFt: 400,
      speedMph: 30,
    });
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);
    expect(rows(container)).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'ALL TIME' }));
    expect(rows(container)).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'TRIP' }));
    expect(rows(container)).toHaveLength(3);
  });

  it('leaves the seven-day trend alone, because a trend is not a trip', () => {
    drivePast({
      id: 'cam-old',
      label: 'Old Rd',
      atMs: NOW - 7_200_000,
      distanceFt: 400,
      speedMph: 30,
    });
    driveTheDesignsDrive();

    const { container } = render(<LogScreen now={now} />);
    const before =
      container.querySelector<HTMLElement>('.fwm-log-bar:last-child')?.dataset['fwmLogBarPasses'];

    fireEvent.click(screen.getByRole('button', { name: 'ALL TIME' }));

    expect(
      container.querySelector<HTMLElement>('.fwm-log-bar:last-child')?.dataset['fwmLogBarPasses'],
    ).toBe(before);
  });

  it('says a trip that has not started is empty rather than showing the whole log', () => {
    drivePast({
      id: 'cam-old',
      label: 'Old Rd',
      atMs: NOW - 60_000,
      distanceFt: 400,
      speedMph: 30,
    });

    const { container } = render(<LogScreen now={now} />);

    fireEvent.click(screen.getByRole('button', { name: 'TRIP' }));

    expect(rows(container)).toHaveLength(0);
    expect(screen.getByText('NO TRIP IN PROGRESS')).toBeInTheDocument();
  });

  it('opens on the scope that has something in it: TRIP with a drive running', () => {
    driveTheDesignsDrive();

    render(<LogScreen now={now} />);

    expect(screen.getByRole('button', { name: 'TRIP' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens on ALL TIME when nothing ever started a trip, rather than on four blank surfaces', () => {
    drivePast({
      id: 'cam-old',
      label: 'Old Rd',
      atMs: NOW - 60_000,
      distanceFt: 400,
      speedMph: 30,
    });

    const { container } = render(<LogScreen now={now} />);

    expect(screen.getByRole('button', { name: 'ALL TIME' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(rows(container)).toHaveLength(1);
    expect(container.querySelector('[data-fwm-log-segment-name="true"]')?.textContent).toBe(
      'Old Rd',
    );
  });
});

describe('HEAT MAP and ZONE AUDIT', () => {
  it('navigates through the one navigation model', () => {
    render(<LogScreen now={now} />);

    fireEvent.click(screen.getByRole('button', { name: 'HEAT MAP' }));
    expect(useNavigationStore.getState().screen).toBe('heat-map');

    fireEvent.click(screen.getByRole('button', { name: 'ZONE AUDIT' }));
    expect(useNavigationStore.getState().screen).toBe('zone-audit');
  });

  it('writes a screen id to the URL and nothing else', () => {
    act(() => {
      initScreenState({ initialScreen: 'log' });
    });
    render(<LogScreen now={now} />);

    fireEvent.click(screen.getByRole('button', { name: 'ZONE AUDIT' }));

    const params = new URLSearchParams(window.location.search);
    expect(params.get('screen')).toBe('zone-audit');
    expect([...params.keys()]).toEqual(['screen']);
  });
});

describe('FLOCKED TODAY is today', () => {
  const YESTERDAY = NOW - 24 * 60 * 60 * 1000;

  it('counts today, not every pass since the app was launched', () => {
    historyActions.startTrip(YESTERDAY - 60_000);
    drivePast({ id: 'cam-y1', label: 'Old Rd', atMs: YESTERDAY, distanceFt: 400, speedMph: 30 });
    drivePast({
      id: 'cam-y2',
      label: 'Old Rd',
      atMs: YESTERDAY + 60_000,
      distanceFt: 300,
      speedMph: 30,
    });
    for (const pass of DRIVE) drivePast(pass);

    const { container } = render(<LogScreen now={now} />);

    // Five passes are on the books; three of them happened today.
    expect(useHistoryStore.getState().today.passes).toBe(5);
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('3');
    expect(screen.getByText('CAMERAS · 3 UNIQUE')).toBeInTheDocument();
  });

  it('never disagrees with the last bar of the week it draws beside it', () => {
    historyActions.startTrip(YESTERDAY - 60_000);
    drivePast({ id: 'cam-y1', label: 'Old Rd', atMs: YESTERDAY, distanceFt: 400, speedMph: 30 });
    for (const pass of DRIVE) drivePast(pass);

    const { container } = render(<LogScreen now={now} />);
    const bars = [...container.querySelectorAll<HTMLElement>('.fwm-log-bar')];

    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe(
      bars[6]?.dataset['fwmLogBarPasses'],
    );
    expect(bars[5]?.dataset['fwmLogBarPasses']).toBe('1');
  });

  it('goes back to zero when the log is cleared, instead of counting rows that are gone', () => {
    driveTheDesignsDrive();
    historyActions.clear();

    const { container } = render(<LogScreen now={now} />);

    expect(rows(container)).toHaveLength(0);
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('0');
    expect(screen.getByText('CAMERAS · 0 UNIQUE')).toBeInTheDocument();
  });
});

describe('the approaching row the design draws amber', () => {
  it('draws a camera that was come up on and never entered range', () => {
    historyActions.startTrip(NOW - 1_800_000);
    driveNear({
      id: 'cam-reading',
      label: 'Reading Rd',
      atMs: NOW - 737_000,
      distanceFt: 760,
      speedMph: 38,
    });

    const { container } = render(<LogScreen now={now} />);

    const drawn = rows(container);
    expect(drawn).toHaveLength(1);
    expect(within(drawn[0] as HTMLElement).getByText('Reading Rd')).toBeInTheDocument();
    expect(
      within(drawn[0] as HTMLElement).getByText('14:09:51 · 38 MPH · 760 FT'),
    ).toBeInTheDocument();
    expect(
      drawn[0]?.querySelector<HTMLElement>('.fwm-log-row-dot')?.dataset['fwmLogRowState'],
    ).toBe('approaching');
  });

  it('does not count it in FLOCKED TODAY, because nothing read the driver', () => {
    historyActions.startTrip(NOW - 1_800_000);
    driveNear({
      id: 'cam-reading',
      label: 'Reading Rd',
      atMs: NOW - 737_000,
      distanceFt: 760,
      speedMph: 38,
    });
    drivePast({ id: 'cam-vine', label: 'Vine St & 7th', atMs: NOW, distanceFt: 380, speedMph: 47 });

    const { container } = render(<LogScreen now={now} />);

    expect(rows(container)).toHaveLength(2);
    expect(container.querySelector('[data-fwm-log-today="true"]')?.textContent).toBe('1');
  });

  it('records the mute on an approaching row without removing the row', () => {
    alertActions.muteAll(NOW - 1_800_000, MUTE_MS);
    historyActions.startTrip(NOW - 1_800_000);
    driveNear({
      id: 'cam-reading',
      label: 'Reading Rd',
      atMs: NOW - 737_000,
      distanceFt: 760,
      speedMph: 38,
    });

    const { container } = render(<LogScreen now={now} />);

    expect(rows(container)).toHaveLength(1);
    expect(rows(container)[0]?.dataset['fwmLogMuted']).toBe('true');
  });
});

describe('ALL TIME', () => {
  const SINCE = new Date(2026, 2, 1).getTime();

  it('loads the durable total nothing else in the app loads', async () => {
    const { container } = await act(async () =>
      render(
        <LogScreen now={now} allTimePort={allTimePort({ status: 'ready', passes: 1284, sinceMs: SINCE })} />,
      ),
    );

    expect(useHistoryStore.getState().allTimePasses).toBeNull();
    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe('1,284');
    expect(screen.getByText('SINCE MAR 2026')).toBeInTheDocument();
  });

  it('prints an em dash, not a zero, when the device has recorded no trip at all', async () => {
    const { container } = await act(async () =>
      render(<LogScreen now={now} allTimePort={NO_DURABLE_READ} />),
    );

    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe('—');
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('prints a durable zero, because a driver no camera ever read is a real number', async () => {
    const { container } = await act(async () =>
      render(
        <LogScreen now={now} allTimePort={allTimePort({ status: 'ready', passes: 0, sinceMs: SINCE })} />,
      ),
    );

    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe('0');
  });

  it('lets the history slice win once something has hydrated it', async () => {
    historyActions.hydrate([], 1284, SINCE);
    driveTheDesignsDrive();

    const { container } = await act(async () =>
      render(
        <LogScreen now={now} allTimePort={allTimePort({ status: 'ready', passes: 7, sinceMs: SINCE })} />,
      ),
    );

    expect(container.querySelector('[data-fwm-log-alltime="true"]')?.textContent).toBe('1,287');
  });

  it('opens no database of its own accord when the screen is only rendered', () => {
    let opened = 0;
    const counting: AllTimeExposurePort = () => {
      opened += 1;
      return Promise.resolve({ status: 'unavailable', reason: 'counted' });
    };

    const view = render(<LogScreen now={now} allTimePort={counting} />);
    view.rerender(<LogScreen now={now} allTimePort={counting} />);

    expect(opened).toBe(1);
  });
});
