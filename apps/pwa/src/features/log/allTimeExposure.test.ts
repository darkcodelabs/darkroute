/**
 * The `ALL TIME` read, against the real trips repository and a real IndexedDB
 * shape.
 *
 * Nothing here fakes a total. Trips are written through
 * `createTripsRepository` -- the same path the driving loop will write them
 * through -- and read back through `readAllTimeExposure()`, so a card that
 * agreed with a hand-built snapshot and disagreed with the database would fail
 * here. The audit finding this file answers was that the card was structurally
 * dead: nothing in the app ever loaded the durable count, so `1,284` rendered
 * ` - ` on every run for ever.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { closeFwmDb, createTripsRepository, openFwmDb } from '../../services/db';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';

import { readAllTimeExposure, resolveAllTime } from './allTimeExposure.ts';

/** 1 Mar 2026 -- the `SINCE MAR 2026` the design prints. */
const MARCH = new Date(2026, 2, 1, 9, 30).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

interface Trip {
  readonly startedAt: number;
  readonly exposureCount: number;
}

/** Seed the real `fwm` database the screen reads, through the real repository. */
async function seed(trips: readonly Trip[]): Promise<void> {
  const db = await openFwmDb();
  try {
    const repo = createTripsRepository(db);
    for (const trip of trips) {
      const id = await repo.start(trip.startedAt);
      await repo.finish(id, {
        endedAt: trip.startedAt + 1_800_000,
        distanceMi: 12,
        cameraIdsPassed: [],
        exposureCount: trip.exposureCount,
      });
    }
  } finally {
    closeFwmDb(db);
  }
}

// The no-IndexedDB case has to run before the double is installed, which is
// why it is first in the file: `installMemoryIndexedDB` is a `beforeAll` of the
// suite below it.
describe('a device with no IndexedDB', () => {
  it('says nothing was stored rather than reporting a zero', async () => {
    const read = await readAllTimeExposure();

    expect(read.status).toBe('unavailable');
    expect(resolveAllTime(null, null, read)).toEqual({ passes: null, sinceMs: null });
  });
});

describe('the durable ALL TIME figure', () => {
  let memory: MemoryIndexedDB;

  beforeAll(() => {
    memory = installMemoryIndexedDB();
  });

  afterEach(() => {
    memory.reset();
  });

  afterAll(() => {
    memory.uninstall();
  });

  it('sums the exposure of every recorded trip and dates the record from the oldest', async () => {
    await seed([
      { startedAt: MARCH, exposureCount: 1000 },
      { startedAt: MARCH + 30 * DAY_MS, exposureCount: 284 },
    ]);

    const read = await readAllTimeExposure();

    expect(read).toEqual({ status: 'ready', passes: 1284, sinceMs: MARCH });
  });

  it('reports a real zero for a driver whose trips read no cameras', async () => {
    await seed([{ startedAt: MARCH, exposureCount: 0 }]);

    expect(await readAllTimeExposure()).toEqual({ status: 'ready', passes: 0, sinceMs: MARCH });
  });

  it('reports "no trip recorded" rather than a zero on an untouched device', async () => {
    const read = await readAllTimeExposure();

    expect(read.status).toBe('unavailable');
  });

  it('writes nothing: reading the card twice leaves the trip store exactly as it was', async () => {
    await seed([{ startedAt: MARCH, exposureCount: 7 }]);

    await readAllTimeExposure();
    await readAllTimeExposure();

    const db = await openFwmDb();
    try {
      const repo = createTripsRepository(db);
      expect(await repo.count()).toBe(1);
      expect(await repo.totalExposure()).toBe(7);
    } finally {
      closeFwmDb(db);
    }
  });
});

describe('which answer the card takes', () => {
  it('prefers the history slice once something has hydrated it', () => {
    const durable = { status: 'ready', passes: 7, sinceMs: MARCH } as const;

    expect(resolveAllTime(1284, MARCH, durable)).toEqual({ passes: 1284, sinceMs: MARCH });
  });

  it('falls back to the durable read, which is the only source this build has', () => {
    const durable = { status: 'ready', passes: 1284, sinceMs: MARCH } as const;

    expect(resolveAllTime(null, null, durable)).toEqual({ passes: 1284, sinceMs: MARCH });
  });

  it('never dates one source with the other source', () => {
    const durable = { status: 'ready', passes: 7, sinceMs: MARCH } as const;

    // The slice has a total but no `since`. The card prints the total it has
    // and an em dash, rather than dating it from a record it did not come from.
    expect(resolveAllTime(1284, null, durable)).toEqual({ passes: 1284, sinceMs: null });
  });

  it('is two em dashes when neither source has answered', () => {
    expect(resolveAllTime(null, null, null)).toEqual({ passes: null, sinceMs: null });
  });
});
