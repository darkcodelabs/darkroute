import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootStores } from './boot.ts';
import { createMemoryPersistPort, installPersistPort, resetPersistPort } from './persist.ts';
import { useSettingsStore } from './settings.ts';

afterEach(() => {
  resetPersistPort();
  vi.useRealTimers();
});

describe('booting the stores', () => {
  it('re-reads the persisted slices after the durable port is installed', async () => {
    // The bug this covers: the stores hydrate at import time, before any port
    // can be opened, so their first read comes from the memory fallback and
    // returns nothing. Installing the port without re-reading would fix writes
    // and leave the read that matters - the one on cold start - still empty.
    const stored = JSON.stringify({
      state: { mode: 'daylight', textScale: 1.25 },
      version: 1,
    });
    const durablePort = {
      durable: true,
      getItem: vi.fn(async (name: string) => (name === 'fwm.settings' ? stored : null)),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
    };

    const result = await bootStores({
      install: async () => installPersistPort(durablePort),
    });

    expect(result.timedOut).toBe(false);
    expect(durablePort.getItem).toHaveBeenCalledWith('fwm.settings');
    expect(useSettingsStore.getState().textScale).toBe(1.25);
    expect(useSettingsStore.getState().durable).toBe(true);
  });

  it('gives up on a database that never answers, rather than never painting', async () => {
    // A blocked IndexedDB upgrade from another open tab never resolves. An app
    // that waits forever shows nothing at all.
    vi.useFakeTimers();
    const boot = bootStores({
      deadlineMs: 1_000,
      install: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(1_000);

    const result = await boot;

    expect(result.timedOut).toBe(true);
    expect(result.durable).toBe(false);
  });

  it('reports non-durable honestly when the installed port is the memory one', async () => {
    const result = await bootStores({
      install: async () => installPersistPort(createMemoryPersistPort()),
    });

    expect(result.timedOut).toBe(false);
    expect(result.durable).toBe(false);
    expect(useSettingsStore.getState().durabilityReason).toContain('memory');
  });
});
