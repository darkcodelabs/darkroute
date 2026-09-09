/**
 * THE LOOP THAT TOOK PRODUCTION DOWN, pinned.
 *
 * `DriveScreen`'s demo effect depended on the current GPS fix, so it re-ran on
 * every tick and called `stopDemoDrive()` each time while demo mode was off.
 * `stopDemoDrive` published unconditionally, the adapter wrapper answered an
 * inactive state by re-emitting the real adapter's current fix to every
 * subscriber, that landed as a fresh fix, and the fresh fix re-ran the effect.
 * The main thread never yielded: blank map, spinner forever, dead page.
 *
 * Two independent guards close it and this file tests both, because either one
 * alone would have been enough and neither should be allowed to rot.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  demoDriveState,
  startDemoDrive,
  stopDemoDrive,
  subscribeDemoDrive,
  wrapWithDemoDrive,
} from './demoGeolocation.ts';
import type { GeoFix, GeolocationAdapter } from './geolocation';

const FIX: GeoFix = {
  lat: 38.9285,
  lon: -94.6708,
  accuracyM: 8,
  altitudeM: null,
  altitudeAccuracyM: null,
  speedMps: 12,
  headingDeg: 90,
  timestamp: 1_757_000_000_000,
};

function fakeAdapter(): GeolocationAdapter {
  const subs = new Set<(v: GeoFix) => void>();
  return {
    name: 'geolocation',
    capability: () => ({ name: 'geolocation', supported: true }) as never,
    permission: () => Promise.resolve('granted' as never),
    request: () => Promise.resolve('granted' as never),
    start: () => undefined,
    stop: () => undefined,
    current: () => FIX,
    error: () => null,
    fixAgeMs: () => 0,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

describe('stopDemoDrive', () => {
  it('publishes nothing when demo is already off', () => {
    /* THE FIRST GUARD. A state broadcast that fires when the state did not
       change is an invitation to a feedback loop, whoever the caller is. */
    stopDemoDrive();
    expect(demoDriveState().active).toBe(false);

    const seen = vi.fn();
    const off = subscribeDemoDrive(seen);
    stopDemoDrive();
    stopDemoDrive();
    stopDemoDrive();
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('does publish when demo was actually running', () => {
    const seen = vi.fn();
    const off = subscribeDemoDrive(seen);
    startDemoDrive({ lat: 1, lon: 2 });
    stopDemoDrive();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(demoDriveState().active).toBe(false);
    off();
  });
});

describe('the wrapper re-emits on the edge, never on the level', () => {
  it('does not push a fix when stop fires and demo was never on', () => {
    /* THE SECOND GUARD, and the one that actually closed the loop: the re-emit
       exists so leaving demo puts a live fix on the map without waiting for the
       next tick. Fired unconditionally it feeds a fix back to whatever caused
       the notification. */
    const wrapped = wrapWithDemoDrive(fakeAdapter());
    const got = vi.fn();
    const off = wrapped.subscribe(got);

    stopDemoDrive();
    stopDemoDrive();
    expect(got).not.toHaveBeenCalled();
    off();
  });

  it('does push one fix when demo really was on', () => {
    const wrapped = wrapWithDemoDrive(fakeAdapter());
    const got = vi.fn();
    const off = wrapped.subscribe(got);

    startDemoDrive({ lat: 1, lon: 2 });
    got.mockClear();
    stopDemoDrive();

    expect(got).toHaveBeenCalledTimes(1);
    expect(got.mock.calls[0]?.[0]).toStrictEqual(FIX);
    off();
  });

  it('passes the real adapter through untouched while demo is off', () => {
    const wrapped = wrapWithDemoDrive(fakeAdapter());
    expect(wrapped.current()).toStrictEqual(FIX);
    expect(wrapped.error()).toBeNull();
  });
});
