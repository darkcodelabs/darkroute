/**
 * TILE PERSISTENCE - that a camera survives a reload, and that failing to
 * cache one never takes a drive down.
 *
 * The regression this file exists for: `cameraTiles` had a complete
 * repository, a migration, eviction, a hard expiry and its own tests, and ZERO
 * production callers. Everything below therefore goes through the module the
 * sync actually calls, not through the repository directly - testing the
 * repository again would prove exactly what was already proven while the
 * product forgot every camera between sessions.
 */

import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';

import { installMemoryIndexedDB } from '../db/testing/memory-idb.ts';
import type { MemoryIndexedDB } from '../db/testing/memory-idb.ts';
import type { CameraRecord } from '../db/schema.ts';
import { useCamerasStore } from '../../stores/cameras.ts';
import { resetAllStores } from '../../stores/index.ts';
import {
  hydrateTiles,
  persistTiles,
  replacePersistedTiles,
  resetTileStore,
  sweepTiles,
} from './tileStore.ts';

const CAMERA: CameraRecord = {
  id: 'osm:1',
  lat: 39.11,
  lon: -84.5786,
  directionDeg: 180,
  ownerType: 'police',
};

const REF = { z: 11, x: 537, y: 792 };
const KEY: [number, number, number] = [REF.z, REF.x, REF.y];
const NOW = 1_800_000_000_000;
const GENERATION_A = 'a'.repeat(64);
const GENERATION_B = 'b'.repeat(64);

let memory: MemoryIndexedDB;

async function seedGeneration(
  generation: string,
  tiles: Parameters<typeof replacePersistedTiles>[2],
): Promise<void> {
  expect(await replacePersistedTiles(null, generation, tiles)).toBe('committed');
}

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

beforeEach(() => {
  memory.reset();
  resetTileStore();
  resetAllStores();
});

afterEach(() => {
  resetTileStore();
  resetAllStores();
});

describe('persist then hydrate', () => {
  it('puts a camera back into the memory store after a reload', async () => {
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
    ]);

    // A reload: the memory store is empty and nothing has been fetched.
    resetAllStores();
    expect(useCamerasStore.getState().cameras).toHaveLength(0);

    const loaded = await hydrateTiles([KEY]);
    expect(loaded).toBe(1);
    expect(useCamerasStore.getState().cameras.map((c) => c.id)).toEqual(['osm:1']);
  });

  /**
   * STALE, NEVER FRESH. RADAR draws the difference and the OFFLINE screen
   * reports it. A tile read off disk presented as current would let an old
   * "CLEAR" look like a live one, which is the only lie this cache is in a
   * position to tell.
   */
  it('marks what it loads as stale', async () => {
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
    ]);
    resetAllStores();
    await hydrateTiles([KEY]);
    const tile = useCamerasStore.getState().tiles.get('11/537/792');
    expect(tile?.freshness).toBe('stale');
  });

  it('keeps the fetch time it was written with, so age is real', async () => {
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
    ]);
    resetAllStores();
    await hydrateTiles([KEY]);
    expect(useCamerasStore.getState().tiles.get('11/537/792')?.fetchedAtMs).toBe(NOW);
  });

  it('says nothing was loaded for a square it has never seen', async () => {
    expect(await hydrateTiles([[11, 1, 1]])).toBe(0);
    expect(useCamerasStore.getState().cameras).toHaveLength(0);
  });

  it('does no work at all for an empty request', async () => {
    expect(await persistTiles([])).toBe(0);
    expect(await hydrateTiles([])).toBe(0);
  });

  it('does not hydrate a stale IndexedDB generation under the current identity', async () => {
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
    ]);
    resetAllStores();

    expect(await hydrateTiles([KEY], GENERATION_B)).toBe(0);
    expect(useCamerasStore.getState().cameras).toEqual([]);
    expect(useCamerasStore.getState().generation).toBeNull();
  });

  it('evicts a tile past hard expiry instead of hydrating it on a cold offline boot', async () => {
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: 1, generation: GENERATION_A },
    ]);
    resetAllStores();

    expect(await hydrateTiles([KEY], GENERATION_A)).toBe(0);
    expect(useCamerasStore.getState().cameras).toEqual([]);
    expect(await hydrateTiles([KEY], GENERATION_A)).toBe(0);
  });

  it('does not let a late old-generation hydrate roll current memory back', async () => {
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
    ]);
    useCamerasStore.getState().replaceGeneration(GENERATION_B, [
      {
        ref: { ...REF, x: REF.x + 1 },
        cameras: [{ ...CAMERA, id: 'osm:current' }],
        fetchedAtMs: NOW + 1,
        freshness: 'fresh',
        source: 'network',
      },
    ]);

    expect(await hydrateTiles([KEY], GENERATION_A)).toBe(0);
    expect(useCamerasStore.getState().generation).toBe(GENERATION_B);
    expect(useCamerasStore.getState().cameras.map(({ id }) => id)).toEqual(['osm:current']);
  });

  it('refuses an incremental write before a generation sentinel exists', async () => {
    const otherRef = { z: 11, x: 538, y: 792 };
    expect(
      await persistTiles([
        { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
        {
          ref: otherRef,
          cameras: [{ ...CAMERA, id: 'osm:2' }],
          fetchedAtMs: NOW + 1,
          generation: GENERATION_B,
        },
      ]),
    ).toBe(0);
  });

  it('atomically removes old-generation rows when installing a replacement', async () => {
    const replacementRef = { z: 11, x: 538, y: 792 };
    await seedGeneration(GENERATION_A, [
      { ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A },
    ]);
    await expect(
      replacePersistedTiles(GENERATION_A, GENERATION_B, [
        {
          ref: replacementRef,
          cameras: [{ ...CAMERA, id: 'osm:moved', lat: 40 }],
          fetchedAtMs: NOW + 1,
          generation: GENERATION_B,
        },
      ]),
    ).resolves.toBe('committed');
    resetAllStores();

    expect(await hydrateTiles([KEY], GENERATION_B)).toBe(0);
    expect(
      await hydrateTiles([[replacementRef.z, replacementRef.x, replacementRef.y]], GENERATION_B),
    ).toBe(1);
    expect(useCamerasStore.getState().cameras).toMatchObject([{ id: 'osm:moved', lat: 40 }]);
  });
});

describe('when there is no database', () => {
  /**
   * THE PROPERTY THAT MATTERS MOST. IndexedDB can be absent, full, or blocked
   * by a version change in another tab. None of those is a reason to stop
   * warning somebody about a camera, so every entry point reports a count and
   * refuses to throw.
   */
  it('reports zero rather than throwing', async () => {
    memory.uninstall();
    resetTileStore();
    try {
      await expect(
        persistTiles([{ ref: REF, cameras: [CAMERA], fetchedAtMs: NOW, generation: GENERATION_A }]),
      ).resolves.toBe(0);
      await expect(hydrateTiles([KEY])).resolves.toBe(0);
      await expect(sweepTiles()).resolves.toBe(0);
    } finally {
      memory = installMemoryIndexedDB();
      resetTileStore();
    }
  });
});
