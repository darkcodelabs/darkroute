/**
 * The contract every adapter keeps, checked against every adapter.
 *
 * These are the rules that make an adapter safe to hand to a screen: it never
 * throws on a platform that cannot do the job, it says why, start/stop are
 * idempotent, and unsubscribe actually unsubscribes. A new adapter added to
 * ADAPTER_NAMES is covered here the moment it is added.
 */

import { describe, expect, it } from 'vitest';
import { ADAPTER_NAMES, type Adapter } from './types';
import { capabilityReport, createPlatformAdapters, listAdapters, stopAll } from './set';
import { CAPABILITY_GLOBALS, withGlobals, withGlobalsAsync } from './testing/globals';
import { createMockAdapters } from './testing/mocks';

type AnyAdapter = Adapter<unknown, never>;

function adapterNamed(name: string): AnyAdapter {
  const set = createPlatformAdapters();
  return set[name as keyof typeof set] as unknown as AnyAdapter;
}

describe('adapter set', () => {
  it('exposes exactly one adapter per declared name, each naming itself', () => {
    const set = createPlatformAdapters();
    expect(listAdapters(set)).toHaveLength(ADAPTER_NAMES.length);
    for (const name of ADAPTER_NAMES) {
      expect(set[name].name).toBe(name);
    }
  });

  it('probes every capability without throwing on this platform', () => {
    const report = capabilityReport(createPlatformAdapters());
    for (const name of ADAPTER_NAMES) {
      const capability = report[name];
      expect(typeof capability.supported).toBe('boolean');
      if (!capability.supported) {
        expect(capability.reason).toBeTruthy();
      }
    }
  });

  it('stops everything without having started anything', () => {
    expect(() => {
      stopAll(createPlatformAdapters());
    }).not.toThrow();
  });
});

describe.each(ADAPTER_NAMES)('%s adapter, with its api deleted from globalThis', (name) => {
  const patch = CAPABILITY_GLOBALS[name] ?? {};

  it('reports supported:false with a readable reason instead of throwing', () => {
    withGlobals(patch, () => {
      const capability = adapterNamed(name).capability();
      expect(capability.supported).toBe(false);
      expect(typeof capability.reason).toBe('string');
      expect((capability.reason ?? '').length).toBeGreaterThan(0);
    });
  });

  it('survives start/stop, records an error, and never invents a value', () => {
    withGlobals(patch, () => {
      const adapter = adapterNamed(name);
      expect(() => {
        // Idempotence on the unhappy path: twice each, in both orders.
        void adapter.start();
        void adapter.start();
        adapter.stop();
        adapter.stop();
      }).not.toThrow();

      const error = adapter.error();
      expect(error).not.toBeNull();
      expect(error?.code).toBeTruthy();
      expect(error?.message).toBeTruthy();
      expect(adapter.current()).toBeNull();
    });
  });

  it('never resolves permission() or request() to a granted state it cannot back up', async () => {
    await withGlobalsAsync(patch, async () => {
      const adapter = adapterNamed(name);
      if (adapter.permission) {
        await expect(adapter.permission()).resolves.toBe('unavailable');
      }
      if (adapter.request) {
        await expect(adapter.request()).resolves.toBe('unavailable');
      }
    });
  });

  it('hands back an unsubscribe that stops delivery', () => {
    withGlobals(patch, () => {
      const adapter = adapterNamed(name);
      let calls = 0;
      const unsubscribe = adapter.subscribe(() => {
        calls += 1;
      });
      expect(typeof unsubscribe).toBe('function');
      expect(() => {
        unsubscribe();
        unsubscribe(); // idempotent
      }).not.toThrow();
      expect(calls).toBe(0);
    });
  });
});

describe('adapters that this runtime does support', () => {
  // jsdom ships DeviceOrientationEvent, DeviceMotionEvent, navigator.onLine and
  // a document, so these four exercise the happy path for start/stop.
  const supportedHere = ['orientation', 'motion', 'network', 'visibility'] as const;

  it.each(supportedHere)('%s: start is idempotent and leaves no error', (name) => {
    const adapter = adapterNamed(name);
    expect(adapter.capability().supported).toBe(true);

    void adapter.start();
    void adapter.start();
    expect(adapter.error()).toBeNull();

    adapter.stop();
    adapter.stop();
    expect(adapter.error()).toBeNull();
  });

  it('network emits its state immediately on start, and stops delivering after unsubscribe', () => {
    const adapter = createPlatformAdapters().network;
    const seen: unknown[] = [];
    const unsubscribe = adapter.subscribe((value) => seen.push(value));

    adapter.start();
    expect(seen).toHaveLength(1);

    unsubscribe();
    adapter.stop();
    adapter.start();
    expect(seen).toHaveLength(1);
    adapter.stop();
  });
});

describe('mock set', () => {
  it('answers the same contract as the real set', () => {
    const mocks = createMockAdapters();
    for (const name of ADAPTER_NAMES) {
      const adapter = mocks[name] as unknown as AnyAdapter;
      expect(adapter.name).toBe(name);
      expect(typeof adapter.capability).toBe('function');
      expect(typeof adapter.start).toBe('function');
      expect(typeof adapter.stop).toBe('function');
      expect(typeof adapter.current).toBe('function');
      expect(typeof adapter.error).toBe('function');
      expect(typeof adapter.subscribe).toBe('function');
    }
  });
});
