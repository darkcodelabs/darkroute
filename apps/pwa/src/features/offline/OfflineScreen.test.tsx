/**
 * OFFLINE, wired to the real stores and the real engine output shape.
 *
 * The cache is the one injected seam: `cache.test.ts` drives that path against
 * real repositories and a real IndexedDB shape, and repeating it here would
 * make every screen assertion wait on a database. Everything else -- the
 * network slice, the presence slice, the alert tick, the mute gate -- goes
 * through the same calls the driving loop uses.
 */

import { render, screen } from '@testing-library/react';
// `offline.css` is READ FROM DISK, not imported. vitest runs with `css: false`,
// which stubs every CSS import to an empty string, so an assertion against the
// import would pass on '' no matter what the file says.
// `node:fs` needed a @ts-expect-error here while @types/node was deliberately
// absent (see eslint.config.js). It now arrives transitively via the build-side
// AWS SDK that publishes the basemap archive, so the suppression became an
// error itself. That stance still holds for RUNTIME code; this is a test
// reading a stylesheet off disk.
import { readFileSync } from 'node:fs';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ingestAlertTick,
  networkActions,
  positionActions,
  resetAllStores,
  useCamerasStore,
  useSettingsStore,
} from '../../stores';
import type { AlertState, AlertTick, CameraAssessment } from '../../stores';
import type { NetworkState as AdapterNetworkState } from '../../services/adapters';

import { RadarScreen } from '../radar/RadarScreen.tsx';

import { OfflineScreen } from './OfflineScreen.tsx';
import type { OfflineCachePort, OfflineCacheRead, OfflineCacheSnapshot } from './cache.ts';

const HERE = (import.meta as unknown as { readonly dirname: string }).dirname;
const offlineCss: string = readFileSync(`${HERE}/offline.css`, 'utf8');

/** The sentence a screen shows in place of a readout, if it is showing one. */
function messageOf(container: HTMLElement): string | null {
  return container.querySelector('.fwm-radar-message')?.textContent ?? null;
}

/** The hero numerals, if the screen is drawing a readout at all. */
function digitsOf(container: HTMLElement): string | null {
  return container.querySelector('[data-fwm-radar-digits="true"]')?.textContent ?? null;
}

const NOW = 1_760_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const now = (): number => NOW;

/**
 * A snapshot with nothing wrong with it, plus whatever this test is about.
 *
 * The three fields past the drawn counters -- how many rows the read refused,
 * why, and which generation is on disk -- default to "refused nothing, no
 * sentinel", so a test about the counters stays about the counters.
 */
function snapshot(over: Partial<OfflineCacheSnapshot> = {}): OfflineCacheSnapshot {
  return {
    cachedCameras: 0,
    cachedTiles: 0,
    unusableTiles: 0,
    incoherence: 'none',
    generation: null,
    oldestCheckedAtMs: null,
    oldestFetchedAtMs: null,
    ...over,
  };
}

/** The cache A2 draws: 4,182 cameras across 318 tiles, last checked two days ago. */
function a2Cache(over: Partial<OfflineCacheRead> = {}): OfflineCachePort {
  const read: OfflineCacheRead = {
    status: 'ready',
    snapshot: snapshot({
      cachedCameras: 4182,
      cachedTiles: 318,
      oldestCheckedAtMs: NOW - 2 * DAY_MS,
      oldestFetchedAtMs: NOW - 2 * DAY_MS,
    }),
    ...(over as Record<string, never>),
  };
  return () => Promise.resolve(read);
}

/** The camera A2 is about: 610 ft ahead, out of range, out of a cached tile. */
function assessment(over: Partial<CameraAssessment> = {}): CameraAssessment {
  return {
    id: 'cam-1',
    lat: 39.1,
    lon: -84.58,
    distanceFt: 610,
    bearingDeg: 41,
    relativeDirection: 'ahead',
    facingVehicle: true,
    directionDeg: 221,
    inRange: false,
    muted: false,
    mergedIds: ['cam-1'],
    ...over,
  };
}

function tick(over: Partial<AlertTick> = {}): AlertTick {
  const nearest = over.nearest === undefined ? assessment() : over.nearest;
  const state: AlertState = over.state ?? 'clear';
  return {
    timestampMs: NOW,
    state,
    previousState: 'clear',
    changed: false,
    nearest,
    cameras: nearest === null ? [] : [nearest],
    countInRange: 0,
    thresholdFt: 500,
    effectiveThresholdFt: 500,
    isClosing: true,
    speedMps: 21,
    speedSource: 'gps',
    accuracyM: 4,
    stationary: false,
    globallyMuted: false,
    shouldAlertUser: false,
    hapticPulses: 0,
    notifyCameraIds: [],
    suppressedBy: [],
    ...over,
  };
}

function lock(): void {
  positionActions.ingestFix({
    lat: 39.0997,
    lon: -84.5786,
    accuracyM: 4,
    altitudeM: null,
    altitudeAccuracyM: null,
    speedMps: 21,
    headingDeg: 41,
    timestamp: NOW,
  });
}

/** One sample from the network adapter, in the shape the adapter publishes it. */
function sample(online: boolean): AdapterNetworkState {
  return {
    online,
    effectiveType: null,
    downlinkMbps: null,
    rttMs: null,
    saveData: null,
    connectionType: null,
    timestamp: NOW,
  };
}

function goOffline(): void {
  networkActions.ingest(sample(false), false);
}

function goOnline(): void {
  networkActions.ingest(sample(true), true);
}

beforeEach(() => {
  resetAllStores();
});

afterEach(() => {
  resetAllStores();
});

describe('the screen A2 draws', () => {
  it('renders the cached hero, the counters and the age warning', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());

    const { container } = render(<OfflineScreen now={now} cachePort={a2Cache()} />);

    expect(screen.getByText('NO NETWORK · RUNNING ON CACHE')).toBeInTheDocument();
    expect(container.querySelector('[data-fwm-radar-digits="true"]')?.textContent).toBe('610');
    expect(screen.getByText('CACHED CAMERA · AHEAD')).toBeInTheDocument();

    expect(await screen.findByText('4,182')).toBeInTheDocument();
    expect(screen.getByText('318')).toBeInTheDocument();
    expect(screen.getByText('CACHED CAMS')).toBeInTheDocument();
    expect(screen.getByText('MAP TILES')).toBeInTheDocument();
    expect(
      screen.getByText(
        'DB last updated 2 days ago. Cameras added since then are invisible - ' +
          'treat clear as probably clear.',
      ),
    ).toBeInTheDocument();
  });

  it('renders the five capability rows with the verdicts A2 renders', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());

    const { container } = render(<OfflineScreen now={now} cachePort={a2Cache()} />);
    await screen.findByText('4,182');

    const verdictOf = (id: string): string | undefined =>
      container
        .querySelector(`[data-fwm-offline-cap="${id}"]`)
        ?.getAttribute('data-fwm-offline-verdict') ?? undefined;

    expect(screen.getByText('WHAT STILL WORKS')).toBeInTheDocument();
    expect(verdictOf('cached-alerts')).toBe('ok');
    expect(verdictOf('local-tools')).toBe('ok');
    expect(verdictOf('queued-reports')).toBe('ok');
    // The mesh is off in this build AND there is no network. Either is enough.
    expect(verdictOf('mesh')).toBe('no');
    expect(verdictOf('ask')).toBe('no');
    expect(screen.getByText('reporting - queues locally')).toBeInTheDocument();
    expect(screen.getByText('ask - needs the model')).toBeInTheDocument();
  });
});

describe('the verdicts are read, not drawn', () => {
  it('says NO to cached alerts when the cache is empty, however good the network is', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick({ nearest: null }));

    const empty: OfflineCachePort = () =>
      Promise.resolve({
        status: 'ready',
        snapshot: snapshot({ cachedCameras: 0, cachedTiles: 0 }),
      });

    const { container } = render(<OfflineScreen now={now} cachePort={empty} />);
    await screen.findByText('never been checked', { exact: false });

    expect(
      container
        .querySelector('[data-fwm-offline-cap="cached-alerts"]')
        ?.getAttribute('data-fwm-offline-verdict'),
    ).toBe('no');
    // Counted zero is printed as zero. It was read; it is not unknown.
    expect(container.querySelector('[data-fwm-offline-counter="CACHED CAMS"]')?.textContent)
      .toContain('0');
  });

  it('takes the local rows down when there is no local storage at all', async () => {
    goOffline();

    const none: OfflineCachePort = () =>
      Promise.resolve({ status: 'unavailable', reason: 'no IndexedDB here' });

    const { container } = render(<OfflineScreen now={now} cachePort={none} />);
    await screen.findByText('Local storage is unavailable', { exact: false });

    for (const id of ['cached-alerts', 'local-tools', 'queued-reports']) {
      expect(
        container
          .querySelector(`[data-fwm-offline-cap="${id}"]`)
          ?.getAttribute('data-fwm-offline-verdict'),
      ).toBe('no');
    }
    expect(container.querySelector('.fwm-offline')?.getAttribute('data-fwm-offline-storage')).toBe(
      'unavailable',
    );
  });

  it('admits it does not know yet instead of flashing a reassurance', () => {
    goOffline();

    // A read that never settles: exactly the first frame after mount.
    const pending: OfflineCachePort = () => new Promise<OfflineCacheRead>(() => undefined);

    const { container } = render(<OfflineScreen now={now} cachePort={pending} />);

    expect(
      container
        .querySelector('[data-fwm-offline-cap="local-tools"]')
        ?.getAttribute('data-fwm-offline-verdict'),
    ).toBe('unknown');
    // No counter and no warning may claim anything before the read lands.
    expect(container.querySelector('[data-fwm-offline-counter="CACHED CAMS"]')?.textContent)
      .toContain('—');
    expect(container.querySelector('[data-fwm-offline-notice]')).toBeNull();
  });
});

describe('when the network comes back while the screen is open', () => {
  it('stops claiming to be offline, and re-reads the cache', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());

    const reads = vi.fn<OfflineCachePort>(() =>
      Promise.resolve({
        status: 'ready',
        snapshot: snapshot({
          cachedCameras: 4182,
          cachedTiles: 318,
          oldestCheckedAtMs: NOW - 2 * DAY_MS,
          oldestFetchedAtMs: NOW - 2 * DAY_MS,
        }),
      }),
    );

    const { container, rerender } = render(<OfflineScreen now={now} cachePort={reads} />);
    await screen.findByText('4,182');
    expect(reads).toHaveBeenCalledTimes(1);

    goOnline();
    rerender(<OfflineScreen now={now} cachePort={reads} />);

    expect(screen.queryByText('NO NETWORK · RUNNING ON CACHE')).toBeNull();
    expect(container.querySelector('.fwm-offline')?.getAttribute('data-fwm-offline-network')).toBe(
      'online',
    );
    // Coming back online is the one moment the tile cache can be refilled.
    expect(reads).toHaveBeenCalledTimes(2);
  });
});

describe('RETRY SYNC', () => {
  it('is drawn disabled when this build has nothing wired to it', () => {
    goOffline();

    render(<OfflineScreen now={now} cachePort={a2Cache()} />);

    expect(screen.getByRole('button', { name: 'RETRY SYNC' })).toBeDisabled();
  });

  it('runs on a press, and only on a press', () => {
    goOffline();
    const onRetrySync = vi.fn();

    render(<OfflineScreen now={now} cachePort={a2Cache()} onRetrySync={onRetrySync} />);
    expect(onRetrySync).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'RETRY SYNC' }).click();
    expect(onRetrySync).toHaveBeenCalledTimes(1);
  });
});

describe('muting removes the alert and nothing else', () => {
  it('keeps a muted camera on the cached readout', () => {
    goOffline();
    lock();
    useSettingsStore.getState().muteAll(NOW);
    ingestAlertTick(tick({ nearest: assessment({ muted: true }) }));

    const { container } = render(<OfflineScreen now={now} cachePort={a2Cache()} />);

    expect(container.querySelector('[data-fwm-radar-digits="true"]')?.textContent).toBe('610');
    expect(screen.getByText('STILL TRACKING')).toBeInTheDocument();
  });
});

describe('this screen sends nothing anywhere', () => {
  it('makes no request and asks the platform for nothing on mount', () => {
    const fetchSpy = vi.fn();
    const sendBeacon = vi.fn();
    const getCurrentPosition = vi.fn();
    const watchPosition = vi.fn();
    const query = vi.fn();

    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('navigator', {
      ...navigator,
      sendBeacon,
      geolocation: { getCurrentPosition, watchPosition, clearWatch: vi.fn() },
      permissions: { query },
    });

    goOffline();
    lock();
    ingestAlertTick(tick());
    const search = window.location.search;

    render(<OfflineScreen now={now} cachePort={a2Cache()} />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    // Nothing about the cache, the camera or the position reaches the URL.
    expect(window.location.search).toBe(search);
  });
});

describe('the hero is gated the way RADAR gates it', () => {
  /**
   * Both screens, same stores, same clock. RADAR replaces its readout with a
   * sentence whenever there is no live distance; OFFLINE composes the readout
   * from the same `directionLine`, so it has to replace it with the SAME
   * sentence or the two screens describe the same device differently.
   *
   * This comparison is also the drift guard on the copy: `RadarView` keeps its
   * `degradedCopy` module-private, so `hero.ts` repeats the strings, and this
   * test fails the moment RADAR changes its wording and OFFLINE does not.
   */
  function bothScreens(clock: () => number): { radar: string | null; offline: string | null } {
    const radar = render(<RadarScreen now={clock} />);
    const offline = render(<OfflineScreen now={clock} cachePort={a2Cache()} />);
    return { radar: messageOf(radar.container), offline: messageOf(offline.container) };
  }

  it('explains a refused permission in RADAR words instead of drawing a bare em dash', () => {
    goOffline();
    positionActions.markDenied();
    ingestAlertTick(tick());

    const { radar, offline } = bothScreens(now);

    expect(offline).toContain('location is off.');
    expect(offline).toContain('Coordinates never leave the phone');
    expect(offline).toBe(radar);
    // The ungated hero drew ` - ` beside `FT` here, with no line and no reason.
    expect(digitsOf(screen.getByLabelText('offline') as HTMLElement)).toBeNull();
  });

  it('names a device with no location service, exactly as RADAR names it', () => {
    goOffline();
    positionActions.markUnavailable('no geolocation on this platform');
    ingestAlertTick(tick());

    const { radar, offline } = bothScreens(now);

    expect(offline).toContain('this device has no location service.');
    expect(offline).toBe(radar);
  });

  it('waits for the first fix in RADAR words', () => {
    goOffline();
    ingestAlertTick(tick());

    const { radar, offline } = bothScreens(now);

    expect(offline).toContain('waiting for the first fix.');
    expect(offline).toBe(radar);
  });

  it('ages a stale fix in RADAR words', () => {
    goOffline();
    lock();
    positionActions.markStale();
    ingestAlertTick(tick());

    const later = (): number => NOW + 40_000;
    const { radar, offline } = bothScreens(later);

    expect(offline).toContain('last fix 40s ago.');
    expect(offline).toContain('showing cached cameras only.');
    expect(offline).toBe(radar);
  });
});

describe('the hero never claims a camera it does not have', () => {
  it('does not print CACHED CAMERA over an empty cache', async () => {
    goOffline();
    lock();
    // A fix, and the engine found nothing: `directionLine` takes the offline
    // branch with no direction and returns the bare string `CACHED CAMERA`.
    ingestAlertTick(tick({ nearest: null }));

    const empty: OfflineCachePort = () =>
      Promise.resolve({
        status: 'ready',
        snapshot: snapshot({ cachedCameras: 0, cachedTiles: 0 }),
      });

    const { container } = render(<OfflineScreen now={now} cachePort={empty} />);
    await screen.findByText('never been checked', { exact: false });

    expect(container.textContent).not.toContain('CACHED CAMERA');
    expect(messageOf(container)).toContain('nothing is cached on this device.');
    expect(digitsOf(container)).toBeNull();
    // And the counter beside it still reports the zero it actually counted.
    expect(container.querySelector('[data-fwm-offline-counter="CACHED CAMS"]')?.textContent)
      .toContain('0');
  });

  it('says the engine found none when the cache is full and nothing is near', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick({ nearest: null }));

    const { container } = render(<OfflineScreen now={now} cachePort={a2Cache()} />);
    await screen.findByText('4,182');

    expect(container.textContent).not.toContain('CACHED CAMERA');
    expect(messageOf(container)).toContain('no cached camera nearby.');
  });
});

describe('the screen never contradicts its own counters', () => {
  it('does not say nothing is cached while it is printing four figures', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());

    // What `cameraTiles.put()` alone produces: tiles on disk, no tileMeta row.
    const unchecked: OfflineCachePort = () =>
      Promise.resolve({
        status: 'ready',
        snapshot: snapshot({
          cachedCameras: 4182,
          cachedTiles: 318,
          oldestFetchedAtMs: NOW - 2 * DAY_MS,
        }),
      });

    const { container } = render(<OfflineScreen now={now} cachePort={unchecked} />);
    await screen.findByText('4,182');

    const notice = container.querySelector('[data-fwm-offline-notice]')?.textContent ?? '';
    expect(notice).not.toContain('Nothing is cached');
    expect(notice).toContain('never been checked');
    expect(notice).toContain('stored 2 days ago');
    expect(container.querySelector('[data-fwm-offline-notice]')?.getAttribute(
      'data-fwm-offline-notice',
    )).toBe('unchecked');
    // The cached-alerts row agrees: there IS something to alert about.
    expect(
      container
        .querySelector('[data-fwm-offline-cap="cached-alerts"]')
        ?.getAttribute('data-fwm-offline-verdict'),
    ).toBe('ok');
  });

  it('tells the driver why there is no storage, in the database layer words', async () => {
    goOffline();

    const none: OfflineCachePort = () =>
      Promise.resolve({
        status: 'unavailable',
        reason: 'this browser exposes no IndexedDB, so nothing is cached on this device',
      });

    const { container } = render(<OfflineScreen now={now} cachePort={none} />);
    await screen.findByText('Local storage is unavailable', { exact: false });

    expect(container.querySelector('[data-fwm-offline-notice-detail]')?.textContent).toBe(
      'this browser exposes no IndexedDB, so nothing is cached on this device',
    );
  });

  it('says a refused cache is refused rather than printing a bare zero', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick({ nearest: null }));

    // A half-finished generation replacement: 318 rows on disk, none of them
    // usable. The counters have to read zero -- nothing there will load -- and
    // the sentence beside them has to say why, or a driver reads it as a
    // device that never cached anything and goes looking for a sync.
    const mixed: OfflineCachePort = () =>
      Promise.resolve({
        status: 'ready',
        snapshot: snapshot({ unusableTiles: 318, incoherence: 'mixed', generation: 'a'.repeat(64) }),
      });

    const { container } = render(<OfflineScreen now={now} cachePort={mixed} />);
    await screen.findByText('more than one published snapshot', { exact: false });

    expect(
      container
        .querySelector('[data-fwm-offline-notice]')
        ?.getAttribute('data-fwm-offline-notice'),
    ).toBe('mixed');
    expect(container.textContent).not.toContain('Nothing is cached');
    // And the capability row agrees with the sentence: there is nothing to
    // alert from.
    expect(
      container
        .querySelector('[data-fwm-offline-cap="cached-alerts"]')
        ?.getAttribute('data-fwm-offline-verdict'),
    ).toBe('no');
  });

  it('says so when the disk holds an older snapshot than the live warnings', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());
    // The live set, admitted to memory after a durable replacement conflicted.
    useCamerasStore.getState().putGenerationTiles('b'.repeat(64), [
      {
        ref: { z: 11, x: 484, y: 783 },
        cameras: [],
        fetchedAtMs: NOW,
        freshness: 'fresh',
        source: 'network',
      },
    ]);

    const behind: OfflineCachePort = () =>
      Promise.resolve({
        status: 'ready',
        snapshot: snapshot({
          cachedCameras: 4182,
          cachedTiles: 318,
          generation: 'a'.repeat(64),
          oldestCheckedAtMs: NOW - 2 * DAY_MS,
          oldestFetchedAtMs: NOW - 2 * DAY_MS,
        }),
      });

    const { container } = render(<OfflineScreen now={now} cachePort={behind} />);
    await screen.findByText('older published snapshot', { exact: false });

    expect(
      container
        .querySelector('[data-fwm-offline-notice]')
        ?.getAttribute('data-fwm-offline-notice'),
    ).toBe('behind');
    // The counters are unchanged -- those rows ARE on disk and usable, they are
    // simply the previous snapshot's. The sentence is what makes them honest.
    expect(container.textContent).toContain('4,182');
  });
});

describe('the database age is read from the clock, not frozen at mount', () => {
  it('advances when anything re-renders the screen', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());

    let clock = NOW;
    const moving = (): number => clock;
    const port = a2Cache();

    const { rerender } = render(<OfflineScreen now={moving} cachePort={port} />);
    expect(await screen.findByText('DB last updated 2 days ago.', { exact: false }))
      .toBeInTheDocument();

    clock = NOW + 2 * DAY_MS;
    rerender(<OfflineScreen now={moving} cachePort={port} />);

    expect(screen.getByText('DB last updated 4 days ago.', { exact: false })).toBeInTheDocument();
  });

  it('starts no timer of its own to make that happen', () => {
    goOffline();
    const interval = vi.spyOn(globalThis, 'setInterval');

    try {
      render(<OfflineScreen now={now} cachePort={a2Cache()} />);
      // A phrase quantised to days does not justify waking a driving screen.
      expect(interval).not.toHaveBeenCalled();
    } finally {
      interval.mockRestore();
    }
  });
});

describe('one live region for one fact', () => {
  it('announces the connectivity change once, not twice', async () => {
    goOffline();
    lock();
    ingestAlertTick(tick());

    const { container } = render(<OfflineScreen now={now} cachePort={a2Cache()} />);
    await screen.findByText('4,182');

    const section = container.querySelector('.fwm-offline');
    const live = section?.querySelectorAll('[role="status"]') ?? [];
    expect(live).toHaveLength(1);
    expect(live[0]?.textContent).toContain('NO NETWORK · RUNNING ON CACHE');
    // The header word is the same fact in one word, so it is not a second one.
    expect(container.querySelector('.fwm-offline-connectivity')?.getAttribute('role')).toBeNull();
  });
});

describe('the mark column', () => {
  it('is two characters wide, so an unknown verdict cannot shift the labels', () => {
    // `OK` and `NO` are two characters; the em dash for an unresolved verdict
    // is one. Without a pinned slot the labels on those rows sit a character
    // to the left of the resolved ones while the cache read is in flight.
    const rule = offlineCss.slice(offlineCss.indexOf('.fwm-offline-cap-mark {'));
    const body = rule.slice(0, rule.indexOf('}'));

    expect(body).toContain('min-width: 2ch');
  });

  it('renders the em dash for a verdict that has not resolved', () => {
    goOffline();

    const pending: OfflineCachePort = () => new Promise<OfflineCacheRead>(() => undefined);
    const { container } = render(<OfflineScreen now={now} cachePort={pending} />);

    expect(
      container.querySelector('[data-fwm-offline-cap="local-tools"] .fwm-offline-cap-mark')
        ?.textContent,
    ).toBe('—');
  });
});

describe('the shell contract', () => {
  it('is registrable as a zero-prop screen and survives a build with no database', async () => {
    // The registry types every screen as `ComponentType` with no props. This
    // is the assignment the shell makes, written out so a required prop can
    // never be added to this screen without the type failing here.
    const Registered: ComponentType = OfflineScreen;

    goOffline();
    render(<Registered />);

    // jsdom has no IndexedDB, so the real port reports the honest answer
    // rather than throwing at the screen.
    expect(await screen.findByText('Local storage is unavailable', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RETRY SYNC' })).toBeInTheDocument();
  });
});
