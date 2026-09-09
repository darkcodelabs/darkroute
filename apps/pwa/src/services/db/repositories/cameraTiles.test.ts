import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeFwmDb, openFwmDb } from '../index.ts';
import { TILE_HARD_EXPIRY_MS } from '../policy.ts';
import type { CameraRecord } from '../schema.ts';
import type { MemoryIndexedDB } from '../testing/memory-idb.ts';
import { installMemoryIndexedDB } from '../testing/memory-idb.ts';
import { createCameraTilesRepository } from './cameraTiles.ts';
import { createTileMetaRepository } from './tileMeta.ts';
import type { FwmDatabase } from './support.ts';

let memory: MemoryIndexedDB;
let counter = 0;

beforeAll(() => {
  memory = installMemoryIndexedDB();
});

afterAll(() => {
  memory.uninstall();
});

async function freshDb(): Promise<FwmDatabase> {
  return openFwmDb({ name: `fwm-tiles-${String(++counter)}` });
}

function camera(id: string): CameraRecord {
  return { id, lat: 39.0997, lon: -84.5786, directionDeg: 223 };
}

describe('cameraTiles repository', () => {
  it('reads back what it cached, with no network anywhere in the path', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db, { now: () => 1_000 });

    await tiles.put({ z: 14, x: 1, y: 1, cameras: [camera('a')], source: 'network' });
    await tiles.put({ z: 14, x: 1, y: 2, cameras: [camera('b')], source: 'network' });

    await expect(tiles.get([14, 1, 1])).resolves.toMatchObject({ fetchedAt: 1_000 });
    const cameras = await tiles.camerasIn([
      [14, 1, 1],
      [14, 1, 2],
    ]);
    expect(cameras.map((item) => item.id).sort()).toEqual(['a', 'b']);
    closeFwmDb(db);
  });

  it('de-duplicates a camera that appears in two overlapping tiles', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db);
    await tiles.put({ z: 14, x: 1, y: 1, cameras: [camera('shared')], source: 'network' });
    await tiles.put({ z: 14, x: 1, y: 2, cameras: [camera('shared')], source: 'network' });

    const cameras = await tiles.camerasIn([
      [14, 1, 1],
      [14, 1, 2],
    ]);
    expect(cameras).toHaveLength(1);
    closeFwmDb(db);
  });

  it('evicts oldest-fetched tiles first when the cap is exceeded', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db);

    // Written out of order on purpose: eviction must follow fetchedAt, not
    // insertion order and not key order.
    const written: { key: [number, number, number]; fetchedAt: number }[] = [
      { key: [14, 0, 3], fetchedAt: 400 },
      { key: [14, 0, 0], fetchedAt: 100 },
      { key: [14, 0, 4], fetchedAt: 500 },
      { key: [14, 0, 2], fetchedAt: 300 },
      { key: [14, 0, 1], fetchedAt: 200 },
    ];
    for (const item of written) {
      await tiles.put({
        z: item.key[0],
        x: item.key[1],
        y: item.key[2],
        cameras: [camera(`c${String(item.fetchedAt)}`)],
        source: 'network',
        fetchedAt: item.fetchedAt,
      });
    }
    await expect(tiles.count()).resolves.toBe(5);

    const report = await tiles.enforceCap(2);
    expect(report).toEqual({ store: 'cameraTiles', reason: 'cap', evicted: 3 });

    const survivors = await tiles.oldestFirstKeys();
    expect(survivors).toEqual([
      [14, 0, 3],
      [14, 0, 4],
    ]);
    closeFwmDb(db);
  });

  it('drops tiles past the hard expiry and keeps everything newer', async () => {
    const db = await freshDb();
    const now = 10 * TILE_HARD_EXPIRY_MS;
    const tiles = createCameraTilesRepository(db, { now: () => now });

    await tiles.put({
      z: 14,
      x: 2,
      y: 0,
      cameras: [camera('ancient')],
      source: 'network',
      fetchedAt: now - TILE_HARD_EXPIRY_MS - 1,
    });
    await tiles.put({
      z: 14,
      x: 2,
      y: 1,
      cameras: [camera('recent')],
      source: 'network',
      fetchedAt: now - 1_000,
    });

    const report = await tiles.evictExpired();
    expect(report.evicted).toBe(1);
    await expect(tiles.get([14, 2, 0])).resolves.toBeUndefined();
    await expect(tiles.get([14, 2, 1])).resolves.toBeDefined();
    closeFwmDb(db);
  });

  it('does not condemn a good cache over an EXPIRED stray from another generation', async () => {
    /*
     * WHAT THIS ASSERTED BEFORE: nothing - `cacheSnapshot` judged coherence
     * over every row in the store, including rows a real read would have
     * deleted first, and no test noticed.
     *
     * `hydrateTiles` calls `evictExpired()` and THEN `generationSnapshot`. So a
     * month-old row left behind by another generation is gone before coherence
     * is ever considered, and a cold start loads the good tiles happily. The
     * snapshot disagreed: it saw one G1 row and one ancient G2 row, called the
     * cache mixed, and the OFFLINE screen told the driver "The cache holds rows
     * from more than one published snapshot, so none of it is being used" while
     * reporting zero cached cameras.
     *
     * This screen exists to say what a cold offline start would actually get,
     * so that divergence is the screen lying about the one thing it is for.
     */
    const db = await freshDb();
    const now = 10 * TILE_HARD_EXPIRY_MS;
    const G1 = 'a'.repeat(64);
    const tiles = createCameraTilesRepository(db, { now: () => now });

    // A coherent, fresh G1 cache.
    await tiles.replaceAll(null, G1, [
      { z: 14, x: 5, y: 5, cameras: [camera('live-1'), camera('live-2')], source: 'network' },
    ]);
    // Plus one ancient stray from a different generation, which a real read
    // path evicts before it looks at coherence at all.
    await tiles.put({
      z: 14,
      x: 9,
      y: 9,
      cameras: [camera('ancient')],
      source: 'network',
      generation: 'b'.repeat(64),
      fetchedAt: now - TILE_HARD_EXPIRY_MS - 1,
    });

    const snapshot = await tiles.cacheSnapshot();

    // NOT `mixed`, which is the assertion that matters: `mixed` makes
    // `format.ts` print "none of it is being used" unconditionally.
    expect(snapshot.incoherence).not.toBe('mixed');
    // `expired` is the honest answer - there IS an expired row - and it only
    // becomes a "cache unusable" message when `cachedCameras <= 0`
    // (`format.ts:250`), which is exactly the distinction this fix restores.
    expect(snapshot.incoherence).toBe('expired');
    expect(snapshot.usableTiles).toBe(1);
    expect(snapshot.usableCameras).toBe(2);
    expect(snapshot.unusableTiles).toBe(1);
    closeFwmDb(db);
  });

  it('still calls the cache mixed when a LIVE row belongs to another generation', async () => {
    // The other side of the same line: expiry is the only thing filtered out.
    // A fresh stray really does make the cache unusable, and must still say so.
    const db = await freshDb();
    const now = 10 * TILE_HARD_EXPIRY_MS;
    const G1 = 'a'.repeat(64);
    const tiles = createCameraTilesRepository(db, { now: () => now });

    await tiles.replaceAll(null, G1, [
      { z: 14, x: 5, y: 5, cameras: [camera('live-1')], source: 'network' },
    ]);
    await tiles.put({
      z: 14,
      x: 9,
      y: 9,
      cameras: [camera('other-gen')],
      source: 'network',
      generation: 'b'.repeat(64),
      fetchedAt: now - 1_000,
    });

    const snapshot = await tiles.cacheSnapshot();

    expect(snapshot.incoherence).toBe('mixed');
    closeFwmDb(db);
  });

  it('removes the freshness row with the tile, so nothing claims a body it lost', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db, { now: () => 5_000 });
    const meta = createTileMetaRepository(db, { now: () => 5_000 });

    await tiles.put({ z: 14, x: 3, y: 3, cameras: [camera('x')], source: 'network' });
    await meta.markChecked({ z: 14, x: 3, y: 3, cameraCount: 1 });
    await expect(meta.freshnessOf([14, 3, 3])).resolves.toBe('fresh');

    await tiles.remove([14, 3, 3]);
    await expect(meta.get([14, 3, 3])).resolves.toBeUndefined();
    await expect(meta.freshnessOf([14, 3, 3])).resolves.toBe('unknown');
    closeFwmDb(db);
  });

  it('counts cached cameras the way the OFFLINE screen reports them', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db);
    await tiles.put({ z: 14, x: 4, y: 0, cameras: [camera('a'), camera('b')], source: 'network' });
    await tiles.put({ z: 14, x: 4, y: 1, cameras: [camera('c')], source: 'network' });
    await expect(tiles.cameraCount()).resolves.toBe(3);
    await expect(tiles.count()).resolves.toBe(2);
    closeFwmDb(db);
  });

  it('replaces old tiles and freshness rows in one generation transaction', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db);
    const meta = createTileMetaRepository(db);
    await tiles.put({
      z: 11,
      x: 1,
      y: 1,
      cameras: [camera('deleted')],
      generation: 'a'.repeat(64),
      source: 'network',
    });
    await meta.markChecked({ z: 11, x: 1, y: 1, cameraCount: 1 });

    await tiles.replaceAll(null, 'b'.repeat(64), [
      {
        z: 11,
        x: 2,
        y: 2,
        cameras: [camera('current')],
        generation: 'b'.repeat(64),
        source: 'network',
      },
    ]);

    await expect(tiles.get([11, 1, 1])).resolves.toBeUndefined();
    await expect(meta.get([11, 1, 1])).resolves.toBeUndefined();
    await expect(tiles.get([11, 2, 2])).resolves.toMatchObject({
      generation: 'b'.repeat(64),
    });
    closeFwmDb(db);
  });

  it('rejects a globally mixed DB even when the requested subset looks coherent', async () => {
    const db = await freshDb();
    const tiles = createCameraTilesRepository(db);
    await tiles.putMany([
      {
        z: 11,
        x: 1,
        y: 1,
        cameras: [camera('only-a-requested')],
        generation: 'a'.repeat(64),
        source: 'network',
      },
      {
        z: 11,
        x: 9,
        y: 9,
        cameras: [camera('hidden-b')],
        generation: 'b'.repeat(64),
        source: 'network',
      },
    ]);

    await expect(tiles.generationSnapshot([[11, 1, 1]])).resolves.toBeNull();
    closeFwmDb(db);
  });

  it('rejects a stale tab write after another tab replaces the generation', async () => {
    const db = await freshDb();
    const firstTab = createCameraTilesRepository(db);
    const secondTab = createCameraTilesRepository(db);
    await firstTab.replaceAll(null, 'a'.repeat(64), [
      {
        z: 11,
        x: 1,
        y: 1,
        cameras: [camera('old')],
        source: 'network',
      },
    ]);

    await expect(
      secondTab.replaceAll('a'.repeat(64), 'b'.repeat(64), [
        {
          z: 11,
          x: 2,
          y: 2,
          cameras: [camera('current')],
          source: 'network',
        },
      ]),
    ).resolves.toBe('replaced');
    const staleWrite = firstTab.putManyIfGeneration('a'.repeat(64), [
      {
        z: 11,
        x: 3,
        y: 3,
        cameras: [camera('stale-tab')],
        source: 'network',
      },
    ]);

    await expect(staleWrite).resolves.toBe(0);
    await expect(
      secondTab.generationSnapshot([
        [11, 2, 2],
        [11, 3, 3],
      ]),
    ).resolves.toMatchObject({
      generation: 'b'.repeat(64),
      tiles: [{ cameras: [{ id: 'current' }] }],
    });
    closeFwmDb(db);
  });

  it('does not let a stale competing replacement regress the durable generation', async () => {
    const db = await freshDb();
    const firstTab = createCameraTilesRepository(db);
    const secondTab = createCameraTilesRepository(db);
    const base = '0'.repeat(64);
    await firstTab.replaceAll(null, base, [
      {
        z: 11,
        x: 1,
        y: 1,
        cameras: [camera('base')],
        source: 'network',
      },
    ]);

    await expect(
      secondTab.replaceAll(base, 'b'.repeat(64), [
        {
          z: 11,
          x: 2,
          y: 2,
          cameras: [camera('g2')],
          source: 'network',
        },
      ]),
    ).resolves.toBe('replaced');
    const stale = firstTab.replaceAll(base, 'a'.repeat(64), [
      {
        z: 11,
        x: 3,
        y: 3,
        cameras: [camera('g1-late')],
        source: 'network',
      },
    ]);

    await expect(stale).resolves.toBe('conflict');
    await expect(
      secondTab.generationSnapshot([
        [11, 2, 2],
        [11, 3, 3],
      ]),
    ).resolves.toMatchObject({
      generation: 'b'.repeat(64),
      tiles: [{ cameras: [{ id: 'g2' }] }],
    });
    closeFwmDb(db);
  });
});

describe('tileMeta repository', () => {
  it('reports stale once the staleness window has passed, and never guesses', async () => {
    const db = await freshDb();
    let clock = 1_000;
    const meta = createTileMetaRepository(db, { now: () => clock });

    await expect(meta.freshnessOf([14, 9, 9])).resolves.toBe('unknown');

    await meta.markChecked({ z: 14, x: 9, y: 9, cameraCount: 12, staleAfterMs: 60_000 });
    await expect(meta.freshnessOf([14, 9, 9])).resolves.toBe('fresh');

    clock = 1_000 + 60_001;
    await expect(meta.freshnessOf([14, 9, 9])).resolves.toBe('stale');
    closeFwmDb(db);
  });
});
