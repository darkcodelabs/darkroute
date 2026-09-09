/**
 * The bridge is the only honest path to background location, and the only
 * thing in this codebase allowed to ask for it. Both halves are tested: the
 * exact sentence a web-only platform gets, and the consent gate.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  BackgroundConsentRequiredError,
  NO_BRIDGE_REASON,
  TWA_BRIDGE_GLOBAL,
  TWA_FIX_CALLBACK,
  createTwaLocationBridgeAdapter,
  fixFromBridgePayload,
  twaBridgeCapability,
  type BackgroundConsent,
} from './twaLocationBridge';
import { withGlobals } from './testing/globals';

const CONSENT: BackgroundConsent = { acknowledged: true, grantedAt: 1_787_000_000_000 };

const GOOD_PAYLOAD = JSON.stringify({
  lat: 39.0997,
  lon: -84.5786,
  accuracyM: 4,
  speedMps: 21,
  headingDeg: 223,
  timestamp: 1_787_000_000_000,
});

function fakeBridge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getBridgeVersion: () => '1.0.0',
    hasBackgroundLocationPermission: () => false,
    requestBackgroundLocationPermission: vi.fn(),
    startBackgroundUpdates: vi.fn(() => true),
    stopBackgroundUpdates: vi.fn(),
    getLastFix: () => GOOD_PAYLOAD,
    ...overrides,
  };
}

function callback(): ((payload: string) => void) | undefined {
  const bag = globalThis as unknown as Record<string, unknown>;
  const fn = bag[TWA_FIX_CALLBACK];
  return typeof fn === 'function' ? (fn as (payload: string) => void) : undefined;
}

describe('no bridge', () => {
  it('reports the exact sentence the product promises', () => {
    const capability = twaBridgeCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toBe(NO_BRIDGE_REASON);
  });

  it('starts nothing, tracks nothing, and does not throw', () => {
    const adapter = createTwaLocationBridgeAdapter();
    expect(() => {
      adapter.start();
      adapter.stop();
    }).not.toThrow();
    expect(adapter.error()?.code).toBe('no-bridge');
    expect(adapter.backgroundTracking()).toBe(false);
    expect(adapter.bridgeInfo().present).toBe(false);
    expect(callback()).toBeUndefined();
  });

  it('refuses to start background tracking and says why', () => {
    const adapter = createTwaLocationBridgeAdapter();
    expect(adapter.startBackgroundTracking(CONSENT)).toBe(false);
    expect(adapter.error()?.message).toBe(NO_BRIDGE_REASON);
  });
});

describe('with the shell present', () => {
  it('detects the injected object and describes what it can do', () => {
    withGlobals({ [TWA_BRIDGE_GLOBAL]: fakeBridge() }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      expect(adapter.capability().supported).toBe(true);
      expect(adapter.bridgeInfo()).toEqual({
        present: true,
        version: '1.0.0',
        canRequestPermission: true,
        canTrackInBackground: true,
      });
    });
  });

  it('start() attaches the receive path and never starts background updates', () => {
    const native = fakeBridge();
    withGlobals({ [TWA_BRIDGE_GLOBAL]: native }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      adapter.start();

      expect(native['startBackgroundUpdates']).not.toHaveBeenCalled();
      expect(adapter.backgroundTracking()).toBe(false);
      // The last known fix is picked up, because it already exists.
      expect(adapter.current()?.lat).toBe(39.0997);
      expect(callback()).toBeTypeOf('function');

      adapter.stop();
      expect(callback()).toBeUndefined();
    });
  });

  it('is idempotent on both ends', () => {
    const native = fakeBridge();
    withGlobals({ [TWA_BRIDGE_GLOBAL]: native }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      adapter.start();
      adapter.start();
      adapter.stop();
      adapter.stop();
      expect(native['stopBackgroundUpdates']).not.toHaveBeenCalled();
    });
  });

  it('emits a fix when the native side calls back', () => {
    withGlobals({ [TWA_BRIDGE_GLOBAL]: fakeBridge({ getLastFix: undefined }) }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      const seen: unknown[] = [];
      adapter.subscribe((fix) => seen.push(fix));
      adapter.start();
      callback()?.(GOOD_PAYLOAD);
      expect(seen).toHaveLength(1);
      adapter.stop();
    });
  });

  it('turns background tracking off when the adapter stops', () => {
    const native = fakeBridge();
    withGlobals({ [TWA_BRIDGE_GLOBAL]: native }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      adapter.start();
      expect(adapter.startBackgroundTracking(CONSENT)).toBe(true);
      expect(native['startBackgroundUpdates']).toHaveBeenCalledTimes(1);
      adapter.stop();
      expect(native['stopBackgroundUpdates']).toHaveBeenCalledTimes(1);
      expect(adapter.backgroundTracking()).toBe(false);
    });
  });
});

describe('consent gate', () => {
  it('throws when consent has not been acknowledged', () => {
    withGlobals({ [TWA_BRIDGE_GLOBAL]: fakeBridge() }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      // A caller that reaches for `as` is exactly the caller this guards against.
      const unacknowledged = { acknowledged: false, grantedAt: 0 } as unknown as BackgroundConsent;
      expect(() => adapter.startBackgroundTracking(unacknowledged)).toThrow(
        BackgroundConsentRequiredError,
      );
    });
  });

  it('reports a native refusal instead of claiming tracking started', () => {
    withGlobals(
      { [TWA_BRIDGE_GLOBAL]: fakeBridge({ startBackgroundUpdates: () => false }) },
      () => {
        const adapter = createTwaLocationBridgeAdapter();
        expect(adapter.startBackgroundTracking(CONSENT)).toBe(false);
        expect(adapter.backgroundTracking()).toBe(false);
        expect(adapter.error()?.code).toBe('background-refused');
      },
    );
  });
});

describe('payload validation', () => {
  it('accepts a well-formed fix', () => {
    const fix = fixFromBridgePayload(GOOD_PAYLOAD);
    expect(fix).not.toBeNull();
    expect(fix?.accuracyM).toBe(4);
    expect(fix?.headingDeg).toBe(223);
    expect(fix?.altitudeM).toBeNull();
  });

  it.each([
    ['not json at all', 'nope'],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['a missing coordinate', '{"lon":-84.5,"accuracyM":4,"timestamp":1}'],
    ['a string coordinate', '{"lat":"39","lon":-84.5,"accuracyM":4,"timestamp":1}'],
    ['an out-of-range latitude', '{"lat":91,"lon":-84.5,"accuracyM":4,"timestamp":1}'],
    ['an out-of-range longitude', '{"lat":39,"lon":-181,"accuracyM":4,"timestamp":1}'],
    ['a negative accuracy', '{"lat":39,"lon":-84.5,"accuracyM":-1,"timestamp":1}'],
    ['a NaN', '{"lat":null,"lon":-84.5,"accuracyM":4,"timestamp":1}'],
  ])('rejects %s', (_label, payload) => {
    expect(fixFromBridgePayload(payload)).toBeNull();
  });

  it('records a bad payload without writing the payload down', () => {
    withGlobals({ [TWA_BRIDGE_GLOBAL]: fakeBridge({ getLastFix: () => 'garbage' }) }, () => {
      const adapter = createTwaLocationBridgeAdapter();
      adapter.start();
      expect(adapter.error()?.code).toBe('bad-bridge-payload');
      expect(adapter.error()?.message).not.toContain('garbage');
      expect(adapter.current()).toBeNull();
      adapter.stop();
    });
  });
});

describe('background permission', () => {
  it('returns granted without asking when the shell already holds it', async () => {
    const ask = vi.fn();
    const native = fakeBridge({
      hasBackgroundLocationPermission: () => true,
      requestBackgroundLocationPermission: ask,
    });
    const adapter = createTwaLocationBridgeAdapter();
    let outcome: string | undefined;
    await new Promise<void>((resolve) => {
      withGlobals({ [TWA_BRIDGE_GLOBAL]: native }, () => {
        void adapter.request().then((value) => {
          outcome = value;
          resolve();
        });
      });
    });
    expect(outcome).toBe('granted');
    expect(ask).not.toHaveBeenCalled();
  });

  it('reads the permission passively as prompt when it is not held', async () => {
    const native = fakeBridge();
    const adapter = createTwaLocationBridgeAdapter();
    let outcome: string | undefined;
    await new Promise<void>((resolve) => {
      withGlobals({ [TWA_BRIDGE_GLOBAL]: native }, () => {
        void adapter.permission().then((value) => {
          outcome = value;
          resolve();
        });
      });
    });
    expect(outcome).toBe('prompt');
  });
});
