/**
 * Geolocation: the privacy invariant first, then the plumbing.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  REDACTION_DECIMALS,
  createGeolocationAdapter,
  geolocationCapability,
  redact,
  redactCoordinate,
  type GeoFix,
} from './geolocation';
import { withGlobals, withGlobalsAsync } from './testing/globals';

/** A real-looking fix: the coordinates the design screens print, full precision. */
const PRECISE: GeoFix = {
  lat: 39.09975123,
  lon: -84.57861987,
  accuracyM: 4,
  altitudeM: 187.25,
  altitudeAccuracyM: 3,
  speedMps: 21.4,
  headingDeg: 41,
  timestamp: 1_787_000_000_000,
};

function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

interface FakeGeo {
  api: Geolocation;
  watchCalls: () => number;
  clearCalls: () => number[];
  emit: (position: GeolocationPosition) => void;
  emitError: (code: number) => void;
}

function fakeGeolocation(options?: {
  currentPosition?: GeolocationPosition;
  currentError?: number;
}): FakeGeo {
  let watchCalls = 0;
  const clearCalls: number[] = [];
  let success: PositionCallback | null = null;
  let failure: PositionErrorCallback | null = null;

  const api = {
    watchPosition(ok: PositionCallback, err?: PositionErrorCallback | null) {
      watchCalls += 1;
      success = ok;
      failure = err ?? null;
      return watchCalls;
    },
    clearWatch(id: number) {
      clearCalls.push(id);
    },
    getCurrentPosition(ok: PositionCallback, err?: PositionErrorCallback | null) {
      if (options?.currentError !== undefined) {
        err?.({ code: options.currentError, message: 'nope' } as GeolocationPositionError);
        return;
      }
      if (options?.currentPosition) ok(options.currentPosition);
    },
  } as unknown as Geolocation;

  return {
    api,
    watchCalls: () => watchCalls,
    clearCalls: () => clearCalls,
    emit: (position) => success?.(position),
    emitError: (code) =>
      failure?.({ code, message: 'geolocation error' } as GeolocationPositionError),
  };
}

function position(overrides: Record<string, unknown> = {}): GeolocationPosition {
  return {
    coords: {
      latitude: PRECISE.lat,
      longitude: PRECISE.lon,
      accuracy: PRECISE.accuracyM,
      altitude: PRECISE.altitudeM,
      altitudeAccuracy: PRECISE.altitudeAccuracyM,
      speed: PRECISE.speedMps,
      heading: PRECISE.headingDeg,
      ...overrides,
    },
    timestamp: PRECISE.timestamp,
  } as unknown as GeolocationPosition;
}

describe('redact', () => {
  it('never emits a coordinate at full precision', () => {
    const safe = redact(PRECISE);
    const json = JSON.stringify(safe);

    expect(json).not.toContain(String(PRECISE.lat));
    expect(json).not.toContain(String(PRECISE.lon));
    expect(decimalsOf(safe.latApprox)).toBeLessThanOrEqual(REDACTION_DECIMALS);
    expect(decimalsOf(safe.lonApprox)).toBeLessThanOrEqual(REDACTION_DECIMALS);
    expect(safe.latApprox).toBe(39.1);
    expect(safe.lonApprox).toBe(-84.579);
  });

  it('drops altitude entirely and keeps no field named lat or lon', () => {
    const safe = redact(PRECISE);
    expect(Object.keys(safe)).not.toContain('lat');
    expect(Object.keys(safe)).not.toContain('lon');
    expect(JSON.stringify(safe)).not.toContain('altitude');
    expect(safe.precision).toBe('approx-3dp');
  });

  it('rounds every coordinate it is given, not just the tidy ones', () => {
    const samples = [0.0001234, -0.9999, 89.987654321, -179.123456789, 12.3456, -0.5];
    for (const value of samples) {
      expect(decimalsOf(redactCoordinate(value))).toBeLessThanOrEqual(REDACTION_DECIMALS);
    }
    // Rounding must actually move a precise value, never pass it through.
    expect(redactCoordinate(39.0997512)).not.toBe(39.0997512);
  });

  it('keeps speed, heading and timestamp, which describe the car and not the place', () => {
    const safe = redact(PRECISE);
    expect(safe.speedMps).toBe(PRECISE.speedMps);
    expect(safe.headingDeg).toBe(PRECISE.headingDeg);
    expect(safe.timestamp).toBe(PRECISE.timestamp);
  });
});

describe('capability', () => {
  it('says no, with a reason, when this browser has no geolocation', () => {
    const capability = geolocationCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/geolocation/i);
  });

  it('says yes once the api is present', () => {
    withGlobals({ navigator: { geolocation: fakeGeolocation().api } }, () => {
      expect(geolocationCapability().supported).toBe(true);
    });
  });
});

describe('watching', () => {
  it('exposes accuracy, speed, heading and the platform timestamp', () => {
    const fake = fakeGeolocation();
    withGlobals({ navigator: { geolocation: fake.api } }, () => {
      const adapter = createGeolocationAdapter();
      const seen: GeoFix[] = [];
      adapter.subscribe((fix) => seen.push(fix));
      adapter.start();
      fake.emit(position());

      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual(PRECISE);
      expect(adapter.error()).toBeNull();
      expect(adapter.fixAgeMs(PRECISE.timestamp + 40_000)).toBe(40_000);
      adapter.stop();
    });
  });

  it('is idempotent: two starts watch once, two stops clear once', () => {
    const fake = fakeGeolocation();
    withGlobals({ navigator: { geolocation: fake.api } }, () => {
      const adapter = createGeolocationAdapter();
      adapter.start();
      adapter.start();
      expect(fake.watchCalls()).toBe(1);

      adapter.stop();
      adapter.stop();
      expect(fake.clearCalls()).toEqual([1]);
    });
  });

  it('stops delivering after unsubscribe', () => {
    const fake = fakeGeolocation();
    withGlobals({ navigator: { geolocation: fake.api } }, () => {
      const adapter = createGeolocationAdapter();
      let calls = 0;
      const unsubscribe = adapter.subscribe(() => {
        calls += 1;
      });
      adapter.start();
      fake.emit(position());
      expect(calls).toBe(1);

      unsubscribe();
      fake.emit(position());
      expect(calls).toBe(1);
      adapter.stop();
    });
  });

  it('keeps going when one subscriber throws, and records that it happened', () => {
    const fake = fakeGeolocation();
    withGlobals({ navigator: { geolocation: fake.api } }, () => {
      const adapter = createGeolocationAdapter();
      adapter.subscribe(() => {
        throw new Error('screen blew up');
      });
      let second = 0;
      adapter.subscribe(() => {
        second += 1;
      });
      adapter.start();
      expect(() => fake.emit(position())).not.toThrow();
      expect(second).toBe(1);
      expect(adapter.error()?.code).toBe('subscriber-threw');
      adapter.stop();
    });
  });

  it('drops the watch when the user denies mid-watch, instead of spinning', () => {
    const fake = fakeGeolocation();
    withGlobals({ navigator: { geolocation: fake.api } }, () => {
      const adapter = createGeolocationAdapter();
      adapter.start();
      fake.emitError(1);
      expect(adapter.error()?.code).toBe('permission-denied');
      expect(fake.clearCalls()).toEqual([1]);
    });
  });

  it('maps position-unavailable and timeout without throwing', () => {
    const fake = fakeGeolocation();
    withGlobals({ navigator: { geolocation: fake.api } }, () => {
      const adapter = createGeolocationAdapter();
      adapter.start();
      fake.emitError(2);
      expect(adapter.error()?.code).toBe('position-unavailable');
      fake.emitError(3);
      expect(adapter.error()?.code).toBe('timeout');
      adapter.stop();
    });
  });

  it('never throws when started on a platform with no geolocation', () => {
    const adapter = createGeolocationAdapter();
    expect(() => {
      adapter.start();
      adapter.stop();
    }).not.toThrow();
    expect(adapter.error()?.code).toBe('unsupported');
  });
});

describe('permission', () => {
  it('surfaces a denial as denied and does not crash', async () => {
    const fake = fakeGeolocation({ currentError: 1 });
    await withGlobalsAsync({ navigator: { geolocation: fake.api } }, async () => {
      const adapter = createGeolocationAdapter();
      await expect(adapter.request()).resolves.toBe('denied');
      expect(adapter.error()?.code).toBe('permission-denied');
      expect(adapter.current()).toBeNull();
    });
  });

  it('resolves granted and publishes the fix when the user allows', async () => {
    const fake = fakeGeolocation({ currentPosition: position() });
    await withGlobalsAsync({ navigator: { geolocation: fake.api } }, async () => {
      const adapter = createGeolocationAdapter();
      await expect(adapter.request()).resolves.toBe('granted');
      expect(adapter.current()).toEqual(PRECISE);
    });
  });

  it('reads the permission passively through the permissions api', async () => {
    const query = vi.fn(async () => ({ state: 'granted' }));
    await withGlobalsAsync(
      { navigator: { geolocation: fakeGeolocation().api, permissions: { query } } },
      async () => {
        const adapter = createGeolocationAdapter();
        await expect(adapter.permission()).resolves.toBe('granted');
        expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
      },
    );
  });
});
