import { beforeEach, describe, expect, it } from 'vitest';

import { no, type PermissionOutcome } from '../services/adapters/types';
import { createMockAdapters, type MockAdapterSet } from '../services/adapters/testing/mocks';
import { capabilitiesActions, useCapabilitiesStore } from './capabilities.ts';

let adapters: MockAdapterSet;

beforeEach(() => {
  adapters = createMockAdapters();
  capabilitiesActions.reset();
});

describe('probing', () => {
  it('reports unknown before anything has been probed', () => {
    // Defaulting to "unsupported" would teach screens to hide features that
    // work; defaulting to "supported" would teach them to lie.
    expect(useCapabilitiesStore.getState().capabilities).toBeNull();
  });

  it('records one capability per adapter, with the reason when unsupported', () => {
    adapters.speechRecognition.mock.setCapability(no('this browser has no SpeechRecognition'));
    capabilitiesActions.probe(adapters, 1_000_000);

    const state = useCapabilitiesStore.getState();
    expect(state.capabilities?.geolocation.supported).toBe(true);
    expect(state.capabilities?.speechRecognition.supported).toBe(false);
    expect(state.capabilities?.speechRecognition.reason).toContain('SpeechRecognition');
    expect(state.probedAtMs).toBe(1_000_000);
  });
});

describe('permissions', () => {
  it('reads passively without prompting anything', async () => {
    adapters.notifications.mock.setPermission('denied');
    await capabilitiesActions.readPermissions(adapters);

    expect(useCapabilitiesStore.getState().permissions.notifications).toBe('denied');
    expect(useCapabilitiesStore.getState().permissions.geolocation).toBe('granted');
    // Nothing was prompted: `request()` was never called on any adapter.
    expect(adapters.notifications.mock.requests()).toBe(0);
    expect(adapters.geolocation.mock.requests()).toBe(0);
    expect(adapters.cameraCapture.mock.requests()).toBe(0);
  });

  /**
   * THE REGRESSION THIS FILE EXISTS TO HOLD.
   *
   * `readPermissions` used to gather all fifteen reads with `Promise.all` and
   * publish one map at the end, so the store learned nothing until the SLOWEST
   * adapter answered. Motion is the read that exposed it: on Android its
   * `permission()` is pure feature detection and settles in the first
   * microtask, but the store did not hear about it until
   * `navigator.permissions.query('clipboard-write')` came back -- measured at
   * +8 ms answered, +267 ms published on a real build. For that window SETTINGS
   * drew the motion row from `unknown`, and the window's length varies per
   * launch, which is why the same phone read GRANTED on one load and OPTIONAL
   * on the next.
   *
   * Here the slow adapter never answers at all. A fast read must still be in
   * the store.
   */
  it('publishes a fast read without waiting for a slow one', async () => {
    let releaseClipboard = (): void => {};
    const clipboardStalled = new Promise<PermissionOutcome>((resolve) => {
      releaseClipboard = () => {
        resolve('prompt');
      };
    });
    adapters.clipboard.permission = () => clipboardStalled;

    const all = capabilitiesActions.readPermissions(adapters);
    // One turn of the microtask queue is all a synchronous adapter needs.
    await Promise.resolve();
    await Promise.resolve();

    expect(useCapabilitiesStore.getState().permissions.motion).toBe('granted');
    expect(useCapabilitiesStore.getState().permissions.clipboard).toBeUndefined();

    // And the method still means "all of them have answered" when it resolves.
    releaseClipboard();
    await all;
    expect(useCapabilitiesStore.getState().permissions.clipboard).toBe('prompt');
    // Nothing the fast reads wrote was clobbered by the late one.
    expect(useCapabilitiesStore.getState().permissions.motion).toBe('granted');
  });

  it('prompts only when asked, and records what the platform decided', async () => {
    adapters.motion.mock.setRequestOutcome('denied');
    const outcome = await capabilitiesActions.request(adapters, 'motion');

    expect(outcome).toBe('denied');
    expect(adapters.motion.mock.requests()).toBe(1);
    expect(useCapabilitiesStore.getState().permissions.motion).toBe('denied');
    expect(useCapabilitiesStore.getState().requesting).toBeNull();
  });
});

describe('errors', () => {
  it('keeps the last error per adapter and clears it on demand', () => {
    capabilitiesActions.noteError('geolocation', { code: 'timeout', message: 'no fix in 15s' });
    capabilitiesActions.noteError('network', { code: 'offline', message: 'radio is off' });
    expect(useCapabilitiesStore.getState().errors.geolocation?.code).toBe('timeout');

    capabilitiesActions.noteError('geolocation', null);
    expect(useCapabilitiesStore.getState().errors.geolocation).toBeUndefined();
    expect(useCapabilitiesStore.getState().errors.network?.code).toBe('offline');
  });
});
