import { afterEach, describe, expect, it } from 'vitest';

import { createMockAdapters } from '../services/adapters/testing/mocks.ts';
import { no } from '../services/adapters/types.ts';
import type { GeoFix } from '../services/adapters';
import { usePositionStore } from '../stores/position.ts';

import { createSensorRuntime } from './sensors.ts';

const FIX: GeoFix = {
  lat: 39.0997,
  lon: -94.5786,
  accuracyM: 8,
  altitudeM: null,
  altitudeAccuracyM: null,
  speedMps: 13.4,
  headingDeg: 92,
  timestamp: 1_700_000_000_000,
};

afterEach(() => {
  usePositionStore.getState().reset();
});

describe('the sensor runtime', () => {
  it('starts the geolocation watch - the call that did not exist before this file', async () => {
    const adapters = createMockAdapters();
    const runtime = createSensorRuntime(adapters);

    await runtime.start();

    expect(adapters.geolocation.mock.starts()).toBe(1);
    expect(runtime.running()).toContain('geolocation');
  });

  it('carries a fix from the adapter into the position store', async () => {
    const adapters = createMockAdapters();
    const runtime = createSensorRuntime(adapters);
    await runtime.start();

    expect(usePositionStore.getState().fix).toBeNull();
    adapters.geolocation.mock.emit(FIX);

    const { fix, gps } = usePositionStore.getState();
    expect(fix?.lat).toBeCloseTo(FIX.lat);
    expect(fix?.lon).toBeCloseTo(FIX.lon);
    expect(gps).not.toBe('searching');
  });

  it('never calls request() - a permission prompt belongs to onboarding, not to a moving car', async () => {
    const adapters = createMockAdapters();
    adapters.geolocation.mock.setPermission('prompt');

    await createSensorRuntime(adapters).start();

    expect(adapters.geolocation.mock.requests()).toBe(0);
    expect(adapters.orientation.mock.requests()).toBe(0);
    expect(adapters.motion.mock.requests()).toBe(0);
  });

  it('reports a denial as denied, not as a missing fix', async () => {
    const adapters = createMockAdapters();
    adapters.geolocation.mock.setPermission('denied');

    await createSensorRuntime(adapters).start();

    expect(usePositionStore.getState().gps).toBe('denied');
    expect(adapters.geolocation.mock.starts()).toBe(0);
  });

  it('reports a platform with no geolocation as unavailable, with the reason', async () => {
    const adapters = createMockAdapters();
    adapters.geolocation.mock.setCapability(no('this browser has no geolocation'));

    await createSensorRuntime(adapters).start();

    const state = usePositionStore.getState();
    expect(state.gps).toBe('unavailable');
    expect(state.error?.message).toBe('this browser has no geolocation');
  });

  it('treats a tunnel as searching, not as a lost permission', async () => {
    const adapters = createMockAdapters();
    const runtime = createSensorRuntime(adapters);
    await runtime.start();

    // The watch is open and the platform stops answering.
    adapters.geolocation.mock.fail('position-unavailable', 'no signal');

    const state = usePositionStore.getState();
    expect(state.gps).toBe('searching');
    expect(state.gps).not.toBe('denied');
    expect(state.gps).not.toBe('unavailable');
  });

  /*
   * A WATCH THAT NEVER PRODUCES A FIX. Reported from a device: RADAR held
   * "waiting for the first fix." indefinitely while the phone had already
   * refused the position. Every assertion here is about a failure that arrives
   * AFTER `start()` has returned and with no fix following it, which is the
   * shape the old code could not see -- it only read `error()` from inside the
   * fix subscription, and there were no fixes.
   */
  describe('a failure after start(), with no fix ever arriving', () => {
    it('REACHES THE STORE AT ALL -- a refusal at the OS prompt is a denial', async () => {
      const adapters = createMockAdapters();
      const runtime = createSensorRuntime(adapters);
      await runtime.start();
      // Permission read as 'granted' at start; the platform refuses later, which
      // is exactly what an iOS prompt answered with "Don't Allow" looks like.
      expect(usePositionStore.getState().gps).toBe('searching');

      adapters.geolocation.mock.fail('permission-denied', 'the user said no');

      // Not 'searching'. RADAR can now say "location is off." instead of
      // waiting for a fix that is never coming.
      expect(usePositionStore.getState().gps).toBe('denied');
    });

    it('reports a device with no location service as unavailable', async () => {
      const adapters = createMockAdapters();
      const runtime = createSensorRuntime(adapters);
      await runtime.start();

      adapters.geolocation.mock.fail('unsupported', 'no location service');

      expect(usePositionStore.getState().gps).toBe('unavailable');
    });

    it('keeps a timeout as searching -- a slow fix is not a refusal', async () => {
      const adapters = createMockAdapters();
      const runtime = createSensorRuntime(adapters);
      await runtime.start();

      adapters.geolocation.mock.fail('timeout', 'timed out waiting for a fix');

      const state = usePositionStore.getState();
      expect(state.gps).toBe('searching');
      expect(state.error?.code).toBe('timeout');
    });

    it('stops listening once the runtime is stopped', async () => {
      const adapters = createMockAdapters();
      const runtime = createSensorRuntime(adapters);
      await runtime.start();
      runtime.stop();

      adapters.geolocation.mock.fail('permission-denied', 'the user said no');

      // A torn-down runtime writing into the store is how a screen shows the
      // state of an app that is no longer running.
      expect(usePositionStore.getState().gps).not.toBe('denied');
    });
  });

  it('clears the tunnel error when the next fix arrives, so the screen cannot contradict itself', async () => {
    const adapters = createMockAdapters();
    const runtime = createSensorRuntime(adapters);
    await runtime.start();
    adapters.geolocation.mock.fail('position-unavailable', 'no signal');

    adapters.geolocation.mock.clearError();
    adapters.geolocation.mock.emit(FIX);

    const state = usePositionStore.getState();
    expect(state.fix).not.toBeNull();
    expect(state.error).toBeNull();
  });

  it('stops every watch it opened, so a second runtime is not a second radio', async () => {
    const adapters = createMockAdapters();
    const runtime = createSensorRuntime(adapters);
    await runtime.start();

    runtime.stop();

    expect(adapters.geolocation.mock.stops()).toBe(1);
    expect(adapters.geolocation.mock.subscribers()).toBe(0);
    expect(runtime.running()).toEqual([]);
  });

  it('ignores a second start(), because StrictMode mounts every effect twice', async () => {
    const adapters = createMockAdapters();
    const runtime = createSensorRuntime(adapters);

    await runtime.start();
    await runtime.start();

    expect(adapters.geolocation.mock.starts()).toBe(1);
  });

  it('runs the GPS even when the compass and motion sensors refuse', async () => {
    const adapters = createMockAdapters();
    adapters.orientation.mock.setCapability(no('no compass'));
    adapters.motion.mock.setPermission('denied');
    const runtime = createSensorRuntime(adapters);

    await runtime.start();

    expect(runtime.running()).toEqual(['geolocation']);
    adapters.geolocation.mock.emit(FIX);
    expect(usePositionStore.getState().fix).not.toBeNull();
  });
});
