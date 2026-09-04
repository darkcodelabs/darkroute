/**
 * The cache read, against the real repositories and a real IndexedDB shape.
 *
 * Nothing here fakes a count. Tiles are written through
 * `createCameraTilesRepository` and checked through `createTileMetaRepository`,
 * which is the same path the sync layer uses, so a screen that agreed with a
 * hand-built snapshot and disagreed with the database would fail here.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  closeFwmDb,
  createCameraTilesRepository,
  createTileMetaRepository,
  openFwmDb,
} from '../../services/db';
import type { CameraRecord } from '../../services/db';
import { TILE_HARD_EXPIRY_MS } from '../../services/db';
import type { MemoryIndexedDB } from '../../services/db/testing/memory-idb.ts';
import {
  MemoryIDBDatabase,
  MemoryIDBOpenDBRequest,
  installMemoryIndexedDB,
} from '../../services/db/testing/memory-idb.ts';

import { readOfflineCache } from './cache.ts';

const NOW = 1_760_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

function camera(id: string): CameraRecord {
  return { id, lat: 39.0997, lon: -84.5786, directionDeg: 223 };
}

/** Seed the real `fwm` database the screen reads. */
async function seed(
  tiles: readonly { z: number; x: number; y: number; cameras: number; checkedAt: number }[],
): Promise<void> {
  const db = await openFwmDb();
  try {
    const tileRepo = createCameraTilesRepository(db, { now: () => NOW });
    const metaRepo = createTileMetaRepository(db, { now: () => NOW });
    for (const tile of tiles) {
      const cameras = Array.from({ length: tile.cameras }, (_unused, index) =>
        camera(`cam-${String(tile.x)}-${String(index)}`),
      );
      await tileRepo.put({ z: tile.z, x: tile.x, y: tile.y, cameras, source: 'network' });
      await metaRepo.markChecked({
        z: tile.z,
        x: tile.x,
        y: tile.y,
        cameraCount: tile.cameras,
        checkedAt: tile.checkedAt,
      });
    }
  } finally {
    closeFwmDb(db);
  }
}

/**
 * Seed tiles through the ONLY write API the repo has for them, which writes the
 * tile body and nothing else. `checkedAt` is optional here on purpose: nothing
 * outside a test calls `markChecked`, so "cached but never checked" is the
 * ordinary state of a real device, not an edge case.
 */
async function seedTiles(
  tiles: readonly {
    z: number;
    x: number;
    y: number;
    cameraIds: readonly string[];
    fetchedAt: number;
    checkedAt?: number;
  }[],
): Promise<void> {
  const db = await openFwmDb();
  try {
    const tileRepo = createCameraTilesRepository(db, { now: () => NOW });
    const metaRepo = createTileMetaRepository(db, { now: () => NOW });
    for (const tile of tiles) {
      await tileRepo.put({
        z: tile.z,
        x: tile.x,
        y: tile.y,
        cameras: tile.cameraIds.map((id) => camera(id)),
        source: 'network',
        fetchedAt: tile.fetchedAt,
      });
      if (tile.checkedAt !== undefined) {
        await metaRepo.markChecked({
          z: tile.z,
          x: tile.x,
          y: tile.y,
          cameraCount: tile.cameraIds.length,
          checkedAt: tile.checkedAt,
        });
      }
    }
  } finally {
    closeFwmDb(db);
  }
}

describe('reading what is actually cached', () => {
  it('counts the cameras and the tiles that are on disk', async () => {
    await seed([
      { z: 14, x: 1, y: 1, cameras: 3, checkedAt: NOW - DAY_MS },
      { z: 14, x: 2, y: 1, cameras: 4, checkedAt: NOW - DAY_MS },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.cachedCameras).toBe(7);
    expect(read.snapshot.cachedTiles).toBe(2);
  });

  it('reports the oldest check, not the newest, as the age of the database', async () => {
    await seed([
      { z: 14, x: 1, y: 1, cameras: 1, checkedAt: NOW - 2 * DAY_MS },
      { z: 14, x: 2, y: 1, cameras: 1, checkedAt: NOW - 1000 },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    // A tile last checked two days ago can be missing cameras added since,
    // whatever its neighbours say.
    expect(read.snapshot.oldestCheckedAtMs).toBe(NOW - 2 * DAY_MS);
  });

  it('counts a camera in two overlapping tiles once', async () => {
    // "tiles overlap at their edges, and a camera that appears in two tiles is
    // one camera, not two alerts" -- cameraTiles.camerasIn. The headline
    // counter has to obey the same rule or it overstates the cache.
    await seedTiles([
      { z: 14, x: 1, y: 1, cameraIds: ['edge', 'a'], fetchedAt: NOW - DAY_MS },
      { z: 14, x: 2, y: 1, cameraIds: ['edge', 'b'], fetchedAt: NOW - DAY_MS },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.cachedCameras).toBe(3);
    expect(read.snapshot.cachedTiles).toBe(2);
  });

  it('dates a cache that was written and never checked, without calling it empty', async () => {
    // `cameraTiles.put()` writes the tile body only. Nothing outside a test
    // calls `markChecked`, so this is what an ordinary filled cache looks like.
    await seedTiles([
      { z: 14, x: 1, y: 1, cameraIds: ['a', 'b'], fetchedAt: NOW - 2 * DAY_MS },
      { z: 14, x: 2, y: 1, cameraIds: ['c'], fetchedAt: NOW - 1000 },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.cachedCameras).toBe(3);
    // No tileMeta row exists, so there is no check to report ...
    expect(read.snapshot.oldestCheckedAtMs).toBeNull();
    // ... and the oldest fetch is the only age the database can give.
    expect(read.snapshot.oldestFetchedAtMs).toBe(NOW - 2 * DAY_MS);
  });

  it('has no age at all when the database is empty', async () => {
    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    // The whole snapshot, which is now seven fields rather than four: the read
    // also reports what it REFUSED and which generation is on disk. An empty
    // database refused nothing -- "nothing is cached" and "what is cached
    // cannot be used" are different sentences on the screen, and this pins
    // that an empty database says the first one.
    expect(read.snapshot).toEqual({
      cachedCameras: 0,
      cachedTiles: 0,
      unusableTiles: 0,
      incoherence: 'none',
      generation: null,
      oldestCheckedAtMs: null,
      oldestFetchedAtMs: null,
    });
  });
});

describe('the read never writes', () => {
  /** Every row in both stores, bodies included. */
  async function dump(): Promise<{ tiles: unknown; meta: unknown }> {
    const db = await openFwmDb();
    try {
      const tiles = createCameraTilesRepository(db, { now: () => NOW });
      const meta = createTileMetaRepository(db, { now: () => NOW });
      const keys = await tiles.oldestFirstKeys();
      return {
        tiles: await tiles.getMany(keys),
        meta: await Promise.all(keys.map((key) => meta.get(key))),
      };
    } finally {
      closeFwmDb(db);
    }
  }

  it('leaves both stores byte-for-byte as it found them', async () => {
    await seedTiles([
      { z: 14, x: 1, y: 1, cameraIds: ['a', 'b'], fetchedAt: NOW - DAY_MS, checkedAt: NOW - DAY_MS },
      { z: 14, x: 2, y: 1, cameraIds: ['c'], fetchedAt: NOW - 2 * DAY_MS },
    ]);
    const before = await dump();

    await readOfflineCache({ now: () => NOW });

    // The whole record, not just its count: a read that rewrote `cameras`,
    // `fetchedAt`, `source` or `etag`, or that evicted and re-inserted a row,
    // would pass a count-only assertion.
    expect(await dump()).toEqual(before);
  });

  it('does not mark anything checked by the act of looking at it', async () => {
    await seedTiles([{ z: 14, x: 1, y: 1, cameraIds: ['a'], fetchedAt: NOW - DAY_MS }]);

    await readOfflineCache({ now: () => NOW });

    const db = await openFwmDb();
    try {
      expect(await createTileMetaRepository(db).count()).toBe(0);
    } finally {
      closeFwmDb(db);
    }
  });
});

describe('the read advertises only what a cold offline start would get', () => {
  const G1 = 'a'.repeat(64);
  const G2 = 'b'.repeat(64);

  /** Install a coherent durable generation the way the sync layer does. */
  async function install(
    generation: string,
    tiles: readonly { x: number; cameras: readonly string[]; fetchedAt: number }[],
  ): Promise<void> {
    const db = await openFwmDb();
    try {
      await createCameraTilesRepository(db, { now: () => NOW }).replaceAll(
        null,
        generation,
        tiles.map((tile) => ({
          z: 11,
          x: tile.x,
          y: 1,
          cameras: tile.cameras.map((id) => camera(id)),
          generation,
          source: 'network' as const,
          fetchedAt: tile.fetchedAt,
        })),
      );
    } finally {
      closeFwmDb(db);
    }
  }

  it('refuses rows past the hard expiry instead of counting them as cached', async () => {
    // `hydrateTiles` evicts these before it reads, so a screen that counted
    // them was promising an offline capability the app would not deliver --
    // two readers of the same bytes, opposite answers, and the reassuring one
    // was the one on screen.
    await install(G1, [
      { x: 1, cameras: ['a', 'b'], fetchedAt: NOW - TILE_HARD_EXPIRY_MS - DAY_MS },
      { x: 2, cameras: ['c'], fetchedAt: NOW - TILE_HARD_EXPIRY_MS - DAY_MS },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.cachedCameras).toBe(0);
    expect(read.snapshot.cachedTiles).toBe(0);
    // Still on disk, and said so: "nothing is cached" and "what is cached is
    // too old to use" are different sentences on this screen.
    expect(read.snapshot.unusableTiles).toBe(2);
    expect(read.snapshot.incoherence).toBe('expired');
  });

  it('counts the rows inside the window and refuses only the ones past it', async () => {
    await install(G1, [
      { x: 1, cameras: ['a', 'b'], fetchedAt: NOW - DAY_MS },
      { x: 2, cameras: ['c'], fetchedAt: NOW - TILE_HARD_EXPIRY_MS - DAY_MS },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.cachedCameras).toBe(2);
    expect(read.snapshot.cachedTiles).toBe(1);
    expect(read.snapshot.unusableTiles).toBe(1);
    // The age reported is the age of the rows being COUNTED. The expired row's
    // `fetchedAt` would have made the cache look a month older than the copy
    // the app would actually use.
    expect(read.snapshot.oldestFetchedAtMs).toBe(NOW - DAY_MS);
  });

  it('refuses a cache mixed across two generations, whole', async () => {
    // What a half-finished replacement leaves behind. `generationSnapshot`
    // refuses the entire cache in this state, so counting the majority would
    // advertise cameras no cold start will ever load.
    await install(G1, [{ x: 1, cameras: ['a', 'b'], fetchedAt: NOW - DAY_MS }]);
    const db = await openFwmDb();
    try {
      await createCameraTilesRepository(db, { now: () => NOW }).putMany([
        {
          z: 11,
          x: 2,
          y: 1,
          cameras: [camera('stray')],
          generation: G2,
          source: 'network',
          fetchedAt: NOW - DAY_MS,
        },
      ]);
    } finally {
      closeFwmDb(db);
    }

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.cachedCameras).toBe(0);
    expect(read.snapshot.cachedTiles).toBe(0);
    expect(read.snapshot.unusableTiles).toBe(2);
    expect(read.snapshot.incoherence).toBe('mixed');
  });

  it('reports which generation is on disk, so the screen can compare it', async () => {
    await install(G1, [{ x: 1, cameras: ['a'], fetchedAt: NOW - DAY_MS }]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.generation).toBe(G1);
    expect(read.snapshot.incoherence).toBe('none');
  });

  it('does not call a legacy generationless cache incoherent', async () => {
    // A cache written before the generation protocol carries no sentinel and
    // no per-row generation. It is coherent -- with itself -- and hydration
    // accepts it, so this read must not refuse it.
    await seedTiles([
      { z: 11, x: 1, y: 1, cameraIds: ['a', 'b'], fetchedAt: NOW - DAY_MS },
    ]);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    if (read.status !== 'ready') return;
    expect(read.snapshot.generation).toBeNull();
    expect(read.snapshot.incoherence).toBe('none');
    expect(read.snapshot.cachedCameras).toBe(2);
  });
});

describe('the four numbers describe one instant', () => {
  it('takes them in a single readonly transaction over all three stores', async () => {
    /*
     * THE DEFECT THIS CLOSES. The screen assembled its counters from five
     * separate transactions -- `count()`, `oldestFirstKeys()`, `camerasIn()`,
     * `get()`, `oldestCheckedAt()`. A generation replacement from the sync
     * layer committing between any two of them produced a screen that
     * contradicted itself: MAP TILES 4 beside CACHED CAMS 0, and
     * `resolveCapabilities` turning that zero into "cached alerts: NO" next to
     * a tile counter saying four were held.
     *
     * Counting transactions is the assertion because ONE transaction is the
     * fix. The in-memory double explicitly does not model cross-connection
     * concurrency (see its header), so a timing test here would prove nothing
     * about a real browser; the structural property is what carries over.
     */
    await seedTiles([
      { z: 11, x: 1, y: 1, cameraIds: ['a', 'b'], fetchedAt: NOW - DAY_MS, checkedAt: NOW - DAY_MS },
      { z: 11, x: 2, y: 1, cameraIds: ['c'], fetchedAt: NOW - DAY_MS },
    ]);
    const opened = vi.spyOn(MemoryIDBDatabase.prototype, 'transaction');

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('ready');
    expect(opened.mock.calls).toHaveLength(1);
    expect(opened.mock.calls[0]?.[0]).toEqual(['cameraCacheState', 'cameraTiles', 'tileMeta']);
    expect(opened.mock.calls[0]?.[1]).toBe('readonly');
  });
});

describe('a database that will not open', () => {
  it('gives up on a blocked upgrade instead of leaving the screen unknown for ever', async () => {
    /*
     * WHAT A VERSION-BLOCKED OPEN LOOKS LIKE AT THE REQUEST BOUNDARY: `blocked`
     * fires and `success` never does, for as long as the other tab holds its
     * connection. `openFwmDb` reports the block through its hook and keeps
     * waiting, so this read never settled at all -- `cachePort()` stayed
     * pending, storage stayed `unknown`, and the OFFLINE screen sat on em-dashes
     * for the rest of the session while the drive path had already given up.
     */
    const stuck = new MemoryIDBOpenDBRequest();
    vi.spyOn(memory.factory, 'open').mockReturnValue(stuck);
    setTimeout(() => stuck.dispatchEvent(new Event('blocked')), 0);

    const read = await readOfflineCache({ timeoutMs: 25, now: () => NOW });

    expect(read.status).toBe('unavailable');
    if (read.status !== 'unavailable') return;
    expect(read.reason).toContain('did not open in time');
  });
});

describe('a platform with no local storage', () => {
  it('says so instead of throwing at the screen', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const read = await readOfflineCache({ now: () => NOW });

    expect(read.status).toBe('unavailable');
    if (read.status !== 'unavailable') return;
    expect(read.reason).toContain('no IndexedDB');
  });
});
