/**
 * THE DRIVE SURVIVES A REFRESH.
 *
 * =============================================================================
 * WHY THIS TEST EXISTS
 * =============================================================================
 * The alerts repository was written, tested and correct. The history store had
 * a `hydrate` action, written, tested and correct. NOTHING CONNECTED THEM.
 * Every unit passed while the feature did not exist, and the only symptom was
 * out in the world: refresh mid-drive and the log came back empty, reporting
 * zero as though the drive had not happened.
 *
 * So this test is deliberately not a unit test of either side. It drives the
 * real path - record an alert the way the alert engine does, then boot a fresh
 * store the way a reload does - because the defect lived precisely in the gap
 * that unit tests do not cover.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { openFwmDb, createAlertsRepository } from '../services/db/index.ts';
import type { FwmDatabase } from '../services/db/index.ts';
import { installMemoryIndexedDB } from '../services/db/testing/memory-idb.ts';
import type { MemoryIndexedDB } from '../services/db/testing/memory-idb.ts';
import { historyActions, useHistoryStore } from './history.ts';
import { hydrateHistory, persistAlert, resetHistoryPersistence } from './historyPersistence.ts';
import type { AlertLogEntry } from './history.ts';

let db: FwmDatabase;
let memory: MemoryIndexedDB;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

function entry(over: Partial<AlertLogEntry> = {}): AlertLogEntry {
  return {
    id: 1,
    cameraId: 'FWM-0442',
    label: 'Vine St & 7th',
    atMs: 1_800_000_000_000,
    state: 'in_range',
    previousState: 'approaching',
    distanceFt: 380,
    speedMph: 47,
    headingDeg: 41,
    muted: false,
    outcome: null,
    ...over,
  };
}

/** Wait for the fire-and-forget write to land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

beforeEach(async () => {
  historyActions.reset();
  resetHistoryPersistence();
  db = await openFwmDb();
  await createAlertsRepository(db).clear();
});

afterEach(() => {
  historyActions.reset();
  resetHistoryPersistence();
});

describe('the log round-trips through storage', () => {
  it('SURVIVES A RELOAD: recorded alerts come back into a fresh store', async () => {
    // The whole bug, in one assertion. Before this wiring existed the second
    // half of this test found an empty store.
    historyActions.record(entry({ cameraId: 'FWM-0442', atMs: 1_800_000_000_000 }));
    historyActions.record(entry({ cameraId: 'FWM-0118', atMs: 1_800_000_060_000 }));
    await settle();

    // The reload: RAM is gone, storage is not.
    historyActions.reset();
    expect(useHistoryStore.getState().entries).toHaveLength(0);

    await hydrateHistory();
    const cameras = useHistoryStore.getState().entries.map((row) => row.cameraId);
    expect(cameras).toContain('FWM-0442');
    expect(cameras).toContain('FWM-0118');
  });

  it('keeps a muted alert, because a muted alert still happened', async () => {
    // The product rule from the design doc: muting removes the alert, never the
    // record. If persistence quietly dropped muted rows, exposure counts would
    // fall every time somebody silenced a camera they already know about.
    persistAlert(entry({ cameraId: 'FWM-9001', muted: true }));
    await settle();
    historyActions.reset();

    await hydrateHistory();
    const restored = useHistoryStore
      .getState()
      .entries.find((row) => row.cameraId === 'FWM-9001');
    expect(restored?.muted).toBe(true);
  });

  it('carries the outcome back, so a dismissed alert is not re-raised as new', async () => {
    const repo = createAlertsRepository(db);
    const id = await repo.record({
      cameraId: 'FWM-7000',
      state: 'in_range',
      distanceFt: 100,
      headingDeg: null,
      speedMph: null,
      at: 1_800_000_000_000,
      muted: false,
      dismissed: false,
    });
    await repo.markDismissed(id);

    await hydrateHistory();
    const restored = useHistoryStore
      .getState()
      .entries.find((row) => row.cameraId === 'FWM-7000');
    expect(restored?.outcome).toBe('dismissed');
  });

  it('does not write a transition that is about no camera', async () => {
    // `AlertRecord.cameraId` is non-nullable. Rather than fabricate an id or
    // force a migration, these stay in RAM - and the omission is asserted so
    // nobody later "fixes" it by inventing a camera.
    persistAlert(entry({ cameraId: null, state: 'clear' }));
    await settle();
    historyActions.reset();

    await hydrateHistory();
    expect(useHistoryStore.getState().entries).toHaveLength(0);
  });

  it('gives restored rows distinct ids, so a new record cannot collide', async () => {
    persistAlert(entry({ cameraId: 'FWM-1', atMs: 1_800_000_000_000 }));
    persistAlert(entry({ cameraId: 'FWM-2', atMs: 1_800_000_030_000 }));
    await settle();
    historyActions.reset();
    await hydrateHistory();

    const before = useHistoryStore.getState().entries.map((row) => row.id);
    const fresh = historyActions.record({
      cameraId: 'FWM-3',
      label: null,
      atMs: 1_800_000_090_000,
      state: 'in_range',
      previousState: 'clear',
      distanceFt: 10,
      speedMph: null,
      headingDeg: null,
      muted: false,
    });
    expect(before).not.toContain(fresh);
    const ids = useHistoryStore.getState().entries.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never throws on the alert path when storage is unavailable', async () => {
    // The alert path runs on every position fix. A rejected promise there is
    // worse than a lost row, so the write swallows its own failures.
    resetHistoryPersistence();
    expect(() => {
      persistAlert(entry({ cameraId: 'FWM-OK' }));
    }).not.toThrow();
    await settle();
  });
});
